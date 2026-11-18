mod common;

use common::setup_test_env;
use mod_keeper_lib::core::{library::Library, mod_manager};
use mod_keeper_lib::models::error::SError;
use mod_keeper_lib::models::library::LibraryCreationRequirement;
use mod_keeper_lib::models::mod_dto::{Mod, ModType};
use std::fs;

#[test]
fn deleting_unknown_or_unsafe_mod_ids_preserves_external_files() {
    let (temp, game_root, repo_root) = setup_test_env();
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("keep.txt"), "user data").unwrap();
    let mut library = Library::create(LibraryCreationRequirement {
        name: "Security test".into(),
        game_root,
        repo_root: Some(repo_root),
    })
    .unwrap();

    let unknown_dir = library.lib_paths.mods.join("unregistered");
    fs::create_dir(&unknown_dir).unwrap();
    fs::write(unknown_dir.join("keep.txt"), "unregistered data").unwrap();
    assert!(matches!(
        mod_manager::remove_mod(&mut library, "unregistered"),
        Err(SError::ModNotFound(_))
    ));
    assert!(unknown_dir.join("keep.txt").exists());

    for id in [
        "../../outside",
        r"..\..\outside",
        outside.to_str().unwrap(),
        "..",
        ".",
        "",
        "mod:stream",
    ] {
        // Even a matching entry in a forged manifest must not authorize traversal.
        library.mods.insert(
            id.to_string(),
            Mod {
                id: id.to_string(),
                is_active: false,
                mod_type: ModType::Unknown,
                name: "Forged mod".into(),
                installed_at: None,
                version: None,
                forge_id: None,
                forge_guid: None,
                source: mod_keeper_lib::models::mod_dto::ModSource::Local,
                forge_kind: None,
                forge_version_id: None,
                forge_meta_cached_at: None,
            },
        );
        assert!(
            matches!(
                mod_manager::remove_mod(&mut library, id),
                Err(SError::ModNotFound(_))
            ),
            "accepted unsafe id {id:?}"
        );
        assert_eq!(
            fs::read_to_string(outside.join("keep.txt")).unwrap(),
            "user data"
        );
        assert!(library.lib_paths.mods.is_dir());
        library.mods.remove(id);
    }
}
