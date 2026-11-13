use crate::core::deployment;
use crate::core::library::Library;
use crate::core::linker;
use crate::models::error::SError;
use crate::models::paths::SPTPathRules;
use camino::{Utf8Path, Utf8PathBuf};
use dunce::canonicalize as dunce_canon;
use std::collections::HashSet;
use std::fs;
use walkdir::WalkDir;

/// Removes recorded deployment artifacts that are still owned by the library.
/// This is used when the library itself is being deleted; normal sync relies
/// on deployment reconciliation so unchanged artifacts can be retained.
pub fn remove_recorded_deployment(library: &Library) -> Result<(), SError> {
    remove_recorded_deployment_with_identity(library, false)
}

/// Removes deployment only when every regular-file artifact has a verifiable
/// filesystem identity. Cross-major transitions use this stricter policy
/// because a byte-identical copy may belong to the replacement installation.
pub fn remove_recorded_deployment_for_transition(library: &Library) -> Result<(), SError> {
    remove_recorded_deployment_with_identity(library, true)
}

fn remove_recorded_deployment_with_identity(
    library: &Library,
    require_identity: bool,
) -> Result<(), SError> {
    let mut artifacts = library.deployment.artifacts.clone();
    artifacts.sort_by_key(|artifact| std::cmp::Reverse(artifact.target.components().count()));

    let mut artifact_removals = Vec::new();
    for artifact in artifacts {
        if !deployment::recorded_path_is_contained(&library.game_root, &artifact.target) {
            return Err(ownership_error(library, &artifact.target));
        }
        let target = library.game_root.join(&artifact.target);
        match fs::symlink_metadata(&target) {
            Ok(_)
                if if require_identity {
                    deployment::artifact_is_owned(library, &artifact, &target)?
                } else {
                    deployment::artifact_is_recorded(library, &artifact, &target)?
                } =>
            {
                artifact_removals.push((target, artifact.kind));
            }
            Ok(_) => return Err(ownership_error(library, &artifact.target)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }

    let protected =
        deployment::get_protected_paths_absolute(&library.game_root, &library.game_rules);
    let mut directories = library.deployment.created_dirs.clone();
    directories.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    let mut directory_removals = Vec::new();
    for path in directories {
        if !deployment::recorded_path_is_contained(&library.game_root, &path) {
            return Err(ownership_error(library, &path));
        }
        let absolute = library.game_root.join(&path);
        if protected.iter().any(|root| root == &absolute) {
            continue;
        }
        match fs::symlink_metadata(&absolute) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Ok(_) if !deployment::recorded_directory_is_contained(&library.game_root, &path) => {
                return Err(ownership_error(library, &absolute));
            }
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(ownership_error(library, &absolute));
            }
            Ok(meta) if meta.is_dir() => {
                directory_removals.push(absolute);
            }
            Ok(_) => {}
            Err(error) => return Err(error.into()),
        }
    }

    for (target, kind) in artifact_removals {
        linker::remove(&target, kind)?;
    }
    for directory in directory_removals {
        if fs::read_dir(&directory)?.next().is_none() {
            fs::remove_dir(&directory)?;
        }
    }

    library.retire_deployment()?;
    Ok(())
}

/// Compatibility cleanup for deployments made before deployment.toml existed.
/// Recorded artifacts are removed by reconciliation, not by scanning the cache.
pub fn validate_purge_roots(library: &Library) -> Result<(), SError> {
    validated_purge_roots(library).map(|_| ())
}

fn purge_roots(library: &Library) -> Vec<Utf8PathBuf> {
    let mut roots =
        deployment::get_protected_paths_absolute(&library.game_root, &library.game_rules);
    let legacy_server_root = library.game_root.join(SPTPathRules::default().server_mods);
    if !roots.iter().any(|root| root == &legacy_server_root) {
        roots.push(legacy_server_root);
    }
    roots
}

