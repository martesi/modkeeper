mod common;

use camino::{Utf8Path, Utf8PathBuf};
use common::{create_test_mod, setup_test_env};
use mod_keeper_lib::core::library::Library;
use mod_keeper_lib::core::linker::ArtifactKind;
use mod_keeper_lib::core::mod_fs::{self, ModFS};
use mod_keeper_lib::core::mod_stager::StagedMod;
use mod_keeper_lib::core::{global_service, library_service, mod_manager};
use mod_keeper_lib::models::error::SError;
use mod_keeper_lib::models::library::LibraryCreationRequirement;
use mod_keeper_lib::models::paths::SPTPathRules;
use mod_keeper_lib::models::workspace::{BulkModAction, CreateLibraryInput};
use mod_keeper_lib::store::AppConfigStore;
use mod_keeper_lib::store::app_config::{AppConfig, KnownLibrary};
use mod_keeper_lib::utils::id::hash_id;
use parking_lot::Mutex;
use std::fs;
use std::sync::Arc;

type ConfigHandle = Arc<Mutex<AppConfigStore>>;
type InstanceHandle = Arc<Mutex<Option<Library>>>;

// Fresh App Config store rooted in the test's temp dir, plus an empty instance slot
fn test_handles(tmp: &tempfile::TempDir) -> (ConfigHandle, InstanceHandle) {
    let path = Utf8PathBuf::from_path_buf(tmp.path().join("app_config.toml")).unwrap();
    let store = AppConfigStore {
        path,
        config: AppConfig::default(),
    };
    (Arc::new(Mutex::new(store)), Arc::new(Mutex::new(None)))
}

// Helper function to create a StagedMod from a path and ModFS for testing
fn create_staged_mod_for_test(mod_root: &Utf8Path, fs: ModFS) -> StagedMod {
    // Use directory name or mod_id as the display name
    let name = mod_root.file_name().unwrap_or(&fs.id).to_string();
    StagedMod {
        fs,
        source_path: mod_root.to_path_buf(),
        is_staging: false,
        name,
    }
}

#[test]
fn test_library_init_and_add_mod() {
    let (_tmp, game_root, repo_root) = setup_test_env();

    // 1. Create Library
    let requirement = LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Test Library".to_string(),
    };
    let mut lib = Library::create(requirement).expect("Failed to create library");
    assert!(lib.lib_paths.mods.exists());

    // 2. Prepare a fake mod on disk
    let mod_src = _tmp.path().join("my_new_mod");
    let mod_src_utf8 = Utf8Path::from_path(&mod_src).unwrap();
    create_test_mod(mod_src_utf8, "MyMod", true);

    // 3. Add mod to library
    let mod_fs = mod_fs::scan(mod_src_utf8, &SPTPathRules::default()).expect("Failed to parse mod");
    let staged = create_staged_mod_for_test(mod_src_utf8, mod_fs);
    mod_manager::add_mod(&mut lib, staged, false).expect("Failed to add mod");

    // 4. Verify persistence (id is the hash of the server mod folder name)
    let mod_id = hash_id("mymod");
    assert!(lib.mods.contains_key(&mod_id));
    assert!(lib.lib_paths.mods.join(&mod_id).exists());
    assert!(lib.cache.mods.contains_key(&mod_id));
}

#[test]
fn test_default_library_root_stores_relative_game_root() {
    let (_tmp, game_root, _) = setup_test_env();
    let repo_root = game_root.join(".mod_keeper");

    let original = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Portable Library".to_string(),
    })
    .unwrap();

    let manifest = Library::read_library_manifest(&repo_root).unwrap();
    assert_eq!(manifest.game_root, Utf8PathBuf::from(".."));

    let loaded = Library::load(&repo_root).unwrap();
    assert_eq!(loaded.id, original.id);
    assert_eq!(loaded.game_root, game_root);

    let manifest_path = repo_root.join("manifest.toml");
    let manifest = fs::read_to_string(&manifest_path).unwrap();
    fs::write(
        &manifest_path,
        manifest.replace("gameRoot = \"..\"", "gameRoot = 'E:\\Games\\EFT_16.9'"),
    )
    .unwrap();

    let loaded_legacy = Library::load(&repo_root).unwrap();
    assert_eq!(loaded_legacy.game_root, game_root);
}

#[test]
fn default_library_root_moves_to_a_versioned_root_after_an_spt_major_change() {
    let (_tmp, game_root, _) = setup_test_env();
    let old_root = game_root.join(".mod_keeper");
    let old_library = Library::create(LibraryCreationRequirement {
        repo_root: Some(old_root.clone()),
        game_root: game_root.clone(),
        name: "SPT 4 library".to_string(),
    })
    .unwrap();
    fs::write(
        game_root.join("SPT/SPT.Server.deps.json"),
        r#"{"runtimeTarget":{"name":"net10/win-x64"},"targets":{"net10/win-x64":{"SPT.Server/5.0.0-RELEASE+abc":{}}}}"#,
    )
    .unwrap();

    let (config_handle, instance_handle) = test_handles(&_tmp);
    config_handle.lock().config.upsert_library(KnownLibrary {
        id: old_library.id,
        library_root: old_root.clone(),
    });
    global_service::create_library(
        &config_handle,
        &instance_handle,
        CreateLibraryInput {
            game_root: game_root.to_string(),
            library_root: None,
            name: None,
        },
    )
    .unwrap();

    let new_root = game_root.join(".mod_keeper-spt-5.0.0");
    assert!(old_root.exists());
    assert!(new_root.join("manifest.toml").exists());
    let instance = instance_handle.lock();
    assert_eq!(instance.as_ref().unwrap().repo_root, new_root);
    assert_eq!(instance.as_ref().unwrap().spt_version, "5.0.0");
    assert_eq!(config_handle.lock().config.known_libraries.len(), 2);
}

#[test]
fn deleting_a_cross_major_library_blocks_on_an_unverifiable_copy() {
    let (tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "SPT 4 library".to_string(),
    })
    .unwrap();
    let mod_src = tmp.path().join("mod");
    let mod_src_utf8 = Utf8Path::from_path(&mod_src).unwrap();
    create_test_mod(mod_src_utf8, "Example", true);
    let mod_fs = mod_fs::scan(mod_src_utf8, &SPTPathRules::default()).unwrap();
    let staged = create_staged_mod_for_test(mod_src_utf8, mod_fs);
    let mod_id = staged.fs.id.clone();
    mod_manager::add_mod(&mut library, staged, false).unwrap();
    mod_manager::toggle_mod(&mut library, &mod_id, true).unwrap();
    library.sync().unwrap();
    let deployed = game_root.join("SPT/user/mods/Example/content.txt");
    assert!(fs::symlink_metadata(&deployed).is_ok());

    fs::write(
        game_root.join("SPT/SPT.Server.deps.json"),
        r#"{"runtimeTarget":{"name":"net10/win-x64"},"targets":{"net10/win-x64":{"SPT.Server/5.0.0-RELEASE+abc":{}}}}"#,
    )
    .unwrap();
    let (config_handle, instance_handle) = test_handles(&tmp);
    config_handle.lock().config.upsert_library(KnownLibrary {
        id: library.id.clone(),
        library_root: repo_root.clone(),
    });

    let error = global_service::delete_library_files(&config_handle, &instance_handle, &library.id)
        .unwrap_err();

    assert!(matches!(&error, SError::InvalidLibrary(_, _)));
    assert!(fs::symlink_metadata(&deployed).is_ok());
    assert!(repo_root.exists());
    assert_eq!(config_handle.lock().config.known_libraries.len(), 1);
}

#[test]
fn deleting_a_cross_major_library_refuses_a_replaced_deployment() {
    let (tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "SPT 4 library".to_string(),
    })
    .unwrap();
    let mod_src = tmp.path().join("mod");
    let mod_src_utf8 = Utf8Path::from_path(&mod_src).unwrap();
    create_test_mod(mod_src_utf8, "Example", true);
    let mod_fs = mod_fs::scan(mod_src_utf8, &SPTPathRules::default()).unwrap();
    let staged = create_staged_mod_for_test(mod_src_utf8, mod_fs);
    let mod_id = staged.fs.id.clone();
    mod_manager::add_mod(&mut library, staged, false).unwrap();
    mod_manager::toggle_mod(&mut library, &mod_id, true).unwrap();
    library.sync().unwrap();
    let deployed = game_root.join("SPT/user/mods/Example/content.txt");
    fs::remove_file(&deployed).unwrap();
    fs::write(&deployed, "new installation").unwrap();

    let (config_handle, instance_handle) = test_handles(&tmp);
    config_handle.lock().config.upsert_library(KnownLibrary {
        id: library.id.clone(),
        library_root: repo_root.clone(),
    });

    let error = global_service::delete_library_files(&config_handle, &instance_handle, &library.id)
        .unwrap_err();

    assert!(
        matches!(&error, SError::InvalidLibrary(_, _)),
        "unexpected error: {error:?}"
    );
    assert_eq!(fs::read_to_string(&deployed).unwrap(), "new installation");
    assert!(repo_root.exists());
    assert_eq!(config_handle.lock().config.known_libraries.len(), 1);
}

#[cfg(unix)]
#[test]
fn deleting_a_library_refuses_a_deployment_path_redirected_within_the_game_root() {
    let (tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "SPT 4 library".to_string(),
    })
    .unwrap();
    let mod_src = tmp.path().join("mod");
    let mod_src_utf8 = Utf8Path::from_path(&mod_src).unwrap();
    create_test_mod(mod_src_utf8, "Example", true);
    let mod_fs = mod_fs::scan(mod_src_utf8, &SPTPathRules::default()).unwrap();
    let staged = create_staged_mod_for_test(mod_src_utf8, mod_fs);
    let mod_id = staged.fs.id.clone();
    mod_manager::add_mod(&mut library, staged, false).unwrap();
    mod_manager::toggle_mod(&mut library, &mod_id, true).unwrap();
    library.sync().unwrap();

    let redirected_root = game_root.join("redirected-user");
    fs::create_dir_all(redirected_root.join("mods/Example")).unwrap();
    fs::create_dir_all(redirected_root.join("sptRegistry")).unwrap();
    fs::write(
        redirected_root.join("mods/Example/content.txt"),
        "another mod",
    )
    .unwrap();
    fs::write(
        redirected_root.join("sptRegistry/registry.json"),
        r#"{"SPT_Version":"SPT 4.0.11 - redirected"}"#,
    )
    .unwrap();
    let user_root = game_root.join("SPT/user");
    fs::rename(&user_root, game_root.join("SPT/user-original")).unwrap();
    std::os::unix::fs::symlink(&redirected_root, &user_root).unwrap();

    let (config_handle, instance_handle) = test_handles(&tmp);
    config_handle.lock().config.upsert_library(KnownLibrary {
        id: library.id.clone(),
        library_root: repo_root.clone(),
    });
    let error = global_service::delete_library_files(&config_handle, &instance_handle, &library.id)
        .unwrap_err();

    assert!(
        matches!(&error, SError::InvalidLibrary(_, _)),
        "unexpected error: {error:?}"
    );
    assert_eq!(
        fs::read_to_string(redirected_root.join("mods/Example/content.txt")).unwrap(),
        "another mod"
    );
    assert!(repo_root.exists());
    assert_eq!(config_handle.lock().config.known_libraries.len(), 1);
}

