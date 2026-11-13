use camino::{Utf8Path, Utf8PathBuf};
use std::fs;
use std::io;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactKind {
    Symlink,
    Junction,
    Hardlink,
    Copy,
}

/// Reads a symlink or junction target without following it.
pub fn read_link_target(path: &Utf8Path) -> io::Result<Utf8PathBuf> {
    Ok(Utf8PathBuf::from(
        fs::read_link(path)?.to_string_lossy().into_owned(),
    ))
}

/// Creates one deployment artifact. The destination must not already exist.
pub fn create(source: &Utf8Path, target: &Utf8Path, kind: ArtifactKind) -> io::Result<()> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }

    match kind {
        ArtifactKind::Symlink => {
            #[cfg(windows)]
            if source.is_dir() {
                std::os::windows::fs::symlink_dir(source, target)?;
            } else {
                std::os::windows::fs::symlink_file(source, target)?;
            }
            #[cfg(unix)]
            std::os::unix::fs::symlink(source, target)?;
        }
        ArtifactKind::Junction => {
            #[cfg(windows)]
            junction::create(source, target)?;
            #[cfg(not(windows))]
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "junctions are only supported on Windows",
            ));
        }
        ArtifactKind::Hardlink => fs::hard_link(source, target)?,
        ArtifactKind::Copy => {
            if source.is_dir() {
                fs::create_dir(target)?;
            } else {
                fs::copy(source, target).map(|_| ())?;
            }
        }
    }

    Ok(())
}

/// Removes one recorded deployment artifact without following directories.
pub fn remove(target: &Utf8Path, kind: ArtifactKind) -> io::Result<()> {
    match kind {
        ArtifactKind::Junction => {
            #[cfg(windows)]
            return fs::remove_dir(target);
            #[cfg(not(windows))]
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "junctions are only supported on Windows",
            ));
        }
        ArtifactKind::Symlink => {
            #[cfg(windows)]
            return fs::remove_dir(target).or_else(|_| fs::remove_file(target));
            #[cfg(unix)]
            return fs::remove_file(target);
        }
        ArtifactKind::Hardlink | ArtifactKind::Copy => {
            if fs::symlink_metadata(target)?.is_dir() {
                fs::remove_dir_all(target)
            } else {
                fs::remove_file(target)
            }
        }
    }
}

/// Creates a symlink for the legacy linker API and its tests.
pub fn link(source: &Utf8Path, target: &Utf8Path) -> io::Result<()> {
    if target.exists() || target.is_symlink() {
        if let Ok(existing) = read_link_target(target)
            && existing == source
        {
            return Ok(());
        }
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!("Target exists and is not linked to source: {target}"),
        ));
    }
    create(source, target, ArtifactKind::Symlink)
}

/// Removes a legacy symlink, junction, file, or empty directory.
pub fn unlink(target: &Utf8Path) -> io::Result<()> {
    let meta = match fs::symlink_metadata(target) {
        Ok(meta) => meta,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };

    if meta.file_type().is_symlink() {
        #[cfg(windows)]
        return fs::remove_dir(target).or_else(|_| fs::remove_file(target));
        #[cfg(unix)]
        return fs::remove_file(target);
    }
    if meta.is_dir() {
        fs::remove_dir(target)
    } else {
        fs::remove_file(target)
    }
}

/// Identifies a legacy reparse link so cleanup can restore it without changing
/// a Windows junction into a symbolic link during a removal preflight.
pub(crate) fn link_kind(path: &Utf8Path) -> io::Result<ArtifactKind> {
    #[cfg(windows)]
    if junction::exists(path.as_std_path())? {
        return Ok(ArtifactKind::Junction);
    }
    #[cfg(not(windows))]
    let _ = path;

    Ok(ArtifactKind::Symlink)
}

