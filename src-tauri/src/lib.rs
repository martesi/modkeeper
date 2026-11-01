pub mod commands;
pub mod config;
pub mod core;
pub mod models;
pub mod store;
pub mod utils;

use crate::commands::global::{
    activate_library, apply_window_effect, create_library, get_library_workspace, get_settings,
    save_settings,
};
use crate::commands::library::{
    bulk_update_mods, delete_library, install_mod_archives, rebuild_library_cache, rename_library,
    sync_mods,
};
use crate::core::registry::AppRegistry;
use crate::models::workspace::WorkspaceEvent;
use crate::store::AppConfigStore;
use parking_lot::Mutex;
use specta_typescript::Typescript;
use std::sync::Arc;
use tauri_specta::{Builder, collect_commands, collect_events};

/// Stage 1: Setup command handler with all registered commands
fn setup_command_handler() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            // library
            bulk_update_mods,
            sync_mods,
            install_mod_archives,
            rebuild_library_cache,
            rename_library,
            delete_library,
            // global
            get_library_workspace,
            activate_library,
            create_library,
            apply_window_effect,
            get_settings,
            save_settings,
        ])
        .events(collect_events![WorkspaceEvent])
}

/// Stage 2: Export TypeScript bindings (debug builds only)
fn export_typescript_bindings(builder: &Builder<tauri::Wry>) {
    #[cfg(debug_assertions)]
    {
        builder
            .export(
                // Recent tauri-specta emits inline results; keep the public helper
                // type used by the repository and Result-unwrapping utilities.
                Typescript::default().with_raw(
                    "export type Result<T, E> = { status: 'ok'; data: T } | { status: 'error'; error: E };",
                ),
                "../src/gen/bindings.ts",
            )
            .expect("Failed to export typescript bindings");
    }
}

type ConfigHandle = Arc<Mutex<AppConfigStore>>;
type InstanceHandle = Arc<Mutex<Option<crate::core::library::Library>>>;
type WarningHandle = Arc<Mutex<Option<String>>>;

/// Stage 3: Initialize application state (AppRegistry and handles)
fn initialize_app_state() -> (AppRegistry, ConfigHandle, InstanceHandle, WarningHandle) {
    let app_registry = AppRegistry::default();
    let config_handle = app_registry.app_config.clone();
    let instance_handle = app_registry.active_instance.clone();
    let warning_handle = app_registry.config_warning.clone();

    (app_registry, config_handle, instance_handle, warning_handle)
}

/// Stage 4: Register Tauri plugins
fn register_plugins() -> tauri::Builder<tauri::Wry> {
    use tauri_plugin_log::{Target, TargetKind};

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .targets([
                    Target::new(TargetKind::Stdout),
                    // File sink in the platform log dir (consolidated-spec.md §13);
                    // the English error detail trail lives here (§7g).
                    Target::new(TargetKind::LogDir {
                        file_name: Some("modkeeper".to_string()),
                    }),
                ])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
}

/// Helper: Load the initial library (App Config active_library_id) in a background thread
fn load_initial_library(
    config_handle: ConfigHandle,
    instance_handle: InstanceHandle,
    warning_handle: WarningHandle,
) {
    tauri::async_runtime::spawn_blocking(move || {
        let library_root = {
            let store = config_handle.lock();
            store
                .config
                .app_state
                .active_library_id
                .as_ref()
                .and_then(|id| store.config.find_library(id))
                .map(|known| known.library_root.clone())
        };

        let Some(library_root) = library_root else {
            return;
        };

        match crate::core::library::Library::load(&library_root) {
            Ok(library) => {
                *instance_handle.lock() = Some(library);
            }
            Err(e) => {
                tracing::error!("Failed to load library from {}: {}", library_root, e);
                // Clear the active id on failure to prevent repeated failures;
                // a save failure is logged and surfaced later, never fatal (C12).
                let mut store = config_handle.lock();
                store.config.app_state.active_library_id = None;
                if let Err(save_err) = store.save() {
                    tracing::error!("Failed to persist cleared active library: {save_err}");
                    *warning_handle.lock() = Some(save_err.to_string());
                }
            }
        }
    });
}

/// Helper: Watchdog for the startup handshake. `get_library_workspace` is both the frontend's
/// first backend call and the thing that shows the main window — so if it hasn't arrived within
/// 10 seconds, the frontend almost certainly crashed before its first render, and the failure
/// would otherwise be an invisible window plus a dead-looking process. Show the window anyway so
/// the error surface (boundary screen, devtools) is reachable instead of hard-exiting.
fn start_init_timeout_checker(
    app_handle: tauri::AppHandle,
    init_called: Arc<std::sync::atomic::AtomicBool>,
) {
    use tauri::Manager;

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

        if !init_called.load(std::sync::atomic::Ordering::Relaxed) {
            tracing::error!(
                "get_library_workspace was not called within 10 seconds of setup; the frontend likely crashed before its first backend call. Showing the window so the failure is visible."
            );
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    });
}

/// Stage 5: Setup application (mount events and load initial library)
fn setup_application(
    builder: Builder<tauri::Wry>,
    config_handle: ConfigHandle,
    instance_handle: InstanceHandle,
    warning_handle: WarningHandle,
    init_called: Arc<std::sync::atomic::AtomicBool>,
) -> impl FnOnce(&mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    move |app| {
        // Mount events for the command handler
        builder.mount_events(app);

        // Load the initial library in the background
        load_initial_library(config_handle, instance_handle, warning_handle);

        // Start timer to check if the startup command was called within 10 seconds
        start_init_timeout_checker(app.handle().clone(), init_called);

        Ok(())
    }
}

/// Stage 6-7: Main entry point - orchestrates all initialization stages
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Stage 1: Setup command handler
    let builder = setup_command_handler();

    // Stage 2: Export TypeScript bindings (debug only)
    export_typescript_bindings(&builder);

    // Stage 3: Initialize application state
    let (app_registry, config_handle, instance_handle, warning_handle) = initialize_app_state();
    let init_called = app_registry.init_called.clone();

    // Stage 4: Register plugins
    let tauri_builder = register_plugins();

    // Stage 5: Get invoke handler before moving builder into setup
    let invoke_handler = builder.invoke_handler();

    // Stage 6: Configure application setup
    let setup_fn = setup_application(
        builder,
        config_handle,
        instance_handle,
        warning_handle,
        init_called,
    );

    // Stage 7: Build and run the application
    tauri_builder
        .invoke_handler(invoke_handler)
        .manage(app_registry)
        .setup(setup_fn)
        .run(tauri::generate_context!("tauri.conf.json"))
        .expect("error while running tauri application");
}

/// Export TypeScript bindings. Called by the export_types binary.
pub fn export_bindings() {
    let builder = setup_command_handler();
    export_typescript_bindings(&builder);
}