#[test]
fn updating_a_deployed_mod_refreshes_and_removal_unlinks_stale_copies() {
    let (tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root),
        game_root: game_root.clone(),
        name: "Update test".to_string(),
    })
    .unwrap();
    let mod_src = tmp.path().join("mod");
    let mod_src_utf8 = Utf8Path::from_path(&mod_src).unwrap();
    create_test_mod(mod_src_utf8, "Example", true);
    let mod_fs = mod_fs::scan(mod_src_utf8, &SPTPathRules::default()).unwrap();
    let staged = create_staged_mod_for_test(mod_src_utf8, mod_fs);
    let mod_id = staged.fs.id.clone();
    mod_manager::add_mod(&mut library, staged, false).unwrap();
    mod_manager::toggle_mod(&mut library, &mod_id, true).unwrap();
    library.sync().unwrap();
    let deployed = game_root.join("SPT/user/mods/Example/content.txt");
    assert_eq!(fs::read_to_string(&deployed).unwrap(), "Example");

    fs::write(&deployed, "user edit").unwrap();
    library.mark_dirty();
    assert!(matches!(library.sync(), Err(SError::FileCollision(_))));
    assert_eq!(fs::read_to_string(&deployed).unwrap(), "user edit");
    let remove_error = mod_manager::remove_mod(&mut library, &mod_id).unwrap_err();
    assert!(matches!(remove_error, SError::FileCollision(_)));
    assert!(library.mods.contains_key(&mod_id));
    assert_eq!(fs::read_to_string(&deployed).unwrap(), "user edit");
    fs::write(&deployed, "Example").unwrap();

    fs::write(
        mod_src_utf8.join("SPT/user/mods/Example/content.txt"),
        "updated",
    )
    .unwrap();
    let updated_fs = mod_fs::scan(mod_src_utf8, &SPTPathRules::default()).unwrap();
    mod_manager::add_mod(
        &mut library,
        create_staged_mod_for_test(mod_src_utf8, updated_fs),
        false,
    )
    .unwrap();
    library.sync().unwrap();
    assert_eq!(fs::read_to_string(&deployed).unwrap(), "updated");

    fs::write(
        mod_src_utf8.join("SPT/user/mods/Example/content.txt"),
        "updated again",
    )
    .unwrap();
    let latest_fs = mod_fs::scan(mod_src_utf8, &SPTPathRules::default()).unwrap();
    mod_manager::add_mod(
        &mut library,
        create_staged_mod_for_test(mod_src_utf8, latest_fs),
        false,
    )
    .unwrap();
    mod_manager::remove_mod(&mut library, &mod_id).unwrap();
    assert!(!deployed.exists());
}

#[cfg(unix)]
#[test]
fn sync_preflights_changed_removals_before_purging_recorded_links() {
    let (tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Preflight order test".to_string(),
    })
    .unwrap();

    let link_source_root = Utf8PathBuf::from_path_buf(tmp.path().join("link-source")).unwrap();
    let copy_source_root = Utf8PathBuf::from_path_buf(tmp.path().join("copy-source")).unwrap();
    create_test_mod(&link_source_root, "KeepLink", true);
    create_test_mod(&copy_source_root, "DropCopy", true);
    let link_fs = mod_fs::scan(&link_source_root, &SPTPathRules::default()).unwrap();
    let copy_fs = mod_fs::scan(&copy_source_root, &SPTPathRules::default()).unwrap();
    let link_id = link_fs.id.clone();
    let copy_id = copy_fs.id.clone();
    mod_manager::add_mod(
        &mut library,
        create_staged_mod_for_test(&link_source_root, link_fs),
        true,
    )
    .unwrap();
    mod_manager::add_mod(
        &mut library,
        create_staged_mod_for_test(&copy_source_root, copy_fs),
        true,
    )
    .unwrap();
    library.sync().unwrap();

    let link_relative = Utf8Path::new("SPT/user/mods/KeepLink/content.txt");
    let link_target = library.game_root.join(link_relative);
    let link_artifact = library
        .deployment
        .artifacts
        .iter_mut()
        .find(|artifact| artifact.target == link_relative)
        .unwrap();
    let link_source = library.repo_root.join(&link_artifact.source);
    fs::remove_file(&link_target).unwrap();
    std::os::unix::fs::symlink(link_source.as_std_path(), link_target.as_std_path()).unwrap();
    link_artifact.kind = ArtifactKind::Symlink;
    link_artifact.fingerprint = None;

    let copy_target = library.game_root.join("SPT/user/mods/DropCopy/content.txt");
    fs::write(&copy_target, "user edit").unwrap();
    mod_manager::toggle_mod(&mut library, &copy_id, false).unwrap();

    assert!(matches!(library.sync(), Err(SError::FileCollision(_))));
    assert!(
        fs::symlink_metadata(&link_target)
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert_eq!(fs::read_to_string(&copy_target).unwrap(), "user edit");
    assert!(library.mods.get(&link_id).unwrap().is_active);
}

#[cfg(unix)]
#[test]
fn removing_a_mod_refuses_a_deployment_path_redirected_within_the_game_root() {
    let (_tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root),
        game_root: game_root.clone(),
        name: "Removal redirect test".to_string(),
    })
    .unwrap();
    let source = game_root.join("outside-source");
    create_test_mod(&source, "RedirectedMod", true);
    let scanned = mod_fs::scan(&source, &SPTPathRules::default()).unwrap();
    let mod_id = scanned.id.clone();
    mod_manager::add_mod(
        &mut library,
        create_staged_mod_for_test(&source, scanned),
        true,
    )
    .unwrap();
    library.sync().unwrap();

    let deployed_dir = game_root.join("SPT/user/mods/RedirectedMod");
    let redirected_dir = game_root.join("redirected-mod");
    fs::create_dir_all(&redirected_dir).unwrap();
    fs::write(redirected_dir.join("content.txt"), "another mod").unwrap();
    fs::remove_dir_all(&deployed_dir).unwrap();
    std::os::unix::fs::symlink(redirected_dir.as_std_path(), deployed_dir.as_std_path()).unwrap();

    let error = mod_manager::remove_mod(&mut library, &mod_id).unwrap_err();
    assert!(matches!(error, SError::FileCollision(_)));
    assert!(library.mods.contains_key(&mod_id));
    assert!(library.lib_paths.mods.join(&mod_id).exists());
    assert_eq!(
        fs::read_to_string(redirected_dir.join("content.txt")).unwrap(),
        "another mod"
    );
}

#[cfg(unix)]
#[test]
fn sync_refuses_redirected_recorded_directories_when_artifacts_are_missing() {
    let (tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root),
        game_root: game_root.clone(),
        name: "Missing artifact directory test".to_string(),
    })
    .unwrap();
    let source = Utf8PathBuf::from_path_buf(tmp.path().join("source")).unwrap();
    let content = source.join("SPT/user/mods/DirMod/Nested/content.txt");
    fs::create_dir_all(content.parent().unwrap()).unwrap();
    fs::write(&content, "DirMod").unwrap();
    let scanned = mod_fs::scan(&source, &SPTPathRules::default()).unwrap();
    let mod_id = scanned.id.clone();
    mod_manager::add_mod(
        &mut library,
        create_staged_mod_for_test(&source, scanned),
        true,
    )
    .unwrap();
    library.sync().unwrap();
    mod_manager::toggle_mod(&mut library, &mod_id, false).unwrap();

    let deployed_dir = game_root.join("SPT/user/mods/DirMod");
    let external_dir = Utf8PathBuf::from_path_buf(tmp.path().join("external")).unwrap();
    fs::create_dir_all(external_dir.join("Nested")).unwrap();
    fs::remove_dir_all(&deployed_dir).unwrap();
    std::os::unix::fs::symlink(external_dir.as_std_path(), deployed_dir.as_std_path()).unwrap();
    library.deployment.artifacts.clear();
    library.mark_dirty();

    assert!(matches!(library.sync(), Err(SError::FileCollision(_))));
    assert!(external_dir.join("Nested").exists());
}

#[cfg(unix)]
#[test]
fn removing_a_mod_preflights_shared_directories_before_unlinking_artifacts() {
    let (tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root),
        game_root: game_root.clone(),
        name: "Shared directory preflight test".to_string(),
    })
    .unwrap();
    let first_source = Utf8PathBuf::from_path_buf(tmp.path().join("first-source")).unwrap();
    let second_source = Utf8PathBuf::from_path_buf(tmp.path().join("second-source")).unwrap();
    create_test_mod(&first_source, "FirstMod", true);
    create_test_mod(&second_source, "SecondMod", true);
    let first_fs = mod_fs::scan(&first_source, &SPTPathRules::default()).unwrap();
    let second_fs = mod_fs::scan(&second_source, &SPTPathRules::default()).unwrap();
    let first_id = first_fs.id.clone();
    mod_manager::add_mod(
        &mut library,
        create_staged_mod_for_test(&first_source, first_fs),
        true,
    )
    .unwrap();
    mod_manager::add_mod(
        &mut library,
        create_staged_mod_for_test(&second_source, second_fs),
        true,
    )
    .unwrap();
    library.sync().unwrap();

    let first_target = game_root.join("SPT/user/mods/FirstMod/content.txt");
    let second_dir = game_root.join("SPT/user/mods/SecondMod");
    let external_dir = Utf8PathBuf::from_path_buf(tmp.path().join("redirected-second")).unwrap();
    fs::create_dir_all(&external_dir).unwrap();
    fs::write(external_dir.join("content.txt"), "foreign").unwrap();
    fs::remove_dir_all(&second_dir).unwrap();
    std::os::unix::fs::symlink(external_dir.as_std_path(), second_dir.as_std_path()).unwrap();

    let error = mod_manager::remove_mod(&mut library, &first_id).unwrap_err();
    assert!(matches!(error, SError::FileCollision(_)));
    assert!(library.mods.contains_key(&first_id));
    assert_eq!(fs::read_to_string(&first_target).unwrap(), "FirstMod");
}

