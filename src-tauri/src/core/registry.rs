use crate::config::global::GlobalConfig;
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
#[cfg(target_os = "windows")]
use sysinfo::System;

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
    /// Tracks whether the startup command has been called (watchdog handoff, C11)
    pub init_called: Arc<AtomicBool>,
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
}

impl Default for AppRegistry {
    fn default() -> Self {
        let old_config = GlobalConfig::load();
        let (app_config, config_warning) = store::load_or_migrate(&old_config);

        Self {
            active_instance: Arc::new(Mutex::new(None)),
            app_config: Arc::new(Mutex::new(app_config)),
            config_warning: Arc::new(Mutex::new(config_warning)),
            in_flight_tasks: Arc::new(Mutex::new(HashSet::new())),
            #[cfg(target_os = "windows")]
            sys: Mutex::new(System::new()),
            init_called: Arc::new(AtomicBool::new(false)),
        }
    }
}
