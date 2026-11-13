use crate::core::cleanup;
use crate::models::error::SError;
use crate::store::AppConfigStore;
use camino::{Utf8Path, Utf8PathBuf};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use uuid::Uuid;

pub(super) const DELETE_RECOVERY_VERSION: u8 = 1;
pub(super) const DELETE_JOURNAL_PREFIX: &str = ".modkeeper-delete-";
pub(super) const DELETE_JOURNAL_SUFFIX: &str = ".toml";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum DeletePhase {
    Staged,
    Committed,
}

#[derive(Debug, Deserialize, Serialize)]
pub(super) struct DeleteRecovery {
    pub(super) version: u8,
    pub(super) token: String,
    pub(super) library_id: String,
    pub(super) repo_root: Utf8PathBuf,
    pub(super) phase: DeletePhase,
    pub(super) entries: Vec<DeleteRecoveryEntry>,
}

#[derive(Debug, Deserialize, Serialize)]
pub(super) struct DeleteRecoveryEntry {
    pub(super) original: Utf8PathBuf,
    pub(super) quarantine: Option<Utf8PathBuf>,
}

pub(super) fn recover_pending_deletions(store: &AppConfigStore) -> Result<(), SError> {
    cleanup::with_exclusive(|| recover_pending_deletions_unlocked(store))
}