#[cfg(unix)]
#[test]
fn purge_preflights_all_protected_roots_before_traversal() {
    let (_tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Purge root preflight test".to_string(),
    })
    .unwrap();
    let repo_file = repo_root.join("foreign.txt");
    fs::write(&repo_file, "foreign").unwrap();

    let valid_root = game_root.join("SPT/user/mods");
    fs::create_dir_all(&valid_root).unwrap();
    let valid_link = valid_root.join("valid-link");
    std::os::unix::fs::symlink(repo_file.as_std_path(), valid_link.as_std_path()).unwrap();

    let redirected_root = game_root.join("redirected-plugins");
    fs::create_dir_all(&redirected_root).unwrap();
    let redirected_link = redirected_root.join("foreign-link");
    std::os::unix::fs::symlink(repo_file.as_std_path(), redirected_link.as_std_path()).unwrap();
    let invalid_parent = game_root.join("BepInEx");
    fs::create_dir_all(&invalid_parent).unwrap();
    fs::remove_dir(&invalid_parent).unwrap();
    std::os::unix::fs::symlink(redirected_root.as_std_path(), invalid_parent.as_std_path())
        .unwrap();

    assert!(matches!(library.sync(), Err(SError::InvalidLibrary(_, _))));
    assert!(valid_link.exists());
    assert!(redirected_link.exists());
}

#[cfg(unix)]
#[test]
fn purge_preflights_all_walks_before_unlinking_links() {
    use std::os::unix::ffi::OsStrExt;

    let (_tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Purge walk preflight test".to_string(),
    })
    .unwrap();
    let repo_file = repo_root.join("foreign.txt");
    fs::write(&repo_file, "foreign").unwrap();
    let valid_root = game_root.join("SPT/user/mods");
    fs::create_dir_all(&valid_root).unwrap();
    let valid_link = valid_root.join("valid-link");
    std::os::unix::fs::symlink(repo_file.as_std_path(), valid_link.as_std_path()).unwrap();

    let invalid_root = game_root.join("BepInEx/plugins");
    fs::create_dir_all(&invalid_root).unwrap();
    let invalid_name = std::ffi::OsStr::from_bytes(b"invalid-\xff");
    fs::write(invalid_root.as_std_path().join(invalid_name), "invalid").unwrap();

    assert!(matches!(library.sync(), Err(SError::Unexpected)));
    assert!(valid_link.exists());
}

#[cfg(unix)]
#[test]
fn purge_resolves_relative_link_targets_from_the_link_parent() {
    let (tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Relative purge link test".to_string(),
    })
    .unwrap();
    let legacy_root = game_root.join("SPT/user/mods");
    fs::create_dir_all(&legacy_root).unwrap();
    let repo_target = repo_root.join("relative-target.txt");
    fs::write(&repo_target, "repo").unwrap();
    let repo_link = legacy_root.join("relative-repo-link");
    std::os::unix::fs::symlink(
        Utf8Path::new("../../../../repo/relative-target.txt").as_std_path(),
        repo_link.as_std_path(),
    )
    .unwrap();

    let external_root = Utf8PathBuf::from_path_buf(tmp.path().join("external")).unwrap();
    fs::create_dir_all(&external_root).unwrap();
    let external_target = external_root.join("foreign.txt");
    fs::write(&external_target, "external").unwrap();
    let external_link = legacy_root.join("relative-external-link");
    std::os::unix::fs::symlink(
        Utf8Path::new("../../../../external/foreign.txt").as_std_path(),
        external_link.as_std_path(),
    )
    .unwrap();

    library.sync().unwrap();
    assert!(fs::symlink_metadata(&repo_link).is_err());
    assert!(external_link.exists());
}

#[cfg(unix)]
#[test]
fn purge_keeps_dangling_external_targets_unverified() {
    let (tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Dangling external purge link test".to_string(),
    })
    .unwrap();
    let legacy_root = game_root.join("SPT/user/mods");
    fs::create_dir_all(&legacy_root).unwrap();
    let external_root = Utf8PathBuf::from_path_buf(tmp.path().join("outside")).unwrap();
    fs::create_dir_all(&external_root).unwrap();
    let link = legacy_root.join("dangling-external-link");
    let target = repo_root.join("../outside/missing.txt");
    std::os::unix::fs::symlink(target.as_std_path(), link.as_std_path()).unwrap();

    library.sync().unwrap();
    assert!(fs::symlink_metadata(&link).is_ok());
}

#[cfg(unix)]
#[test]
fn purge_handles_non_utf8_link_targets_without_recreating_them() {
    use std::os::unix::ffi::OsStrExt;

    let (_tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Non-UTF-8 purge link test".to_string(),
    })
    .unwrap();
    let legacy_root = game_root.join("SPT/user/mods");
    fs::create_dir_all(&legacy_root).unwrap();
    let target = repo_root
        .as_std_path()
        .join(std::ffi::OsStr::from_bytes(b"repo-\xff.txt"));
    fs::write(&target, "repo").unwrap();
    let link = legacy_root.join("non-utf8-repo-link");
    std::os::unix::fs::symlink(&target, link.as_std_path()).unwrap();

    library.sync().unwrap();
    assert!(fs::symlink_metadata(&link).is_err());
    assert!(target.exists());
}

#[cfg(unix)]
#[test]
fn purge_handles_long_link_names_with_a_bounded_quarantine_name() {
    let (_tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Long purge link test".to_string(),
    })
    .unwrap();
    let legacy_root = game_root.join("SPT/user/mods");
    fs::create_dir_all(&legacy_root).unwrap();
    let target = repo_root.join("long-target.txt");
    fs::write(&target, "repo").unwrap();
    let link = legacy_root.join("l".repeat(202));
    std::os::unix::fs::symlink(target.as_std_path(), link.as_std_path()).unwrap();

    library.sync().unwrap();
    assert!(fs::symlink_metadata(&link).is_err());
}

#[cfg(unix)]
#[test]
fn purge_preflights_link_parent_permissions_before_unlinking() {
    use std::os::unix::fs::PermissionsExt;

    let (_tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Purge permission preflight test".to_string(),
    })
    .unwrap();
    let repo_target = repo_root.join("permission-target.txt");
    fs::write(&repo_target, "repo").unwrap();
    let server_root = game_root.join("SPT/user/mods");
    fs::create_dir_all(&server_root).unwrap();
    let server_link = server_root.join("server-link");
    std::os::unix::fs::symlink(repo_target.as_std_path(), server_link.as_std_path()).unwrap();

    let client_root = game_root.join("BepInEx/plugins");
    fs::create_dir_all(&client_root).unwrap();
    let client_link = client_root.join("client-link");
    std::os::unix::fs::symlink(repo_target.as_std_path(), client_link.as_std_path()).unwrap();
    fs::set_permissions(&client_root, fs::Permissions::from_mode(0o555)).unwrap();
    let result = library.sync();
    fs::set_permissions(&client_root, fs::Permissions::from_mode(0o755)).unwrap();

    assert!(matches!(result, Err(SError::IOError(_))));
    assert!(server_link.exists());
    assert!(client_link.exists());
}

#[cfg(unix)]
#[test]
fn deleting_a_library_validates_purge_before_removing_deployment() {
    let (tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Delete purge preflight test".to_string(),
    })
    .unwrap();
    let source_path = tmp.path().join("source");
    let source = Utf8Path::from_path(&source_path).unwrap();
    create_test_mod(source, "KeepDeployment", true);
    let scanned = mod_fs::scan(source, &SPTPathRules::default()).unwrap();
    let mod_id = scanned.id.clone();
    mod_manager::add_mod(
        &mut library,
        create_staged_mod_for_test(source, scanned),
        true,
    )
    .unwrap();
    library.sync().unwrap();
    let deployed = game_root.join("SPT/user/mods/KeepDeployment/content.txt");

    let redirected_root = game_root.join("redirected-plugins");
    fs::create_dir_all(&redirected_root).unwrap();
    let invalid_root = game_root.join("BepInEx/plugins");
    fs::create_dir_all(invalid_root.parent().unwrap()).unwrap();
    std::os::unix::fs::symlink(redirected_root.as_std_path(), invalid_root.as_std_path()).unwrap();

    let (config_handle, instance_handle) = test_handles(&tmp);
    config_handle.lock().config.upsert_library(KnownLibrary {
        id: library.id.clone(),
        library_root: repo_root.clone(),
    });
    let error = global_service::delete_library_files(&config_handle, &instance_handle, &library.id)
        .unwrap_err();

    assert!(matches!(error, SError::InvalidLibrary(_, _)));
    assert!(deployed.exists());
    assert!(repo_root.exists());
    assert!(
        !Library::load(&repo_root)
            .unwrap()
            .deployment
            .artifacts
            .is_empty()
    );
    assert!(
        config_handle
            .lock()
            .config
            .known_libraries
            .iter()
            .any(|known| known.id == library.id)
    );
    assert!(library.mods.contains_key(&mod_id));
}

#[cfg(unix)]
#[test]
fn deleting_a_library_validates_purge_walks_before_removing_deployment() {
    use std::os::unix::ffi::OsStrExt;

    let (tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Delete purge walk test".to_string(),
    })
    .unwrap();
    let source_path = tmp.path().join("source");
    let source = Utf8Path::from_path(&source_path).unwrap();
    create_test_mod(source, "KeepDeployment", true);
    let scanned = mod_fs::scan(source, &SPTPathRules::default()).unwrap();
    let mod_id = scanned.id.clone();
    mod_manager::add_mod(
        &mut library,
        create_staged_mod_for_test(source, scanned),
        true,
    )
    .unwrap();
    library.sync().unwrap();
    let deployed = game_root.join("SPT/user/mods/KeepDeployment/content.txt");

    let invalid_root = game_root.join("BepInEx/plugins");
    fs::create_dir_all(&invalid_root).unwrap();
    let invalid_name = std::ffi::OsStr::from_bytes(b"invalid-\xff");
    fs::write(invalid_root.as_std_path().join(invalid_name), "invalid").unwrap();

    let (config_handle, instance_handle) = test_handles(&tmp);
    config_handle.lock().config.upsert_library(KnownLibrary {
        id: library.id.clone(),
        library_root: repo_root.clone(),
    });
    let error = global_service::delete_library_files(&config_handle, &instance_handle, &library.id)
        .unwrap_err();

    assert!(matches!(error, SError::Unexpected));
    assert!(deployed.exists());
    assert!(
        !Library::load(&repo_root)
            .unwrap()
            .deployment
            .artifacts
            .is_empty()
    );
    assert!(
        config_handle
            .lock()
            .config
            .known_libraries
            .iter()
            .any(|known| known.id == library.id)
    );
    assert!(library.mods.contains_key(&mod_id));
}

