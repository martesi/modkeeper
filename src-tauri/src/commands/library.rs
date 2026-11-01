use crate::commands::log_err;
use crate::core::library::Library;
use crate::core::registry::AppRegistry;
use crate::core::{global_service, library_service};
use crate::models::error::SError;
use crate::models::workspace::{
    BulkUpdateModsInput, CacheState, CacheStatus, DeleteLibraryInput, InstallModArchivesInput,
    LibraryWorkspace, ModFailure, OperationAccepted, RebuildLibraryCacheInput, RenameLibraryInput,
    SyncModsInput, WorkspaceEvent,
};
use crate::store::AppConfigStore;
use crate::utils::time::now_iso8601_utc;
use camino::Utf8PathBuf;
use parking_lot::Mutex;
use std::collections::HashSet;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_specta::Event;

fn assemble_workspace(
    config_handle: &Arc<Mutex<AppConfigStore>>,
    instance_handle: &Arc<Mutex<Option<Library>>>,
) -> LibraryWorkspace {
    let store = config_handle.lock();
    let instance = instance_handle.lock();
    global_service::assemble_workspace(&store.config, instance.as_ref(), None)
}

fn finish_task(tasks: &Arc<Mutex<HashSet<String>>>, task_id: &str) {
    tasks.lock().remove(task_id);
}

#[tauri::command]
#[specta::specta]
pub async fn rename_library(
    state: State<'_, AppRegistry>,
    input: RenameLibraryInput,
) -> Result<LibraryWorkspace, SError> {
    let config_handle = state.app_config.clone();
    let instance_handle = state.active_instance.clone();

    log_err(
        tauri::async_runtime::spawn_blocking(move || {
            global_service::rename_library(
                &config_handle,
                &instance_handle,
                &input.library_id,
                input.name,
            )?;
            Ok(assemble_workspace(&config_handle, &instance_handle))
        })
        .await
        .map_err(|e| SError::AsyncRuntimeError(e.to_string()))
        .and_then(|r| r),
    )
}

/// Two distinct destructive stakes (§7b): deleteFiles removes the registry row
/// AND the library directory (guarded by GameOrServerRunning - delta 2);
/// otherwise only the row goes, so re-adding re-adopts the id (C7).
#[tauri::command]
#[specta::specta]
pub async fn delete_library(
    state: State<'_, AppRegistry>,
    input: DeleteLibraryInput,
) -> Result<LibraryWorkspace, SError> {
    if input.delete_files && state.is_game_or_server_running() {
        return log_err(Err(SError::GameOrServerRunning));
    }

    let config_handle = state.app_config.clone();
    let instance_handle = state.active_instance.clone();

    log_err(
        tauri::async_runtime::spawn_blocking(move || {
            if input.delete_files {
                global_service::delete_library_files(
                    &config_handle,
                    &instance_handle,
                    &input.library_id,
                )?;
            } else {
                global_service::delete_library_entry(
                    &config_handle,
                    &instance_handle,
                    &input.library_id,
                )?;
            }
            Ok(assemble_workspace(&config_handle, &instance_handle))
        })
        .await
        .map_err(|e| SError::AsyncRuntimeError(e.to_string()))
        .and_then(|r| r),
    )
}

/// Plain blocking (delta 3): commits mod state only, never deploys - no
/// symlinks touched, no collision check (C3). Sets deployStale via the dirty flag.
#[tauri::command]
#[specta::specta]
pub async fn bulk_update_mods(
    state: State<'_, AppRegistry>,
    input: BulkUpdateModsInput,
) -> Result<LibraryWorkspace, SError> {
    let config_handle = state.app_config.clone();
    let instance_handle = state.active_instance.clone();

    log_err(
        tauri::async_runtime::spawn_blocking(move || {
            library_service::bulk_update_mods(
                instance_handle.clone(),
                &input.library_id,
                &input.mod_ids,
                &input.action,
            )?;
            Ok(assemble_workspace(&config_handle, &instance_handle))
        })
        .await
        .map_err(|e| SError::AsyncRuntimeError(e.to_string()))
        .and_then(|r| r),
    )
}