fn recover_pending_deletions_unlocked(store: &AppConfigStore) -> Result<(), SError> {
    let Some(directory) = store.path.parent() else {
        return Ok(());
    };
    let entries = match fs::read_dir(directory.as_std_path()) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let mut failures = Vec::new();
    for entry in entries {
        let entry = entry?;
        let path = Utf8PathBuf::from_path_buf(entry.path()).map_err(|path| {
            SError::ParseError(format!(
                "Non-UTF-8 deletion journal path: {}",
                path.display()
            ))
        })?;
        if !is_deletion_journal(&path) {
            continue;
        }
        let meta = match fs::symlink_metadata(path.as_std_path()) {
            Ok(meta) => meta,
            Err(error) => {
                failures.push(format!("'{}': {error}", path));
                continue;
            }
        };
        if meta.file_type().is_symlink() || !meta.is_file() {
            failures.push(format!("'{}' is not a regular deletion journal", path));
            continue;
        }
        let recovery = match read_journal(&path) {
            Ok(recovery) => recovery,
            Err(error) => {
                failures.push(format!("'{}': {error}", path));
                continue;
            }
        };
        if !store.path.exists() {
            failures.push(format!(
                "'{}': app config '{}' is missing, so deletion state is ambiguous",
                path, store.path
            ));
            continue;
        }
        let registered = match store.config.find_library(&recovery.library_id) {
            Some(known) if known.library_root == recovery.repo_root => true,
            Some(known) => {
                failures.push(format!(
                    "'{}' conflicts with registered library root '{}'",
                    path, known.library_root
                ));
                continue;
            }
            None => {
                if let Some(known) = store
                    .config
                    .known_libraries
                    .iter()
                    .find(|known| known.library_root == recovery.repo_root)
                {
                    failures.push(format!(
                        "'{}' conflicts with a different library '{}' registered at the same root",
                        path, known.id
                    ));
                    continue;
                }
                false
            }
        };

        let result = if registered {
            if recovery.phase == DeletePhase::Committed {
                Err(pending_error(
                    &path,
                    "journal is committed but the library remains registered",
                ))
            } else {
                restore_entries(&recovery.entries).and_then(|()| remove_journal(&path))
            }
        } else {
            finish_recovery(&path, &recovery)
        };
        if let Err(error) = result {
            failures.push(error.to_string());
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(SError::IOError(failures.join("; ")))
    }
}

pub(super) fn write_new_journal(path: &Utf8Path, recovery: &DeleteRecovery) -> Result<(), SError> {
    let result = (|| {
        let content = serialize_journal(recovery)?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path.as_std_path())?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        drop(file);
        sync_directory(path.parent().ok_or(SError::Unexpected)?)?;
        Ok::<(), SError>(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(path.as_std_path());
        return Err(error);
    }
    Ok(())
}

pub(super) fn write_journal(path: &Utf8Path, recovery: &DeleteRecovery) -> Result<(), SError> {
    let parent = path.parent().ok_or(SError::Unexpected)?;
    let temp = parent.join(format!(
        ".{}.tmp-{}",
        path.file_name().unwrap_or("journal"),
        Uuid::new_v4()
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(temp.as_std_path())?;
        file.write_all(serialize_journal(recovery)?.as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::rename(temp.as_std_path(), path.as_std_path())?;
        sync_directory(parent)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp.as_std_path());
    }
    result
}

fn serialize_journal(recovery: &DeleteRecovery) -> Result<String, SError> {
    ::toml::to_string(recovery).map_err(|error| SError::ParseError(error.to_string()))
}

fn read_journal(path: &Utf8Path) -> Result<DeleteRecovery, SError> {
    let content = fs::read_to_string(path.as_std_path())?;
    let recovery = ::toml::from_str::<DeleteRecovery>(&content)
        .map_err(|error| SError::ParseError(error.to_string()))?;
    if recovery.version != DELETE_RECOVERY_VERSION
        || recovery.token.is_empty()
        || recovery.entries.is_empty()
    {
        return Err(SError::ParseError(format!(
            "unsupported or incomplete deletion journal '{path}'"
        )));
    }
    Ok(recovery)
}

pub(super) fn restore_entries(entries: &[DeleteRecoveryEntry]) -> Result<(), SError> {
    let mut failures = Vec::new();
    for entry in entries.iter().rev() {
        let original = fs::symlink_metadata(entry.original.as_std_path());
        let Some(quarantine) = &entry.quarantine else {
            continue;
        };
        let staged = fs::symlink_metadata(quarantine.as_std_path());
        match (original, staged) {
            (Ok(_), Ok(_)) => failures.push(format!(
                "both original '{}' and quarantine '{}' exist",
                entry.original, quarantine
            )),
            (Ok(_), Err(error)) if error.kind() == std::io::ErrorKind::NotFound => {}
            (Err(error), Ok(_)) if error.kind() == std::io::ErrorKind::NotFound => {
                if let Err(rename_error) =
                    fs::rename(quarantine.as_std_path(), entry.original.as_std_path())
                {
                    failures.push(format!("'{}': {rename_error}", entry.original));
                }
            }
            (Err(error), Ok(_)) => failures.push(format!("'{}': {error}", entry.original)),
            (Err(error), Err(staged_error)) => failures.push(format!(
                "'{}': {error}; quarantine '{}': {staged_error}",
                entry.original, quarantine
            )),
            (Ok(_), Err(error)) => failures.push(format!("'{}': {error}", quarantine)),
        }
    }
    if let Err(error) = sync_entry_directories(entries) {
        failures.push(error.to_string());
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(SError::IOError(failures.join("; ")))
    }
}

fn finish_recovery(path: &Utf8Path, recovery: &DeleteRecovery) -> Result<(), SError> {
    let mut failures = Vec::new();
    for entry in &recovery.entries {
        let result = match &entry.quarantine {
            Some(quarantine) => remove_staged_object(quarantine),
            None => remove_empty_directory(&entry.original),
        };
        if let Err(error) = result {
            failures.push(format!("'{}': {error}", entry.original));
        }
    }
    if !failures.is_empty() {
        return Err(pending_error(path, failures.join(", ")));
    }
    remove_journal(path)
}

pub(super) fn remove_staged_object(path: &Utf8Path) -> Result<(), SError> {
    let removed = match fs::symlink_metadata(path.as_std_path()) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => {
            fs::remove_dir_all(path.as_std_path())?;
            true
        }
        Ok(_) => {
            fs::remove_file(path.as_std_path())?;
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(error.into()),
    };
    if removed && let Some(parent) = path.parent() {
        sync_directory(parent)?;
    }
    Ok(())
}

pub(super) fn remove_empty_directory(path: &Utf8Path) -> Result<(), SError> {
    let meta = match fs::symlink_metadata(path.as_std_path()) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err(SError::IOError(format!(
            "'{}' is not a real directory",
            path
        )));
    }
    if fs::read_dir(path.as_std_path())?.next().is_none() {
        fs::remove_dir(path.as_std_path())?;
        if let Some(parent) = path.parent() {
            sync_directory(parent)?;
        }
    }
    Ok(())
}

pub(super) fn remove_journal(path: &Utf8Path) -> Result<(), SError> {
    match fs::remove_file(path.as_std_path()) {
        Ok(()) => sync_directory(path.parent().ok_or(SError::Unexpected)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

pub(super) fn sync_entry_directories(entries: &[DeleteRecoveryEntry]) -> Result<(), SError> {
    let mut directories = BTreeSet::new();
    for entry in entries {
        if let Some(parent) = entry.original.parent() {
            directories.insert(parent.to_path_buf());
        }
        if let Some(quarantine) = &entry.quarantine
            && let Some(parent) = quarantine.parent()
        {
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

fn is_deletion_journal(path: &Utf8Path) -> bool {
    path.file_name().is_some_and(|name| {
        name.starts_with(DELETE_JOURNAL_PREFIX) && name.ends_with(DELETE_JOURNAL_SUFFIX)
    })
}

pub(super) fn pending_error(path: &Utf8Path, detail: impl Into<String>) -> SError {
    SError::IOError(format!(
        "Library deletion cleanup is pending at '{path}': {}",
        detail.into()
    ))
}

#[cfg(test)]
#[path = "recovery_tests.rs"]
mod tests;