#[test]
fn retiring_reconciled_records_prevents_old_library_replay() {
    let (tmp, game_root, _) = setup_test_env();
    let old_root = game_root.join(".mod_keeper");
    let mut old_library = Library::create(LibraryCreationRequirement {
        repo_root: Some(game_root.join(".mod_keeper")),
        game_root: game_root.clone(),
        name: "SPT 4 library".to_string(),
    })
    .unwrap();
    let mod_src = tmp.path().join("mod");
    let mod_src_utf8 = Utf8Path::from_path(&mod_src).unwrap();
    create_test_mod(mod_src_utf8, "Example", true);
    let mod_fs = mod_fs::scan(mod_src_utf8, &SPTPathRules::default()).unwrap();
    let staged = create_staged_mod_for_test(mod_src_utf8, mod_fs);
    let mod_id = staged.fs.id.clone();
    mod_manager::add_mod(&mut old_library, staged, false).unwrap();
    mod_manager::toggle_mod(&mut old_library, &mod_id, true).unwrap();
    old_library.sync().unwrap();
    let deployed = game_root.join("SPT/user/mods/Example/content.txt");
    assert!(deployed.exists());
    fs::remove_file(&deployed).unwrap();

    fs::write(
        game_root.join("SPT/SPT.Server.deps.json"),
        r#"{"runtimeTarget":{"name":"net10/win-x64"},"targets":{"net10/win-x64":{"SPT.Server/5.0.0-RELEASE+abc":{}}}}"#,
    )
    .unwrap();
    let (config_handle, instance_handle) = test_handles(&tmp);
    config_handle.lock().config.upsert_library(KnownLibrary {
        id: old_library.id.clone(),
        library_root: old_root.clone(),
    });

    global_service::create_library(
        &config_handle,
        &instance_handle,
        CreateLibraryInput {
            game_root: game_root.to_string(),
            library_root: None,
            name: None,
        },
    )
    .unwrap();

    assert!(!deployed.exists());
    assert!(old_root.exists());
    {
        let instance = instance_handle.lock();
        let new_library = instance.as_ref().unwrap();
        assert_eq!(new_library.spt_version, "5.0.0");
        assert!(new_library.mods.is_empty());
    }

    {
        let mut instance = instance_handle.lock();
        let new_library = instance.as_mut().unwrap();
        let mod_fs = mod_fs::scan(mod_src_utf8, &SPTPathRules::default()).unwrap();
        let staged = create_staged_mod_for_test(mod_src_utf8, mod_fs);
        let mod_id = staged.fs.id.clone();
        mod_manager::add_mod(new_library, staged, false).unwrap();
        mod_manager::toggle_mod(new_library, &mod_id, true).unwrap();
        new_library.sync().unwrap();
    }
    assert!(deployed.exists());

    global_service::delete_library_files(&config_handle, &instance_handle, &old_library.id)
        .unwrap();
    assert!(deployed.exists());
}

#[test]
fn creating_a_new_major_library_allows_an_already_removed_old_tree() {
    let (tmp, game_root, _) = setup_test_env();
    let old_root = game_root.join(".mod_keeper");
    let mut old_library = Library::create(LibraryCreationRequirement {
        repo_root: Some(old_root.clone()),
        game_root: game_root.clone(),
        name: "SPT 4 library".to_string(),
    })
    .unwrap();
    let mod_src = tmp.path().join("mod");
    let mod_src_utf8 = Utf8Path::from_path(&mod_src).unwrap();
    create_test_mod(mod_src_utf8, "Example", true);
    let mod_fs = mod_fs::scan(mod_src_utf8, &SPTPathRules::default()).unwrap();
    let staged = create_staged_mod_for_test(mod_src_utf8, mod_fs);
    let mod_id = staged.fs.id.clone();
    mod_manager::add_mod(&mut old_library, staged, false).unwrap();
    mod_manager::toggle_mod(&mut old_library, &mod_id, true).unwrap();
    old_library.sync().unwrap();
    fs::remove_dir_all(game_root.join("SPT")).unwrap();

    let runtime = game_root.join("SPT_Runtime");
    fs::create_dir_all(&runtime).unwrap();
    fs::write(runtime.join("SPT.Server.exe"), "server").unwrap();
    fs::write(
        runtime.join("SPT.Server.deps.json"),
        r#"{"runtimeTarget":{"name":"net10/win-x64"},"targets":{"net10/win-x64":{"SPT.Server/5.0.0-RELEASE+abc":{}}}}"#,
    )
    .unwrap();
    let (config_handle, instance_handle) = test_handles(&tmp);
    config_handle.lock().config.upsert_library(KnownLibrary {
        id: old_library.id,
        library_root: old_root,
    });

    global_service::create_library(
        &config_handle,
        &instance_handle,
        CreateLibraryInput {
            game_root: game_root.to_string(),
            library_root: None,
            name: None,
        },
    )
    .unwrap();

    assert!(
        game_root
            .join(".mod_keeper-spt-5.0.0/manifest.toml")
            .exists()
    );
}

#[cfg(unix)]
#[test]
fn cross_major_migration_purges_legacy_links_from_the_old_server_root() {
    let (tmp, game_root, _) = setup_test_env();
    let old_root = game_root.join(".mod_keeper");
    let old_library = Library::create(LibraryCreationRequirement {
        repo_root: Some(old_root.clone()),
        game_root: game_root.clone(),
        name: "SPT 4 library".to_string(),
    })
    .unwrap();
    let legacy_target = old_root.join("legacy-target.txt");
    fs::write(&legacy_target, "legacy").unwrap();
    let legacy_root = game_root.join("SPT/user/mods");
    fs::create_dir_all(&legacy_root).unwrap();
    let legacy_link = legacy_root.join("LegacyLink");
    std::os::unix::fs::symlink(legacy_target.as_std_path(), legacy_link.as_std_path()).unwrap();

    fs::remove_file(game_root.join("SPT/SPT.Server.exe")).unwrap();
    let runtime = game_root.join("SPT_Runtime");
    fs::create_dir_all(&runtime).unwrap();
    fs::write(runtime.join("SPT.Server.exe"), "server").unwrap();
    fs::write(
        runtime.join("SPT.Server.deps.json"),
        r#"{"runtimeTarget":{"name":"net10/win-x64"},"targets":{"net10/win-x64":{"SPT.Server/5.0.0-RELEASE+abc":{}}}}"#,
    )
    .unwrap();

    let (config_handle, instance_handle) = test_handles(&tmp);
    config_handle.lock().config.upsert_library(KnownLibrary {
        id: old_library.id,
        library_root: old_root,
    });
    global_service::create_library(
        &config_handle,
        &instance_handle,
        CreateLibraryInput {
            game_root: game_root.to_string(),
            library_root: None,
            name: None,
        },
    )
    .unwrap();

    assert!(fs::symlink_metadata(&legacy_link).is_err());
    assert!(legacy_target.exists());
}

#[test]
fn readding_a_game_root_reuses_a_compatible_versioned_library_after_a_patch_change() {
    let (_tmp, game_root, _) = setup_test_env();
    let old_root = game_root.join(".mod_keeper");
    let old_library = Library::create(LibraryCreationRequirement {
        repo_root: Some(old_root.clone()),
        game_root: game_root.clone(),
        name: "SPT 4 library".to_string(),
    })
    .unwrap();
    let old_id = old_library.id.clone();

    fs::write(
        game_root.join("SPT/SPT.Server.deps.json"),
        r#"{"runtimeTarget":{"name":"net10/win-x64"},"targets":{"net10/win-x64":{"SPT.Server/5.0.0-RELEASE+abc":{}}}}"#,
    )
    .unwrap();
    let (config_handle, instance_handle) = test_handles(&_tmp);
    config_handle.lock().config.upsert_library(KnownLibrary {
        id: old_id.clone(),
        library_root: old_root.clone(),
    });
    global_service::create_library(
        &config_handle,
        &instance_handle,
        CreateLibraryInput {
            game_root: game_root.to_string(),
            library_root: None,
            name: None,
        },
    )
    .unwrap();

    let versioned_root = game_root.join(".mod_keeper-spt-5.0.0");
    let versioned_id = instance_handle.lock().as_ref().unwrap().id.clone();
    global_service::delete_library_files(&config_handle, &instance_handle, &old_id).unwrap();
    assert!(!old_root.exists());
    assert!(versioned_root.exists());

    fs::write(
        game_root.join("SPT/SPT.Server.deps.json"),
        r#"{"runtimeTarget":{"name":"net10/win-x64"},"targets":{"net10/win-x64":{"SPT.Server/5.0.1-RELEASE+abc":{}}}}"#,
    )
    .unwrap();
    global_service::create_library(
        &config_handle,
        &instance_handle,
        CreateLibraryInput {
            game_root: game_root.to_string(),
            library_root: None,
            name: None,
        },
    )
    .unwrap();

    let instance = instance_handle.lock();
    let library = instance.as_ref().unwrap();
    assert_eq!(library.id, versioned_id);
    assert_eq!(library.repo_root, versioned_root);
    assert_eq!(library.spt_version, "5.0.1");
    assert_eq!(config_handle.lock().config.known_libraries.len(), 1);
}

#[test]
fn test_collision_detection() {
    let (_tmp, game_root, repo_root) = setup_test_env();
    let requirement = LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Test Library".to_string(),
    };
    let mut lib = Library::create(requirement).unwrap();
    let rules = SPTPathRules::default();

    // Helper to create a mod with a unique server folder (distinct ID) plus a colliding file
    let mut add_named_mod = |mod_name: &str, colliding_file: &str| {
        let p = repo_root.join(format!("src_{}", mod_name));

        // 1. Create a unique server folder so the two mods hash to different IDs
        let server_file = p.join(&rules.server_mods).join(mod_name).join("mod.js");
        fs::create_dir_all(server_file.parent().unwrap()).unwrap();
        fs::write(server_file, "// mod").unwrap();

        // 2. Create the colliding file
        let file_path = p.join(colliding_file);
        fs::create_dir_all(file_path.parent().unwrap()).unwrap();
        fs::write(file_path, "some content").unwrap();

        // 3. Add to library and activate
        let fs = mod_fs::scan(&p, &rules).expect("Failed to parse mod");
        let mod_id = fs.id.clone();
        let staged = create_staged_mod_for_test(&p, fs);
        mod_manager::add_mod(&mut lib, staged, false).expect("Failed to add mod");
        lib.mods.get_mut(&mod_id).unwrap().is_active = true;
    };

    // These two mods have different IDs but both provide "BepInEx/plugins/conflict.dll"
    let conflict_path = "BepInEx/plugins/conflict.dll";
    add_named_mod("Mod_A", conflict_path);
    add_named_mod("Mod_B", conflict_path);

    // Act — lib.sync() runs deploy which detects the collision
    let result = lib.sync();

    // Assert
    assert!(
        result.is_err(),
        "Sync should have failed due to file collision"
    );
    match result {
        Err(SError::FileCollision(errors)) => {
            assert!(!errors.is_empty(), "Collision list should not be empty");
            assert!(
                errors.iter().any(|e| e.contains("conflict.dll")),
                "Error message should mention the colliding file"
            );
        }
        other => panic!("Expected SError::FileCollision, but got: {:?}", other),
    }
}

