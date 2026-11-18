mod common;

use camino::Utf8Path;
use common::{create_test_mod, setup_test_env};
use mod_keeper_lib::core::{library::Library, mod_fs, mod_manager, mod_stager::StagedMod};
use mod_keeper_lib::models::{
    library::LibraryCreationRequirement,
    mod_dto::{ForgeInstallMetadata, ForgeKind, ModSource},
    paths::SPTPathRules,
};
use mod_keeper_lib::store::app_config::AppSettings;

#[test]
fn install_preference_defaults_and_round_trips() {
    let old: AppSettings = toml::from_str("theme = 'dark'\n").unwrap();
    assert!(old.enable_mods_on_install);
    let mut settings = AppSettings::default();
    assert!(settings.enable_mods_on_install);
    settings.enable_mods_on_install = false;
    let saved = toml::to_string(&settings).unwrap();
    assert!(
        !toml::from_str::<AppSettings>(&saved)
            .unwrap()
            .enable_mods_on_install
    );
}

#[test]
fn install_preference_applies_to_new_mods_and_preserves_updates() {
    let (tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root,
        name: "Test".into(),
    })
    .unwrap();
    for (name, enabled) in [("EnabledMod", true), ("DisabledMod", false)] {
        let path = tmp.path().join(name);
        let source = Utf8Path::from_path(&path).unwrap();
        create_test_mod(source, name, true);
        let staged = || StagedMod {
            fs: mod_fs::scan(source, &SPTPathRules::default()).unwrap(),
            source_path: source.to_path_buf(),
            is_staging: false,
            name: name.into(),
        };
        let id = staged().fs.id;
        mod_manager::add_mod(&mut library, staged(), enabled).unwrap();
        assert_eq!(library.mods[&id].is_active, enabled);
        mod_manager::add_mod(&mut library, staged(), !enabled).unwrap();
        assert_eq!(library.mods[&id].is_active, enabled);
        let reloaded = Library::load(&repo_root).unwrap();
        assert_eq!(reloaded.mods[&id].is_active, enabled);
    }
}

#[test]
fn local_overwrite_clears_forge_identity_metadata() {
    let (tmp, game_root, repo_root) = setup_test_env();
    let mut library = Library::create(LibraryCreationRequirement {
        repo_root: Some(repo_root.clone()),
        game_root,
        name: "Test".into(),
    })
    .unwrap();
    let path = tmp.path().join("ForgeInstalledMod");
    let source = Utf8Path::from_path(&path).unwrap();
    create_test_mod(source, "ForgeInstalledMod", true);
    let staged = || StagedMod {
        fs: mod_fs::scan(source, &SPTPathRules::default()).unwrap(),
        source_path: source.to_path_buf(),
        is_staging: false,
        name: "ForgeInstalledMod".into(),
    };
    let id = staged().fs.id;
    let metadata = ForgeInstallMetadata {
        kind: ForgeKind::Mod,
        forge_id: 2658,
        forge_guid: "test.forge.mod".into(),
        version: "1.21.0".into(),
        version_id: 9001,
        cached_at: "2026-11-18T00:00:00Z".into(),
    };

    mod_manager::add_mod_with_metadata(&mut library, staged(), true, Some(&metadata)).unwrap();
    assert_eq!(library.mods[&id].source, ModSource::Forge);

    mod_manager::add_mod(&mut library, staged(), true).unwrap();
    let local = &library.mods[&id];
    assert_eq!(local.source, ModSource::Local);
    assert_eq!(local.version, None);
    assert_eq!(local.forge_id, None);
    assert_eq!(local.forge_guid, None);
    assert_eq!(local.forge_kind, None);
    assert_eq!(local.forge_version_id, None);
    assert_eq!(local.forge_meta_cached_at, None);

    let reloaded = Library::load(&repo_root).unwrap();
    assert_eq!(reloaded.mods[&id].source, ModSource::Local);
    assert_eq!(reloaded.mods[&id].forge_guid, None);
}
