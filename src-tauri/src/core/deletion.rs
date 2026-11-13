use crate::core::cleanup::{self, PurgeLink};
use crate::core::deployment::{self, DeploymentArtifact};
use crate::core::library::Library;
use crate::core::linker;
use crate::models::error::SError;
use camino::{Utf8Path, Utf8PathBuf};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use uuid::Uuid;

mod recovery;

use recovery::{
    DELETE_JOURNAL_PREFIX, DELETE_JOURNAL_SUFFIX, DELETE_RECOVERY_VERSION, DeletePhase,
    DeleteRecovery, DeleteRecoveryEntry,
};

struct PlannedObject {
    original: Utf8PathBuf,
    quarantine: Utf8PathBuf,
    artifact: Option<DeploymentArtifact>,
    link: Option<PurgeLink>,
}

pub(crate) struct DeletionTransaction {
    journal_path: Utf8PathBuf,
    recovery: DeleteRecovery,
}

/// Stages every owned game object and the library directory before config is
/// changed. All quarantine paths are siblings, so staging stays on the source
/// volume and preserves each original filesystem object exactly.
pub(crate) fn prepare(
    config_path: &Utf8Path,
    library: &Library,
    require_identity: bool,
) -> Result<DeletionTransaction, SError> {
    let recorded = cleanup::plan_recorded_deployment_removal(library, require_identity)?;
    let links = cleanup::plan_purge(library)?;
    let mut artifacts = BTreeMap::new();
    for (artifact, target) in &recorded.artifacts {
        ensure_outside_repository(library, target)?;
        artifacts.insert(target.clone(), artifact.clone());
    }

    let mut purge_links = BTreeMap::new();
    for link in links {
        ensure_outside_repository(library, &link.path)?;
        purge_links.insert(link.path.clone(), link);
    }

    let token = Uuid::new_v4().to_string();
    let mut paths: Vec<_> = artifacts
        .keys()
        .chain(purge_links.keys())
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    paths.sort_by_key(|path| std::cmp::Reverse(path.components().count()));

    let mut entries = Vec::new();
    let mut planned = Vec::new();
    for (index, original) in paths.into_iter().enumerate() {
        let quarantine = sibling_quarantine_path(&original, &token, index)?;
        entries.push(DeleteRecoveryEntry {
            original: original.clone(),
            quarantine: Some(quarantine.clone()),
        });
        planned.push(PlannedObject {
            artifact: artifacts.get(&original).cloned(),
            link: purge_links.get(&original).cloned(),
            original,
            quarantine,
        });
    }

    // Empty created directories are safe to remove after commit, but are not
    // staged: this preserves untracked files that may have appeared inside.
    for directory in recorded.directories {
        if !entries.iter().any(|entry| entry.original == directory) {
            entries.push(DeleteRecoveryEntry {
                original: directory,
                quarantine: None,
            });
        }
    }

    let repo_quarantine = sibling_quarantine_path(&library.repo_root, &token, entries.len())?;
    entries.push(DeleteRecoveryEntry {
        original: library.repo_root.clone(),
        quarantine: Some(repo_quarantine.clone()),
    });
    planned.push(PlannedObject {
        original: library.repo_root.clone(),
        quarantine: repo_quarantine,
        artifact: None,
        link: None,
    });

    let journal_dir = config_path
        .parent()
        .ok_or_else(|| SError::IOError(format!("No parent directory for {config_path}")))?;
    fs::create_dir_all(journal_dir.as_std_path())?;
    let journal_path = journal_dir.join(format!(
        "{DELETE_JOURNAL_PREFIX}{token}{DELETE_JOURNAL_SUFFIX}"
    ));
    let recovery = DeleteRecovery {
        version: DELETE_RECOVERY_VERSION,
        token,
        library_id: library.id.clone(),
        repo_root: library.repo_root.clone(),
        phase: DeletePhase::Staged,
        entries,
    };
    recovery::write_new_journal(&journal_path, &recovery)?;

    let transaction = DeletionTransaction {
        journal_path,
        recovery,
    };
    if let Err(error) = stage_objects(&transaction.recovery, library, require_identity, &planned) {
        let rollback = transaction.rollback();
        return Err(with_rollback_error(error, rollback));
    }
    Ok(transaction)
}