#[test]
fn test_recursive_linking_logic() {
    let (_tmp, game_root, repo_root) = setup_test_env();
    let requirement = LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Test Library".to_string(),
    };
    let mut lib = Library::create(requirement).unwrap();
    let rules = SPTPathRules::default();

    let setup_mod = |lib: &mut Library, mod_name: &str, file_name: &str| {
        let p = repo_root.join(mod_name);

        // 1. Create a unique client dll so the two mods hash to different IDs
        let dll_path = p
            .join(&rules.client_plugins)
            .join(format!("{mod_name}.dll"));
        fs::create_dir_all(dll_path.parent().unwrap()).unwrap();
        fs::write(dll_path, "").unwrap();

        // 2. Create the overlapping directory structure
        let file_path = p.join(&rules.server_mods).join("CommonDir").join(file_name);
        fs::create_dir_all(file_path.parent().unwrap()).unwrap();
        fs::write(file_path, "data").unwrap();

        // 3. Add and activate using the resolved hash ID
        let fs = mod_fs::scan(&p, &rules).unwrap();
        let mod_id = fs.id.clone();
        let staged = create_staged_mod_for_test(&p, fs);
        mod_manager::add_mod(lib, staged, false).unwrap();

        lib.mods.get_mut(&mod_id).unwrap().is_active = true;
    };

    setup_mod(&mut lib, "ModA", "A.txt");
    setup_mod(&mut lib, "ModB", "B.txt");

    // Sync
    lib.sync().expect("Sync failed");

    // ... rest of your assertions ...
    let common_dir_in_game = game_root.join(&rules.server_mods).join("CommonDir");
    assert!(common_dir_in_game.exists());
    assert!(common_dir_in_game.is_dir());
}

#[test]
fn test_purge_removes_deactivated_mods() {
    let (_tmp, game_root, repo_root) = setup_test_env();
    let requirement = LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Test Library".to_string(),
    };
    let mut lib = Library::create(requirement).unwrap();
    let rules = SPTPathRules::default();

    // 1. Add and activate mod
    create_test_mod(&repo_root.join("src"), "DeleteMe", true);
    let fs = mod_fs::scan(&repo_root.join("src"), &rules).unwrap();
    let mod_id = fs.id.clone();
    let staged = create_staged_mod_for_test(&repo_root.join("src"), fs);
    mod_manager::add_mod(&mut lib, staged, false).unwrap();
    lib.mods.get_mut(&mod_id).unwrap().is_active = true;

    // Sync
    lib.sync().unwrap();

    assert!(lib.lib_paths.deployment.exists());
    let loaded = Library::load(&lib.repo_root).unwrap();
    assert!(!loaded.deployment.artifacts.is_empty());

    let target_path = game_root.join(&rules.server_mods).join("DeleteMe");
    assert!(target_path.exists());
    assert!(target_path.is_dir());
    assert!(
        !fs::symlink_metadata(&target_path)
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert_eq!(
        fs::read_to_string(target_path.join("content.txt")).unwrap(),
        "DeleteMe"
    );

    // 2. Deactivate and sync
    lib.mods.get_mut(&mod_id).unwrap().is_active = false;
    lib.sync().unwrap();

    // 3. Verify it's gone from game but exists in repo
    assert!(!target_path.exists());
    assert!(lib.lib_paths.mods.join(&mod_id).exists());
    assert!(lib.deployment.artifacts.is_empty());
}

#[test]
fn test_copy_deployment_reuses_owned_directories_and_normalizes_legacy_paths() {
    let (_tmp, game_root, repo_root) = setup_test_env();
    let mut lib = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Test Library".to_string(),
    })
    .unwrap();

    let source = repo_root.join("source");
    create_test_mod(&source, "CopyMod", true);
    let scanned = mod_fs::scan(&source, &SPTPathRules::default()).unwrap();
    let mod_id = scanned.id.clone();
    mod_manager::add_mod(
        &mut lib,
        create_staged_mod_for_test(&source, scanned),
        false,
    )
    .unwrap();
    lib.mods.get_mut(&mod_id).unwrap().is_active = true;

    lib.sync().unwrap();
    assert!(
        lib.deployment
            .created_dirs
            .iter()
            .all(|path| path.is_relative())
    );

    // A second sync must recognize the copied directory as library-owned.
    lib.sync().unwrap();

    // Simulate deployment.toml written by the old implementation.
    lib.deployment.created_dirs = lib
        .deployment
        .created_dirs
        .iter()
        .map(|path| game_root.join(path))
        .collect();
    lib.persist().unwrap();

    let mut loaded = Library::load(&lib.repo_root).unwrap();
    assert!(
        loaded
            .deployment
            .created_dirs
            .iter()
            .all(|path| path.is_relative())
    );
    loaded.sync().unwrap();
}

#[test]
fn test_legacy_copy_deployment_fingerprints_are_migrated_on_load() {
    let (_tmp, game_root, repo_root) = setup_test_env();
    let mut lib = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root,
        name: "Legacy deployment test".to_string(),
    })
    .unwrap();

    let source = repo_root.join("source");
    create_test_mod(&source, "LegacyMod", true);
    let scanned = mod_fs::scan(&source, &SPTPathRules::default()).unwrap();
    let mod_id = scanned.id.clone();
    mod_manager::add_mod(
        &mut lib,
        create_staged_mod_for_test(&source, scanned),
        false,
    )
    .unwrap();
    lib.mods.get_mut(&mod_id).unwrap().is_active = true;
    lib.sync().unwrap();

    let copy_count = lib
        .deployment
        .artifacts
        .iter()
        .filter(|artifact| artifact.kind == ArtifactKind::Copy)
        .count();
    assert!(copy_count > 0);
    for artifact in &mut lib.deployment.artifacts {
        if artifact.kind == ArtifactKind::Copy {
            artifact.fingerprint = None;
        }
    }
    lib.persist().unwrap();

    let mut loaded = Library::load(&lib.repo_root).unwrap();
    assert_eq!(
        loaded
            .deployment
            .artifacts
            .iter()
            .filter(|artifact| artifact.kind == ArtifactKind::Copy)
            .filter(|artifact| artifact.fingerprint.is_some())
            .count(),
        copy_count
    );
    loaded.sync().unwrap();
}

#[test]
fn test_copy_deployment_merges_into_existing_game_directory() {
    let (_tmp, game_root, repo_root) = setup_test_env();
    let mut lib = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Test Library".to_string(),
    })
    .unwrap();

    let managed_dir = game_root.join("EscapeFromTarkov_Data/Managed");
    fs::create_dir_all(&managed_dir).unwrap();
    fs::write(managed_dir.join("game.dll"), "game data").unwrap();

    let source = repo_root.join("dynamic_maps");
    let rules = SPTPathRules::default();
    let server_file = source
        .join(&rules.server_mods)
        .join("DynamicMaps/server.dll");
    let managed_file = source.join("EscapeFromTarkov_Data/Managed/Unity.VectorGraphics.dll");
    fs::create_dir_all(server_file.parent().unwrap()).unwrap();
    fs::create_dir_all(managed_file.parent().unwrap()).unwrap();
    fs::write(server_file, "server").unwrap();
    fs::write(&managed_file, "mod dependency").unwrap();

    let scanned = mod_fs::scan(&source, &rules).unwrap();
    let mod_id = scanned.id.clone();
    mod_manager::add_mod(
        &mut lib,
        create_staged_mod_for_test(&source, scanned),
        false,
    )
    .unwrap();
    lib.mods.get_mut(&mod_id).unwrap().is_active = true;

    lib.sync().unwrap();

    assert_eq!(
        fs::read_to_string(managed_dir.join("game.dll")).unwrap(),
        "game data"
    );
    assert_eq!(
        fs::read_to_string(managed_dir.join("Unity.VectorGraphics.dll")).unwrap(),
        "mod dependency"
    );
    assert!(
        !lib.deployment
            .created_dirs
            .iter()
            .any(|path| path == Utf8Path::new("EscapeFromTarkov_Data"))
    );

    lib.sync().unwrap();
}

#[test]
fn test_unowned_deployment_target_is_preserved_and_blocks_sync() {
    let (_tmp, game_root, repo_root) = setup_test_env();
    let mut lib = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Test Library".to_string(),
    })
    .unwrap();

    let source = repo_root.join("source");
    create_test_mod(&source, "OwnedByUser", true);
    let scanned = mod_fs::scan(&source, &SPTPathRules::default()).unwrap();
    let mod_id = scanned.id.clone();
    mod_manager::add_mod(
        &mut lib,
        create_staged_mod_for_test(&source, scanned),
        false,
    )
    .unwrap();
    lib.mods.get_mut(&mod_id).unwrap().is_active = true;

    let target = game_root.join("SPT/user/mods/OwnedByUser");
    fs::create_dir_all(&target).unwrap();
    fs::write(target.join("keep.txt"), "user data").unwrap();

    assert!(lib.sync().is_err());
    assert_eq!(
        fs::read_to_string(target.join("keep.txt")).unwrap(),
        "user data"
    );
}

#[test]
fn test_to_dto_uses_hash_id() {
    let (_tmp, game_root, repo_root) = setup_test_env();
    let requirement = LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Test Library".to_string(),
    };
    let mut lib = Library::create(requirement).expect("Failed to create library");

    // 1. Prepare a mod on disk
    let mod_src = _tmp.path().join("source_mod");
    let mod_src_utf8 = Utf8Path::from_path(&mod_src).unwrap();

    let rules = SPTPathRules::default();
    let dummy_dll = mod_src_utf8
        .join(&rules.server_mods)
        .join("TestMod/mod.dll");
    std::fs::create_dir_all(dummy_dll.parent().unwrap()).unwrap();
    std::fs::write(dummy_dll, "").unwrap();

    // 2. Add mod to library
    let fs = mod_fs::scan(mod_src_utf8, &rules).unwrap();
    let staged = create_staged_mod_for_test(mod_src_utf8, fs);
    mod_manager::add_mod(&mut lib, staged, false).expect("Add mod failed");

    // 3. Check Frontend DTO: mod is keyed by the hash ID, name from the source directory
    let dto = lib.to_dto();
    let mod_id = hash_id("testmod");
    let m = dto.mods.get(&mod_id).expect("Mod not found in DTO");
    assert_eq!(m.id, mod_id);
    assert_eq!(m.name, "source_mod");
}

