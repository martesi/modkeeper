use crate::core::deployment;
use crate::core::library::Library;
use crate::core::linker;
use crate::models::error::SError;
use camino::{Utf8Path, Utf8PathBuf};
use dunce::canonicalize as dunce_canon;
use std::collections::HashSet;
use std::fs;
use walkdir::WalkDir;

/// Removes recorded deployment artifacts that are still owned by the library.
/// This is used when the library itself is being deleted; normal sync relies
/// on deployment reconciliation so unchanged artifacts can be retained.
pub fn remove_recorded_deployment(library: &Library) -> Result<(), SError> {
    let mut artifacts = library.deployment.artifacts.clone();
    artifacts.sort_by_key(|artifact| std::cmp::Reverse(artifact.target.components().count()));

    for artifact in artifacts {
        let target = library.game_root.join(&artifact.target);
        if artifact_is_still_owned(library, &artifact, &target) {
            linker::remove(&target, artifact.kind)?;
        }
    }

    let protected =
        deployment::get_protected_paths_absolute(&library.game_root, &library.game_rules);
    let mut directories = library.deployment.created_dirs.clone();
    directories.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    for path in directories {
        let absolute = library.game_root.join(path);
        if protected.iter().any(|root| root == &absolute) {
            continue;
        }
        if let Ok(meta) = fs::symlink_metadata(&absolute)
            && meta.is_dir()
            && fs::read_dir(&absolute)?.next().is_none()
        {
            fs::remove_dir(&absolute)?;
        }
    }

    Ok(())
}

/// Compatibility cleanup for deployments made before deployment.toml existed.
/// Recorded artifacts are removed by reconciliation, not by scanning the cache.
pub fn purge(library: &Library) -> Result<(), SError> {
    let repo_root = dunce_canon(&library.repo_root)
        .map(|path| Utf8PathBuf::from(path.to_string_lossy().into_owned()))
        .unwrap_or_else(|_| library.repo_root.clone());
    let roots = deployment::get_protected_paths_absolute(&library.game_root, &library.game_rules);

    for root in roots.iter().filter(|root| root.exists()) {
        for entry in WalkDir::new(root).follow_links(false) {
            let entry = entry.map_err(|error| SError::IOError(error.to_string()))?;
            let path = Utf8Path::from_path(entry.path()).ok_or(SError::Unexpected)?;
            if path == root || !entry.file_type().is_symlink() {
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

    for path in unlink_paths {
        let Some(artifact) = deployment::recorded_artifact(library, path).cloned() else {
            continue;
        };
        if protected.iter().any(|root| root == path) {
            continue;
        }
        let target = path.clone();
        match fs::symlink_metadata(&target) {
            Ok(_) => {
                if !artifact_is_still_owned(library, &artifact, &target) {
                    continue;
                }
                linker::remove(&target, artifact.kind)?;
                unlinked.push(target.clone());
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        removed_targets.insert(artifact.target);
    }

    let mut dirs: Vec<_> = shared_dirs.iter().collect();
    dirs.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    for path in dirs {
        if protected.iter().any(|root| root == path) {
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(path) else {
            continue;
        };
        if meta.is_dir() && fs::read_dir(path)?.next().is_none() {
            fs::remove_dir(path)?;
            unlinked.push(path.clone());
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

fn artifact_is_still_owned(
    library: &Library,
    artifact: &deployment::DeploymentArtifact,
    target: &Utf8Path,
) -> bool {
    if matches!(
        artifact.kind,
        linker::ArtifactKind::Symlink | linker::ArtifactKind::Junction
    ) {
        return linker::read_link_target(target)
            .map(|actual| actual == library.repo_root.join(&artifact.source))
            .unwrap_or(false);
    }
    fs::symlink_metadata(target).is_ok_and(|meta| meta.is_file())
}
