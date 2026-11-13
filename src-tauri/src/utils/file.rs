use crate::models::error::SError;
use camino::Utf8Path;
use std::io::Write;
use walkdir::WalkDir;

pub fn create_dir_all(path: &Utf8Path) -> Result<(), SError> {
    std::fs::create_dir_all(path).map_err(Into::into)
}

pub fn remove_dir(path: &Utf8Path) -> Result<(), SError> {
    std::fs::remove_dir(path).map_err(Into::into)
}

pub fn remove_dir_all(path: &Utf8Path) -> Result<(), SError> {
    std::fs::remove_dir_all(path).map_err(Into::into)
}

pub fn rename(from: &Utf8Path, to: &Utf8Path) -> Result<(), SError> {
    std::fs::rename(from, to).map_err(Into::into)
}

pub fn copy(from: &Utf8Path, to: &Utf8Path) -> Result<(), SError> {
    std::fs::copy(from, to).map(|_| ()).map_err(Into::into)
}

pub fn write(path: &Utf8Path, contents: impl AsRef<[u8]>) -> Result<(), SError> {
    std::fs::write(path, contents).map_err(Into::into)
}

pub fn read_to_string(path: &Utf8Path) -> Result<String, SError> {
    std::fs::read_to_string(path).map_err(Into::into)
}

pub fn read_dir(path: &Utf8Path) -> Result<std::fs::ReadDir, SError> {
    std::fs::read_dir(path).map_err(Into::into)
}

/// Writes via a temp file so the target is never observable half-written.
pub fn atomic_write(path: &Utf8Path, contents: impl AsRef<[u8]>) -> Result<(), SError> {
    let parent = path
        .parent()
        .ok_or_else(|| SError::IOError(format!("No parent directory for {path}")))?;
    create_dir_all(parent)?;

    let file_name = path.file_name().unwrap_or("file");
    let tmp = parent.join(format!("{}.tmp-{}", file_name, std::process::id()));

    let result = (|| {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(contents.as_ref())?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&tmp, path)?;
        sync_directory(parent)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

fn sync_directory(path: &Utf8Path) -> Result<(), SError> {
    #[cfg(unix)]
    {
        std::fs::File::open(path.as_std_path())?.sync_all()?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

pub fn is_dir_empty(path: &Utf8Path) -> bool {
    std::fs::read_dir(path)
        .map(|mut i| i.next().is_none())
        .unwrap_or(false)
}

pub fn copy_recursive(src: &Utf8Path, dst: &Utf8Path) -> Result<(), SError> {
    std::fs::create_dir_all(dst)?;

    for entry in WalkDir::new(src) {
        let entry = entry.map_err(|e| SError::IOError(e.to_string()))?;
        let src_path = Utf8Path::from_path(entry.path())
            .ok_or_else(|| SError::ParseError(format!("Invalid UTF-8 path: {:?}", entry.path())))?;
        let dst_path = dst.join(src_path.strip_prefix(src)?);

        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&dst_path)?;
            continue;
        }

        if let Some(parent) = dst_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(src_path, &dst_path)?;
    }

    Ok(())
}
