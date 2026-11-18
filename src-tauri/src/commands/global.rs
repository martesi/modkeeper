use crate::commands::log_err;
use crate::core::global_service;
use crate::core::registry::AppRegistry;
use crate::models::error::SError;
use crate::models::workspace::{ActivateLibraryInput, CreateLibraryInput, LibraryWorkspace};
use crate::store::app_config::AppSettings;
use tauri::{AppHandle, Manager, State};

/// Apply window vibrancy effect based on OS and theme.
/// Windows tries Mica first and falls back to Acrylic when unavailable.
/// macOS uses the system appearance-based vibrancy material.
#[tauri::command]
#[specta::specta]
pub fn apply_window_effect(app_handle: AppHandle, is_dark: Option<bool>) {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, apply_mica};

        let Some(window) = app_handle.get_webview_window("main") else {
            tracing::warn!("Failed to get main window for window effect");
            return;
        };

        if let Err(mica_error) = apply_mica(&window, is_dark) {
            let color = match is_dark {
                Some(true) | None => Some((18, 18, 18, 125)),
                Some(false) => Some((255, 255, 255, 125)),
            };

            if let Err(acrylic_error) = apply_acrylic(&window, color) {
                tracing::warn!(
                    "Failed to apply Mica ({}) or Acrylic ({}); window effect disabled",
                    mica_error,
                    acrylic_error
                );
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{NSVisualEffectMaterial, apply_vibrancy};

        let Some(window) = app_handle.get_webview_window("main") else {
            tracing::warn!("Failed to get main window for window effect");
            return;
        };

        // AppearanceBased follows system dark/light mode automatically
        if let Err(e) = apply_vibrancy(&window, NSVisualEffectMaterial::AppearanceBased, None, None)
        {
            tracing::warn!("Failed to apply vibrancy effect: {}", e);
        }
    }

    // Suppress unused variable warning on platforms where we don't use these
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = app_handle;
        let _ = is_dark;
        tracing::debug!("Window effects are not supported on this platform");
    }
}

/// The startup command: returns the full workspace and, as the first frontend
/// call, carries the watchdog handoff (C11) and shows the window (prevents an
/// unstyled flash). Also delivers any pending startup config warning once (C12).
#[tauri::command]
#[specta::specta]
pub async fn get_library_workspace(
    app_handle: AppHandle,
    state: State<'_, AppRegistry>,
) -> Result<LibraryWorkspace, SError> {
    let config_handle = state.app_config.clone();
    let instance_handle = state.active_instance.clone();
    let warning_handle = state.config_warning.clone();

    let result = match state.wait_for_initial_library_load().await {
        Ok(()) => log_err(
            tauri::async_runtime::spawn_blocking(move || {
                let store = config_handle.lock();
                let instance = instance_handle.lock();
                let warning = warning_handle.lock().take();
                Ok(global_service::assemble_workspace(
                    &store.config,
                    instance.as_ref(),
                    warning,
                ))
            })
            .await
            .map_err(|error| SError::AsyncRuntimeError(error.to_string()))
            .and_then(|result| result),
        ),
        Err(error) => log_err(Err(error)),
    };
    state
        .startup_ready
        .store(true, std::sync::atomic::Ordering::Relaxed);

    if let Some(window) = app_handle.get_webview_window("main") {
        if let Err(error) = window.center() {
            tracing::warn!(%error, "could not center the main window after workspace initialization");
        }
        if let Err(error) = window.show() {
            tracing::error!(%error, "could not show the main window after workspace initialization");
        }
        if let Err(error) = window.set_focus() {
            tracing::warn!(%error, "could not focus the main window after workspace initialization");
        }
    } else if result.is_err() {
        tracing::error!("workspace initialization failed and the main window is unavailable");
    }
    result
}

#[tauri::command]
#[specta::specta]
pub async fn activate_library(
    state: State<'_, AppRegistry>,
    input: ActivateLibraryInput,
) -> Result<LibraryWorkspace, SError> {
    let config_handle = state.app_config.clone();
    let instance_handle = state.active_instance.clone();

    log_err(
        tauri::async_runtime::spawn_blocking(move || {
            global_service::activate_library(&config_handle, &instance_handle, &input.library_id)?;

            let store = config_handle.lock();
            let instance = instance_handle.lock();
            Ok(global_service::assemble_workspace(
                &store.config,
                instance.as_ref(),
                None,
            ))
        })
        .await
        .map_err(|e| SError::AsyncRuntimeError(e.to_string()))
        .and_then(|r| r),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn create_library(
    state: State<'_, AppRegistry>,
    input: CreateLibraryInput,
) -> Result<LibraryWorkspace, SError> {
    let config_handle = state.app_config.clone();
    let instance_handle = state.active_instance.clone();

    log_err(
        tauri::async_runtime::spawn_blocking(move || {
            global_service::create_library(&config_handle, &instance_handle, input)?;

            let store = config_handle.lock();
            let instance = instance_handle.lock();
            Ok(global_service::assemble_workspace(
                &store.config,
                instance.as_ref(),
                None,
            ))
        })
        .await
        .map_err(|e| SError::AsyncRuntimeError(e.to_string()))
        .and_then(|r| r),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn get_settings(state: State<'_, AppRegistry>) -> Result<AppSettings, SError> {
    Ok(global_service::get_settings(&state.app_config.lock()))
}

#[tauri::command]
#[specta::specta]
pub async fn save_settings(
    state: State<'_, AppRegistry>,
    settings: AppSettings,
) -> Result<AppSettings, SError> {
    let config_handle = state.app_config.clone();
    log_err(
        tauri::async_runtime::spawn_blocking(move || {
            global_service::save_settings(&mut config_handle.lock(), settings)
        })
        .await
        .map_err(|e| SError::AsyncRuntimeError(e.to_string()))
        .and_then(|r| r),
    )
}
