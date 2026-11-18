use crate::core::cleanup;
use crate::core::deployment;
use crate::core::library::Library;
use crate::core::mod_snapshot;
use crate::core::mod_stager::StagedMod;
use crate::models::error::SError;
use crate::models::mod_dto::{ForgeInstallMetadata, Mod, ModSource};
use crate::utils::file;
use crate::utils::time::{file_created_at, now_iso8601_utc};

/// Adds or updates a mod in the library.
/// Overwriting an existing mod is guarded by a transient snapshot (§7f): a
/// failed overwrite restores the mod exactly as it was; a successful one
/// leaves no snapshot behind.
pub fn add_mod(
    library: &mut Library,
    staged: StagedMod,
    enable_on_install: bool,
) -> Result<(), SError> {
    add_mod_with_metadata(library, staged, enable_on_install, None)
}

pub fn add_mod_with_metadata(
    library: &mut Library,
    staged: StagedMod,
    enable_on_install: bool,
    metadata: Option<&ForgeInstallMetadata>,
) -> Result<(), SError> {
    let mod_id = staged.fs.id.clone();
    let dst = library.lib_paths.mods.join(&mod_id);
    // Read legacy timestamps before an overwrite can change the folder metadata.
    let installed_at = library
        .mods
        .get(&mod_id)
        .and_then(|m| m.installed_at.clone().or_else(|| file_created_at(&dst)))
        .unwrap_or_else(now_iso8601_utc);

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
            // Preserve the existing name and first installation time on updates.
            m.mod_type = staged.fs.mod_type.clone();
            m.installed_at = Some(installed_at.clone());
            if let Some(metadata) = metadata {
                apply_forge_metadata(m, metadata);
            } else {
                clear_forge_metadata(m);
            }
        })
        .or_insert_with(|| Mod {
            id: mod_id.clone(),
            is_active: enable_on_install,
            mod_type: staged.fs.mod_type.clone(),
            name: staged.name.clone(),
            installed_at: Some(installed_at),
            version: metadata.map(|metadata| metadata.version.clone()),
            forge_id: metadata.map(|metadata| metadata.forge_id),
            forge_guid: metadata.map(|metadata| metadata.forge_guid.clone()),
            source: if metadata.is_some() {
                ModSource::Forge
            } else {
                ModSource::Local
            },
            forge_kind: metadata.map(|metadata| metadata.kind.clone()),
            forge_version_id: metadata.map(|metadata| metadata.version_id),
            forge_meta_cached_at: metadata.map(|metadata| metadata.cached_at.clone()),
        });

    library.cache.add(staged.fs);
    library.mark_dirty();
    library.persist()?;
    Ok(())
}

fn apply_forge_metadata(mod_entry: &mut Mod, metadata: &ForgeInstallMetadata) {
    mod_entry.version = Some(metadata.version.clone());
    mod_entry.forge_id = Some(metadata.forge_id);
    mod_entry.forge_guid = Some(metadata.forge_guid.clone());
    mod_entry.source = ModSource::Forge;
    mod_entry.forge_kind = Some(metadata.kind.clone());
    mod_entry.forge_version_id = Some(metadata.version_id);
    mod_entry.forge_meta_cached_at = Some(metadata.cached_at.clone());
}

fn clear_forge_metadata(mod_entry: &mut Mod) {
    mod_entry.version = None;
    mod_entry.forge_id = None;
    mod_entry.forge_guid = None;
    mod_entry.source = ModSource::Local;
    mod_entry.forge_kind = None;
    mod_entry.forge_version_id = None;
    mod_entry.forge_meta_cached_at = None;
}

/// Removes a mod from the library.
/// Unlinks files, junctions, and shared directories, then removes from filesystem.
/// Always attempts to unlink regardless of active status, as library state may not be synced.
/// Does not mark library dirty as sync status already reflects unlinked state.
pub fn remove_mod(library: &mut Library, id: &str) -> Result<(), SError> {
    // IDs arrive through IPC and are joined to both the mods and backup roots.
    // Check before any cleanup, including when persisted metadata was tampered with.
    if !library.mods.contains_key(id)
        || id.is_empty()
        || matches!(id, "." | "..")
        || id.contains(['/', '\\', ':'])
        || id.ends_with(['.', ' '])
        || id.chars().any(char::is_control)
    {
        return Err(SError::ModNotFound(id.to_string()));
    }

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
