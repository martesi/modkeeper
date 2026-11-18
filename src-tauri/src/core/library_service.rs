use crate::core::cache::{LibraryCache, normalize_mod_folders};
use crate::core::library::Library;
use crate::core::mod_manager;
use crate::core::mod_stager::{self, StageMaterial};
use crate::models::error::SError;
use crate::models::forge::ForgeAddonInstallConstraint;
use crate::models::mod_dto::{ForgeInstallMetadata, ForgeKind, ModSource};
use crate::models::paths::LibPathRules;
use crate::models::task_progress::TaskProgressStage;
use crate::models::workspace::{ArchiveFailure, BulkModAction};
use crate::utils::thread::with_lib_arc_mut;
use crate::utils::time::file_created_at;
use camino::{Utf8Path, Utf8PathBuf};
use parking_lot::Mutex;
use std::sync::Arc;
use tracing::debug;

/// Validates that a library directory has the required structure.
/// Checks for manifest.toml and required directories (mods/, backups/, staging/).
pub fn validate_library_structure(repo_root: &Utf8Path) -> Result<(), SError> {
    let lib_paths = LibPathRules::new(repo_root);

    // Check if manifest.toml exists and is readable
    if !lib_paths.manifest.exists() {
        return Err(SError::InvalidLibrary(
            repo_root.to_string(),
            "manifest.toml is missing".to_string(),
        ));
    }

    // Check if manifest.toml is readable (attempt to read it)
    if let Err(e) = Library::read_library_manifest(repo_root) {
        return Err(SError::InvalidLibrary(
            repo_root.to_string(),
            format!("manifest.toml is invalid or unreadable: {}", e),
        ));
    }

    // Check if required directories exist
    let required_dirs = [&lib_paths.mods, &lib_paths.backups, &lib_paths.staging];
    for dir in required_dirs.iter() {
        if !dir.exists() {
            return Err(SError::InvalidLibrary(
                repo_root.to_string(),
                format!(
                    "missing required directory: {}",
                    dir.file_name().unwrap_or("unknown")
                ),
            ));
        }
        if !dir.is_dir() {
            return Err(SError::InvalidLibrary(
                repo_root.to_string(),
                format!(
                    "expected directory but found file: {}",
                    dir.file_name().unwrap_or("unknown")
                ),
            ));
        }
    }

    Ok(())
}

/// Derives the library root path from the game root.
/// Returns game_root/.mod_keeper
pub fn derive_library_root(game_root: &Utf8Path) -> Utf8PathBuf {
    let spt_rules = crate::models::paths::SPTPathRules::default();
    game_root.join(&spt_rules.library_default)
}

/// Keeps a prior default library intact when the same game root moves to a
/// different SPT major version.
pub fn derive_library_root_for_spt(game_root: &Utf8Path, spt_version: &str) -> Utf8PathBuf {
    game_root.join(format!(".mod_keeper-spt-{spt_version}"))
}

fn assert_is_library(library: &Library, library_id: &str) -> Result<(), SError> {
    if library.id == library_id {
        Ok(())
    } else {
        Err(SError::InvalidLibrary(
            library_id.to_string(),
            "not the active library".to_string(),
        ))
    }
}

/// Enable/disable commit mod state only (metadata, cheap) - no symlinks are
/// touched, no collision check runs; deploy stays the explicit sync step (C3).
/// Delete unlinks and removes just the selected mods. Plain blocking (delta 3).
pub fn bulk_update_mods(
    instance_handle: Arc<Mutex<Option<Library>>>,
    library_id: &str,
    mod_ids: &[String],
    action: &BulkModAction,
) -> Result<(), SError> {
    with_lib_arc_mut(instance_handle, |inst| {
        assert_is_library(inst, library_id)?;
        match action {
            BulkModAction::Enable | BulkModAction::Disable => {
                let is_active = *action == BulkModAction::Enable;
                for mod_id in mod_ids {
                    inst.mods
                        .get_mut(mod_id)
                        .ok_or_else(|| SError::ModNotFound(mod_id.to_string()))?
                        .is_active = is_active;
                }
                inst.mark_dirty();
                inst.persist()
            }
            BulkModAction::Delete => mod_ids.iter().try_for_each(|mod_id| {
                debug!("Removing mod {}", mod_id);
                mod_manager::remove_mod(inst, mod_id)
            }),
        }
    })?
}

