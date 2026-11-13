use crate::core::deployment;
use crate::core::library::Library;
use crate::core::linker;
use crate::models::error::SError;
use crate::models::paths::SPTPathRules;
use crate::utils::toml as toml_store;
use camino::{Utf8Path, Utf8PathBuf};
use dunce::canonicalize as dunce_canon;
use parking_lot::Mutex;
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const PURGE_RECOVERY_VERSION: u8 = 2;
static PURGE_LOCK: Mutex<()> = Mutex::new(());

/// Serializes all in-process purge/recovery lifecycles. The lock covers the
/// journal, quarantine moves, and final cleanup so another operation cannot
/// mistake a live journal for abandoned state.
pub(crate) fn with_exclusive<T>(
    operation: impl FnOnce() -> Result<T, SError>,
) -> Result<T, SError> {
    let _guard = PURGE_LOCK.lock();
    operation()
}

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

/// Validates the compatibility purge without leaving game-tree mutations.
/// Each candidate is moved aside as the original filesystem object, its delete
/// permission is checked, and the object is moved back before records are
/// retired elsewhere.
pub fn validate_purge(library: &Library) -> Result<(), SError> {
    with_exclusive(|| validate_purge_unlocked(library))
}

pub(crate) fn validate_purge_unlocked(library: &Library) -> Result<(), SError> {
    let links = plan_purge(library)?;
    preflight_link_removals(library, &links)
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
        let relative = root.strip_prefix(&library.game_root)?;
        if !deployment::recorded_directory_is_contained(&library.game_root, relative) {
            return Err(ownership_error(library, &root));
        }
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
        valid_roots.push(root);
    }
    Ok(valid_roots)
}

#[derive(Clone)]
struct PurgeLink {
    path: Utf8PathBuf,
    target: PathBuf,
    kind: linker::ArtifactKind,
}

struct QuarantinedLink {
    link: PurgeLink,
    path: Utf8PathBuf,
}

struct QuarantineBatch {
    links: Vec<QuarantinedLink>,
    recovery_path: Utf8PathBuf,
    token: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct PurgeRecovery {
    version: u8,
    token: String,
    entries: Vec<PurgeRecoveryEntry>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct PurgeRecoveryEntry {
    original: Utf8PathBuf,
    quarantine: Utf8PathBuf,
}

fn plan_purge(library: &Library) -> Result<Vec<PurgeLink>, SError> {
    ensure_no_pending_recovery(library)?;
    let repo_root = dunce_canon(&library.repo_root)
        .unwrap_or_else(|_| library.repo_root.as_std_path().to_path_buf());
    let roots = validated_purge_roots(library)?;
    let mut links = Vec::new();

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
            if path
                .file_name()
                .is_some_and(|name| name.starts_with(".mkp-"))
            {
                return Err(purge_recovery_error(
                    library,
                    path,
                    "an orphaned quarantine link was found without a recovery manifest",
                ));
            }
            let Ok(raw_target) = linker::read_link_target_native(path) else {
                continue;
            };
            let target = if raw_target.is_absolute() {
                raw_target.clone()
            } else {
                path.as_std_path()
                    .parent()
                    .unwrap_or_else(|| Path::new("."))
                    .join(&raw_target)
            };
            let Ok(target) = dunce_canon(&target) else {
                // A dangling target cannot be proven to remain inside the
                // repository. Leave it untouched rather than using a lexical
                // prefix that may still contain `..` components.
                continue;
            };
            if target.starts_with(&repo_root) {
                links.push(PurgeLink {
                    path: path.to_path_buf(),
                    target: raw_target,
                    kind: linker::link_kind(path)?,
                });
            }
        }
    }
    Ok(links)
}

fn preflight_link_removals(library: &Library, links: &[PurgeLink]) -> Result<(), SError> {
    let batch = quarantine_links(library, links)?;
    restore_quarantined_links(&batch.links)?;
    clear_purge_recovery(library, &batch.recovery_path, batch.token.as_deref())
}

pub fn purge(library: &Library) -> Result<(), SError> {
    with_exclusive(|| purge_unlocked(library))
}

pub(crate) fn purge_unlocked(library: &Library) -> Result<(), SError> {
    let batch = quarantine_links(library, &plan_purge(library)?)?;
    let mut validation_failures = Vec::new();
    for entry in &batch.links {
        match verify_purge_link_at(&entry.link, &entry.path) {
            Ok(true) => {}
            Ok(false) => validation_failures.push(purge_link_changed(&entry.path).to_string()),
            Err(error) => validation_failures.push(error.to_string()),
        }
    }
    if !validation_failures.is_empty() {
        sync_quarantine_directories(&batch.links)?;
        return Err(SError::IOError(format!(
            "Unable to remove changed quarantined deployment links; recovery is pending at '{}': {}",
            batch.recovery_path,
            validation_failures.join(", ")
        )));
    }

    let mut failures = Vec::new();
    for entry in &batch.links {
        if let Err(error) = linker::unlink(&entry.path) {
            failures.push(format!("'{}': {error}", entry.path));
        }
    }
    if failures.is_empty() {
        sync_quarantine_directories(&batch.links)?;
        return clear_purge_recovery(library, &batch.recovery_path, batch.token.as_deref());
    }
    sync_quarantine_directories(&batch.links)?;
    Err(SError::IOError(format!(
        "Unable to remove all quarantined deployment links; recovery is pending at '{}': {}",
        batch.recovery_path,
        failures.join(", ")
    )))
}

