mod common;

use camino::Utf8PathBuf;
use common::setup_test_env;
use mod_keeper_lib::config::global::GlobalConfig;
use mod_keeper_lib::core::library::Library;
use mod_keeper_lib::models::error::SError;
use mod_keeper_lib::models::library::LibraryCreationRequirement;
use mod_keeper_lib::store::app_config::{AppConfig, KnownLibrary, migrate_from_confy};
use mod_keeper_lib::store::{load_from, save_to};
use std::fs;

#[test]
fn test_migration_adopts_manifest_ids() {
    let (_tmp, game_root, _repo_root) = setup_test_env();

    // Create two real libraries with manifests
    let root1 = game_root.join(".mod_keeper_1");
    let lib1 = Library::create(LibraryCreationRequirement {
        repo_root: Some(root1.clone()),
        game_root: game_root.clone(),
        name: "First".to_string(),
    })
    .unwrap();

    let root2 = game_root.join(".mod_keeper_2");
    let lib2 = Library::create(LibraryCreationRequirement {
        repo_root: Some(root2.clone()),
        game_root: game_root.clone(),
        name: "Second".to_string(),
    })
    .unwrap();

    let old = GlobalConfig {
        library_last: Some(root1.clone()),
        library_recent: vec![root2.clone()],
    };

    let migrated = migrate_from_confy(&old);

    // Ids are adopted from each library's manifest.toml, never re-minted (C7)
    assert_eq!(migrated.known_libraries.len(), 2);
    let entry1 = migrated
        .known_libraries
        .iter()
        .find(|l| l.library_root == root1)
        .expect("library 1 registered");
    assert_eq!(entry1.id, lib1.id);
    let entry2 = migrated
        .known_libraries
        .iter()
        .find(|l| l.library_root == root2)
        .expect("library 2 registered");
    assert_eq!(entry2.id, lib2.id);

    // library_last becomes the active library id
    assert_eq!(migrated.app_state.active_library_id, Some(lib1.id));
}

#[test]
fn test_migration_mints_id_only_without_readable_manifest() {
    let (_tmp, game_root, _repo_root) = setup_test_env();

    // A registered path with no manifest at all
    let orphan = game_root.join("orphan_lib");
    fs::create_dir_all(&orphan).unwrap();

    let old = GlobalConfig {
        library_last: None,
        library_recent: vec![orphan.clone()],
    };

    let migrated = migrate_from_confy(&old);

    assert_eq!(migrated.known_libraries.len(), 1);
    let entry = &migrated.known_libraries[0];
    assert_eq!(entry.library_root, orphan);
    // A fresh uuid was minted
    assert!(uuid::Uuid::parse_str(&entry.id).is_ok());
    assert!(migrated.app_state.active_library_id.is_none());
}

#[test]
fn test_load_missing_file_yields_default() {
    let tmp = tempfile::tempdir().unwrap();
    let path = Utf8PathBuf::from_path_buf(tmp.path().join("config.toml")).unwrap();

    let config = load_from(&path).expect("missing file is a normal first run");
    assert!(config.known_libraries.is_empty());
    assert!(config.app_state.active_library_id.is_none());
    assert_eq!(config.settings.accent_color, "default");
}

#[test]
fn test_missing_accent_field_defaults_to_default() {
    let tmp = tempfile::tempdir().unwrap();
    let path = Utf8PathBuf::from_path_buf(tmp.path().join("config.toml")).unwrap();
    fs::write(&path, "[settings]\ntheme = \"system\"").unwrap();

    let config = load_from(&path).expect("partial settings should use defaults");
    assert_eq!(config.settings.accent_color, "default");
}

#[test]
fn test_load_corrupt_file_errors_and_leaves_file_untouched() {
    let tmp = tempfile::tempdir().unwrap();
    let path = Utf8PathBuf::from_path_buf(tmp.path().join("config.toml")).unwrap();
    fs::write(&path, "this is [ not toml").unwrap();

    let result = load_from(&path);
    assert!(matches!(result, Err(SError::ParseError(_))));

    // No silent reset: the corrupt file is still there, unmodified
    assert_eq!(fs::read_to_string(&path).unwrap(), "this is [ not toml");
}

#[test]
fn test_save_round_trip() {
    let tmp = tempfile::tempdir().unwrap();
    let path = Utf8PathBuf::from_path_buf(tmp.path().join("config.toml")).unwrap();

    let mut config = AppConfig::default();
    config.upsert_library(KnownLibrary {
        id: "lib-1".to_string(),
        library_root: Utf8PathBuf::from("C:/games/spt/.mod_keeper"),
    });
    config.app_state.active_library_id = Some("lib-1".to_string());
    config.settings.accent_color = "#123456".to_string();

    save_to(&path, &config).expect("save failed");

    let loaded = load_from(&path).expect("load failed");
    assert_eq!(loaded.known_libraries.len(), 1);
    assert_eq!(loaded.known_libraries[0].id, "lib-1");
    assert_eq!(loaded.app_state.active_library_id.as_deref(), Some("lib-1"));
    assert_eq!(loaded.settings.accent_color, "#123456");

    // No temp file left behind
    let leftovers: Vec<_> = fs::read_dir(tmp.path())
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
        .collect();
    assert!(leftovers.is_empty(), "atomic_write left a temp file behind");
}

