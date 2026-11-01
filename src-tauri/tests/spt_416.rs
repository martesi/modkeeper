use camino::Utf8PathBuf;
use mod_keeper_lib::core::{library::Library, mod_fs, mod_manager, mod_stager, version};
use mod_keeper_lib::models::{
    error::SError, library::LibraryCreationRequirement, paths::SPTPathRules,
};
use std::fs;
use std::io::Write;

fn deps(version: &str) -> String {
    format!(
        r#"{{"runtimeTarget":{{"name":"net10/win-x64"}},"targets":{{"net10/win-x64":{{"SPT.Server/{version}-RELEASE+abc":{{}}}}}}}}"#
    )
}

#[test]
fn spt_416_imports_deploys_and_removes_mods() {
    let temp = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(temp.path().to_path_buf()).unwrap();
    let game = root.join("game");
    let repo = root.join("library");
    let runtime = game.join("SPT_Runtime");
    fs::create_dir_all(&runtime).unwrap();
    fs::write(game.join("EscapeFromTarkov.exe"), "game").unwrap();
    fs::write(runtime.join("SPT.Server.exe"), "server").unwrap();
    fs::write(runtime.join("SPT.Server.deps.json"), deps("4.1.6")).unwrap();

    let mut library = Library::create(LibraryCreationRequirement {
        game_root: game.clone(),
        repo_root: Some(repo.clone()),
        name: "Test".into(),
    })
    .unwrap();
    assert_eq!(library.spt_version, "4.1.6");

    let source = root.join("package.zip");
    let mut zip = zip::ZipWriter::new(fs::File::create(&source).unwrap());
    for file in [
        "SPT_Runtime/user/mods/Example/mod.dll",
        "BepInEx/plugins/Example/client.dll",
    ] {
        zip.start_file(file, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"mod").unwrap();
    }
    zip.finish().unwrap();
    let staged = mod_stager::resolve(&[source], &library.stage_material("mod".into()))
        .unwrap()
        .pop()
        .unwrap();
    let id = staged.fs.id.clone();
    mod_manager::add_mod(&mut library, staged, false).unwrap();
    mod_manager::toggle_mod(&mut library, &id, true).unwrap();
    drop(library);
    let mut library = Library::load(&repo).unwrap();
    library.sync().unwrap();
    assert_eq!(
        fs::read_to_string(runtime.join("user/mods/Example/mod.dll")).unwrap(),
        "mod"
    );
    assert!(game.join("BepInEx/plugins/Example/client.dll").exists());
    assert!(!game.join("SPT").exists());
    let unsafe_package = root.join("unprocessed");
    for file in [
        "BepInEx/plugins/Other.dll",
        "SPT_Runtime/user/mods/Other/mod.dll",
    ] {
        let path = unsafe_package.join(file);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "mod").unwrap();
    }
    let unsafe_mod = mod_stager::StagedMod {
        fs: mod_fs::scan(&unsafe_package, &SPTPathRules::default()).unwrap(),
        source_path: unsafe_package,
        is_staging: false,
        name: "unsafe".into(),
    };
    let unsafe_id = unsafe_mod.fs.id.clone();
    mod_manager::add_mod(&mut library, unsafe_mod, false).unwrap();
    mod_manager::toggle_mod(&mut library, &unsafe_id, true).unwrap();
    assert!(matches!(library.sync(), Err(SError::FileCollision(_))));
    assert_eq!(
        fs::read_to_string(runtime.join("user/mods/Example/mod.dll")).unwrap(),
        "mod"
    );
    mod_manager::remove_mod(&mut library, &unsafe_id).unwrap();
    mod_manager::remove_mod(&mut library, &id).unwrap();
    assert!(!runtime.join("user/mods/Example/mod.dll").exists());
    assert!(runtime.join("SPT.Server.exe").exists());
}

#[test]
fn staging_accepts_old_and_new_roots_without_mutating_source() {
    let temp = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(temp.path().to_path_buf()).unwrap();
    let material = mod_stager::StageMaterial {
        rules: SPTPathRules::default(),
        root: root.join("staging"),
        name: "test".into(),
    };
    let package = root.join("package");
    let runtime = package.join("SPT_Runtime/user/mods/Example/mod.dll");
    fs::create_dir_all(runtime.parent().unwrap()).unwrap();
    fs::write(&runtime, "mod").unwrap();
    let staged = mod_stager::resolve(std::slice::from_ref(&package), &material)
        .unwrap()
        .pop()
        .unwrap();
    assert!(
        staged
            .source_path
            .join("SPT/user/mods/Example/mod.dll")
            .exists()
    );
    assert!(runtime.exists());
    let old = package.join("SPT/user/mods/Other/mod.dll");
    fs::create_dir_all(old.parent().unwrap()).unwrap();
    fs::write(old, "mod").unwrap();
    assert!(matches!(
        mod_stager::resolve(std::slice::from_ref(&package), &material),
        Err(SError::ParseError(_))
    ));
    fs::remove_dir_all(package.join("SPT_Runtime")).unwrap();
    let legacy = mod_stager::resolve(&[package], &material)
        .unwrap()
        .pop()
        .unwrap();
    assert!(
        legacy
            .source_path
            .join("SPT/user/mods/Other/mod.dll")
            .exists()
    );
}

#[test]
fn server_metadata_takes_precedence_and_invalid_data_is_rejected() {
    let temp = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(temp.path().to_path_buf()).unwrap();
    let rules = SPTPathRules::new(&root);
    fs::create_dir_all(rules.server_exe.parent().unwrap()).unwrap();
    fs::create_dir_all(rules.server_registry.parent().unwrap()).unwrap();
    fs::write(
        &rules.server_registry,
        r#"{"SPT_Version":"SPT 4.0.11 - old"}"#,
    )
    .unwrap();
    let metadata = rules.server_exe.with_file_name("SPT.Server.deps.json");
    fs::write(&metadata, deps("4.1.6")).unwrap();
    assert_eq!(version::fetch_and_validate(&rules).unwrap(), "4.1.6");
    fs::write(&metadata, deps("5.0.0")).unwrap();
    assert!(matches!(
        version::fetch_and_validate(&rules),
        Err(SError::UnsupportedSPTVersion(_))
    ));
    fs::write(&metadata, "{}").unwrap();
    assert!(matches!(
        version::fetch_and_validate(&rules),
        Err(SError::ParseError(_))
    ));
    fs::remove_file(metadata).unwrap();
    assert_eq!(version::fetch_and_validate(&rules).unwrap(), "4.0.11");
}

#[test]
fn ambiguous_server_roots_are_rejected() {
    let temp = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(temp.path().to_path_buf()).unwrap();
    for directory in ["SPT", "SPT_Runtime"] {
        fs::create_dir_all(root.join(directory)).unwrap();
        fs::write(root.join(directory).join("SPT.Server.exe"), "server").unwrap();
    }
    assert!(SPTPathRules::for_game_root(&root).is_err());
}

#[test]
#[ignore = "requires SPT_INSPECT_ROOT pointing to an installed game"]
fn inspect_real_installation_read_only() {
    let root = Utf8PathBuf::from(std::env::var("SPT_INSPECT_ROOT").unwrap());
    let rules = SPTPathRules::for_game_root(&root)
        .unwrap()
        .to_absolute(&root);
    assert!(rules.server_exe.is_file());
    assert!(rules.client_exe.is_file());
    println!(
        "Installed SPT version: {}",
        version::fetch_and_validate(&rules).unwrap()
    );
}