/// Fire-and-track (§7e): the Result is the accept; the outcome arrives as a
/// sync_completed event matched by taskId. Keeps the GameOrServerRunning guard
/// (delta 2, reverses C2).
#[tauri::command]
#[specta::specta]
pub async fn sync_mods(
    app: AppHandle,
    state: State<'_, AppRegistry>,
    input: SyncModsInput,
) -> Result<OperationAccepted, SError> {
    log_err((|| {
        if state.is_game_or_server_running() {
            return Err(SError::GameOrServerRunning);
        }
        state.assert_active_library(&input.library_id)?;
        state.begin_task(&input.task_id)
    })())?;

    let config_handle = state.app_config.clone();
    let instance_handle = state.active_instance.clone();
    let tasks = state.in_flight_tasks.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let failures = match library_service::sync_active_library(
            instance_handle.clone(),
            &input.library_id,
        ) {
            Ok(()) => Vec::new(),
            Err(error) => {
                tracing::error!("{error}");
                vec![ModFailure {
                    mod_id: String::new(),
                    error,
                }]
            }
        };

        finish_task(&tasks, &input.task_id);
        let event = WorkspaceEvent::SyncCompleted {
            task_id: input.task_id,
            library_id: input.library_id,
            failures,
            workspace: assemble_workspace(&config_handle, &instance_handle),
        };
        if let Err(e) = event.emit(&app) {
            tracing::error!("Failed to emit sync_completed: {e}");
        }
    });

    Ok(OperationAccepted::new())
}

/// Fire-and-track (§7e): outcome arrives as mod_install_completed carrying
/// per-archive failures (§7b).
#[tauri::command]
#[specta::specta]
pub async fn install_mod_archives(
    app: AppHandle,
    state: State<'_, AppRegistry>,
    input: InstallModArchivesInput,
) -> Result<OperationAccepted, SError> {
    let material = log_err((|| {
        state.assert_active_library(&input.library_id)?;
        let material = state.get_stage_material("Unknown mod".to_string())?;
        state.begin_task(&input.task_id)?;
        Ok(material)
    })())?;

    let enable_on_install = state
        .app_config
        .lock()
        .config
        .settings
        .enable_mods_on_install;
    let config_handle = state.app_config.clone();
    let instance_handle = state.active_instance.clone();
    let tasks = state.in_flight_tasks.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let archives: Vec<Utf8PathBuf> =
            input.archive_paths.iter().map(Utf8PathBuf::from).collect();

        let failures = library_service::install_mod_archives(
            instance_handle.clone(),
            &input.library_id,
            &material,
            &archives,
            enable_on_install,
        );
        for failure in &failures {
            tracing::error!("{}: {}", failure.archive_path, failure.error);
        }

        finish_task(&tasks, &input.task_id);
        let event = WorkspaceEvent::ModInstallCompleted {
            task_id: input.task_id,
            library_id: input.library_id,
            failures,
            workspace: assemble_workspace(&config_handle, &instance_handle),
        };
        if let Err(e) = event.emit(&app) {
            tracing::error!("Failed to emit mod_install_completed: {e}");
        }
    });

    Ok(OperationAccepted::new())
}

/// Fire-and-track (§7e): outcome arrives as cache_rebuild_completed.
/// Rebuild renames only - no backup cleanup, no re-link (C8).
#[tauri::command]
#[specta::specta]
pub async fn rebuild_library_cache(
    app: AppHandle,
    state: State<'_, AppRegistry>,
    input: RebuildLibraryCacheInput,
) -> Result<OperationAccepted, SError> {
    log_err((|| {
        state.assert_active_library(&input.library_id)?;
        state.begin_task(&input.task_id)
    })())?;

    let config_handle = state.app_config.clone();
    let instance_handle = state.active_instance.clone();
    let tasks = state.in_flight_tasks.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let cache_status = match library_service::rebuild_active_library_cache(
            instance_handle.clone(),
            &input.library_id,
        ) {
            Ok(()) => CacheStatus {
                state: CacheState::Ready,
                message: None,
                last_rebuilt_at: Some(now_iso8601_utc()),
            },
            Err(error) => {
                tracing::error!("{error}");
                CacheStatus {
                    state: CacheState::Failed,
                    message: Some(error.to_string()),
                    last_rebuilt_at: None,
                }
            }
        };

        finish_task(&tasks, &input.task_id);
        let event = WorkspaceEvent::CacheRebuildCompleted {
            task_id: input.task_id,
            library_id: input.library_id,
            cache_status,
            workspace: assemble_workspace(&config_handle, &instance_handle),
        };
        if let Err(e) = event.emit(&app) {
            tracing::error!("Failed to emit cache_rebuild_completed: {e}");
        }
    });

    Ok(OperationAccepted::new())
}
