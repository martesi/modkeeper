use crate::core::cleanup;
use crate::core::deployment;
use crate::core::library::Library;
use crate::core::mod_snapshot;
use crate::core::mod_stager::StagedMod;
use crate::models::error::SError;
use crate::models::mod_dto::Mod;
use crate::utils::file;

/// Adds or updates a mod in the library.
/// Overwriting an existing mod is guarded by a transient snapshot (§7f): a
/// failed overwrite restores the mod exactly as it was; a successful one
/// leaves no snapshot behind.
pub fn add_mod(
    library: &mut Library,
    staged: StagedMod,
    enable_on_install: bool,
) -> Result<(), SError> {
    let mod_id = staged.fs.id.clone();
    let dst = library.lib_paths.mods.join(&mod_id);

    let has_snapshot = if dst.exists() {
        mod_snapshot::take(library, &mod_id)?;
        true
    } else {
        false
    };

    let copied =
        file::create_dir_all(&dst).and_then(|_| file::copy_recursive(&staged.source_path, &dst));
    if let Err(e) = copied {
        if has_snapshot {
            mod_snapshot::restore(library, &mod_id)?;
        }
        return Err(e);
    }
    if has_snapshot {
        mod_snapshot::discard(library, &mod_id)?;
    }

    library
        .mods
        .entry(mod_id.clone())
        .and_modify(|m| {
            // Preserve existing name when updating - only update mod_type
            m.mod_type = staged.fs.mod_type.clone();
        })
        .or_insert_with(|| Mod {
            id: mod_id.clone(),
            is_active: enable_on_install,
            mod_type: staged.fs.mod_type.clone(),
            name: staged.name.clone(),
        });

    library.cache.add(staged.fs);
    library.mark_dirty();
    library.persist()?;
    Ok(())
}

/// Removes a mod from the library.
/// Unlinks files, junctions, and shared directories, then removes from filesystem.
/// Always attempts to unlink regardless of active status, as library state may not be synced.
/// Does not mark library dirty as sync status already reflects unlinked state.
pub fn remove_mod(library: &mut Library, id: &str) -> Result<(), SError> {
    // Get mod's ModFS from cache before removing
    let mod_fs_exists = library.cache.mods.contains_key(id);

    // Always attempt to unlink - active status may not match filesystem state
    if mod_fs_exists {
        // Find what paths need to be unlinked (treats mod as active for ownership calculation)
        let (unlink_paths, shared_dirs) = deployment::find_mod_links(library, id)?;

        // Unlink all paths and shared directories
        cleanup::unlink_mod(library, id, &unlink_paths, &shared_dirs)?;
    }

    // Defensive cleanup of any leftover snapshot dir (crash backstop, §7f)
    mod_snapshot::cleanup(&library.lib_paths, id)?;

    // Remove mod directory from filesystem
    let mod_dir = library.lib_paths.mods.join(id);
    if mod_dir.exists() {
        file::remove_dir_all(&mod_dir)?;
    }

    // Remove from cache and mods map
    library.cache.mods.remove(id);
    library.mods.remove(id);

    // Do NOT mark dirty - sync status already reflects the unlinked state
    library.persist()?;
    Ok(())
}

/// Toggles the active state of a mod.
pub fn toggle_mod(library: &mut Library, id: &str, is_active: bool) -> Result<(), SError> {
    let mod_entry = library
        .mods
        .get_mut(id)
        .ok_or_else(|| SError::ModNotFound(id.to_string()))?;
    mod_entry.is_active = is_active;
    library.mark_dirty();
    library.persist()?;
    Ok(())
}