#[test]
fn test_saved_pink_accent_round_trips_unchanged() {
    let tmp = tempfile::tempdir().unwrap();
    let path = Utf8PathBuf::from_path_buf(tmp.path().join("config.toml")).unwrap();
    let mut config = AppConfig::default();
    config.settings.accent_color = "#e91e63".to_string();

    save_to(&path, &config).expect("save failed");

    let loaded = load_from(&path).expect("load failed");
    assert_eq!(loaded.settings.accent_color, "#e91e63");
}

#[test]
fn test_save_failure_surfaces_config_save_failed_and_preserves_target() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = Utf8PathBuf::from_path_buf(tmp.path().to_path_buf()).unwrap();

    // Write a valid config first
    let path = dir.join("config.toml");
    let config = AppConfig::default();
    save_to(&path, &config).unwrap();
    let original = fs::read_to_string(&path).unwrap();

    // Force the rename to fail: the target "path" is now a directory
    let blocked_path = dir.join("blocked");
    fs::create_dir_all(blocked_path.join("sub")).unwrap();
    let result = save_to(&blocked_path, &config);
    assert!(
        matches!(result, Err(SError::ConfigSaveFailed(_))),
        "expected ConfigSaveFailed, got {result:?}"
    );

    // The earlier config file was never touched
    assert_eq!(fs::read_to_string(&path).unwrap(), original);
}

#[test]
fn test_find_library_by_handle_matches_id_or_path() {
    let mut config = AppConfig::default();
    config.upsert_library(KnownLibrary {
        id: "lib-1".to_string(),
        library_root: Utf8PathBuf::from("C:/games/spt/.mod_keeper"),
    });

    assert_eq!(config.find_library_by_handle("lib-1").unwrap().id, "lib-1");
    // A path-only stub's registered path doubles as its removal handle (C13)
    assert_eq!(
        config
            .find_library_by_handle("C:/games/spt/.mod_keeper")
            .unwrap()
            .id,
        "lib-1"
    );
    assert!(config.find_library_by_handle("unknown").is_none());
}

#[test]
fn test_delete_library_entry_accepts_path_handle() {
    use mod_keeper_lib::core::global_service;
    use mod_keeper_lib::store::AppConfigStore;
    use parking_lot::Mutex;
    use std::sync::Arc;

    let tmp = tempfile::tempdir().unwrap();
    let config_path = Utf8PathBuf::from_path_buf(tmp.path().join("config.toml")).unwrap();

    // A registered library whose manifest is unreadable lists as a path-only
    // stub; the frontend only has its path to remove it with (C13).
    let stub_root = "C:/games/spt/.broken_library";
    let mut config = AppConfig::default();
    config.upsert_library(KnownLibrary {
        id: "stub-id".to_string(),
        library_root: Utf8PathBuf::from(stub_root),
    });
    config.app_state.active_library_id = Some("stub-id".to_string());

    let config_handle = Arc::new(Mutex::new(AppConfigStore {
        path: config_path.clone(),
        config,
    }));
    let instance_handle = Arc::new(Mutex::new(None));

    global_service::delete_library_entry(&config_handle, &instance_handle, stub_root)
        .expect("delete by path handle failed");

    let store = config_handle.lock();
    assert!(store.config.known_libraries.is_empty());
    assert_eq!(store.config.app_state.active_library_id, None);

    // The change was persisted
    let saved = load_from(&config_path).unwrap();
    assert!(saved.known_libraries.is_empty());
}

#[test]
fn test_delete_library_entry_rejects_unknown_handle() {
    use mod_keeper_lib::core::global_service;
    use mod_keeper_lib::store::AppConfigStore;
    use parking_lot::Mutex;
    use std::sync::Arc;

    let tmp = tempfile::tempdir().unwrap();
    let config_path = Utf8PathBuf::from_path_buf(tmp.path().join("config.toml")).unwrap();
    let config_handle = Arc::new(Mutex::new(AppConfigStore {
        path: config_path,
        config: AppConfig::default(),
    }));
    let instance_handle = Arc::new(Mutex::new(None));

    let result = global_service::delete_library_entry(&config_handle, &instance_handle, "nope");
    assert!(matches!(result, Err(SError::InvalidLibrary(_, _))));
}