#[test]
fn test_upgrade_success_leaves_no_snapshot() {
    let (_tmp, game_root, repo_root) = setup_test_env();
    let requirement = LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Test Library".to_string(),
    };
    let mut lib = Library::create(requirement).unwrap();
    let rules = SPTPathRules::default();

    // Both versions share the same server folder name, so they hash to the same ID
    let folder_name = "UpgradeTest";
    let mod_id = hash_id("upgradetest");
    let src = repo_root.join("src_v1");
    fs::create_dir_all(src.join(&rules.server_mods).join(folder_name)).unwrap();
    fs::write(
        src.join(&rules.server_mods)
            .join(folder_name)
            .join("v1.txt"),
        "v1",
    )
    .unwrap();

    // 1. Initial Add
    let fs1 = mod_fs::scan(&src, &rules).unwrap();
    let staged1 = create_staged_mod_for_test(&src, fs1);
    mod_manager::add_mod(&mut lib, staged1, false).unwrap();

    // 2. Overwrite Add
    let src2 = repo_root.join("src_v2");
    fs::create_dir_all(src2.join(&rules.server_mods).join(folder_name)).unwrap();
    fs::write(
        src2.join(&rules.server_mods)
            .join(folder_name)
            .join("v2.txt"),
        "v2",
    )
    .unwrap();

    let fs2 = mod_fs::scan(&src2, &rules).unwrap();
    let staged2 = create_staged_mod_for_test(&src2, fs2);
    mod_manager::add_mod(&mut lib, staged2, false).unwrap();

    // 3. Upgrade landed and the transient snapshot was discarded (§7f)
    let mod_dir = lib.lib_paths.mods.join(&mod_id);
    assert!(
        mod_dir
            .join(&rules.server_mods)
            .join(folder_name)
            .join("v2.txt")
            .exists()
    );
    assert!(
        !lib.lib_paths.backups.join(&mod_id).exists(),
        "successful overwrite must leave no snapshot behind"
    );
}

#[test]
fn test_upgrade_snapshot_restores_prior_contents() {
    let (_tmp, game_root, repo_root) = setup_test_env();
    let requirement = LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Test Library".to_string(),
    };
    let mut lib = Library::create(requirement).unwrap();
    let rules = SPTPathRules::default();

    let folder_name = "RestoreTest";
    let mod_id = hash_id("restoretest");
    let src = repo_root.join("src_v1");
    let payload = src.join(&rules.server_mods).join(folder_name);
    fs::create_dir_all(&payload).unwrap();
    fs::write(payload.join("v1.txt"), "v1").unwrap();

    let fs1 = mod_fs::scan(&src, &rules).unwrap();
    let staged1 = create_staged_mod_for_test(&src, fs1);
    mod_manager::add_mod(&mut lib, staged1, false).unwrap();

    // Simulate a failed overwrite: snapshot taken, then the mod dir mangled
    mod_keeper_lib::core::mod_snapshot::take(&lib, &mod_id).unwrap();
    let installed = lib.lib_paths.mods.join(&mod_id);
    fs::remove_dir_all(&installed).unwrap();
    fs::create_dir_all(&installed).unwrap();
    fs::write(installed.join("partial-junk.txt"), "half-written").unwrap();

    // Restore puts everything back exactly as it was and discards the snapshot
    mod_keeper_lib::core::mod_snapshot::restore(&lib, &mod_id).unwrap();

    assert!(
        installed
            .join(&rules.server_mods)
            .join(folder_name)
            .join("v1.txt")
            .exists(),
        "prior contents must be restored"
    );
    assert!(
        !installed.join("partial-junk.txt").exists(),
        "partial write must be gone"
    );
    assert!(
        !lib.lib_paths.backups.join(&mod_id).exists(),
        "snapshot is discarded after restore"
    );
}

#[test]
fn test_untracked_file_safety_in_shared_folder() {
    let (_tmp, game_root, repo_root) = setup_test_env();
    let requirement = LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Test Library".to_string(),
    };
    let mut lib = Library::create(requirement).unwrap();
    let rules = SPTPathRules::default();

    // 1. Setup TWO mods sharing a folder in "client_plugins" (BepInEx/plugins).
    // REASON: "server_mods" (user/mods) strictly enforces a "One Folder = One Mod" structure
    // where the folder name is the Mod ID. Creating a "SharedDir" there creates ambiguity
    // (is "SharedDir" the mod?). "client_plugins" allows unstructured nesting,
    // making it the correct target for testing shared directory behavior.
    let setup_mod = |lib: &mut Library, name: &str| {
        let p = repo_root.join(format!("src_{}", name));

        // Target: BepInEx/plugins/SharedDir/{name}.dll
        let file_rel = rules
            .client_plugins
            .join("SharedDir")
            .join(format!("{}.dll", name));

        fs::create_dir_all(p.join(file_rel.parent().unwrap())).unwrap();
        fs::write(p.join(&file_rel), "dll content").unwrap();

        let fs = mod_fs::scan(&p, &rules).unwrap();
        let mod_id = fs.id.clone();
        let staged = create_staged_mod_for_test(&p, fs);

        mod_manager::add_mod(lib, staged, false).unwrap();

        // Access the mod using the actual ID generated by ModFS
        lib.mods.get_mut(&mod_id).unwrap().is_active = true;

        mod_id
    };

    let id_a = setup_mod(&mut lib, "ModA");
    let id_b = setup_mod(&mut lib, "ModB");

    // Sync
    lib.sync().unwrap();

    // 2. Add untracked file to the real directory created by the Linker
    let shared_dir = game_root.join(&rules.client_plugins).join("SharedDir");
    let untracked = shared_dir.join("user_notes.txt");

    assert!(shared_dir.exists(), "SharedDir should exist after sync");
    fs::write(&untracked, "user data").unwrap();

    // 3. Deactivate all mods and sync (purge)
    lib.mods.get_mut(&id_a).unwrap().is_active = false;
    lib.mods.get_mut(&id_b).unwrap().is_active = false;
    lib.sync().unwrap();

    // 4. Verification
    assert!(
        !shared_dir.join("ModA.dll").exists(),
        "ModA.dll should be cleaned up"
    );
    assert!(
        !shared_dir.join("ModB.dll").exists(),
        "ModB.dll should be cleaned up"
    );

    // Crucial Check: The folder and user file must remain
    assert!(untracked.exists(), "Untracked user file must be preserved");
    assert!(
        shared_dir.exists(),
        "Shared directory must be preserved because it contains user data"
    );
}

#[test]
fn test_persistence_cycle() {
    let (_tmp, game_root, repo_root) = setup_test_env();
    let requirement = LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Test Library".to_string(),
    };
    let mut lib = Library::create(requirement).unwrap();
    let rules = SPTPathRules::default();

    let src = repo_root.join("src");
    fs::create_dir_all(src.join(&rules.server_mods).join("PersistMod")).unwrap();
    fs::write(
        src.join(&rules.server_mods)
            .join("PersistMod")
            .join("mod.dll"),
        "",
    )
    .unwrap();

    let mod_fs = mod_fs::scan(&src, &rules).unwrap();
    let staged = create_staged_mod_for_test(&src, mod_fs);
    mod_manager::add_mod(&mut lib, staged, false).unwrap();

    let mod_id = hash_id("persistmod");
    lib.mods.get_mut(&mod_id).unwrap().is_active = true;
    lib.sync().unwrap();

    let loaded_lib = Library::load(&repo_root).expect("Failed to load library");

    assert_eq!(loaded_lib.mods.len(), 1);
    assert!(loaded_lib.mods.get(&mod_id).unwrap().is_active);
}

#[test]
fn test_mod_id_case_normalization() {
    // This test ensures that on Windows, IDs are treated case-insensitively
    // to prevent duplicate mods pointing to the same folder.
    let (_tmp, _game_root, _repo_root) = setup_test_env();
    let requirement = LibraryCreationRequirement {
        repo_root: Some(_repo_root.clone()),
        game_root: _game_root.clone(),
        name: "Test Library".to_string(),
    };
    let _lib = Library::create(requirement).unwrap();

    // Add "MyMod" then add "mymod"
    // (Implementation depends on your Choice:
    //  Either ModFS::new should lowercase IDs, or Library should handle it)

    // Suggestion: In Library::add_mod, use: let mod_id = fs.id.to_lowercase();
    // and adjust tests accordingly.
}

#[test]
fn test_derive_library_root() {
    let (_tmp, game_root, _repo_root) = setup_test_env();

    let derived = library_service::derive_library_root(&game_root);
    let expected = game_root.join(".mod_keeper");

    assert_eq!(derived, expected);
}

#[test]
fn test_validate_library_structure_valid() {
    let (_tmp, game_root, repo_root) = setup_test_env();

    // Create a valid library
    let requirement = LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Test Library".to_string(),
    };
    Library::create(requirement).expect("Failed to create library");

    // Validate should succeed
    let result = library_service::validate_library_structure(&repo_root);
    assert!(result.is_ok(), "Valid library should pass validation");
}

#[test]
fn test_validate_library_structure_missing_manifest() {
    let (_tmp, _game_root, repo_root) = setup_test_env();

    // Create directory structure but no manifest
    std::fs::create_dir_all(repo_root.join("mods")).unwrap();
    std::fs::create_dir_all(repo_root.join("backups")).unwrap();
    std::fs::create_dir_all(repo_root.join("staging")).unwrap();

    // Validate should fail with InvalidLibrary error
    let result = library_service::validate_library_structure(&repo_root);
    assert!(
        result.is_err(),
        "Library without manifest should fail validation"
    );

    match result {
        Err(SError::InvalidLibrary(path, reason)) => {
            assert_eq!(path, repo_root.to_string());
            assert!(reason.contains("manifest.toml"));
        }
        Err(e) => panic!("Expected InvalidLibrary error, got: {}", e),
        Ok(_) => panic!("Expected error but got Ok"),
    }
}

#[test]
fn test_validate_library_structure_missing_directory() {
    let (_tmp, game_root, repo_root) = setup_test_env();

    // Create a library
    let requirement = LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Test Library".to_string(),
    };
    Library::create(requirement).expect("Failed to create library");

    // Remove one of the required directories
    std::fs::remove_dir_all(repo_root.join("backups")).unwrap();

    // Validate should fail
    let result = library_service::validate_library_structure(&repo_root);
    assert!(
        result.is_err(),
        "Library with missing directory should fail validation"
    );

    match result {
        Err(SError::InvalidLibrary(path, reason)) => {
            assert_eq!(path, repo_root.to_string());
            assert!(reason.contains("backups") || reason.contains("missing required directory"));
        }
        Err(e) => panic!("Expected InvalidLibrary error, got: {}", e),
        Ok(_) => panic!("Expected error but got Ok"),
    }
}