fn verify_purge_link(link: &PurgeLink) -> Result<bool, SError> {
    verify_purge_link_at(link, &link.path)
}

fn verify_purge_link_at(link: &PurgeLink, path: &Utf8Path) -> Result<bool, SError> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    if !meta.file_type().is_symlink() {
        return Err(purge_link_changed(path));
    }
    if linker::read_link_target_native(path)? != link.target
        || linker::link_kind(path)? != link.kind
    {
        return Err(purge_link_changed(path));
    }
    Ok(true)
}

fn quarantine_links(library: &Library, links: &[PurgeLink]) -> Result<QuarantineBatch, SError> {
    let recovery_path = purge_recovery_path(library);
    let mut candidates = Vec::new();
    for link in links {
        match verify_purge_link(link) {
            Ok(false) => continue,
            Ok(true) => {}
            Err(error) => return Err(error),
        }
        let path = quarantine_path(&link.path)?;
        candidates.push(QuarantinedLink {
            link: link.clone(),
            path,
        });
    }
    if candidates.is_empty() {
        return Ok(QuarantineBatch {
            links: candidates,
            recovery_path,
            token: None,
        });
    }

    let token = persist_purge_recovery(library, &recovery_path, &candidates)?;
    let mut quarantined = Vec::new();
    for entry in candidates {
        if let Err(error) = fs::rename(entry.link.path.as_std_path(), entry.path.as_std_path()) {
            let rollback = rollback_quarantine(library, &recovery_path, &token, &quarantined);
            return Err(with_rollback_error(error.into(), rollback));
        }
        quarantined.push(entry);
    }

    if let Err(error) = sync_quarantine_directories(&quarantined) {
        let rollback = rollback_quarantine(library, &recovery_path, &token, &quarantined);
        return Err(with_rollback_error(error, rollback));
    }

    if let Err(error) = validate_quarantined_links(&quarantined) {
        let rollback = rollback_quarantine(library, &recovery_path, &token, &quarantined);
        return Err(with_rollback_error(error, rollback));
    }
    Ok(QuarantineBatch {
        links: quarantined,
        recovery_path,
        token: Some(token),
    })
}

fn quarantine_path(path: &Utf8Path) -> Result<Utf8PathBuf, SError> {
    let parent = path.parent().ok_or(SError::Unexpected)?;
    for _ in 0..8 {
        let candidate = parent.join(format!(".mkp-{}", uuid::Uuid::new_v4()));
        match fs::symlink_metadata(&candidate) {
            Ok(_) => continue,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(candidate),
            Err(error) => return Err(error.into()),
        }
    }
    Err(SError::IOError(format!(
        "Unable to allocate a quarantine path beside '{path}'"
    )))
}

fn purge_recovery_path(library: &Library) -> Utf8PathBuf {
    library.repo_root.join(".modkeeper-purge-recovery.toml")
}

fn persist_purge_recovery(
    library: &Library,
    recovery_path: &Utf8Path,
    links: &[QuarantinedLink],
) -> Result<String, SError> {
    let token = uuid::Uuid::new_v4().to_string();
    let recovery = PurgeRecovery {
        version: PURGE_RECOVERY_VERSION,
        token: token.clone(),
        entries: links
            .iter()
            .map(|entry| {
                Ok(PurgeRecoveryEntry {
                    original: recovery_relative_path(library, &entry.link.path)?,
                    quarantine: recovery_relative_path(library, &entry.path)?,
                })
            })
            .collect::<Result<Vec<_>, SError>>()?,
    };
    let serialized =
        ::toml::to_string(&recovery).map_err(|error| SError::ParseError(error.to_string()))?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(recovery_path.as_std_path())?;
    file.write_all(serialized.as_bytes())?;
    file.sync_all()?;
    if let Some(parent) = recovery_path.parent() {
        sync_directory(parent)?;
    }
    Ok(token)
}

fn ensure_no_pending_recovery(library: &Library) -> Result<(), SError> {
    let recovery_path = purge_recovery_path(library);
    let meta = match fs::symlink_metadata(&recovery_path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err(purge_recovery_error(
            library,
            &recovery_path,
            "the recovery manifest is not a regular file",
        ));
    }

    let recovery = read_purge_recovery(library, &recovery_path)?;
    let detail = recovery
        .entries
        .first()
        .map(|entry| {
            format!(
                "the recovery manifest owns quarantine '{}' and requires explicit recovery before retrying",
                entry.quarantine
            )
        })
        .unwrap_or_else(|| {
            "the recovery manifest requires explicit recovery before retrying".to_string()
        });
    Err(purge_recovery_error(library, &recovery_path, &detail))
}