/// Full sync of the active library: purge -> redeploy -> collision check ->
/// mark clean (C3). Holds the library mutex for its full FS duration.
pub fn sync_active_library(
    instance_handle: Arc<Mutex<Option<Library>>>,
    library_id: &str,
) -> Result<(), SError> {
    sync_active_library_with_progress(instance_handle, library_id, |_, _| {})
}

pub fn sync_active_library_with_progress(
    instance_handle: Arc<Mutex<Option<Library>>>,
    library_id: &str,
    mut progress: impl FnMut(TaskProgressStage, Option<f64>),
) -> Result<(), SError> {
    with_lib_arc_mut(instance_handle, |inst| {
        assert_is_library(inst, library_id)?;
        inst.sync_with_progress(&mut progress)
    })?
}

/// Installs each archive independently, collecting per-archive failures
/// instead of failing the whole call (§7b); failures ride the completion event.
pub fn install_mod_archives(
    instance_handle: Arc<Mutex<Option<Library>>>,
    library_id: &str,
    material: &StageMaterial,
    archive_paths: &[Utf8PathBuf],
    enable_on_install: bool,
) -> Vec<ArchiveFailure> {
    install_mod_archives_with_progress(
        instance_handle,
        library_id,
        material,
        archive_paths,
        enable_on_install,
        |_, _| {},
    )
}

pub fn install_mod_archives_with_progress(
    instance_handle: Arc<Mutex<Option<Library>>>,
    library_id: &str,
    material: &StageMaterial,
    archive_paths: &[Utf8PathBuf],
    enable_on_install: bool,
    mut progress: impl FnMut(TaskProgressStage, Option<f64>),
) -> Vec<ArchiveFailure> {
    let mut failures = Vec::new();
    let total = archive_paths.len();
    progress(
        TaskProgressStage::InstallArchives,
        crate::core::task_progress::archive_count_percent(0, total),
    );
    for (index, path) in archive_paths.iter().enumerate() {
        let result = install_single_archive_with_progress(
            instance_handle.clone(),
            library_id,
            material,
            path,
            enable_on_install,
            &mut progress,
        );
        record_archive_result(path, result, &mut failures);
        progress(
            TaskProgressStage::InstallArchives,
            crate::core::task_progress::archive_count_percent(index + 1, total),
        );
    }
    failures
}

/// Installs a Forge archive through the standard staging path and records the
/// remote identity only after the archive has passed the usual safety checks.
pub fn install_forge_archive(
    instance_handle: Arc<Mutex<Option<Library>>>,
    library_id: &str,
    material: &StageMaterial,
    archive_path: &Utf8PathBuf,
    enable_on_install: bool,
    metadata: &ForgeInstallMetadata,
    addon_constraint: Option<&ForgeAddonInstallConstraint>,
) -> Result<(), SError> {
    install_forge_archive_with_progress(
        instance_handle,
        library_id,
        material,
        archive_path,
        enable_on_install,
        metadata,
        addon_constraint,
        |_, _| {},
    )
}

