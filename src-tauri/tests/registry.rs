mod common;

use camino::Utf8PathBuf;
use common::setup_test_env;
use mod_keeper_lib::core::library::Library;
use mod_keeper_lib::core::registry::AppRegistry;
use mod_keeper_lib::models::error::SError;
use mod_keeper_lib::models::library::LibraryCreationRequirement;
use mod_keeper_lib::store::AppConfigStore;
use mod_keeper_lib::store::app_config::AppConfig;
use parking_lot::Mutex;
use std::collections::HashSet;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
#[cfg(target_os = "windows")]
use sysinfo::System;

// A registry that never touches the real user config (unlike AppRegistry::default)
fn test_registry(tmp: &tempfile::TempDir) -> AppRegistry {
    let path = Utf8PathBuf::from_path_buf(tmp.path().join("app_config.toml")).unwrap();
    AppRegistry {
        active_instance: Arc::new(Mutex::new(None)),
        app_config: Arc::new(Mutex::new(AppConfigStore {
            path,
            config: AppConfig::default(),
        })),
        config_warning: Arc::new(Mutex::new(None)),
        in_flight_tasks: Arc::new(Mutex::new(HashSet::new())),
        #[cfg(target_os = "windows")]
        sys: Mutex::new(System::new()),
        initial_library_load_complete: tokio::sync::watch::channel(None).0,
        startup_ready: Arc::new(AtomicBool::new(false)),
    }
}

#[tokio::test]
async fn startup_library_waits_for_background_load_completion() {
    let (tmp, _game_root, _repo_root) = setup_test_env();
    let registry = test_registry(&tmp);
    let load_complete = registry.initial_library_load_complete.clone();

    let waiting = tokio::spawn(async move { registry.wait_for_initial_library_load().await });
    tokio::task::yield_now().await;
    assert!(!waiting.is_finished());

    load_complete.send_replace(Some(Ok(())));
    waiting
        .await
        .expect("startup wait task should complete")
        .expect("startup load completion should unblock waiters");
}

#[test]
fn test_task_id_in_use_rejected_until_finished() {
    let (_tmp, _game_root, _repo_root) = setup_test_env();
    let registry = test_registry(&_tmp);

    registry.begin_task("task-1").expect("first accept");

    // Reusing an in-flight id is rejected (§7e)
    let reused = registry.begin_task("task-1");
    assert!(matches!(reused, Err(SError::TaskIdInUse(id)) if id == "task-1"));

    // A different id is fine
    registry.begin_task("task-2").expect("independent task");

    // After completion the id becomes usable again
    registry.in_flight_tasks.lock().remove("task-1");
    registry.begin_task("task-1").expect("finished id reusable");
}

#[test]
fn test_assert_active_library_rejects_non_active() {
    let (_tmp, game_root, repo_root) = setup_test_env();
    let registry = test_registry(&_tmp);

    // No active library at all
    assert!(matches!(
        registry.assert_active_library("lib-x"),
        Err(SError::NoActiveLibrary)
    ));

    // Active library present, wrong id → validation error before touching anything
    let library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Lib".to_string(),
    })
    .unwrap();
    let library_id = library.id.clone();
    *registry.active_instance.lock() = Some(library);

    assert!(matches!(
        registry.assert_active_library("not-this-one"),
        Err(SError::InvalidLibrary(id, _)) if id == "not-this-one"
    ));

    // Matching id passes
    registry
        .assert_active_library(&library_id)
        .expect("active id accepted");
}

#[cfg(target_os = "windows")]
#[test]
fn test_process_guard_detects_running_process() {
    let (_tmp, game_root, repo_root) = setup_test_env();
    let registry = test_registry(&_tmp);

    // The guard machinery detects a genuinely running process (this test binary)
    let current = std::env::current_exe().unwrap();
    assert!(registry.is_running(&[current]).unwrap());

    // With an active library whose game/server exes are dummy files (not running),
    // the GameOrServerRunning guard stays quiet
    let library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Lib".to_string(),
    })
    .unwrap();
    *registry.active_instance.lock() = Some(library);
    assert!(!registry.is_game_or_server_running().unwrap());
}

#[cfg(target_os = "windows")]
#[test]
fn test_process_initialization_failure_does_not_report_safe_to_deploy() {
    let (tmp, game_root, repo_root) = setup_test_env();
    let registry = test_registry(&tmp);
    *registry.sys.lock() = Err(sysinfo::Error::Unsupported);
    *registry.active_instance.lock() = Some(
        Library::create(LibraryCreationRequirement {
            repo_root: Some(repo_root),
            game_root,
            name: "Lib".to_string(),
        })
        .unwrap(),
    );

    assert!(matches!(
        registry.is_game_or_server_running(),
        Err(SError::IOError(message)) if message.contains("Unable to inspect running processes")
    ));
}
