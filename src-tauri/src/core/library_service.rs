use crate::core::cache::{LibraryCache, normalize_mod_folders};
use crate::core::library::Library;
use crate::core::mod_manager;
use crate::core::mod_stager::{self, StageMaterial};
use crate::models::error::SError;
use crate::models::paths::LibPathRules;
use crate::models::workspace::{ArchiveFailure, BulkModAction};
use crate::utils::thread::with_lib_arc_mut;
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
    with_lib_arc_mut(instance_handle, |inst| {
        assert_is_library(inst, library_id)?;
        inst.sync()
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
    let mut failures = Vec::new();
    for path in archive_paths {
        if let Err(error) = install_single_archive(
            instance_handle.clone(),
            library_id,
            material,
            path,
            enable_on_install,
        ) {
            failures.push(ArchiveFailure {
                archive_path: path.to_string(),
                error,
            });
        }
    }
    failures
}

fn install_single_archive(
    instance_handle: Arc<Mutex<Option<Library>>>,
    library_id: &str,
    material: &StageMaterial,
    archive_path: &Utf8PathBuf,
    enable_on_install: bool,
) -> Result<(), SError> {
    // Staging (extraction) runs outside the lock; only the install holds it.
    let staged_mods = mod_stager::resolve(std::slice::from_ref(archive_path), material)?;

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

/// Rebuilds the active library's cache under the mutex for the full duration.
/// Folder normalization renames only (C8): backups are left on disk, and no
/// re-link happens - a rename dangles that mod's deployed links until sync_mods.
pub fn rebuild_active_library_cache(
    instance_handle: Arc<Mutex<Option<Library>>>,
    library_id: &str,
) -> Result<(), SError> {
    with_lib_arc_mut(instance_handle, |inst| {
        assert_is_library(inst, library_id)?;
        rebuild_library_cache(inst)
    })?
}

pub fn rebuild_library_cache(library: &mut Library) -> Result<(), SError> {
    use crate::models::mod_dto::Mod;

    // 1. Normalize folder names to match resolved IDs
    let result = normalize_mod_folders(&library.lib_paths.mods, &library.spt_rules, &library.mods)?;

    // 2. Drop stale mod entries for renamed folders, keeping display names for step 4.
    // Backups are intentionally left on disk (C8).
    let mut old_names = std::collections::BTreeMap::new();
    for renamed in &result.renamed {
        if let Some(old) = library.mods.remove(&renamed.old_name) {
            old_names.insert(renamed.new_name.clone(), old.name);
        }
    }

    // 3. Rebuild cache from normalized folders
    library.cache = LibraryCache::build(&library.lib_paths.mods, &library.spt_rules)?;

    // 4. Create new mod entries for renamed mods and restore enabled state
    for renamed in &result.renamed {
        if let Some(cached_fs) = library.cache.mods.get(&renamed.new_name) {
            // Keep the previous display name or fall back to the folder name
            let name = old_names
                .get(&renamed.new_name)
                .cloned()
                .unwrap_or_else(|| renamed.new_name.clone());

            library.mods.insert(
                renamed.new_name.clone(),
                Mod {
                    id: renamed.new_name.clone(),
                    is_active: renamed.was_active,
                    mod_type: cached_fs.mod_type.clone(),
                    name,
                },
            );
        }
    }

    library.persist()?;
    Ok(())
}
