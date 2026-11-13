use crate::core::cache::LibraryCache;
use crate::core::library::Library;
use crate::core::linker::{self, ArtifactKind};
use crate::models::error::SError;
use crate::models::mod_dto::Mod;
use crate::models::paths::SPTPathRules;
use camino::{Utf8Path, Utf8PathBuf};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::io::{self, Read};
use std::path::{Component, PathBuf};
use walkdir::WalkDir;

type OwnershipMap = HashMap<Utf8PathBuf, Vec<String>>;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeploymentState {
    pub artifacts: Vec<DeploymentArtifact>,
    pub created_dirs: Vec<Utf8PathBuf>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DeploymentArtifact {
    pub target: Utf8PathBuf,
    pub source: Utf8PathBuf,
    pub kind: ArtifactKind,
    #[serde(default)]
    pub fingerprint: Option<String>,
}

pub struct DeploymentPlan {
    artifacts: Vec<DeploymentArtifact>,
    directories: Vec<Utf8PathBuf>,
}

impl DeploymentArtifact {
    fn from_source(
        target: Utf8PathBuf,
        source: Utf8PathBuf,
        source_path: &Utf8Path,
        kind: ArtifactKind,
    ) -> Result<Self, SError> {
        let fingerprint = source_path
            .is_file()
            .then(|| file_fingerprint(source_path))
            .transpose()?;
        Ok(Self {
            target,
            source,
            kind,
            fingerprint,
        })
    }
}

/// Keeps persisted directory ownership relative to the game root.
///
/// Older deployment files recorded the absolute path passed to
/// `ensure_directory`. Normalize those records when loading so they continue
/// to participate in ownership checks after the representation is fixed.
pub(crate) fn normalize_created_dirs(game_root: &Utf8Path, state: &mut DeploymentState) {
    for path in &mut state.created_dirs {
        let Ok(relative) = path.strip_prefix(game_root) else {
            continue;
        };
        if relative.as_str().is_empty() || relative == "." {
            continue;
        }
        *path = relative.to_path_buf();
    }
}

/// Backfills fingerprints for legacy regular-copy records only when the
/// recorded destination still exactly matches the library source. An
/// ambiguous legacy destination remains unowned so later reconciliation can
/// surface an explicit collision instead of guessing.
pub(crate) fn migrate_legacy_fingerprints(
    game_root: &Utf8Path,
    repo_root: &Utf8Path,
    state: &mut DeploymentState,
) -> Result<bool, SError> {
    let mut migrated = false;
    for artifact in &mut state.artifacts {
        if artifact.fingerprint.is_some() || artifact.kind != ArtifactKind::Copy {
            continue;
        }
        if !recorded_path_is_contained(game_root, &artifact.target) {
            continue;
        }
        let Some(source) = recorded_source_path_for(repo_root, &artifact.source) else {
            continue;
        };
        let target = game_root.join(&artifact.target);
        let Ok(source_meta) = fs::symlink_metadata(source.as_std_path()) else {
            continue;
        };
        let Ok(target_meta) = fs::symlink_metadata(target.as_std_path()) else {
            continue;
        };
        if !source_meta.is_file() || !target_meta.is_file() {
            continue;
        }
        if file_contents_match(&source, &target)? {
            artifact.fingerprint = Some(file_fingerprint(&target)?);
            migrated = true;
        }
    }
    Ok(migrated)
}

/// Checks that a persisted game-root-relative path cannot escape through `..`
/// or an ancestor symlink/junction. The final component is deliberately not
/// canonicalized because recorded symlinks and junctions are deployment
/// artifacts that ownership checks must inspect without following.
pub(crate) fn recorded_path_is_contained(base: &Utf8Path, relative: &Utf8Path) -> bool {
    if !is_safe_relative_path(relative) {
        return false;
    }

    let Ok(base_canonical) = dunce::canonicalize(base.as_std_path()) else {
        return false;
    };
    if !has_unredirected_ancestors(base, relative, &base_canonical) {
        return false;
    }
    let absolute = base.join(relative);
    let parent = absolute.parent().unwrap_or(base);
    let Some(parent_canonical) = canonicalize_nearest_existing(parent) else {
        return false;
    };
    parent_canonical.starts_with(base_canonical)
}

/// Like [`recorded_path_is_contained`], but also validates the final component.
/// Recorded directories must never be redirected by a junction or symlink
/// before cleanup inspects or removes their contents.
pub(crate) fn recorded_directory_is_contained(base: &Utf8Path, relative: &Utf8Path) -> bool {
    if !recorded_path_is_contained(base, relative) {
        return false;
    }

    let Ok(base_canonical) = dunce::canonicalize(base.as_std_path()) else {
        return false;
    };
    let absolute = base.join(relative);
    match fs::symlink_metadata(&absolute) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Ok(meta) if is_redirected_path(&absolute) || !meta.is_dir() => false,
        Ok(_) => dunce::canonicalize(absolute.as_std_path())
            .map(|path| path.starts_with(base_canonical))
            .unwrap_or(false),
        Err(_) => false,
    }
}

