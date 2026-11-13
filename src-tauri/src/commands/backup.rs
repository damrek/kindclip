use std::path::Path;

use super::CommandError;

/// Every SQLite database starts with this 16-byte header.
const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";

/// Check that `path` is a regular file with the SQLite header and return its
/// size. Rejecting the file before plugin-sql loads it keeps a wrong path from
/// being silently created as an empty database.
pub(crate) fn read_sqlite_magic(path: &Path) -> Result<u64, String> {
    use std::io::Read;

    let metadata = std::fs::metadata(path)
        .map_err(|err| format!("cannot read file '{}': {err}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("'{}' is not a file", path.display()));
    }
    let mut file = std::fs::File::open(path)
        .map_err(|err| format!("cannot read file '{}': {err}", path.display()))?;
    let mut header = [0u8; 16];
    if file.read_exact(&mut header).is_err() || header.as_slice() != SQLITE_MAGIC {
        return Err(format!("'{}' is not a SQLite database", path.display()));
    }
    Ok(metadata.len())
}

/// Pre-flight check for a backup the user picked in the restore dialog.
#[tauri::command]
pub fn validate_backup_file(path: String) -> Result<u64, CommandError> {
    let size = read_sqlite_magic(Path::new(&path)).map_err(|err| {
        log::warn!("backup: rejected '{path}': {err}");
        CommandError::new("invalid-backup", err)
    })?;
    log::info!("backup: validated '{path}' ({size} bytes)");
    Ok(size)
}

/// Remove the target of a new backup so `VACUUM INTO` can write it.
///
/// The native save dialog already asked the user to confirm an overwrite;
/// this only clears a regular file or accepts a path that does not exist yet.
#[tauri::command]
pub fn clear_backup_target(path: String) -> Result<(), CommandError> {
    let path = Path::new(&path);
    if path.is_dir() {
        return Err(CommandError::new(
            "backup-target",
            format!("'{}' is a directory", path.display()),
        ));
    }
    match std::fs::remove_file(path) {
        Ok(()) => {
            log::info!("backup: cleared existing target '{}'", path.display());
            Ok(())
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => {
            log::warn!("backup: cannot clear '{}': {err}", path.display());
            Err(CommandError::new(
                "backup-target",
                format!("cannot clear '{}': {err}", path.display()),
            ))
        }
    }
}