#[test]
fn test_cache_rebuild_conflict_error() {
    let (_tmp, game_root, repo_root) = setup_test_env();
    let requirement = LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Test Library".to_string(),
    };
    let mut lib = Library::create(requirement).expect("Failed to create library");
    let rules = SPTPathRules::default();

    // Both folders contain the same server mod folder, so both resolve to the same hash ID
    let resolved_id = hash_id("samemod");

    // 1. Create first mod folder whose name doesn't match the resolved ID (wants a rename)
    let source_folder = "source-mod";
    let source_dir = lib.lib_paths.mods.join(source_folder);
    let source_server = source_dir.join(&rules.server_mods).join("SameMod");
    fs::create_dir_all(&source_server).unwrap();
    fs::write(source_server.join("mod.js"), "// source").unwrap();

    // 2. Create second mod folder already named with the resolved ID
    let target_dir = lib.lib_paths.mods.join(&resolved_id);
    let target_server = target_dir.join(&rules.server_mods).join("SameMod");
    fs::create_dir_all(&target_server).unwrap();
    fs::write(target_server.join("mod.js"), "// target").unwrap();

    // 3. Attempt cache rebuild - should fail with conflict error
    let result = library_service::rebuild_library_cache(&mut lib);

    assert!(result.is_err(), "Should fail due to ID conflict");
    match result {
        Err(SError::ModIdConflict(from, to)) => {
            assert_eq!(from, source_folder);
            assert_eq!(to, resolved_id);
        }
        other => panic!("Expected ModIdConflict error, got: {:?}", other),
    }
}

// --- App-Config-based library lifecycle (new endpoint services) ---

#[test]
fn test_create_library_registers_and_activates() {
    let (_tmp, game_root, _repo_root) = setup_test_env();
    let (config_handle, instance_handle) = test_handles(&_tmp);

    let expected_root = game_root.join(".mod_keeper");
    assert!(!expected_root.exists());

    global_service::create_library(
        &config_handle,
        &instance_handle,
        CreateLibraryInput {
            game_root: game_root.to_string(),
            library_root: None,
            name: Some("New Library".to_string()),
        },
    )
    .expect("Failed to create library");

    // Files created
    assert!(expected_root.join("manifest.toml").exists());
    assert!(expected_root.join("mods").exists());
    assert!(expected_root.join("backups").exists());
    assert!(expected_root.join("staging").exists());

    // Instance swapped in
    let instance = instance_handle.lock();
    let library = instance.as_ref().expect("library should be active");
    assert_eq!(library.name, "New Library");

    // Config registered the id and made it active
    let store = config_handle.lock();
    let known = store
        .config
        .find_library(&library.id)
        .expect("library registered");
    assert_eq!(known.library_root, expected_root);
    assert_eq!(
        store.config.app_state.active_library_id.as_deref(),
        Some(library.id.as_str())
    );
    // Config was persisted to the test path
    assert!(store.path.exists());
}

#[test]
fn test_create_library_adopts_existing_id() {
    let (_tmp, game_root, _repo_root) = setup_test_env();
    let (config_handle, instance_handle) = test_handles(&_tmp);

    // An existing valid library at the derived root
    let expected_root = game_root.join(".mod_keeper");
    let original = Library::create(LibraryCreationRequirement {
        repo_root: Some(expected_root.clone()),
        game_root: game_root.clone(),
        name: "Original Library".to_string(),
    })
    .expect("Failed to create original library");

    global_service::create_library(
        &config_handle,
        &instance_handle,
        CreateLibraryInput {
            game_root: game_root.to_string(),
            library_root: None,
            name: Some("Ignored Name".to_string()),
        },
    )
    .expect("Failed to adopt existing library");

    // The id was adopted, never re-minted (C7), and the name kept
    let instance = instance_handle.lock();
    let library = instance.as_ref().unwrap();
    assert_eq!(library.id, original.id);
    assert_eq!(library.name, "Original Library");
}

#[test]
fn test_create_library_invalid_existing_dir_fails() {
    let (_tmp, game_root, _repo_root) = setup_test_env();
    let (config_handle, instance_handle) = test_handles(&_tmp);

    // Dir exists but has no manifest
    let expected_root = game_root.join(".mod_keeper");
    fs::create_dir_all(expected_root.join("mods")).unwrap();
    fs::create_dir_all(expected_root.join("backups")).unwrap();
    fs::create_dir_all(expected_root.join("staging")).unwrap();

    let result = global_service::create_library(
        &config_handle,
        &instance_handle,
        CreateLibraryInput {
            game_root: game_root.to_string(),
            library_root: None,
            name: None,
        },
    );

    assert!(matches!(result, Err(SError::InvalidLibrary(_, _))));
    // Nothing registered, nothing activated
    assert!(config_handle.lock().config.known_libraries.is_empty());
    assert!(instance_handle.lock().is_none());
}

#[test]
fn test_activate_library_by_id() {
    let (_tmp, game_root, _repo_root) = setup_test_env();
    let (config_handle, instance_handle) = test_handles(&_tmp);

    global_service::create_library(
        &config_handle,
        &instance_handle,
        CreateLibraryInput {
            game_root: game_root.to_string(),
            library_root: None,
            name: Some("Lib".to_string()),
        },
    )
    .unwrap();
    let library_id = instance_handle.lock().as_ref().unwrap().id.clone();

    // Drop the instance, then re-activate by id
    *instance_handle.lock() = None;
    global_service::activate_library(&config_handle, &instance_handle, &library_id)
        .expect("activate failed");

    assert_eq!(
        instance_handle.lock().as_ref().map(|l| l.id.clone()),
        Some(library_id.clone())
    );
    assert_eq!(
        config_handle.lock().config.app_state.active_library_id,
        Some(library_id)
    );
}

#[test]
fn test_activate_unsupported_spt_version_fails_only_on_activate() {
    let (_tmp, game_root, _repo_root) = setup_test_env();
    let (config_handle, instance_handle) = test_handles(&_tmp);

    global_service::create_library(
        &config_handle,
        &instance_handle,
        CreateLibraryInput {
            game_root: game_root.to_string(),
            library_root: None,
            name: Some("Old SPT".to_string()),
        },
    )
    .unwrap();
    let library_id = instance_handle.lock().as_ref().unwrap().id.clone();
    let library_root = game_root.join(".mod_keeper");
    *instance_handle.lock() = None;

    // Tamper the recorded SPT version to an unsupported one
    let manifest_path = library_root.join("manifest.toml");
    let manifest = fs::read_to_string(&manifest_path).unwrap();
    fs::write(&manifest_path, manifest.replace("4.0.11", "3.9.0")).unwrap();

    // Assembly still lists it fully - no validation at list time (C13)
    let store = config_handle.lock();
    let workspace = global_service::assemble_workspace(&store.config, None, None);
    drop(store);
    assert_eq!(workspace.libraries.len(), 1);
    assert!(matches!(
        workspace.libraries[0],
        mod_keeper_lib::models::workspace::LibraryEntry::Summary(_)
    ));

    // Activation is where the version hard-fails
    let result = global_service::activate_library(&config_handle, &instance_handle, &library_id);
    assert!(matches!(result, Err(SError::UnsupportedSPTVersion(_))));
}

#[test]
fn test_rename_library_active_and_inactive() {
    let (_tmp, game_root, _repo_root) = setup_test_env();
    let (config_handle, instance_handle) = test_handles(&_tmp);

    global_service::create_library(
        &config_handle,
        &instance_handle,
        CreateLibraryInput {
            game_root: game_root.to_string(),
            library_root: None,
            name: Some("Original Name".to_string()),
        },
    )
    .unwrap();
    let library_id = instance_handle.lock().as_ref().unwrap().id.clone();
    let library_root = game_root.join(".mod_keeper");

    // Active: rename goes through the live instance
    global_service::rename_library(
        &config_handle,
        &instance_handle,
        &library_id,
        "Active Rename".to_string(),
    )
    .expect("rename failed");
    assert_eq!(
        instance_handle.lock().as_ref().unwrap().name,
        "Active Rename"
    );
    assert_eq!(
        Library::read_library_manifest(&library_root).unwrap().name,
        "Active Rename"
    );

    // Inactive: rename writes manifest.toml directly
    *instance_handle.lock() = None;
    global_service::rename_library(
        &config_handle,
        &instance_handle,
        &library_id,
        "Inactive Rename".to_string(),
    )
    .expect("rename failed");
    assert_eq!(
        Library::read_library_manifest(&library_root).unwrap().name,
        "Inactive Rename"
    );
}

#[test]
fn test_delete_library_entry_keeps_files() {
    let (_tmp, game_root, _repo_root) = setup_test_env();
    let (config_handle, instance_handle) = test_handles(&_tmp);

    global_service::create_library(
        &config_handle,
        &instance_handle,
        CreateLibraryInput {
            game_root: game_root.to_string(),
            library_root: None,
            name: Some("Lib".to_string()),
        },
    )
    .unwrap();
    let library_id = instance_handle.lock().as_ref().unwrap().id.clone();
    let library_root = game_root.join(".mod_keeper");

    global_service::delete_library_entry(&config_handle, &instance_handle, &library_id)
        .expect("delete entry failed");

    // Row and activation gone; files intact so re-adding re-adopts the id (C7)
    let store = config_handle.lock();
    assert!(store.config.known_libraries.is_empty());
    assert!(store.config.app_state.active_library_id.is_none());
    drop(store);
    assert!(instance_handle.lock().is_none());
    assert!(library_root.join("manifest.toml").exists());
}

#[test]
fn test_delete_library_files_removes_directory() {
    let (_tmp, game_root, _repo_root) = setup_test_env();
    let (config_handle, instance_handle) = test_handles(&_tmp);

    global_service::create_library(
        &config_handle,
        &instance_handle,
        CreateLibraryInput {
            game_root: game_root.to_string(),
            library_root: None,
            name: Some("Lib".to_string()),
        },
    )
    .unwrap();
    let library_id = instance_handle.lock().as_ref().unwrap().id.clone();
    let library_root = game_root.join(".mod_keeper");

    // Add and deploy a mod so purge has links to clean up
    let rules = SPTPathRules::default();
    let mod_src = _tmp.path().join("test_mod");
    let mod_src_utf8 = Utf8Path::from_path(&mod_src).unwrap();
    create_test_mod(mod_src_utf8, "TestMod", true);
    let mod_fs = mod_fs::scan(mod_src_utf8, &rules).unwrap();
    let mod_id = mod_fs.id.clone();
    {
        let mut instance = instance_handle.lock();
        let lib = instance.as_mut().unwrap();
        let staged = create_staged_mod_for_test(mod_src_utf8, mod_fs);
        mod_manager::add_mod(lib, staged, false).unwrap();
        lib.mods.get_mut(&mod_id).unwrap().is_active = true;
        lib.sync().unwrap();
    }
    let deployed = game_root.join(&rules.server_mods).join("TestMod");
    assert!(deployed.exists(), "mod should be deployed before delete");

    global_service::delete_library_files(&config_handle, &instance_handle, &library_id)
        .expect("delete files failed");

    assert!(!library_root.exists(), "library dir should be deleted");
    assert!(!deployed.exists(), "deployed links should be purged");
    assert!(config_handle.lock().config.known_libraries.is_empty());
    assert!(instance_handle.lock().is_none());
}