pub fn install_forge_archive_with_progress(
    instance_handle: Arc<Mutex<Option<Library>>>,
    library_id: &str,
    material: &StageMaterial,
    archive_path: &Utf8PathBuf,
    enable_on_install: bool,
    metadata: &ForgeInstallMetadata,
    addon_constraint: Option<&ForgeAddonInstallConstraint>,
    mut progress: impl FnMut(TaskProgressStage, Option<f64>),
) -> Result<(), SError> {
    progress(TaskProgressStage::ForgeStage, None);
    let mut staged_mods = mod_stager::resolve(std::slice::from_ref(archive_path), material)?;
    if staged_mods.len() != 1 {
        let count = staged_mods.len();
        for staged in staged_mods {
            let _ = mod_stager::clean_up(staged.is_staging, &staged.source_path);
        }
        return Err(SError::ParseError(format!(
            "Forge archive produced {count} installable entries; expected exactly one"
        )));
    }
    let staged = staged_mods.pop().ok_or(SError::Unexpected)?;
    let is_staging = staged.is_staging;
    let staged_path = staged.source_path.clone();
    let install_result = with_lib_arc_mut(instance_handle, |library| {
        assert_is_library(library, library_id)?;
        if metadata.kind == ForgeKind::Addon {
            validate_addon_parent_with_progress(library, addon_constraint, &mut progress)?;
        }
        progress(TaskProgressStage::ForgeInstall, None);
        mod_manager::add_mod_with_metadata(library, staged, enable_on_install, Some(metadata))
    })?;
    let cleanup_result = mod_stager::clean_up(is_staging, &staged_path);
    match (install_result, cleanup_result) {
        (Err(error), _) => Err(error),
        (Ok(()), Err(error)) => Err(error),
        (Ok(()), Ok(())) => Ok(()),
    }
}

/// Explicitly links a previously installed local entry to a Forge identity.
/// The archive remains untouched; no metadata is inferred from its contents.
pub fn match_forge_metadata(
    instance_handle: Arc<Mutex<Option<Library>>>,
    library_id: &str,
    installed_mod_id: &str,
    metadata: &ForgeInstallMetadata,
    addon_constraint: Option<&ForgeAddonInstallConstraint>,
) -> Result<(), SError> {
    with_lib_arc_mut(instance_handle, |library| {
        assert_is_library(library, library_id)?;
        if metadata.kind == ForgeKind::Addon {
            validate_addon_parent(library, addon_constraint)?;
        }
        let installed = library
            .mods
            .get_mut(installed_mod_id)
            .ok_or_else(|| SError::ModNotFound(installed_mod_id.to_string()))?;
        installed.version = Some(metadata.version.clone());
        installed.forge_id = Some(metadata.forge_id);
        installed.forge_guid = Some(metadata.forge_guid.clone());
        installed.source = crate::models::mod_dto::ModSource::Forge;
        installed.forge_kind = Some(metadata.kind.clone());
        installed.forge_version_id = Some(metadata.version_id);
        installed.forge_meta_cached_at = Some(metadata.cached_at.clone());
        library.mark_dirty();
        library.persist()
    })?
}

fn validate_addon_parent(
    library: &Library,
    constraint: Option<&ForgeAddonInstallConstraint>,
) -> Result<(), SError> {
    let constraint = constraint
        .ok_or_else(|| SError::ParseError("Forge addon parent metadata is missing".into()))?;
    if constraint.is_detached {
        return Ok(());
    }

    let guid = constraint.parent_guid.as_deref().ok_or_else(|| {
        SError::ParseError("Forge addon has no positively identified parent GUID".into())
    })?;
    let parent_forge_id = constraint
        .parent_forge_id
        .ok_or_else(|| SError::ParseError("Forge addon has no parent Forge ID".into()))?;
    let version_constraint = constraint.version_constraint.as_deref().ok_or_else(|| {
        SError::ParseError("Forge addon parent version constraint is missing".into())
    })?;
    let parent = library
        .mods
        .values()
        .find(|installed| {
            installed.source == ModSource::Forge
                && installed.forge_kind.as_ref() == Some(&ForgeKind::Mod)
                && installed.forge_id == Some(parent_forge_id)
                && installed.forge_guid.as_deref() == Some(guid)
        })
        .ok_or_else(|| {
            SError::ParseError(format!(
                "Forge addon requires installed parent {parent_forge_id} ({guid})"
            ))
        })?;
    let parent_version = parent.version.as_deref().ok_or_else(|| {
        SError::ParseError(format!(
            "Installed Forge parent {guid} has no recorded version"
        ))
    })?;
    if !forge_version_matches(parent_version, version_constraint)? {
        return Err(SError::ParseError(format!(
            "Forge addon requires parent {guid} at {version_constraint}, installed version is {parent_version}"
        )));
    }
    Ok(())
}