impl DeletionTransaction {
    pub(crate) fn mark_committed(&mut self) -> Result<(), SError> {
        self.recovery.phase = DeletePhase::Committed;
        recovery::write_journal(&self.journal_path, &self.recovery).map_err(|error| {
            recovery::pending_error(
                &self.journal_path,
                format!(
                    "config removal committed but the journal phase could not be updated: {error}"
                ),
            )
        })
    }

    pub(crate) fn rollback(self) -> Result<(), SError> {
        recovery::restore_entries(&self.recovery.entries)?;
        recovery::remove_journal(&self.journal_path)
    }

    pub(crate) fn finish(self) -> Result<(), SError> {
        let mut failures = Vec::new();
        for entry in &self.recovery.entries {
            let result = match &entry.quarantine {
                Some(path) => recovery::remove_staged_object(path),
                None => recovery::remove_empty_directory(&entry.original),
            };
            if let Err(error) = result {
                failures.push(format!("'{}': {error}", entry.original));
            }
        }
        if !failures.is_empty() {
            return Err(recovery::pending_error(
                &self.journal_path,
                failures.join(", "),
            ));
        }
        recovery::remove_journal(&self.journal_path)
    }
}

/// Recovers journals before the active library is opened. A still-registered
/// library means staging stopped before commit and must be restored; a removed
/// registration means config commit happened and cleanup should finish.
pub(crate) fn recover_pending_deletions(
    store: &crate::store::AppConfigStore,
) -> Result<(), SError> {
    recovery::recover_pending_deletions(store)
}

fn stage_objects(
    recovery: &DeleteRecovery,
    library: &Library,
    require_identity: bool,
    planned: &[PlannedObject],
) -> Result<(), SError> {
    for object in planned {
        if let Some(artifact) = &object.artifact {
            let owned = if require_identity {
                deployment::artifact_is_owned(library, artifact, &object.original)?
            } else {
                deployment::artifact_is_recorded(library, artifact, &object.original)?
            };
            if !owned {
                return Err(ownership_error(library, &object.original));
            }
        }
        if let Some(link) = &object.link {
            verify_purge_link(link)?;
        }
        let meta = fs::symlink_metadata(object.original.as_std_path())
            .map_err(|error| SError::IOError(format!("'{}': {error}", object.original)))?;
        if object.original == library.repo_root && (!meta.is_dir() || meta.file_type().is_symlink())
        {
            return Err(SError::InvalidLibrary(
                library.repo_root.to_string(),
                "library root is not a real directory".to_string(),
            ));
        }
        fs::rename(
            object.original.as_std_path(),
            object.quarantine.as_std_path(),
        )
        .map_err(|error| SError::IOError(format!("'{}': {error}", object.original)))?;
    }
    recovery::sync_entry_directories(&recovery.entries)
}

fn verify_purge_link(link: &PurgeLink) -> Result<(), SError> {
    let meta = fs::symlink_metadata(link.path.as_std_path())?;
    if !meta.file_type().is_symlink()
        || linker::read_link_target_native(&link.path)? != link.target
        || linker::link_kind(&link.path)? != link.kind
    {
        return Err(SError::FileCollision(vec![format!(
            "Deployment link changed before deletion: '{}'",
            link.path
        )]));
    }
    Ok(())
}

fn ensure_outside_repository(library: &Library, path: &Utf8Path) -> Result<(), SError> {
    if path == library.repo_root
        || path.starts_with(&library.repo_root)
        || library.repo_root.starts_with(path)
    {
        return Err(ownership_error(library, path));
    }
    Ok(())
}

fn sibling_quarantine_path(
    path: &Utf8Path,
    token: &str,
    index: usize,
) -> Result<Utf8PathBuf, SError> {
    let parent = path.parent().ok_or(SError::Unexpected)?;
    let candidate = parent.join(format!(".mkd-{token}-{index}"));
    if fs::symlink_metadata(candidate.as_std_path()).is_ok() {
        return Err(SError::IOError(format!(
            "deletion quarantine path already exists beside '{path}'"
        )));
    }
    Ok(candidate)
}

fn ownership_error(library: &Library, path: &Utf8Path) -> SError {
    SError::InvalidLibrary(
        library.repo_root.to_string(),
        format!(
            "Refusing to remove deployment target '{path}' because its ownership or containment cannot be verified"
        ),
    )
}

fn with_rollback_error(primary: SError, rollback: Result<(), SError>) -> SError {
    match rollback {
        Ok(()) => primary,
        Err(error) => SError::IOError(format!("{primary}; deletion rollback pending: {error}")),
    }
}
