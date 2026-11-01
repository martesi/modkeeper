mod common;

use camino::Utf8Path;
use common::{create_test_mod, setup_test_env};
use mod_keeper_lib::core::{
    global_service, library::Library, library_service, mod_fs, mod_manager, mod_stager::StagedMod,
};
use mod_keeper_lib::models::{
    library::LibraryCreationRequirement, mod_dto::Mod, paths::SPTPathRules,
};
use mod_keeper_lib::store::app_config::{AppConfig, KnownLibrary};
use mod_keeper_lib::utils::id::hash_id;
use mod_keeper_lib::utils::time::{file_created_at, now_iso8601_utc};
use std::fs;

#[test]
fn legacy_mod_manifests_remain_readable() {
    let manifest = "id = 'legacy'\nisActive = true\ntype = 'server'\nname = 'Legacy'\n";
    let entry: Mod = toml::from_str(manifest).unwrap();
    assert_eq!(entry.installed_at, None);
}

#[test]
fn install_time_survives_updates_toggles_rebuilds_and_reload() {
    let (tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root,
        name: "Test".into(),
    })
    .unwrap();
    let source_dir = tmp.path().join("source");
    let source = Utf8Path::from_path(&source_dir).unwrap();
    create_test_mod(source, "TimestampMod", true);
    let staged = || StagedMod {
        fs: mod_fs::scan(source, &SPTPathRules::default()).unwrap(),
        source_path: source.to_path_buf(),
        is_staging: false,
        name: "Timestamp Mod".into(),
    };
    let id = staged().fs.id;
    let before = now_iso8601_utc();
    mod_manager::add_mod(&mut library, staged(), true).unwrap();
    let installed_at = library.mods[&id].installed_at.as_ref().unwrap();
    assert!(installed_at >= &before && installed_at <= &now_iso8601_utc());

    // A past date makes an accidental replacement with today's date observable.
    let original = "2025-01-02T03:04:05Z";
    library.mods.get_mut(&id).unwrap().installed_at = Some(original.into());
    library.persist().unwrap();
    mod_manager::add_mod(&mut library, staged(), false).unwrap();
    mod_manager::toggle_mod(&mut library, &id, false).unwrap();
    library_service::rebuild_library_cache(&mut library).unwrap();
    let mut library = Library::load(&repo_root).unwrap();
    assert_eq!(library.mods[&id].installed_at.as_deref(), Some(original));

    let config = AppConfig {
        known_libraries: vec![KnownLibrary {
            id: library.id.clone(),
            library_root: repo_root,
        }],
        ..AppConfig::default()
    };
    let workspace = global_service::assemble_workspace(&config, Some(&library), None);
    assert_eq!(
        workspace.mods_by_library_id[&library.id][0]
            .installed_at
            .as_deref(),
        Some(original)
    );

    // Removal followed by a fresh install gets a new installation date.
    mod_manager::remove_mod(&mut library, &id).unwrap();
    mod_manager::add_mod(&mut library, staged(), true).unwrap();
    assert_ne!(library.mods[&id].installed_at.as_deref(), Some(original));
}

