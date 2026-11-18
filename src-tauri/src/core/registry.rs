use crate::config::global::GlobalConfig;
use crate::core::deletion;
use crate::core::library::Library;
use crate::core::mod_stager::StageMaterial;
use crate::models::error::SError;
use crate::store::{self, AppConfigStore};
#[cfg(target_os = "windows")]
use crate::utils::process;
use parking_lot::Mutex;
use std::collections::HashSet;
#[cfg(target_os = "windows")]
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Duration;
#[cfg(target_os = "windows")]
use sysinfo::System;

const INITIAL_LIBRARY_LOAD_TIMEOUT: Duration = Duration::from_secs(10);

pub struct AppRegistry {
    // Arc<Mutex<Option>> allows us to "swap" the entire instance safely
    pub active_instance: Arc<Mutex<Option<Library>>>,
    pub app_config: Arc<Mutex<AppConfigStore>>,
    /// Startup config load/save problem to surface once via the frontend (C12).
    pub config_warning: Arc<Mutex<Option<String>>>,
    /// Fire-and-track tasks currently in flight, keyed by client-minted taskId (§7e).
    pub in_flight_tasks: Arc<Mutex<HashSet<String>>>,
    #[cfg(target_os = "windows")]
    pub sys: Mutex<Result<System, sysinfo::Error>>,
    /// Signals when the background load of the configured startup library finishes.
    pub initial_library_load_complete:
        tokio::sync::watch::Sender<Option<Result<(), String>>>,
    /// Tracks completion of the first workspace request (watchdog handoff, C11).
    pub startup_ready: Arc<AtomicBool>,
}

impl AppRegistry {
    #[cfg(target_os = "windows")]
    pub fn is_running<P: AsRef<Path>>(&self, canonical_paths: &[P]) -> Result<bool, SError> {
        let mut system = self.sys.lock();
        let system = system.as_mut().map_err(|error| {
            SError::IOError(format!("Unable to inspect running processes: {error}"))
        })?;
        Ok(process::is_running(system, canonical_paths))
    }

    #[cfg(target_os = "windows")]
    pub fn get_canonical_spt_paths(&self) -> Option<Vec<PathBuf>> {
        self.active_instance
            .lock()
            .as_ref()
            .map(|v| v.spt_canonical_paths())
    }

    /// Exact executable-path matching is a meaningful safety guard only for
    /// native Windows processes. Wine exposes its Unix loader as the process
    /// executable on Linux, so treating a failed match there as "not running"
    /// would provide false confidence.
    #[cfg(target_os = "windows")]
    pub fn is_game_or_server_running(&self) -> Result<bool, SError> {
        self.get_canonical_spt_paths()
            .map(|v| self.is_running(&v))
            .unwrap_or(Ok(false))
    }

    #[cfg(not(target_os = "windows"))]
    pub fn is_game_or_server_running(&self) -> Result<bool, SError> {
        Ok(false)
    }

    pub fn get_stage_material(&self, unknown_mod_name: String) -> Result<StageMaterial, SError> {
        self.active_instance
            .lock()
            .as_ref()
            .map(|v| v.stage_material(unknown_mod_name))
            .ok_or(SError::NoActiveLibrary)
    }

    /// Rejects when the given library is not the currently active one (§7e).
    pub fn assert_active_library(&self, library_id: &str) -> Result<(), SError> {
        match self.active_instance.lock().as_ref() {
            Some(lib) if lib.id == library_id => Ok(()),
            Some(_) => Err(SError::InvalidLibrary(
                library_id.to_string(),
                "not the active library".to_string(),
            )),
            None => Err(SError::NoActiveLibrary),
        }
    }

    /// Registers a client-minted taskId; a reused in-flight id is rejected (§7e).
    pub fn begin_task(&self, task_id: &str) -> Result<(), SError> {
        if self.in_flight_tasks.lock().insert(task_id.to_string()) {
            Ok(())
        } else {
            Err(SError::TaskIdInUse(task_id.to_string()))
        }
    }

