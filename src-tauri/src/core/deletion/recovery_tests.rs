use super::*;
use crate::store::app_config::{AppConfig, KnownLibrary};
use tempfile::tempdir;

fn store(path: &Utf8Path, id: &str, root: &Utf8Path) -> AppConfigStore {
    fs::write(path, "").unwrap();
    AppConfigStore {
        path: path.to_path_buf(),
        config: AppConfig {
            known_libraries: vec![KnownLibrary {
                id: id.to_string(),
                library_root: root.to_path_buf(),
            }],
            ..AppConfig::default()
        },
    }
}

fn write_recovery(path: &Utf8Path, recovery: &DeleteRecovery) {
    write_new_journal(path, recovery).unwrap();
}

#[test]
fn recovery_restores_staged_objects_for_registered_library() {
    let tmp = tempdir().unwrap();
    let root = Utf8Path::from_path(tmp.path()).unwrap();
    let config_path = root.join("config.toml");
    let original = root.join("original");
    let quarantine = root.join("quarantine");
    fs::write(&quarantine, "data").unwrap();
    let journal = root.join(".modkeeper-delete-test.toml");
    let recovery = DeleteRecovery {
        version: DELETE_RECOVERY_VERSION,
        token: "test".to_string(),
        library_id: "library".to_string(),
        repo_root: original.clone(),
        phase: DeletePhase::Staged,
        entries: vec![DeleteRecoveryEntry {
            original: original.clone(),
            quarantine: Some(quarantine.clone()),
        }],
    };
    write_recovery(&journal, &recovery);

    recover_pending_deletions(&store(&config_path, "library", &original)).unwrap();

    assert_eq!(fs::read_to_string(&original).unwrap(), "data");
    assert!(!quarantine.exists());
    assert!(!journal.exists());
}

#[test]
fn recovery_finishes_committed_cleanup_for_unregistered_library() {
    let tmp = tempdir().unwrap();
    let root = Utf8Path::from_path(tmp.path()).unwrap();
    let config_path = root.join("config.toml");
    fs::write(&config_path, "").unwrap();
    let original = root.join("original");
    let quarantine = root.join("quarantine");
    fs::write(&quarantine, "data").unwrap();
    let journal = root.join(".modkeeper-delete-test.toml");
    let recovery = DeleteRecovery {
        version: DELETE_RECOVERY_VERSION,
        token: "test".to_string(),
        library_id: "library".to_string(),
        repo_root: original,
        phase: DeletePhase::Committed,
        entries: vec![DeleteRecoveryEntry {
            original: root.join("original"),
            quarantine: Some(quarantine.clone()),
        }],
    };
    write_recovery(&journal, &recovery);

    let store = AppConfigStore {
        path: config_path,
        config: AppConfig::default(),
    };
    recover_pending_deletions(&store).unwrap();

    assert!(!quarantine.exists());
    assert!(!journal.exists());
}

#[test]
fn recovery_blocks_a_different_library_claiming_the_same_root() {
    let tmp = tempdir().unwrap();
    let root = Utf8Path::from_path(tmp.path()).unwrap();
    let config_path = root.join("config.toml");
    let original = root.join("original");
    let quarantine = root.join("quarantine");
    fs::write(&quarantine, "data").unwrap();
    let journal = root.join(".modkeeper-delete-test.toml");
    let recovery = DeleteRecovery {
        version: DELETE_RECOVERY_VERSION,
        token: "test".to_string(),
        library_id: "old-library".to_string(),
        repo_root: original.clone(),
        phase: DeletePhase::Committed,
        entries: vec![DeleteRecoveryEntry {
            original,
            quarantine: Some(quarantine.clone()),
        }],
    };
    write_recovery(&journal, &recovery);

    let result =
        recover_pending_deletions(&store(&config_path, "new-library", &root.join("original")));

    assert!(result.is_err());
    assert!(quarantine.exists());
    assert!(journal.exists());
}

#[test]
fn recovery_ignores_a_missing_config_directory() {
    let tmp = tempdir().unwrap();
    let root = Utf8Path::from_path(tmp.path()).unwrap();
    let store = AppConfigStore {
        path: root.join("missing").join("config.toml"),
        config: AppConfig::default(),
    };

    recover_pending_deletions(&store).unwrap();
}

#[test]
fn recovery_blocks_a_journal_when_the_config_file_is_missing() {
    let tmp = tempdir().unwrap();
    let root = Utf8Path::from_path(tmp.path()).unwrap();
    let config_path = root.join("config.toml");
    let original = root.join("original");
    let quarantine = root.join("quarantine");
    fs::write(&quarantine, "data").unwrap();
    let journal = root.join(".modkeeper-delete-test.toml");
    let recovery = DeleteRecovery {
        version: DELETE_RECOVERY_VERSION,
        token: "test".to_string(),
        library_id: "library".to_string(),
        repo_root: original.clone(),
        phase: DeletePhase::Committed,
        entries: vec![DeleteRecoveryEntry {
            original,
            quarantine: Some(quarantine.clone()),
        }],
    };
    write_recovery(&journal, &recovery);

    let result = recover_pending_deletions(&AppConfigStore {
        path: config_path,
        config: AppConfig::default(),
    });

    assert!(result.is_err());
    assert!(quarantine.exists());
    assert!(journal.exists());
}
