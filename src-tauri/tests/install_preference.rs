mod common;

use camino::Utf8Path;
use common::{create_test_mod, setup_test_env};
use mod_keeper_lib::core::{library::Library, mod_fs, mod_manager, mod_stager::StagedMod};
use mod_keeper_lib::models::{library::LibraryCreationRequirement, paths::SPTPathRules};
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