#[test]
fn legacy_folder_time_is_exposed_read_only_and_preserved_on_update() {
    let (tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root,
        name: "Test".into(),
    })
    .unwrap();
    let source_dir = tmp.path().join("source");
    let source = Utf8Path::from_path(&source_dir).unwrap();
    create_test_mod(source, "LegacyMod", true);
    let staged = || StagedMod {
        fs: mod_fs::scan(source, &SPTPathRules::default()).unwrap(),
        source_path: source.to_path_buf(),
        is_staging: false,
        name: "Legacy Mod".into(),
    };
    let id = staged().fs.id;
    mod_manager::add_mod(&mut library, staged(), true).unwrap();
    library.mods.get_mut(&id).unwrap().installed_at = None;
    library.persist().unwrap();
    let config = AppConfig {
        known_libraries: vec![KnownLibrary {
            id: library.id.clone(),
            library_root: repo_root,
        }],
        ..AppConfig::default()
    };
    let mod_dir = library.lib_paths.mods.join(&id);
    let expected = file_created_at(&mod_dir).unwrap();
    let manifest_before = fs::read(&library.lib_paths.manifest).unwrap();
    // Inactive libraries also use the fallback without mutating their manifest.
    let workspace = global_service::assemble_workspace(&config, None, None);
    assert_eq!(
        workspace.mods_by_library_id[&library.id][0]
            .installed_at
            .as_ref(),
        Some(&expected)
    );
    assert_eq!(
        fs::read(&library.lib_paths.manifest).unwrap(),
        manifest_before
    );
    assert_eq!(library.mods[&id].installed_at, None);
    mod_manager::add_mod(&mut library, staged(), true).unwrap();
    assert_eq!(library.mods[&id].installed_at.as_ref(), Some(&expected));

    library.mods.get_mut(&id).unwrap().installed_at = None;
    fs::remove_dir_all(&mod_dir).unwrap();
    let workspace = global_service::assemble_workspace(&config, Some(&library), None);
    assert_eq!(
        workspace.mods_by_library_id[&library.id][0].installed_at,
        None
    );
}

#[test]
fn test_cache_rebuild_renames_mismatched_folder() {
    let (_tmp, game_root, repo_root) = setup_test_env();
    let requirement = LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root: game_root.clone(),
        name: "Test Library".to_string(),
    };
    let mut lib = Library::create(requirement).expect("Failed to create library");
    let rules = SPTPathRules::default();

    // 1. Create mod folder - folder name will be treated as old ID.
    // The folder name doesn't match the resolved hash ID, which triggers a rename on rebuild.
    let old_folder_name = "hash_abc123";
    let new_resolved_id = hash_id("testmod");
    let mod_dir = lib.lib_paths.mods.join(old_folder_name);
    let server_mod_dir = mod_dir.join(&rules.server_mods).join("TestMod");
    fs::create_dir_all(&server_mod_dir).unwrap();
    fs::write(server_mod_dir.join("mod.js"), "// test").unwrap();

    // 2. Register mod in library.mods with folder name as key and set enabled
    // This simulates a mod that was registered before the ID resolution changed
    lib.mods.insert(
        old_folder_name.to_string(),
        mod_keeper_lib::models::mod_dto::Mod {
            id: old_folder_name.to_string(),
            is_active: true,
            mod_type: mod_keeper_lib::models::mod_dto::ModType::Server,
            name: "Test Mod".to_string(),
            installed_at: Some("2026-01-02T03:04:05Z".into()),
        },
    );

    // 3. Create backup for old folder name (to verify cleanup)
    let old_backup_dir = lib.lib_paths.backups.join(old_folder_name);
    fs::create_dir_all(&old_backup_dir).unwrap();
    fs::write(old_backup_dir.join("dummy.txt"), "backup data").unwrap();
    lib.persist().unwrap();

    // 4. Rebuild cache - should rename folder and clean up
    library_service::rebuild_library_cache(&mut lib).expect("Cache rebuild failed");

    // 5. Verify folder was renamed
    assert!(
        !lib.lib_paths.mods.join(old_folder_name).exists(),
        "Old folder should be renamed"
    );
    assert!(
        lib.lib_paths.mods.join(&new_resolved_id).exists(),
        "New folder should exist"
    );

    // 6. Verify enabled state and display name preserved
    assert!(
        lib.mods
            .get(&new_resolved_id)
            .map(|m| m.is_active)
            .unwrap_or(false),
        "Enabled state should be preserved"
    );
    assert_eq!(
        lib.mods.get(&new_resolved_id).map(|m| m.name.as_str()),
        Some("Test Mod"),
        "Display name should be preserved"
    );

    assert_eq!(
        lib.mods[&new_resolved_id].installed_at.as_deref(),
        Some("2026-01-02T03:04:05Z"),
    );

    // 7. Verify old mod entry removed
    assert!(
        !lib.mods.contains_key(old_folder_name),
        "Old mod entry should be removed"
    );

    // 8. Backups are intentionally left on disk during rebuild (C8)
    assert!(
        old_backup_dir.exists(),
        "Backup directory must be preserved by rebuild"
    );
}
