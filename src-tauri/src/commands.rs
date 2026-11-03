//! Tauri commands: file import and export entry points (T4).

use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

/// Every SQLite database starts with this 16-byte header.
const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";

/// A parsed clippings file, ready for the frontend import orchestration.
#[derive(Debug, Serialize)]
pub struct ParsedFile {
    pub path: String,
    pub file_hash: String,
    pub clippings: Vec<clippings_parser::Clipping>,
    /// Blocks the parser discarded; zero clippings with a non-zero count is
    /// still a successful read (S2).
    pub skipped: usize,
}

/// Absolute path of the SQLite file owned by tauri-plugin-sql.
///
/// Relative `sqlite:` URLs are resolved by the plugin against the app config
/// dir, so revealing this path shows the user where their library lives.
#[tauri::command]
pub fn db_file_path(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("cannot resolve app config dir: {err}"))?;
    std::fs::create_dir_all(&dir).map_err(|err| format!("cannot create app config dir: {err}"))?;
    Ok(dir.join("kindclip.db").to_string_lossy().to_string())
}

/// Read `My Clippings.txt` from disk, hash it (S5 dedupe key) and parse it (S2).
#[tauri::command]
pub fn parse_clippings_file(path: String) -> Result<ParsedFile, String> {
    let bytes = std::fs::read(&path).map_err(|err| format!("cannot read file '{path}': {err}"))?;
    let file_hash: String = Sha256::digest(&bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let text = clippings_parser::decode_bytes(&bytes);
    let parsed = clippings_parser::parse_clippings_with_stats(&text);
    Ok(ParsedFile {
        path,
        file_hash,
        clippings: parsed.clippings,
        skipped: parsed.skipped,
    })
}

/// Reject empty export names and names containing path separators (S10).
///
/// Export names are joined onto the Downloads directory, so a name with a
/// separator could point the write outside it.
pub(crate) fn validate_file_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("file name cannot be empty".to_string());
    }
    if name.contains('/') || name.contains('\\') {
        return Err(format!("file name '{name}' cannot contain path separators"));
    }
    Ok(())
}

/// Write the exported document to disk (S4): the frontend picks the target
/// path through the native save dialog and this command persists the contents.
#[tauri::command]
pub fn write_export_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|err| format!("cannot write file '{path}': {err}"))
}

/// Default export target inside the Downloads directory (S10).
///
/// Lives in Rust so the frontend never needs filesystem path APIs; the
/// suggested name is validated before being joined.
///
/// Not unit tested: resolving `download_dir` requires a live `AppHandle`, which
/// only exists inside a running Tauri app context.
#[tauri::command]
pub fn export_default_path(
    app: tauri::AppHandle,
    suggested_file_name: String,
) -> Result<String, String> {
    use tauri::Manager;
    validate_file_name(&suggested_file_name)?;
    let dir = app
        .path()
        .download_dir()
        .map_err(|err| format!("cannot resolve download dir: {err}"))?;
    Ok(dir.join(&suggested_file_name).to_string_lossy().to_string())
}

/// Path with `suffix` appended to the full file name (`db` + `-wal`, …).
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

/// Check that `path` is a regular file with the SQLite header and return its
/// size. Rejecting the file before plugin-sql loads it keeps a wrong path from
/// being silently created as an empty database.
fn read_sqlite_magic(path: &Path) -> Result<u64, String> {
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
pub fn validate_backup_file(path: String) -> Result<u64, String> {
    read_sqlite_magic(Path::new(&path))
}

/// Remove the target of a new backup so `VACUUM INTO` can write it.
///
/// The native save dialog already asked the user to confirm an overwrite;
/// this only clears a regular file or accepts a path that does not exist yet.
#[tauri::command]
pub fn clear_backup_target(path: String) -> Result<(), String> {
    let path = Path::new(&path);
    if path.is_dir() {
        return Err(format!("'{}' is a directory", path.display()));
    }
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("cannot clear '{}': {err}", path.display())),
    }
}

