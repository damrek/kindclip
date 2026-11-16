use std::path::{Path, PathBuf};

use super::backup::read_sqlite_magic;
use super::diagnostics::db_path;
use super::export::with_suffix;
use super::CommandError;

/// Whether two paths point at the same file on disk.
pub(crate) fn same_path(left: &Path, right: &Path) -> bool {
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

    restored.map_err(|err| {
        log::warn!(
            "restore: cannot replace '{}' with '{}': {err}",
            db_path.display(),
            backup_path.display()
        );
        err
    })?;
    log::info!(
        "restore: replaced '{}' with '{}' (previous database kept at '{}')",
        db_path.display(),
        backup_path.display(),
        safety_path.display()
    );
    Ok(safety_path)
}

pub(crate) fn replace_database_with(
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
pub fn restore_database_file(
    app: tauri::AppHandle,
    backup_path: String,
) -> Result<(), CommandError> {
    let db_path = db_path(&app)?;
    restore_database_at(Path::new(&backup_path), Path::new(&db_path))
        .map_err(|err| CommandError::new("restore", err))?;
    log::info!("restore: restarting the app to reopen the restored database");
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_support::{backup_dir, sqlite_bytes, write_sqlite};

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