    /// Waits for the configured startup library load, bounded by the watchdog budget.
    pub async fn wait_for_initial_library_load(&self) -> Result<(), SError> {
        wait_for_initial_library_load(
            self.initial_library_load_complete.subscribe(),
            INITIAL_LIBRARY_LOAD_TIMEOUT,
        )
        .await
    }
}

async fn wait_for_initial_library_load(
    mut load_complete: tokio::sync::watch::Receiver<Option<Result<(), String>>>,
    timeout: Duration,
) -> Result<(), SError> {
    let wait_for_signal = async {
        loop {
            if let Some(result) = load_complete.borrow_and_update().clone() {
                return result.map_err(|error| {
                    SError::AsyncRuntimeError(format!("Initial library load failed: {error}"))
                });
            }
            load_complete.changed().await.map_err(|error| {
                SError::AsyncRuntimeError(format!(
                    "Initial library load notification failed: {error}"
                ))
            })?;
        }
    };

    tokio::time::timeout(timeout, wait_for_signal)
        .await
        .map_err(|_| {
            SError::AsyncRuntimeError(format!("Initial library load timed out after {timeout:?}"))
        })?
}

/// Publishes completion or the task failure so startup waiters cannot hang on a panicked loader.
pub(crate) async fn signal_initial_library_load(
    load_complete: tokio::sync::watch::Sender<Option<Result<(), String>>>,
    loader: tauri::async_runtime::JoinHandle<()>,
) {
    let result = loader.await.map_err(|error| {
        tracing::error!(%error, "initial library loader task failed");
        error.to_string()
    });
    load_complete.send_replace(Some(result));
}

impl Default for AppRegistry {
    fn default() -> Self {
        let (initial_library_load_complete, _) = tokio::sync::watch::channel(None);
        let old_config = GlobalConfig::load();
        let (app_config, mut config_warning) = store::load_or_migrate(&old_config);
        if config_warning.is_none() {
            if let Err(error) = deletion::recover_pending_deletions(&app_config) {
                tracing::error!("Pending library deletion recovery failed: {error}");
                config_warning = Some(format!("Pending deletion recovery: {error}"));
            }
        } else {
            tracing::warn!(
                "Skipping pending library deletion recovery because app config loading reported a warning"
            );
        }

        Self {
            active_instance: Arc::new(Mutex::new(None)),
            app_config: Arc::new(Mutex::new(app_config)),
            config_warning: Arc::new(Mutex::new(config_warning)),
            in_flight_tasks: Arc::new(Mutex::new(HashSet::new())),
            #[cfg(target_os = "windows")]
            sys: Mutex::new(System::new()),
            initial_library_load_complete,
            startup_ready: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{signal_initial_library_load, wait_for_initial_library_load};
    use std::time::Duration;
    use tokio::sync::watch;

    #[tokio::test]
    async fn initial_library_load_success_wakes_waiters() {
        let (load_complete, _) = watch::channel(None);
        let loader = tauri::async_runtime::spawn(async {});

        signal_initial_library_load(load_complete.clone(), loader).await;

        assert!(
            wait_for_initial_library_load(load_complete.subscribe(), Duration::from_secs(1))
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn loader_panic_wakes_waiters_with_an_error() {
        let (load_complete, _) = watch::channel(None);
        let loader = tauri::async_runtime::spawn(async { panic!("initial loader failed") });

        signal_initial_library_load(load_complete.clone(), loader).await;

        let result =
            wait_for_initial_library_load(load_complete.subscribe(), Duration::from_secs(1)).await;
        assert!(matches!(
            result,
            Err(crate::models::error::SError::AsyncRuntimeError(message))
                if message.contains("Initial library load failed")
        ));
    }

    #[tokio::test]
    async fn stalled_initial_library_load_times_out() {
        let (load_complete, _) = watch::channel(None);

        let result = wait_for_initial_library_load(
            load_complete.subscribe(),
            Duration::from_millis(1),
        )
        .await;
        assert!(matches!(
            result,
            Err(crate::models::error::SError::AsyncRuntimeError(message))
                if message.contains("Initial library load timed out")
        ));
    }
}