/// Recreates a legacy link from the target string returned by `read_link`.
/// Relative targets must remain relative to the destination rather than the
/// process working directory.
pub(crate) fn recreate_link(
    target: &Utf8Path,
    destination: &Utf8Path,
    kind: ArtifactKind,
) -> io::Result<()> {
    match kind {
        ArtifactKind::Symlink => recreate_symlink(target, destination),
        ArtifactKind::Junction => {
            #[cfg(windows)]
            {
                let resolved = resolve_link_target(target, destination)?;
                junction::create(resolved.as_std_path(), destination.as_std_path())
            }
            #[cfg(not(windows))]
            {
                Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    "junctions are only supported on Windows",
                ))
            }
        }
        ArtifactKind::Hardlink | ArtifactKind::Copy => Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "only symbolic links and junctions can be recreated",
        )),
    }
}

fn recreate_symlink(target: &Utf8Path, destination: &Utf8Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target.as_std_path(), destination.as_std_path())
    }
    #[cfg(windows)]
    {
        let resolved = resolve_link_target(target, destination)?;
        if resolved.is_dir() {
            std::os::windows::fs::symlink_dir(target.as_std_path(), destination.as_std_path())
        } else {
            std::os::windows::fs::symlink_file(target.as_std_path(), destination.as_std_path())
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "symbolic links are not supported on this platform",
        ))
    }
}

#[cfg(windows)]
fn resolve_link_target(target: &Utf8Path, destination: &Utf8Path) -> io::Result<Utf8PathBuf> {
    if target.is_absolute() {
        return Ok(target.to_path_buf());
    }
    destination
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "link has no parent"))
        .map(|parent| parent.join(target))
}

#[derive(Clone, Copy)]
pub struct MethodSelection {
    pub file: ArtifactKind,
    pub directory: ArtifactKind,
}

/// Probes methods on both relevant volumes before touching the real tree.
pub fn preflight(repo_root: &Utf8Path, game_root: &Utf8Path) -> io::Result<MethodSelection> {
    let probe = uuid::Uuid::new_v4();
    let source_root = repo_root.join(format!(".deployment-probe-{probe}"));
    let target_root = game_root.join(format!(".deployment-probe-{probe}"));
    fs::create_dir_all(&source_root)?;
    fs::create_dir_all(&target_root)?;
    let source_file = source_root.join("file");
    let source_dir = source_root.join("directory");
    fs::write(&source_file, b"probe")?;
    fs::create_dir(&source_dir)?;

    let result = (|| {
        // Prefer copies so deployments remain usable when the library moves
        // between mounts; links remain a capability fallback.
        let file = probe_kind(
            &source_file,
            &target_root.join("file"),
            [
                ArtifactKind::Copy,
                ArtifactKind::Symlink,
                ArtifactKind::Hardlink,
            ],
        )?;
        let directory = probe_kind(
            &source_dir,
            &target_root.join("directory"),
            [
                ArtifactKind::Copy,
                ArtifactKind::Symlink,
                ArtifactKind::Junction,
            ],
        )?;
        Ok(MethodSelection { file, directory })
    })();

    let _ = fs::remove_dir_all(&source_root);
    let _ = fs::remove_dir_all(&target_root);
    result
}

fn probe_kind(
    source: &Utf8Path,
    target: &Utf8Path,
    kinds: [ArtifactKind; 3],
) -> io::Result<ArtifactKind> {
    let mut last_error = None;
    for kind in kinds {
        match create(source, target, kind) {
            Ok(()) => {
                let _ = remove(target, kind);
                return Ok(kind);
            }
            Err(error) if is_capability_error(&error) => last_error = Some(error),
            Err(error) => return Err(error),
        }
    }
    Err(last_error.unwrap_or_else(|| io::Error::other("no deployment method available")))
}

fn is_capability_error(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::PermissionDenied
            | io::ErrorKind::Unsupported
            | io::ErrorKind::InvalidInput
            | io::ErrorKind::CrossesDevices
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preflight_prefers_copy_when_available() {
        let repo = tempfile::tempdir().unwrap();
        let game = tempfile::tempdir().unwrap();
        let repo_root = Utf8Path::from_path(repo.path()).unwrap();
        let game_root = Utf8Path::from_path(game.path()).unwrap();

        let methods = preflight(repo_root, game_root).unwrap();

        assert_eq!(methods.file, ArtifactKind::Copy);
        assert_eq!(methods.directory, ArtifactKind::Copy);
    }
}