fn is_safe_relative_path(path: &Utf8Path) -> bool {
    !path.as_std_path().is_absolute()
        && !path.as_std_path().components().any(|component| {
            matches!(
                component,
                Component::Prefix(_) | Component::RootDir | Component::ParentDir
            )
        })
}

fn canonicalize_nearest_existing(path: &Utf8Path) -> Option<PathBuf> {
    let mut current = path;
    loop {
        match fs::symlink_metadata(current.as_std_path()) {
            Ok(_) => return dunce::canonicalize(current.as_std_path()).ok(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                current = current.parent()?;
            }
            Err(_) => return None,
        }
    }
}

fn has_unredirected_ancestors(
    base: &Utf8Path,
    relative: &Utf8Path,
    base_canonical: &std::path::Path,
) -> bool {
    let Some(parent) = relative.parent() else {
        return true;
    };
    let mut physical = base.to_path_buf();
    let mut expected = base_canonical.to_path_buf();
    for component in parent.as_std_path().components() {
        let Some(component) = component.as_os_str().to_str() else {
            return false;
        };
        physical.push(component);
        expected.push(component);
        match fs::symlink_metadata(physical.as_std_path()) {
            Ok(meta) => {
                if !meta.is_dir() || is_redirected_path(&physical) {
                    return false;
                }
                if !same_file::is_same_file(physical.as_std_path(), &expected).unwrap_or(false) {
                    return false;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(_) => return false,
        }
    }
    true
}

fn is_redirected_path(path: &Utf8Path) -> bool {
    let is_symlink = fs::symlink_metadata(path.as_std_path())
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false);
    #[cfg(windows)]
    let is_junction = junction::exists(path.as_std_path()).unwrap_or(false);
    #[cfg(not(windows))]
    let is_junction = false;
    is_symlink || is_junction || linker::read_link_target(path).is_ok()
}

// --- Protected Path Helpers ---

pub fn get_protected_paths(spt_rules: &SPTPathRules) -> Vec<&Utf8Path> {
    vec![&spt_rules.server_mods, &spt_rules.client_plugins]
}

pub fn get_protected_paths_absolute(
    game_root: &Utf8Path,
    spt_rules: &SPTPathRules,
) -> Vec<Utf8PathBuf> {
    get_protected_paths(spt_rules)
        .iter()
        .map(|path| game_root.join(path))
        .collect()
}

pub fn is_protected_path(path: &Utf8Path, spt_rules: &SPTPathRules) -> bool {
    get_protected_paths(spt_rules).contains(&path)
}

pub fn is_protected_path_absolute(
    path: &Utf8Path,
    game_root: &Utf8Path,
    spt_rules: &SPTPathRules,
) -> bool {
    get_protected_paths_absolute(game_root, spt_rules)
        .iter()
        .any(|protected| path == protected)
}

/// Builds the entire deployment plan and validates its destinations before any cleanup.
pub fn plan(library: &Library) -> Result<DeploymentPlan, SError> {
    check_file_collisions(&library.mods, &library.cache)?;
    let ownership = build_folder_ownership_map(&library.spt_rules, &library.mods, &library.cache);
    let mut selected = BTreeMap::new();
    // Keep stored packages in the canonical SPT layout so the runtime cannot
    // bypass the protected-path ownership rules or alias another mod's target.
    if library.game_rules.server_mods != library.spt_rules.server_mods {
        for (path, _) in iter_active_files(&library.mods, &library.cache) {
            if path
                .components()
                .next()
                .is_some_and(|component| component.as_str().eq_ignore_ascii_case("SPT_Runtime"))
            {
                return Err(SError::FileCollision(vec![format!(
                    "Stored mod contains '{path}'; reimport the mod to normalize its server folder."
                )]));
            }
        }
    }
    let methods = linker::preflight(&library.repo_root, &library.game_root)?;

    for (id, mod_fs) in library
        .cache
        .mods
        .iter()
        .filter(|(id, _)| library.mods.get(*id).is_some_and(|m| m.is_active))
    {
        for file_path in &mod_fs.files {
            let mut current_path = Utf8PathBuf::new();
            for component in file_path.components() {
                current_path.push(component);
                let owners = ownership.get(&current_path).ok_or_else(|| {
                    SError::ParseError(format!("Missing ownership for '{current_path}'"))
                })?;
                if owners.len() == 1 {
                    let source = library.lib_paths.mods.join(id).join(&current_path);
                    let target = library.deployment_target(&current_path);
                    if methods.directory == ArtifactKind::Copy
                        && source.is_dir()
                        && should_expand_existing_directory(library, &target)?
                    {
                        continue;
                    }
                    let kind = if source.is_dir() {
                        methods.directory
                    } else {
                        methods.file
                    };
                    selected.insert(current_path.clone(), (source, kind));
                    break;
                }
            }
        }
    }

    let mut artifacts = Vec::new();
    let mut directories = BTreeSet::new();
    for (target, (source, kind)) in selected {
        let target = library.deployment_target(&target);
        if kind == ArtifactKind::Copy && source.is_dir() {
            check_copy_directory_destination(library, &target)?;
            for entry in WalkDir::new(&source) {
                let entry = entry.map_err(|error| SError::IOError(error.to_string()))?;
                let entry_path = Utf8Path::from_path(entry.path()).ok_or(SError::Unexpected)?;
                let relative = entry_path.strip_prefix(&source)?;
                let destination = target.join(relative);
                if entry.file_type().is_dir() {
                    directories.insert(destination);
                } else if entry.file_type().is_file() {
                    artifacts.push(DeploymentArtifact::from_source(
                        destination,
                        entry_path.strip_prefix(&library.repo_root)?.to_path_buf(),
                        entry_path,
                        kind,
                    )?);
                }
            }
        } else {
            artifacts.push(DeploymentArtifact::from_source(
                target.clone(),
                source.strip_prefix(&library.repo_root)?.to_path_buf(),
                &source,
                kind,
            )?);
        }
        add_parent_dirs(&mut directories, &target);
    }

    artifacts.sort_by(|a, b| a.target.cmp(&b.target));
    check_destinations(library, &artifacts)?;
    Ok(DeploymentPlan {
        artifacts,
        directories: directories.into_iter().collect(),
    })
}

fn check_copy_directory_destination(library: &Library, target: &Utf8Path) -> Result<(), SError> {
    let absolute = library.game_root.join(target);
    let exists = match fs::symlink_metadata(&absolute) {
        Ok(_) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(error.into()),
    };
    if !exists {
        return Ok(());
    }

    if deployment_owns_directory(library, target)?
        || legacy_repo_link(&absolute, &library.repo_root)
    {
        return Ok(());
    }

    Err(collision(target))
}

/// Existing game directories may receive new files, but protected mod roots
/// must retain their one-folder/one-owner collision behavior.
fn should_expand_existing_directory(library: &Library, target: &Utf8Path) -> Result<bool, SError> {
    let absolute = library.game_root.join(target);
    let meta = match fs::symlink_metadata(&absolute) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    if !meta.is_dir()
        || deployment_owns_directory(library, target)?
        || legacy_repo_link(&absolute, &library.repo_root)
    {
        return Ok(false);
    }

    let protected = get_protected_paths_absolute(&library.game_root, &library.game_rules);
    Ok(!protected
        .iter()
        .any(|root| absolute == *root || absolute.starts_with(root)))
}

fn deployment_owns_directory(library: &Library, target: &Utf8Path) -> Result<bool, SError> {
    if library
        .deployment
        .created_dirs
        .iter()
        .any(|path| path == target)
    {
        return Ok(true);
    }

    for old in &library.deployment.artifacts {
        if old.target == target
            && artifact_is_recorded(library, old, &library.game_root.join(&old.target))?
        {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Validates recorded artifacts before compatibility cleanup can remove any
/// links. This catches conflicts for artifacts that are no longer desired.
pub fn preflight(library: &Library, plan: &DeploymentPlan) -> Result<(), SError> {
    plan_artifact_removals(library, plan)?;
    preflight_recorded_directories(library)
}

fn preflight_recorded_directories(library: &Library) -> Result<(), SError> {
    for path in &library.deployment.created_dirs {
        if !recorded_directory_is_contained(&library.game_root, path) {
            return Err(containment_collision(path));
        }
    }
    Ok(())
}

fn plan_artifact_removals(
    library: &Library,
    plan: &DeploymentPlan,
) -> Result<Vec<(Utf8PathBuf, ArtifactKind)>, SError> {
    let old = &library.deployment;
    let desired: HashSet<_> = plan.artifacts.iter().cloned().collect();
    let mut artifact_removals = Vec::new();

    for artifact in &old.artifacts {
        if !recorded_path_is_contained(&library.game_root, &artifact.target) {
            return Err(containment_collision(&artifact.target));
        }
        let target = library.game_root.join(&artifact.target);
        if desired.contains(artifact) && artifact_is_current(library, artifact, &target)? {
            continue;
        }
        match fs::symlink_metadata(&target) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Ok(_) if artifact_is_recorded(library, artifact, &target)? => {
                artifact_removals.push((target, artifact.kind));
            }
            Ok(_) => return Err(collision(&artifact.target)),
            Err(error) => return Err(error.into()),
        }
    }
    Ok(artifact_removals)
}

/// Reconciles recorded artifacts, then creates only absent destinations.
pub fn deploy(library: &mut Library, plan: DeploymentPlan) -> Result<(), SError> {
    let old = library.deployment.clone();
    preflight_recorded_directories(library)?;
    let artifact_removals = plan_artifact_removals(library, &plan)?;
    for (target, kind) in artifact_removals {
        linker::remove(&target, kind)?;
    }

    let protected = get_protected_paths_absolute(&library.game_root, &library.game_rules);
    let desired_dirs: HashSet<_> = plan.directories.iter().cloned().collect();
    let mut old_dirs = old.created_dirs.clone();
    old_dirs.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    for path in &old_dirs {
        if !recorded_directory_is_contained(&library.game_root, path) {
            return Err(containment_collision(path));
        }
        if desired_dirs.contains(path)
            || protected
                .iter()
                .any(|root| root == &library.game_root.join(path))
        {
            continue;
        }
        let absolute = library.game_root.join(path);
        if let Ok(meta) = fs::symlink_metadata(&absolute)
            && meta.is_dir()
            && fs::read_dir(&absolute)?.next().is_none()
        {
            fs::remove_dir(&absolute)?;
        }
    }

    // Preserve ownership records for directories that already exist. Without
    // this, a second sync forgets directories created by the first sync and a
    // later copy deployment treats them as user-owned collisions.
    let mut created_dirs: Vec<_> = old
        .created_dirs
        .iter()
        .filter(|path| desired_dirs.contains(*path))
        .cloned()
        .collect();
    for directory in &plan.directories {
        ensure_directory(
            &library.game_root.join(directory),
            &library.game_root,
            &protected,
            &mut created_dirs,
        )?;
    }

    let mut new_artifacts = Vec::new();
    for artifact in &plan.artifacts {
        let target = library.game_root.join(&artifact.target);
        if let Some(previous) = old
            .artifacts
            .iter()
            .find(|old| old.target == artifact.target)
            && previous == artifact
            && artifact_is_current(library, previous, &target)?
        {
            new_artifacts.push(artifact.clone());
            continue;
        }
        match fs::symlink_metadata(&target) {
            Ok(_) => return Err(collision(&artifact.target)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let source = library.repo_root.join(&artifact.source);
        linker::create(&source, &target, artifact.kind)?;
        new_artifacts.push(artifact.clone());
    }

    new_artifacts.sort_by(|a, b| a.target.cmp(&b.target));
    created_dirs.sort();
    library.deployment = DeploymentState {
        artifacts: new_artifacts,
        created_dirs,
    };
    Ok(())
}

fn check_destinations(library: &Library, artifacts: &[DeploymentArtifact]) -> Result<(), SError> {
    for artifact in artifacts {
        let target = library.game_root.join(&artifact.target);
        let exists = match fs::symlink_metadata(&target) {
            Ok(_) => true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => return Err(error.into()),
        };
        if !exists {
            continue;
        }
        let owned_prior = library.deployment.artifacts.iter().any(|old| {
            (old.target == artifact.target || artifact.target.starts_with(&old.target))
                && artifact_is_recorded(library, old, &library.game_root.join(&old.target))
                    .unwrap_or(false)
        });
        if owned_prior || legacy_repo_link(&target, &library.repo_root) {
            continue;
        }
        return Err(collision(&artifact.target));
    }
    Ok(())
}

fn collision(path: &Utf8Path) -> SError {
    SError::FileCollision(vec![format!("Deployment target already exists: '{path}'.")])
}

fn containment_collision(path: &Utf8Path) -> SError {
    SError::FileCollision(vec![format!(
        "Deployment target cannot be safely removed because its path is redirected or outside the game root: '{path}'."
    )])
}

fn legacy_repo_link(path: &Utf8Path, repo_root: &Utf8Path) -> bool {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return false;
    };
    if !meta.file_type().is_symlink() {
        return false;
    }
    let Ok(target) = linker::read_link_target(path) else {
        return false;
    };
    dunce::canonicalize(target.as_std_path())
        .map(|target| target.starts_with(repo_root.as_std_path()))
        .unwrap_or(false)
}

pub(crate) fn artifact_is_recorded(
    library: &Library,
    artifact: &DeploymentArtifact,
    target: &Utf8Path,
) -> Result<bool, SError> {
    let expected_target = library.game_root.join(&artifact.target);
    if target != expected_target
        || !recorded_path_is_contained(&library.game_root, &artifact.target)
    {
        return Ok(false);
    }

    let Some(source) = recorded_source_path(library, &artifact.source) else {
        return Ok(false);
    };
    let meta = match fs::symlink_metadata(target) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    if matches!(
        artifact.kind,
        ArtifactKind::Symlink | ArtifactKind::Junction
    ) {
        return Ok(link_target_matches(&source, target));
    }
    if !meta.is_file() {
        return Ok(false);
    }

    match artifact.kind {
        ArtifactKind::Hardlink => Ok(same_file::is_same_file(
            source.as_std_path(),
            target.as_std_path(),
        )
        .unwrap_or(false)),
        ArtifactKind::Copy => {
            let Some(expected) = artifact.fingerprint.as_deref() else {
                return Ok(false);
            };
            Ok(file_fingerprint(target)? == expected)
        }
        ArtifactKind::Symlink | ArtifactKind::Junction => unreachable!(),
    }
}

/// Verifies that a recorded artifact still represents the current library
/// source. This is sufficient for ordinary reconciliation, where a changed
/// source should replace the old deployment but a user-edited destination must
/// be preserved as a collision.
fn artifact_is_current(
    library: &Library,
    artifact: &DeploymentArtifact,
    target: &Utf8Path,
) -> Result<bool, SError> {
    if !artifact_is_recorded(library, artifact, target)? {
        return Ok(false);
    }

    let Some(source) = contained_source_path(library, &artifact.source) else {
        return Ok(false);
    };
    match artifact.kind {
        ArtifactKind::Symlink | ArtifactKind::Junction => Ok(true),
        ArtifactKind::Hardlink | ArtifactKind::Copy => Ok(file_contents_match(&source, target)?),
    }
}

pub(crate) fn artifact_is_owned(
    library: &Library,
    artifact: &DeploymentArtifact,
    target: &Utf8Path,
) -> Result<bool, SError> {
    if !artifact_is_recorded(library, artifact, target)? {
        return Ok(false);
    }

    let Some(source) = contained_source_path(library, &artifact.source) else {
        return Ok(false);
    };
    if matches!(
        artifact.kind,
        ArtifactKind::Symlink | ArtifactKind::Junction
    ) {
        return Ok(true);
    }

    match artifact.kind {
        ArtifactKind::Hardlink => Ok(same_file::is_same_file(
            source.as_std_path(),
            target.as_std_path(),
        )?),
        // A regular copy has no stable origin identity. Matching bytes are not
        // enough to distinguish it from a replacement made by the new game
        // installation, so cross-major destructive cleanup refuses it.
        ArtifactKind::Copy => Ok(false),
        ArtifactKind::Symlink | ArtifactKind::Junction => unreachable!(),
    }
}

fn recorded_source_path(library: &Library, source: &Utf8Path) -> Option<Utf8PathBuf> {
    recorded_source_path_for(&library.repo_root, source)
}

fn recorded_source_path_for(repo_root: &Utf8Path, source: &Utf8Path) -> Option<Utf8PathBuf> {
    if !is_safe_relative_path(source) {
        return None;
    }

    let repo_canonical = dunce::canonicalize(repo_root.as_std_path()).ok()?;
    let source_path = repo_root.join(source);
    let source_parent = source_path.parent().unwrap_or(repo_root);
    let source_parent_canonical = canonicalize_nearest_existing(source_parent)?;
    source_parent_canonical
        .starts_with(repo_canonical)
        .then_some(source_path)
}

fn contained_source_path(library: &Library, source: &Utf8Path) -> Option<Utf8PathBuf> {
    let source_path = recorded_source_path(library, source)?;
    let repo_canonical = dunce::canonicalize(library.repo_root.as_std_path()).ok()?;
    let source_canonical = dunce::canonicalize(source_path.as_std_path()).ok()?;
    source_canonical
        .starts_with(repo_canonical)
        .then_some(source_path)
}

fn link_target_matches(source: &Utf8Path, target: &Utf8Path) -> bool {
    let Ok(actual) = linker::read_link_target(target) else {
        return false;
    };
    let actual = if actual.is_absolute() {
        actual
    } else {
        target.parent().unwrap_or(Utf8Path::new(".")).join(actual)
    };
    if actual == source {
        return true;
    }
    dunce::canonicalize(actual.as_std_path())
        .and_then(|actual| {
            dunce::canonicalize(source.as_std_path()).map(|expected| actual == expected)
        })
        .unwrap_or(false)
}

fn file_fingerprint(path: &Utf8Path) -> io::Result<String> {
    let mut file = fs::File::open(path)?;
    Ok(blake3::Hasher::new()
        .update_reader(&mut file)?
        .finalize()
        .to_hex()
        .to_string())
}

fn file_contents_match(left: &Utf8Path, right: &Utf8Path) -> io::Result<bool> {
    let left_meta = fs::metadata(left)?;
    let right_meta = fs::metadata(right)?;
    if !left_meta.is_file() || !right_meta.is_file() || left_meta.len() != right_meta.len() {
        return Ok(false);
    }

    let mut left_file = fs::File::open(left)?;
    let mut right_file = fs::File::open(right)?;
    let mut left_buffer = [0_u8; 64 * 1024];
    let mut right_buffer = [0_u8; 64 * 1024];

    loop {
        let left_read = left_file.read(&mut left_buffer)?;
        let right_read = right_file.read(&mut right_buffer)?;
        if left_read != right_read {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
        if left_buffer[..left_read] != right_buffer[..right_read] {
            return Ok(false);
        }
    }
}

fn ensure_directory(
    path: &Utf8Path,
    game_root: &Utf8Path,
    protected: &[Utf8PathBuf],
    created: &mut Vec<Utf8PathBuf>,
) -> Result<(), SError> {
    let mut missing = Vec::new();
    let mut current = path.to_path_buf();
    while match fs::symlink_metadata(&current) {
        Ok(_) => false,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(error) => return Err(error.into()),
    } {
        missing.push(current.clone());
        current = current
            .parent()
            .ok_or_else(|| SError::IOError(format!("No parent directory for {path}")))?
            .to_path_buf();
    }
    if !fs::symlink_metadata(&current)?.is_dir() {
        return Err(collision(path));
    }
    for directory in missing.into_iter().rev() {
        fs::create_dir(&directory)?;
        if !protected.iter().any(|root| root == &directory) {
            let relative = directory
                .strip_prefix(game_root)
                .map_err(|_| SError::Unexpected)?;
            created.push(relative.to_path_buf());
        }
    }
    Ok(())
}

fn add_parent_dirs(directories: &mut BTreeSet<Utf8PathBuf>, path: &Utf8Path) {
    let mut parent = path.parent();
    while let Some(directory) = parent {
        if directory.as_str().is_empty() || directory == "." {
            break;
        }
        directories.insert(directory.to_path_buf());
        parent = directory.parent();
    }
}

fn check_file_collisions(mods: &BTreeMap<String, Mod>, cache: &LibraryCache) -> Result<(), SError> {
    let mut owners = HashMap::new();
    let mut collisions = BTreeSet::new();
    for (path, current_id) in iter_active_files(mods, cache) {
        let Some(existing_owner) = owners.insert(path.to_owned(), current_id.to_string()) else {
            continue;
        };
        if existing_owner != current_id {
            collisions.insert(format!(
                "File Conflict: '{path}' is provided by both '{existing_owner}' and '{current_id}'."
            ));
        }
    }
    if collisions.is_empty() {
        Ok(())
    } else {
        Err(SError::FileCollision(collisions.into_iter().collect()))
    }
}

fn build_folder_ownership_map(
    spt_rules: &SPTPathRules,
    mods: &BTreeMap<String, Mod>,
    cache: &LibraryCache,
) -> OwnershipMap {
    let mut ownership: OwnershipMap = get_protected_paths(spt_rules)
        .iter()
        .flat_map(|path| path.ancestors())
        .filter(|path| !path.as_str().is_empty() && *path != ".")
        .map(|path| (path.to_path_buf(), vec!["__SYSTEM__".to_string()]))
        .collect();
    iter_active_files_and_ancestors(mods, cache).for_each(|(path, id)| {
        let owners = ownership.entry(path.to_path_buf()).or_default();
        if !owners.contains(&id.to_string()) {
            owners.push(id.to_string());
        }
    });
    ownership
}

fn iter_active_files<'a>(
    mods: &'a BTreeMap<String, Mod>,
    cache: &'a LibraryCache,
) -> impl Iterator<Item = (&'a Utf8Path, &'a str)> {
    cache
        .mods
        .iter()
        .filter(move |(id, _)| mods.get(*id).is_some_and(|m| m.is_active))
        .flat_map(|(id, fs)| {
            fs.files
                .iter()
                .map(move |file| (file.as_path(), id.as_str()))
        })
}

fn iter_active_files_and_ancestors<'a>(
    mods: &'a BTreeMap<String, Mod>,
    cache: &'a LibraryCache,
) -> impl Iterator<Item = (&'a Utf8Path, &'a str)> {
    cache
        .mods
        .iter()
        .filter(move |(id, _)| mods.get(*id).is_some_and(|m| m.is_active))
        .flat_map(|(id, fs)| {
            fs.files.iter().flat_map(move |file| {
                file.ancestors()
                    .filter(|path| !path.as_str().is_empty() && *path != ".")
                    .map(move |path| (path, id.as_str()))
            })
        })
}

/// Returns recorded artifact targets belonging to one mod and recorded directories.
pub fn find_mod_links(
    library: &Library,
    mod_id: &str,
) -> Result<(HashSet<Utf8PathBuf>, HashSet<Utf8PathBuf>), SError> {
    if !library.cache.mods.contains_key(mod_id) {
        return Err(SError::ModNotFound(mod_id.to_string()));
    }
    let prefix = library
        .lib_paths
        .mods
        .strip_prefix(&library.repo_root)
        .unwrap_or(&library.lib_paths.mods)
        .join(mod_id);
    let artifacts = library
        .deployment
        .artifacts
        .iter()
        .filter(|artifact| artifact.source.starts_with(&prefix))
        .map(|artifact| library.game_root.join(&artifact.target))
        .collect();
    let dirs = library
        .deployment
        .created_dirs
        .iter()
        .map(|path| library.game_root.join(path))
        .collect();
    Ok((artifacts, dirs))
}

pub fn recorded_artifact<'a>(
    library: &'a Library,
    target: &Utf8Path,
) -> Option<&'a DeploymentArtifact> {
    let relative = target.strip_prefix(&library.game_root).ok()?;
    library
        .deployment
        .artifacts
        .iter()
        .find(|artifact| artifact.target == relative)
}