#[test]
fn deleting_a_library_leaves_nonempty_recorded_directories_in_place() {
    let (_tmp, game_root, _repo_root) = setup_test_env();
    let (config_handle, instance_handle) = test_handles(&_tmp);

    global_service::create_library(
        &config_handle,
        &instance_handle,
        CreateLibraryInput {
            game_root: game_root.to_string(),
            library_root: None,
            name: Some("Lib".to_string()),
        },
    )
    .unwrap();
    let library_id = instance_handle.lock().as_ref().unwrap().id.clone();
    let library_root = game_root.join(".mod_keeper");
    let mod_src = _tmp.path().join("test_mod");
    let mod_src_utf8 = Utf8Path::from_path(&mod_src).unwrap();
    create_test_mod(mod_src_utf8, "TestMod", true);
    {
        let mut instance = instance_handle.lock();
        let lib = instance.as_mut().unwrap();
        let mod_fs = mod_fs::scan(mod_src_utf8, &SPTPathRules::default()).unwrap();
        let mod_id = mod_fs.id.clone();
        mod_manager::add_mod(lib, create_staged_mod_for_test(mod_src_utf8, mod_fs), false).unwrap();
        mod_manager::toggle_mod(lib, &mod_id, true).unwrap();
        lib.sync().unwrap();
    }
    let content = game_root.join("SPT/user/mods/TestMod/content.txt");
    let untracked = game_root.join("SPT/user/mods/TestMod/untracked.txt");
    fs::write(&untracked, "keep me").unwrap();

    global_service::delete_library_files(&config_handle, &instance_handle, &library_id).unwrap();

    assert!(!library_root.exists());
    assert!(!content.exists());
    assert_eq!(fs::read_to_string(&untracked).unwrap(), "keep me");
}

#[test]
fn test_delete_library_unregistered_id_fails() {
    let (_tmp, _game_root, _repo_root) = setup_test_env();
    let (config_handle, instance_handle) = test_handles(&_tmp);

    let result =
        global_service::delete_library_files(&config_handle, &instance_handle, "no-such-id");
    assert!(matches!(result, Err(SError::InvalidLibrary(_, _))));
}

// --- bulk_update_mods / sync (delta 3, C3) ---

// Creates an active library with one installed (not yet deployed) server mod.
fn setup_active_library_with_mod(
    tmp: &tempfile::TempDir,
    game_root: &Utf8Path,
) -> (ConfigHandle, InstanceHandle, String, String) {
    let (config_handle, instance_handle) = test_handles(tmp);
    global_service::create_library(
        &config_handle,
        &instance_handle,
        CreateLibraryInput {
            game_root: game_root.to_string(),
            library_root: None,
            name: Some("Lib".to_string()),
        },
    )
    .unwrap();

    let mod_src = tmp.path().join("bulk_mod");
    let mod_src_utf8 = Utf8Path::from_path(&mod_src).unwrap();
    create_test_mod(mod_src_utf8, "BulkMod", true);
    let mod_fs = mod_fs::scan(mod_src_utf8, &SPTPathRules::default()).unwrap();
    let mod_id = mod_fs.id.clone();

    let library_id = {
        let mut instance = instance_handle.lock();
        let lib = instance.as_mut().unwrap();
        let staged = create_staged_mod_for_test(mod_src_utf8, mod_fs);
        mod_manager::add_mod(lib, staged, false).unwrap();
        // add_mod marks dirty; clear via sync so the test observes bulk_update's dirty flag
        lib.sync().unwrap();
        lib.id.clone()
    };

    (config_handle, instance_handle, library_id, mod_id)
}

#[test]
fn test_bulk_update_sets_stale_and_never_deploys() {
    let (_tmp, game_root, _repo_root) = setup_test_env();
    let (_config, instance_handle, library_id, mod_id) =
        setup_active_library_with_mod(&_tmp, &game_root);
    let rules = SPTPathRules::default();
    let deployed = game_root.join(&rules.server_mods).join("BulkMod");

    library_service::bulk_update_mods(
        instance_handle.clone(),
        &library_id,
        std::slice::from_ref(&mod_id),
        &BulkModAction::Enable,
    )
    .expect("bulk enable failed");

    {
        let instance = instance_handle.lock();
        let lib = instance.as_ref().unwrap();
        assert!(lib.mods.get(&mod_id).unwrap().is_active);
        assert!(
            lib.to_dto().is_dirty,
            "enable must set the dirty flag (deployStale)"
        );
    }
    assert!(
        !deployed.exists(),
        "bulk_update_mods must never deploy symlinks (C3)"
    );

    // Explicit sync deploys and clears the stale flag
    library_service::sync_active_library(instance_handle.clone(), &library_id)
        .expect("sync failed");
    assert!(deployed.exists());
    assert!(!instance_handle.lock().as_ref().unwrap().to_dto().is_dirty);
}

#[test]
fn test_bulk_update_rejects_non_active_library() {
    let (_tmp, game_root, _repo_root) = setup_test_env();
    let (_config, instance_handle, _library_id, mod_id) =
        setup_active_library_with_mod(&_tmp, &game_root);

    let result = library_service::bulk_update_mods(
        instance_handle,
        "some-other-library",
        &[mod_id],
        &BulkModAction::Enable,
    );
    assert!(matches!(result, Err(SError::InvalidLibrary(_, _))));
}

#[test]
fn test_bulk_update_delete_removes_mod() {
    let (_tmp, game_root, _repo_root) = setup_test_env();
    let (_config, instance_handle, library_id, mod_id) =
        setup_active_library_with_mod(&_tmp, &game_root);

    library_service::bulk_update_mods(
        instance_handle.clone(),
        &library_id,
        std::slice::from_ref(&mod_id),
        &BulkModAction::Delete,
    )
    .expect("bulk delete failed");

    let instance = instance_handle.lock();
    let lib = instance.as_ref().unwrap();
    assert!(!lib.mods.contains_key(&mod_id));
    assert!(!lib.lib_paths.mods.join(&mod_id).exists());
}

#[test]
fn test_overlapping_mod_writes_settle_to_a_requested_state() {
    let (_tmp, game_root, _repo_root) = setup_test_env();
    let (_config, instance_handle, library_id, mod_id) =
        setup_active_library_with_mod(&_tmp, &game_root);

    // Two overlapping absolute writes to the same mod: both must complete,
    // and the result is one of the requested states, never a corrupt third (§7e)
    let handles: Vec<_> = [BulkModAction::Enable, BulkModAction::Disable]
        .into_iter()
        .map(|action| {
            let instance_handle = instance_handle.clone();
            let library_id = library_id.clone();
            let mod_id = mod_id.clone();
            std::thread::spawn(move || {
                library_service::bulk_update_mods(instance_handle, &library_id, &[mod_id], &action)
            })
        })
        .collect();

    for handle in handles {
        handle.join().unwrap().expect("both writes must succeed");
    }

    // Final state matches what was persisted
    let instance = instance_handle.lock();
    let lib = instance.as_ref().unwrap();
    let in_memory = lib.mods.get(&mod_id).unwrap().is_active;
    let reloaded = Library::read_library_manifest(&lib.repo_root).unwrap();
    assert_eq!(reloaded.mods.get(&mod_id).unwrap().is_active, in_memory);
}

// --- Read-only workspace assembly (C13) ---

#[test]
fn test_assembly_unreadable_manifest_is_path_only_stub() {
    let (_tmp, game_root, _repo_root) = setup_test_env();
    let (config_handle, instance_handle) = test_handles(&_tmp);

    global_service::create_library(
        &config_handle,
        &instance_handle,
        CreateLibraryInput {
            game_root: game_root.to_string(),
            library_root: None,
            name: Some("Good Lib".to_string()),
        },
    )
    .unwrap();

    // Register a second path with a corrupt manifest
    let broken_root = game_root.join(".broken_lib");
    fs::create_dir_all(&broken_root).unwrap();
    fs::write(broken_root.join("manifest.toml"), "not [ valid toml").unwrap();
    config_handle.lock().config.upsert_library(KnownLibrary {
        id: "broken-id".to_string(),
        library_root: broken_root.clone(),
    });

    let store = config_handle.lock();
    let instance = instance_handle.lock();
    let workspace = global_service::assemble_workspace(&store.config, instance.as_ref(), None);

    // Both entries present - the unreadable one as a stub, never dropped
    assert_eq!(workspace.libraries.len(), 2);
    let stubs: Vec<_> = workspace
        .libraries
        .iter()
        .filter_map(|entry| match entry {
            mod_keeper_lib::models::workspace::LibraryEntry::Stub(stub) => Some(stub),
            _ => None,
        })
        .collect();
    assert_eq!(stubs.len(), 1);
    assert_eq!(stubs[0].path, broken_root.to_string());
}

#[test]
fn test_assembly_reports_mods_and_deploy_stale() {
    let (_tmp, game_root, _repo_root) = setup_test_env();
    let (config_handle, instance_handle, library_id, mod_id) =
        setup_active_library_with_mod(&_tmp, &game_root);

    library_service::bulk_update_mods(
        instance_handle.clone(),
        &library_id,
        std::slice::from_ref(&mod_id),
        &BulkModAction::Enable,
    )
    .unwrap();

    let store = config_handle.lock();
    let instance = instance_handle.lock();
    let workspace = global_service::assemble_workspace(&store.config, instance.as_ref(), None);

    assert_eq!(
        workspace.active_library_id.as_deref(),
        Some(library_id.as_str())
    );
    let mods = workspace
        .mods_by_library_id
        .get(&library_id)
        .expect("mods listed");
    let entry = mods.iter().find(|m| m.id == mod_id).expect("mod present");
    assert!(entry.is_enabled);

    match &workspace.libraries[0] {
        mod_keeper_lib::models::workspace::LibraryEntry::Summary(summary) => {
            assert!(
                summary.deploy_stale,
                "pending toggle must read as deployStale"
            );
        }
        other => panic!("expected summary, got {other:?}"),
    }
    // Tools map exists but is empty (tool registry deferred)
    assert_eq!(
        workspace.tools_by_library_id.get(&library_id).map(Vec::len),
        Some(0)
    );
}