fn validated_purge_roots(library: &Library) -> Result<Vec<Utf8PathBuf>, SError> {
    let mut valid_roots = Vec::new();
    for root in purge_roots(library) {
        let meta = match fs::symlink_metadata(&root) {
            Ok(meta) => meta,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        if !meta.is_dir()
            || meta.file_type().is_symlink()
            || linker::read_link_target(&root).is_ok()
        {
            return Err(ownership_error(library, &root));
        }
        let relative = root.strip_prefix(&library.game_root)?;
        if !deployment::recorded_directory_is_contained(&library.game_root, relative) {
            return Err(ownership_error(library, &root));
        }
        valid_roots.push(root);
    }
    Ok(valid_roots)
}

pub fn purge(library: &Library) -> Result<(), SError> {
    let repo_root = dunce_canon(&library.repo_root)
        .map(|path| Utf8PathBuf::from(path.to_string_lossy().into_owned()))
        .unwrap_or_else(|_| library.repo_root.clone());
    let roots = validated_purge_roots(library)?;

    for root in roots {
        // The root was verified as a real directory above; min_depth avoids
        // treating it as a link traversal root, while follow_links keeps child
        // links from being traversed.
        for entry in WalkDir::new(root).min_depth(1).follow_links(false) {
            let entry = entry.map_err(|error| SError::IOError(error.to_string()))?;
            let path = Utf8Path::from_path(entry.path()).ok_or(SError::Unexpected)?;
            if !entry.file_type().is_symlink() {
                continue;
            }
            let Ok(target) = linker::read_link_target(path) else {
                continue;
            };
            let target = dunce_canon(&target)
                .map(|path| Utf8PathBuf::from(path.to_string_lossy().into_owned()))
                .unwrap_or(target);
            if target.starts_with(&repo_root) {
                linker::unlink(path)?;
            }
        }
    }
    Ok(())
}

/// Removes only recorded artifacts for a mod and prunes recorded empty directories.
pub fn unlink_mod(
    library: &mut Library,
    _mod_id: &str,
    unlink_paths: &HashSet<Utf8PathBuf>,
    shared_dirs: &HashSet<Utf8PathBuf>,
) -> Result<Vec<Utf8PathBuf>, SError> {
    let protected =
        deployment::get_protected_paths_absolute(&library.game_root, &library.game_rules);
    let mut unlinked = Vec::new();
    let mut removed_targets = HashSet::new();
    let mut artifact_removals = Vec::new();
    let mut dirs: Vec<_> = shared_dirs.iter().collect();
    dirs.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    let mut directory_candidates = Vec::new();

    // Validate every recorded directory before removing any artifact. The
    // directory set is library-wide, so another mod can make this cleanup
    // unsafe even when this mod's own artifacts are valid.
    for path in &dirs {
        let Ok(relative) = path.strip_prefix(&library.game_root) else {
            return Err(containment_collision(path));
        };
        if !deployment::recorded_directory_is_contained(&library.game_root, relative) {
            return Err(containment_collision(path));
        }
        let Ok(meta) = fs::symlink_metadata(path) else {
            continue;
        };
        if protected.iter().any(|root| root == *path) {
            continue;
        }
        if meta.is_dir() {
            let _ = fs::read_dir(path)?.next();
            directory_candidates.push((*path).clone());
        }
    }

    for path in unlink_paths {
        let Some(artifact) = deployment::recorded_artifact(library, path).cloned() else {
            continue;
        };
        let expected_target = library.game_root.join(&artifact.target);
        if path != &expected_target {
            continue;
        }
        if !deployment::recorded_path_is_contained(&library.game_root, &artifact.target) {
            return Err(containment_collision(path));
        }
        if protected.iter().any(|root| root == path) {
            continue;
        }
        let target = path.clone();
        match fs::symlink_metadata(&target) {
            Ok(_) => {
                if !deployment::artifact_is_recorded(library, &artifact, &target)? {
                    return Err(SError::FileCollision(vec![format!(
                        "Deployment target changed outside ModKeeper ownership: '{target}'."
                    )]));
                }
                artifact_removals.push((target, artifact));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                removed_targets.insert(artifact.target);
            }
            Err(error) => return Err(error.into()),
        }
    }

    for (target, artifact) in artifact_removals {
        linker::remove(&target, artifact.kind)?;
        unlinked.push(target);
        removed_targets.insert(artifact.target);
    }

    for path in directory_candidates {
        if fs::read_dir(&path)?.next().is_none() {
            fs::remove_dir(&path)?;
            unlinked.push(path);
        }
    }

    library
        .deployment
        .artifacts
        .retain(|artifact| !removed_targets.contains(&artifact.target));
    library.deployment.created_dirs.retain(|directory| {
        let absolute = library.game_root.join(directory);
        fs::symlink_metadata(&absolute).is_ok()
    });
    Ok(unlinked)
}

fn ownership_error(library: &Library, path: &Utf8Path) -> SError {
    SError::InvalidLibrary(
        library.repo_root.to_string(),
        format!(
            "Refusing to remove deployment target '{path}' because its ownership or containment cannot be verified"
        ),
    )
}

fn containment_collision(path: &Utf8Path) -> SError {
    SError::FileCollision(vec![format!(
        "Deployment target cannot be safely removed because its path is redirected or outside the game root: '{path}'."
    )])
}