/// Whether two paths point at the same file on disk.
fn same_path(left: &Path, right: &Path) -> bool {
    match (std::fs::canonicalize(left), std::fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

/// Replace the live database with a backup, keeping the previous file as
/// `<database>.before-restore`. Sidecars from the replaced database are
/// removed so a stale journal can never roll back into the restored file.
///
/// The chosen backup is staged next to the database first. Without that step,
/// restoring `<database>.before-restore` — which the UI offers as a snapshot —
/// would overwrite the source with the safety copy of the current database
/// before it is read.
pub(crate) fn restore_database_at(backup_path: &Path, db_path: &Path) -> Result<PathBuf, String> {
    read_sqlite_magic(backup_path)?;

    if same_path(backup_path, db_path) {
        return Err(format!(
            "'{}' is the live database; choose a separate backup file",
            backup_path.display()
        ));
    }

    let safety_path = with_suffix(db_path, ".before-restore");
    let staged_path = with_suffix(db_path, ".restore-source");
    // An interrupted restore can leave the staged copy behind and the user may
    // then pick it as the backup; copying a file onto itself would truncate it.
    let staged_is_backup = same_path(&staged_path, backup_path);

    if !staged_is_backup {
        std::fs::copy(backup_path, &staged_path)
            .map_err(|err| format!("cannot stage the backup '{}': {err}", backup_path.display()))?;
    }

    let restored = replace_database_with(&staged_path, db_path, &safety_path);

    // The staged copy is an implementation detail of a single restore.
    if !staged_is_backup {
        let _ = std::fs::remove_file(&staged_path);
    }

    restored?;
    Ok(safety_path)
}

fn replace_database_with(
    snapshot: &Path,
    db_path: &Path,
    safety_path: &Path,
) -> Result<(), String> {
    if db_path.exists() {
        std::fs::copy(db_path, safety_path).map_err(|err| {
            format!(
                "cannot save the current database to '{}': {err}",
                safety_path.display()
            )
        })?;
    }

    for suffix in ["-wal", "-shm", "-journal"] {
        let sidecar = with_suffix(db_path, suffix);
        if sidecar.exists() {
            std::fs::remove_file(&sidecar)
                .map_err(|err| format!("cannot remove '{}': {err}", sidecar.display()))?;
        }
    }

    if let Err(err) = std::fs::copy(snapshot, db_path) {
        // Put the previous database back so a failed copy never leaves a
        // half-written library behind.
        if safety_path.exists() {
            let _ = std::fs::copy(safety_path, db_path);
        }
        return Err(format!(
            "cannot restore the backup over '{}': {err}",
            db_path.display()
        ));
    }
    Ok(())
}

/// Restore a validated backup and restart the app.
///
/// plugin-sql consumes its registered migrations on the first load of the
/// process, so a swapped file can only be migrated on a fresh launch. The
/// frontend closes its pool before invoking this command.
#[tauri::command]
pub fn restore_database_file(app: tauri::AppHandle, backup_path: String) -> Result<(), String> {
    let db_path = db_file_path(app.clone())?;
    restore_database_at(Path::new(&backup_path), Path::new(&db_path))?;
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_real_file_from_disk() {
        let path = std::env::temp_dir().join("kindclip-t4-test.txt");
        std::fs::write(
            &path,
            "Title (Author)\n- Your Highlight on page 1 | Location 1-2 | Added on Monday, January 6, 2020 10:15:00 AM\n\nHi.\n==========\n",
        )
        .unwrap();
        let parsed = parse_clippings_file(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(parsed.clippings.len(), 1);
        assert_eq!(parsed.clippings[0].title, "Title");
        assert_eq!(parsed.file_hash.len(), 64);
        assert_eq!(parsed.skipped, 0);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn reports_skipped_blocks_next_to_the_clippings() {
        let path = std::env::temp_dir().join("kindclip-t1-skipped.txt");
        std::fs::write(
            &path,
            "Title (Author)\n- Your Highlight on page 1 | Location 1-2 | Added on Monday, January 6, 2020 10:15:00 AM\n\nHi.\n==========\n\
             broken block without a meta line\n==========\n\n==========\n",
        )
        .unwrap();
        let parsed = parse_clippings_file(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(parsed.clippings.len(), 1);
        assert_eq!(parsed.skipped, 1);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn zero_clippings_with_skips_is_a_successful_result() {
        let path = std::env::temp_dir().join("kindclip-t1-all-skipped.txt");
        std::fs::write(
            &path,
            "broken block without a meta line\n==========\njust some text\n==========\n",
        )
        .unwrap();
        let parsed = parse_clippings_file(path.to_string_lossy().to_string()).unwrap();
        assert!(parsed.clippings.is_empty());
        assert_eq!(parsed.skipped, 2);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn missing_file_is_an_error() {
        let result = parse_clippings_file("/definitely/not/here/clippings.txt".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn valid_export_file_names_are_accepted() {
        assert!(validate_file_name("kindclip-export-2026-10-16.md").is_ok());
    }

    #[test]
    fn empty_export_file_name_is_rejected() {
        assert!(validate_file_name("").is_err());
    }

    #[test]
    fn export_file_name_with_separators_is_rejected() {
        assert!(validate_file_name("dir/export.md").is_err());
        assert!(validate_file_name("dir\\export.md").is_err());
    }

    #[test]
    fn write_export_file_roundtrips_contents() {
        let dir = std::env::temp_dir().join("kindclip-t3-export-roundtrip");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("export.md");
        let contents = "# Title\n> Hola\n".to_string();
        write_export_file(path.to_string_lossy().to_string(), contents.clone()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), contents);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_export_file_errors_when_directory_is_missing() {
        let path = std::env::temp_dir()
            .join("kindclip-t3-missing-dir")
            .join("export.md");
        let result = write_export_file(path.to_string_lossy().to_string(), "hola".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cannot write file"));
    }

    fn backup_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kindclip-t5-{name}"));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sqlite_bytes(contents: &[u8]) -> Vec<u8> {
        let mut bytes = b"SQLite format 3\0".to_vec();
        bytes.extend_from_slice(contents);
        bytes
    }

    fn write_sqlite(path: &Path, contents: &[u8]) {
        std::fs::write(path, sqlite_bytes(contents)).unwrap();
    }

    #[test]
    fn validate_backup_file_accepts_a_sqlite_file() {
        let dir = backup_dir("validate-ok");
        let path = dir.join("backup.db");
        write_sqlite(&path, b"payload");
        let size = validate_backup_file(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(size, 23);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn validate_backup_file_rejects_a_text_file() {
        let dir = backup_dir("validate-text");
        let path = dir.join("notes.txt");
        std::fs::write(&path, b"not a database at all").unwrap();
        let error = validate_backup_file(path.to_string_lossy().to_string()).unwrap_err();
        assert!(error.contains("SQLite"), "{error}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn validate_backup_file_rejects_a_missing_file() {
        let path = std::env::temp_dir().join("kindclip-t5-definitely-missing.db");
        let error = validate_backup_file(path.to_string_lossy().to_string()).unwrap_err();
        assert!(error.contains("cannot read file"), "{error}");
    }

    #[test]
    fn clear_backup_target_removes_an_existing_file() {
        let dir = backup_dir("clear-existing");
        let path = dir.join("backup.db");
        std::fs::write(&path, b"old").unwrap();
        clear_backup_target(path.to_string_lossy().to_string()).unwrap();
        assert!(!path.exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn clear_backup_target_accepts_a_missing_file() {
        let dir = backup_dir("clear-missing");
        let path = dir.join("backup.db");
        clear_backup_target(path.to_string_lossy().to_string()).unwrap();
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn restore_database_at_copies_the_snapshot_and_keeps_the_previous_database() {
        let dir = backup_dir("restore-ok");
        let db = dir.join("kindclip.db");
        let backup = dir.join("backup.db");
        std::fs::write(&db, b"old database").unwrap();
        // Stale sidecars from the replaced file must never reach the new one.
        std::fs::write(dir.join("kindclip.db-wal"), b"wal").unwrap();
        std::fs::write(dir.join("kindclip.db-shm"), b"shm").unwrap();
        std::fs::write(dir.join("kindclip.db-journal"), b"journal").unwrap();
        write_sqlite(&backup, b"new database");

        let safety = restore_database_at(&backup, &db).unwrap();

        assert_eq!(std::fs::read(&db).unwrap(), sqlite_bytes(b"new database"));
        assert_eq!(std::fs::read(&safety).unwrap(), b"old database");
        assert!(safety
            .to_string_lossy()
            .ends_with("kindclip.db.before-restore"));
        assert!(!dir.join("kindclip.db-wal").exists());
        assert!(!dir.join("kindclip.db-shm").exists());
        assert!(!dir.join("kindclip.db-journal").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn restore_database_at_rejects_a_non_sqlite_backup_without_touching_the_database() {
        let dir = backup_dir("restore-invalid");
        let db = dir.join("kindclip.db");
        let backup = dir.join("backup.db");
        std::fs::write(&db, b"old database").unwrap();
        std::fs::write(&backup, b"not a database").unwrap();

        let error = restore_database_at(&backup, &db).unwrap_err();

        assert!(error.contains("SQLite"), "{error}");
        assert_eq!(std::fs::read(&db).unwrap(), b"old database");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn restore_database_at_refuses_the_live_database_as_its_own_backup() {
        let dir = backup_dir("restore-self");
        let db = dir.join("kindclip.db");
        write_sqlite(&db, b"only copy");

        let error = restore_database_at(&db, &db).unwrap_err();

        assert!(error.contains("live database"), "{error}");
        assert_eq!(std::fs::read(&db).unwrap(), sqlite_bytes(b"only copy"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn restore_database_at_accepts_the_safety_copy_as_the_backup() {
        let dir = backup_dir("restore-safety-source");
        let db = dir.join("kindclip.db");
        let safety = dir.join("kindclip.db.before-restore");
        std::fs::write(&db, b"current database").unwrap();
        write_sqlite(&safety, b"previous database");

        let kept = restore_database_at(&safety, &db).unwrap();

        assert_eq!(
            std::fs::read(&db).unwrap(),
            sqlite_bytes(b"previous database")
        );
        assert_eq!(std::fs::read(&kept).unwrap(), b"current database");
        assert!(!dir.join("kindclip.db.restore-source").exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}