fn validate_addon_parent_with_progress(
    library: &Library,
    constraint: Option<&ForgeAddonInstallConstraint>,
    progress: &mut impl FnMut(TaskProgressStage, Option<f64>),
) -> Result<(), SError> {
    progress(TaskProgressStage::ForgeParentValidation, None);
    validate_addon_parent(library, constraint)
}

fn forge_version_matches(version: &str, constraint: &str) -> Result<bool, SError> {
    let requirement = semver::VersionReq::parse(constraint).map_err(|error| {
        SError::ParseError(format!("Invalid Forge addon parent constraint: {error}"))
    })?;
    let parsed_version = semver::Version::parse(version).map_err(|error| {
        SError::ParseError(format!(
            "Installed Forge parent version cannot be evaluated: {error}"
        ))
    })?;
    Ok(requirement.matches(&parsed_version))
}

fn install_single_archive_with_progress(
    instance_handle: Arc<Mutex<Option<Library>>>,
    library_id: &str,
    material: &StageMaterial,
    archive_path: &Utf8PathBuf,
    enable_on_install: bool,
    progress: &mut impl FnMut(TaskProgressStage, Option<f64>),
) -> Result<(), SError> {
    // Staging (extraction) runs outside the lock; only the install holds it.
    progress(TaskProgressStage::InstallArchiveStage, None);
    let staged_mods = mod_stager::resolve(std::slice::from_ref(archive_path), material)?;

    progress(TaskProgressStage::InstallCommit, None);
    with_lib_arc_mut(instance_handle, |inst| {
        assert_is_library(inst, library_id)?;
        staged_mods.into_iter().try_for_each(|staged| {
            debug!("installing: {:?}", staged);
            let is_staging = staged.is_staging;
            let source_path = staged.source_path.clone();
            mod_manager::add_mod(inst, staged, enable_on_install)
                .and_then(|_| mod_stager::clean_up(is_staging, &source_path))
        })
    })?
}

fn record_archive_result(
    path: &Utf8PathBuf,
    result: Result<(), SError>,
    failures: &mut Vec<ArchiveFailure>,
) {
    if let Err(error) = result {
        failures.push(ArchiveFailure {
            archive_path: path.to_string(),
            error,
        });
    }
}

/// Rebuilds the active library's cache under the mutex for the full duration.
/// Folder normalization renames only (C8): backups are left on disk, and no
/// re-link happens - a rename dangles that mod's deployed links until sync_mods.
pub fn rebuild_active_library_cache(
    instance_handle: Arc<Mutex<Option<Library>>>,
    library_id: &str,
) -> Result<(), SError> {
    rebuild_active_library_cache_with_progress(instance_handle, library_id, |_, _| {})
}

pub fn rebuild_active_library_cache_with_progress(
    instance_handle: Arc<Mutex<Option<Library>>>,
    library_id: &str,
    mut progress: impl FnMut(TaskProgressStage, Option<f64>),
) -> Result<(), SError> {
    with_lib_arc_mut(instance_handle, |inst| {
        assert_is_library(inst, library_id)?;
        rebuild_library_cache_with_progress(inst, &mut progress)
    })?
}

pub fn rebuild_library_cache(library: &mut Library) -> Result<(), SError> {
    rebuild_library_cache_with_progress(library, &mut |_, _| {})
}

