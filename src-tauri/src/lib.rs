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
use std::sync::Arc;
use tauri_specta::{Builder, collect_commands, collect_events};

#[cfg(debug_assertions)]
use specta_typescript::Typescript;

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
fn export_typescript_bindings(_builder: &Builder<tauri::Wry>) {
    #[cfg(debug_assertions)]
    {
        _builder
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
                    // Stdout can create a console for a Windows GUI executable launched from Explorer.
                    #[cfg(any(debug_assertions, not(target_os = "windows")))]
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
    initial_library_load_complete:
        tokio::sync::watch::Sender<Option<Result<(), String>>>,
) {
    let loader = tauri::async_runtime::spawn_blocking(move || {
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

        if let Some(library_root) = library_root {
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
        }
    });
    tauri::async_runtime::spawn(crate::core::registry::signal_initial_library_load(
        initial_library_load_complete,
        loader,
    ));
}

/// Helper: Watchdog for the startup handshake. If the first workspace has not finished loading
/// within 10 seconds, the frontend would otherwise remain an invisible window and dead-looking
/// process. Show the window anyway so the loading or error surface remains reachable.
fn start_init_timeout_checker(
    app_handle: tauri::AppHandle,
    startup_ready: Arc<std::sync::atomic::AtomicBool>,
    initial_library_load_complete: tokio::sync::watch::Sender<Option<Result<(), String>>>,
) {
    use tauri::Manager;

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

        if !startup_ready.load(std::sync::atomic::Ordering::Relaxed) {
            let mut load_status = initial_library_load_complete.subscribe();
            match load_status.borrow_and_update().clone() {
                None => tracing::error!(
                    timeout_seconds = 10,
                    "startup watchdog expired while the initial library load was still pending; showing the main window"
                ),
                Some(Err(error)) => tracing::error!(
                    timeout_seconds = 10,
                    %error,
                    "startup watchdog observed an initial library load failure; showing the main window"
                ),
                Some(Ok(())) => tracing::error!(
                    timeout_seconds = 10,
                    "startup watchdog expired after library load completed but before the initial workspace request finished; showing the main window"
                ),
            }
            if let Some(window) = app_handle.get_webview_window("main") {
                if let Err(error) = window.show() {
                    tracing::error!(%error, "startup watchdog could not show the main window");
                }
                if let Err(error) = window.set_focus() {
                    tracing::warn!(%error, "startup watchdog could not focus the main window");
                }
            } else {
                tracing::error!("startup watchdog could not find the main webview window");
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
    initial_library_load_complete:
        tokio::sync::watch::Sender<Option<Result<(), String>>>,
    startup_ready: Arc<std::sync::atomic::AtomicBool>,
) -> impl FnOnce(&mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    move |app| {
        // Mount events for the command handler
        builder.mount_events(app);

        // Load the initial library in the background
        load_initial_library(
            config_handle,
            instance_handle,
            warning_handle,
            initial_library_load_complete.clone(),
        );

        // Start timer to check whether the first workspace is ready within 10 seconds
        start_init_timeout_checker(
            app.handle().clone(),
            startup_ready,
            initial_library_load_complete,
        );

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
    let initial_library_load_complete = app_registry.initial_library_load_complete.clone();
    let startup_ready = app_registry.startup_ready.clone();

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
        initial_library_load_complete,
        startup_ready,
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
