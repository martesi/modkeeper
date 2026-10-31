use crate::core::mod_fs::{self, ModFS};
use crate::models::error::SError;
use crate::models::paths::SPTPathRules;
#[cfg(target_os = "windows")]
use crate::utils::process;
use crate::utils::{archive, file};
use camino::{Utf8Path, Utf8PathBuf};
#[cfg(target_os = "windows")]
use sysinfo::System;
use tracing::debug;
use uuid::Uuid;

#[derive(Debug)]
pub struct StagedMod {
    pub fs: ModFS,
    pub source_path: Utf8PathBuf,
    pub is_staging: bool,
    pub name: String,
}

#[derive(Debug)]
pub struct StageMaterial {
    pub rules: SPTPathRules,
    pub root: Utf8PathBuf,
    pub name: String,
}

pub fn resolve(
    inputs: &[Utf8PathBuf],
    StageMaterial { root, rules, name }: &StageMaterial,
) -> Result<Vec<StagedMod>, SError> {
    if is_game_root_structure(inputs, rules) {
        return stage_loose_files(inputs, rules, root, name).map(|staged| vec![staged]);
    }

    inputs
        .iter()
        .filter_map(|input| {
            process_as_directory(input, rules, root, name)
                .or_else(|| process_as_archive(input, rules, root, name))
        })
        .collect()
}

#[cfg(target_os = "windows")]
pub fn any_mod_tool_running(sys: &mut System, mods_to_install: &[StagedMod]) -> Result<(), SError> {
    let specific_paths: Vec<_> = mods_to_install
        .iter()
        .flat_map(|m| m.fs.executables.iter().map(|exe| m.source_path.join(exe)))
        .collect();

    if process::is_running(sys, &specific_paths) {
        return Err(SError::ProcessRunning);
    }

    Ok(())
}

fn process_as_directory(
    input: &Utf8PathBuf,
    rules: &SPTPathRules,
    staging_root: &Utf8Path,
    unknown_mod_name: &str,
) -> Option<Result<StagedMod, SError>> {
    if !input.is_dir() {
        return None;
    }

    if input.join("SPT_Runtime").exists() {
        return Some(stage_directory(
            input,
            rules,
            staging_root,
            unknown_mod_name,
        ));
    }

    match folder_matches_game_structure(input, rules) {
        Ok(true) => Some(
            mod_fs::scan(input, rules).map(|fs| staged_from_directory(input, fs, unknown_mod_name)),
        ),
        Ok(false) => match mod_fs::scan(input, rules) {
            Ok(fs) => Some(Ok(staged_from_directory(input, fs, unknown_mod_name))),
            Err(SError::UnableToDetermineModId) => None,
            Err(error) => Some(Err(error)),
        },
        Err(error) => Some(Err(error)),
    }
}

fn process_as_archive(
    input: &Utf8PathBuf,
    rules: &SPTPathRules,
    staging_root: &Utf8Path,
    unknown_mod_name: &str,
) -> Option<Result<StagedMod, SError>> {
    archive::ArchiveFormat::from_path(input)
        .map(|_| stage_archive(input, rules, staging_root, unknown_mod_name))
}

fn is_game_root_structure(inputs: &[Utf8PathBuf], rules: &SPTPathRules) -> bool {
    let roots = [
        get_root_component(&rules.server_mods),
        get_root_component(&rules.client_plugins),
        Some("SPT_Runtime"),
    ];

    inputs.iter().any(|path| {
        path.file_name()
            .map(|name| roots.contains(&Some(name)))
            .unwrap_or(false)
    })
}

fn folder_matches_game_structure(folder: &Utf8Path, rules: &SPTPathRules) -> Result<bool, SError> {
    let roots = [
        get_root_component(&rules.server_mods),
        get_root_component(&rules.client_plugins),
        Some("SPT_Runtime"),
    ];

    for entry in file::read_dir(folder)? {
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|name| SError::ParseError(format!("Invalid UTF-8 file name: {name:?}")))?;

        if roots.contains(&Some(name.as_str())) {
            return Ok(true);
        }
    }

    Ok(false)
}

fn stage_loose_files(
    inputs: &[Utf8PathBuf],
    rules: &SPTPathRules,
    staging_root: &Utf8Path,
    unknown_mod_name: &str,
) -> Result<StagedMod, SError> {
    let uuid = Uuid::new_v4().to_string();
    let dest_dir = staging_root.join(uuid);
    file::create_dir_all(&dest_dir)?;

    for input in inputs {
        let name = input
            .file_name()
            .ok_or_else(|| SError::ParseError(format!("Unable to get file name for {input}")))?;
        file::copy_recursive(input, &dest_dir.join(name))?;
    }

    normalize_server_root(&dest_dir)?;
    let fs = mod_fs::scan(&dest_dir, rules)?;

    Ok(StagedMod {
        fs,
        source_path: dest_dir,
        is_staging: true,
        name: unknown_mod_name.to_string(),
    })
}

fn stage_archive(
    archive: &Utf8Path,
    rules: &SPTPathRules,
    staging_root: &Utf8Path,
    unknown_mod_name: &str,
) -> Result<StagedMod, SError> {
    let uuid = Uuid::new_v4().to_string();
    let dest_dir = staging_root.join(uuid);
    file::create_dir_all(&dest_dir)?;

    archive::extract(archive, &dest_dir)?;
    normalize_server_root(&dest_dir)?;
    let fs = mod_fs::scan(&dest_dir, rules)?;
    let name = archive.file_stem().unwrap_or(unknown_mod_name).to_string();

    Ok(StagedMod {
        fs,
        source_path: dest_dir,
        is_staging: true,
        name,
    })
}

fn stage_directory(
    input: &Utf8Path,
    rules: &SPTPathRules,
    staging_root: &Utf8Path,
    unknown_mod_name: &str,
) -> Result<StagedMod, SError> {
    let dest_dir = staging_root.join(Uuid::new_v4().to_string());
    file::copy_recursive(input, &dest_dir)?;
    normalize_server_root(&dest_dir)?;
    let fs = mod_fs::scan(&dest_dir, rules)?;
    Ok(StagedMod {
        fs,
        source_path: dest_dir,
        is_staging: true,
        name: input.file_name().unwrap_or(unknown_mod_name).to_string(),
    })
}

fn normalize_server_root(root: &Utf8Path) -> Result<(), SError> {
    let runtime = root.join("SPT_Runtime");
    if runtime.exists() {
        let standard = root.join("SPT");
        if standard.exists() {
            return Err(SError::ParseError(
                "Mod package contains both SPT and SPT_Runtime folders".into(),
            ));
        }
        file::rename(&runtime, &standard)?;
    }
    Ok(())
}

fn staged_from_directory(input: &Utf8Path, fs: ModFS, unknown_mod_name: &str) -> StagedMod {
    let name = input.file_name().unwrap_or(unknown_mod_name).to_string();

    StagedMod {
        fs,
        source_path: input.to_path_buf(),
        is_staging: false,
        name,
    }
}

fn get_root_component(path: &Utf8Path) -> Option<&str> {
    path.components().next().map(|c| c.as_str())
}

pub fn clean_up(is_staging: bool, source_path: &Utf8Path) -> Result<(), SError> {
    if !is_staging {
        return Ok(());
    }
    debug!("clean up for {source_path}");
    file::remove_dir_all(source_path)
}