fn clear_purge_recovery(
    library: &Library,
    recovery_path: &Utf8Path,
    token: Option<&str>,
) -> Result<(), SError> {
    let Some(token) = token else {
        return Ok(());
    };
    let recovery = read_purge_recovery(library, recovery_path)?;
    if recovery.token != token {
        return Err(purge_recovery_error(
            library,
            recovery_path,
            "the recovery manifest is owned by another purge operation",
        ));
    }
    match fs::remove_file(recovery_path) {
        Ok(()) => {
            if let Some(parent) = recovery_path.parent() {
                sync_directory(parent)?;
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn read_purge_recovery(
    library: &Library,
    recovery_path: &Utf8Path,
) -> Result<PurgeRecovery, SError> {
    let recovery: PurgeRecovery =
        toml_store::read(&recovery_path.to_path_buf()).map_err(|error| {
            purge_recovery_error(
                library,
                recovery_path,
                &format!("the recovery manifest could not be read: {error}"),
            )
        })?;
    if recovery.version != PURGE_RECOVERY_VERSION || recovery.token.is_empty() {
        return Err(purge_recovery_error(
            library,
            recovery_path,
            "the recovery manifest has an unsupported version or missing ownership token",
        ));
    }
    for entry in &recovery.entries {
        for path in [&entry.original, &entry.quarantine] {
            if !deployment::recorded_path_is_contained(&library.game_root, path) {
                return Err(purge_recovery_error(
                    library,
                    recovery_path,
                    &format!("the recovery path '{}' is outside the game root", path),
                ));
            }
        }
    }
    Ok(recovery)
}

fn recovery_relative_path(library: &Library, path: &Utf8Path) -> Result<Utf8PathBuf, SError> {
    let relative = path
        .strip_prefix(&library.game_root)
        .map_err(|_| ownership_error(library, path))?;
    if !deployment::recorded_path_is_contained(&library.game_root, relative) {
        return Err(ownership_error(library, path));
    }
    Ok(relative.to_path_buf())
}

fn rollback_quarantine(
    library: &Library,
    recovery_path: &Utf8Path,
    token: &str,
    links: &[QuarantinedLink],
) -> Result<(), SError> {
    restore_quarantined_links(links)?;
    clear_purge_recovery(library, recovery_path, Some(token))
}

fn validate_quarantined_links(links: &[QuarantinedLink]) -> Result<(), SError> {
    for entry in links {
        match verify_purge_link_at(&entry.link, &entry.path) {
            Ok(true) => {}
            Ok(false) => return Err(purge_link_changed(&entry.path)),
            Err(error) => return Err(error),
        }
    }
    for entry in links {
        linker::can_unlink(&entry.path)?;
    }
    Ok(())
}

fn sync_quarantine_directories(links: &[QuarantinedLink]) -> Result<(), SError> {
    let mut directories = HashSet::new();
    for entry in links {
        if let Some(parent) = entry.path.parent() {
            directories.insert(parent.to_path_buf());
        }
        if let Some(parent) = entry.link.path.parent() {
            directories.insert(parent.to_path_buf());
        }
    }
    for directory in directories {
        sync_directory(&directory)?;
    }
    Ok(())
}

fn sync_directory(path: &Utf8Path) -> Result<(), SError> {
    #[cfg(unix)]
    {
        fs::File::open(path.as_std_path())?.sync_all()?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

fn purge_recovery_error(library: &Library, path: &Utf8Path, detail: &str) -> SError {
    SError::InvalidLibrary(
        library.repo_root.to_string(),
        format!(
            "Purge recovery is pending at '{path}': {detail}. Resolve the retained quarantine before retrying"
        ),
    )
}

fn restore_quarantined_links(links: &[QuarantinedLink]) -> Result<(), SError> {
    let mut failures = Vec::new();
    for entry in links.iter().rev() {
        match fs::symlink_metadata(&entry.link.path) {
            Ok(_) => {
                if fs::symlink_metadata(&entry.path).is_ok()
                    || !matches!(verify_purge_link(&entry.link), Ok(true))
                {
                    failures.push(format!("'{}' is occupied", entry.link.path));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                match fs::symlink_metadata(&entry.path) {
                    Ok(_) => {
                        if let Err(error) =
                            fs::rename(entry.path.as_std_path(), entry.link.path.as_std_path())
                        {
                            failures.push(format!("'{}': {error}", entry.link.path));
                        }
                    }
                    Err(error) => failures.push(format!("'{}': {error}", entry.path)),
                }
            }
            Err(error) => failures.push(format!("'{}': {error}", entry.link.path)),
        }
    }
    if let Err(error) = sync_quarantine_directories(links) {
        failures.push(format!("directory sync failed: {error}"));
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(SError::IOError(format!(
            "Unable to restore quarantined deployment links: {}",
            failures.join(", ")
        )))
    }
}

fn with_rollback_error(primary: SError, rollback: Result<(), SError>) -> SError {
    match rollback {
        Ok(()) => primary,
        Err(error) => SError::IOError(format!("{primary}; rollback failed: {error}")),
    }
}

fn purge_link_changed(path: &Utf8Path) -> SError {
    SError::FileCollision(vec![format!(
        "Deployment link changed before it could be safely removed: '{path}'."
    )])
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