fn rebuild_library_cache_with_progress(
    library: &mut Library,
    progress: &mut impl FnMut(TaskProgressStage, Option<f64>),
) -> Result<(), SError> {
    use crate::models::mod_dto::Mod;

    // 1. Normalize folder names to match resolved IDs
    progress(TaskProgressStage::CacheNormalize, None);
    let result = normalize_mod_folders(&library.lib_paths.mods, &library.spt_rules, &library.mods)?;

    // 2. Drop stale mod entries, keeping their names and installation times for step 4.
    // Backups are intentionally left on disk (C8).
    let mut old_mods = std::collections::BTreeMap::new();
    for renamed in &result.renamed {
        if let Some(old) = library.mods.remove(&renamed.old_name) {
            old_mods.insert(renamed.new_name.clone(), old);
        }
    }

    // 3. Rebuild cache from normalized folders
    progress(TaskProgressStage::CacheScan, None);
    library.cache = LibraryCache::build(&library.lib_paths.mods, &library.spt_rules)?;

    // 4. Create new mod entries for renamed mods and restore enabled state
    for renamed in &result.renamed {
        if let Some(cached_fs) = library.cache.mods.get(&renamed.new_name) {
            // Keep the previous display name or fall back to the folder name
            let old = old_mods.get(&renamed.new_name);
            let name = old
                .map(|m| m.name.clone())
                .unwrap_or_else(|| renamed.new_name.clone());
            let installed_at = old
                .and_then(|m| m.installed_at.clone())
                .or_else(|| file_created_at(&library.lib_paths.mods.join(&renamed.new_name)));

            library.mods.insert(
                renamed.new_name.clone(),
                Mod {
                    id: renamed.new_name.clone(),
                    is_active: renamed.was_active,
                    mod_type: cached_fs.mod_type.clone(),
                    name,
                    installed_at,
                    version: None,
                    forge_id: None,
                    forge_guid: None,
                    source: crate::models::mod_dto::ModSource::Local,
                    forge_kind: None,
                    forge_version_id: None,
                    forge_meta_cached_at: None,
                },
            );
        }
    }

    progress(TaskProgressStage::CachePersist, None);
    library.persist()?;
    Ok(())
}

#[cfg(test)]
mod forge_tests {
    use super::{
        forge_version_matches, record_archive_result, validate_addon_parent_with_progress,
    };
    use crate::core::library::Library;
    use crate::models::error::SError;
    use crate::models::forge::ForgeAddonInstallConstraint;
    use crate::models::library::LibraryCreationRequirement;
    use crate::models::task_progress::TaskProgressStage;
    use camino::Utf8PathBuf;
    use std::fs;

    #[test]
    fn addon_parent_constraints_are_evaluated_with_semver() {
        assert!(forge_version_matches("1.21.0", "1.21").unwrap());
        assert!(!forge_version_matches("1.20.9", "1.21").unwrap());
        assert!(forge_version_matches("not-a-version", "1.21").is_err());
        assert!(forge_version_matches("1.21.0", "invalid constraint").is_err());
    }

    #[test]
    fn partial_archive_failures_are_retained_per_archive() {
        let first = Utf8PathBuf::from("first.zip");
        let second = Utf8PathBuf::from("second.zip");
        let third = Utf8PathBuf::from("third.zip");
        let mut failures = Vec::new();
        record_archive_result(&first, Ok(()), &mut failures);
        record_archive_result(
            &second,
            Err(SError::ParseError("invalid archive".into())),
            &mut failures,
        );
        record_archive_result(&third, Ok(()), &mut failures);
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].archive_path, "second.zip");
    }

    #[test]
    fn addon_parent_gate_failure_reports_validation_stage() {
        let temp = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(temp.path().to_path_buf()).unwrap();
        let game_root = root.join("game");
        let repo_root = root.join("repo");
        fs::create_dir_all(&game_root).unwrap();
        fs::create_dir_all(&repo_root).unwrap();
        let rules = crate::models::paths::SPTPathRules::new(&game_root);
        for exe in [&rules.server_exe, &rules.client_exe] {
            if let Some(parent) = exe.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(exe, "dummy").unwrap();
        }
        if let Some(parent) = rules.server_registry.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(
            &rules.server_registry,
            r#"{"SPT_Version": "SPT 4.0.11 - 278e72"}"#,
        )
        .unwrap();
        let library = Library::create(LibraryCreationRequirement {
            repo_root: Some(repo_root),
            game_root,
            name: "Test".into(),
        })
        .unwrap();
        let constraint = ForgeAddonInstallConstraint {
            is_detached: false,
            parent_forge_id: Some(2658),
            parent_guid: Some("example.parent".into()),
            version_constraint: Some("1.21".into()),
        };
        let mut stages = Vec::new();
        let result = validate_addon_parent_with_progress(
            &library,
            Some(&constraint),
            &mut |stage, percent| stages.push((stage, percent)),
        );
        assert!(result.is_err());
        assert_eq!(stages, [(TaskProgressStage::ForgeParentValidation, None)]);
    }
}
