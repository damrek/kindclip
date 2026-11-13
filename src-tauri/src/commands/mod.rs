//! Tauri commands, one module per responsibility. `lib.rs` registers the
//! `#[tauri::command]` entry points; every helper stays crate-visible for the
//! command tests.

use serde::Serialize;

/// Serializable error envelope shared by every command: `code` is stable for
/// callers that branch on it, `message` is the text shown to the user.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
}

impl CommandError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl From<String> for CommandError {
    fn from(message: String) -> Self {
        Self::new("command-failed", message)
    }
}

mod auto_backup;
mod backup;
mod diagnostics;
mod export;
mod parse;
mod restore;

pub(crate) use auto_backup::*;
pub(crate) use backup::*;
pub(crate) use diagnostics::*;
pub(crate) use export::*;
pub(crate) use parse::*;
pub(crate) use restore::*;

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};
    use std::time::{Duration, SystemTime};

    use crate::commands::*;

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
        assert!(result.unwrap_err().message.contains("cannot write file"));
    }

    fn per_book_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kindclip-t6-per-book-{name}"));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn export_file(name: &str, contents: &str) -> ExportFile {
        ExportFile {
            name: name.to_string(),
            contents: contents.to_string(),
        }
    }

    #[test]
    fn validate_export_name_accepts_generated_names_and_rejects_unsafe_ones() {
        assert!(validate_export_name("meditations.md").is_ok());
        assert!(validate_export_name("c--a-2.md").is_ok());
        assert!(validate_export_name("").is_err());
        assert!(validate_export_name("../escape.md").is_err());
        assert!(validate_export_name("dir/export.md").is_err());
        assert!(validate_export_name("dir\\export.md").is_err());
        assert!(validate_export_name("export.txt").is_err());
        assert!(validate_export_name("bad\u{0}name.md").is_err());
        assert!(validate_export_name("bad\nname.md").is_err());
    }

    #[test]
    fn check_export_targets_reports_only_existing_names() {
        let dir = per_book_dir("check-existing");
        std::fs::write(dir.join("a.md"), "# A").unwrap();
        std::fs::create_dir_all(dir.join("b.md")).unwrap();
        let found = check_export_targets(
            dir.to_string_lossy().to_string(),
            vec!["a.md".to_string(), "b.md".to_string(), "c.md".to_string()],
        )
        .unwrap();
        assert_eq!(found, vec!["a.md".to_string(), "b.md".to_string()]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn check_export_targets_rejects_bad_directories_and_names() {
        let missing = std::env::temp_dir().join("kindclip-t6-per-book-definitely-missing");
        assert!(check_export_targets(
            missing.to_string_lossy().to_string(),
            vec!["a.md".to_string()],
        )
        .is_err());

        let file = std::env::temp_dir().join("kindclip-t6-per-book-not-a-dir");
        std::fs::write(&file, "x").unwrap();
        assert!(
            check_export_targets(file.to_string_lossy().to_string(), vec!["a.md".to_string()],)
                .is_err()
        );
        std::fs::remove_file(&file).ok();

        let dir = per_book_dir("check-unsafe");
        assert!(check_export_targets(
            dir.to_string_lossy().to_string(),
            vec!["../escape.md".to_string()],
        )
        .is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_export_files_writes_every_file_and_replaces_only_targets() {
        let dir = per_book_dir("write-all");
        std::fs::write(dir.join("a.md"), "old").unwrap();
        std::fs::write(dir.join("keep.txt"), "foreign").unwrap();
        let written = write_export_files(
            dir.to_string_lossy().to_string(),
            vec![export_file("a.md", "# New A"), export_file("b.md", "# B")],
        )
        .unwrap();
        assert_eq!(written, 2);
        assert_eq!(
            std::fs::read_to_string(dir.join("a.md")).unwrap(),
            "# New A"
        );
        assert_eq!(std::fs::read_to_string(dir.join("b.md")).unwrap(), "# B");
        assert_eq!(
            std::fs::read_to_string(dir.join("keep.txt")).unwrap(),
            "foreign"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_export_files_reports_written_count_on_mid_run_failure() {
        let dir = per_book_dir("write-mid-failure");
        std::fs::create_dir_all(dir.join("b.md")).unwrap();
        let result = write_export_files(
            dir.to_string_lossy().to_string(),
            vec![
                export_file("a.md", "# A"),
                export_file("b.md", "# B"),
                export_file("c.md", "# C"),
            ],
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().message.contains("wrote 1 of 3"));
        assert_eq!(std::fs::read_to_string(dir.join("a.md")).unwrap(), "# A");
        assert!(!dir.join("c.md").exists());
        let entries: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(entries.len(), 2, "no temp files may remain: {entries:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn per_book_failure_log_records_counts_only() {
        assert_eq!(
            per_book_failure_message(1, 3),
            "export: stopped after 1/3 per-book files"
        );
    }

    #[test]
    fn write_export_files_rejects_traversal_before_writing_anything() {
        let dir = per_book_dir("write-traversal");
        let result = write_export_files(
            dir.to_string_lossy().to_string(),
            vec![
                export_file("a.md", "# A"),
                export_file("../escape.md", "# X"),
            ],
        );
        assert!(result.is_err());
        assert!(!dir.join("a.md").exists());
        std::fs::remove_dir_all(&dir).ok();
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
        assert!(error.message.contains("SQLite"), "{error}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn validate_backup_file_rejects_a_missing_file() {
        let path = std::env::temp_dir().join("kindclip-t5-definitely-missing.db");
        let error = validate_backup_file(path.to_string_lossy().to_string()).unwrap_err();
        assert!(error.message.contains("cannot read file"), "{error}");
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

    fn auto_dir(name: &str) -> PathBuf {
        backup_dir(name).join("backups")
    }

    fn snapshot(dir: &Path, day: u32) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join(format!("kindclip-backup-2026-01-{day:02}.db"));
        write_sqlite(&path, format!("day {day}").as_bytes());
        path
    }

    #[test]
    fn auto_backup_name_owns_the_format_and_rejects_bad_dates() {
        assert_eq!(
            auto_backup_name("2026-11-12").unwrap(),
            "kindclip-backup-2026-11-12.db"
        );
        assert!(auto_backup_name("2026-11-12.db").is_err());
        assert!(auto_backup_name("2026-13-01").is_err());
        assert!(auto_backup_name("2026-11-32").is_err());
        assert!(auto_backup_name("12-11-2026").is_err());
    }

    #[test]
    fn prepare_auto_backup_at_creates_the_folder_and_the_final_path() {
        let dir = auto_dir("auto-prepare");
        let paths = prepare_auto_backup_at(&dir, "2026-11-12").unwrap();

        assert!(dir.is_dir());
        assert_eq!(
            Path::new(&paths.final_path),
            dir.join("kindclip-backup-2026-11-12.db")
        );
        assert!(paths.temp_path.contains("kindclip-auto-"));
        assert!(paths.temp_path.ends_with(".tmp"));
        std::fs::remove_dir_all(dir.parent().unwrap()).ok();
    }

    #[test]
    fn prepare_auto_backup_at_rejects_a_foreign_name() {
        let dir = auto_dir("auto-prepare-bad");
        let error = prepare_auto_backup_at(&dir, "not-a-date").unwrap_err();

        assert!(error.contains("YYYY-MM-DD"), "{error}");
    }

    #[test]
    fn prepare_auto_backup_at_gives_each_run_its_own_temp_file() {
        let dir = auto_dir("auto-prepare-temp");
        let first = prepare_auto_backup_at(&dir, "2026-11-12").unwrap();
        let second = prepare_auto_backup_at(&dir, "2026-11-13").unwrap();

        assert_ne!(first.temp_path, second.temp_path);
        std::fs::remove_dir_all(dir.parent().unwrap()).ok();
    }

    #[test]
    fn list_auto_backups_in_returns_dated_files_newest_first() {
        let dir = auto_dir("auto-list");
        snapshot(&dir, 3);
        snapshot(&dir, 9);
        std::fs::write(dir.join("kindclip.db"), b"live").unwrap();
        std::fs::write(dir.join("notes.txt"), b"notes").unwrap();

        let listed = list_auto_backups_in(&dir).unwrap();

        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].name, "kindclip-backup-2026-01-09.db");
        assert_eq!(listed[1].name, "kindclip-backup-2026-01-03.db");
        assert!(listed[0].size > 0);
        assert!(listed[0].path.ends_with("kindclip-backup-2026-01-09.db"));
        std::fs::remove_dir_all(dir.parent().unwrap()).ok();
    }

    #[test]
    fn list_auto_backups_in_accepts_a_missing_folder() {
        let dir = std::env::temp_dir().join("kindclip-auto-missing-folder");
        std::fs::remove_dir_all(&dir).ok();

        assert!(list_auto_backups_in(&dir).unwrap().is_empty());
    }

    #[test]
    fn commit_auto_backup_at_moves_a_valid_snapshot_into_place() {
        let dir = auto_dir("auto-commit");
        std::fs::create_dir_all(&dir).unwrap();
        let temp = dir.join("kindclip-auto-1.tmp");
        let final_path = dir.join("kindclip-backup-2026-11-12.db");
        write_sqlite(&temp, b"payload");

        commit_auto_backup_at(&temp, &final_path).unwrap();

        assert!(!temp.exists());
        assert_eq!(
            std::fs::read(&final_path).unwrap(),
            sqlite_bytes(b"payload")
        );
        std::fs::remove_dir_all(dir.parent().unwrap()).ok();
    }

    #[test]
    fn commit_auto_backup_at_cleans_a_non_sqlite_temp_file() {
        let dir = auto_dir("auto-commit-bad");
        std::fs::create_dir_all(&dir).unwrap();
        let temp = dir.join("kindclip-auto-bad.tmp");
        let final_path = dir.join("kindclip-backup-2026-11-12.db");
        std::fs::write(&temp, b"not a database").unwrap();

        let error = commit_auto_backup_at(&temp, &final_path).unwrap_err();

        assert!(error.contains("SQLite"), "{error}");
        assert!(!temp.exists());
        assert!(!final_path.exists());
        std::fs::remove_dir_all(dir.parent().unwrap()).ok();
    }

    #[test]
    fn commit_auto_backup_at_never_overwrites_an_existing_snapshot() {
        let dir = auto_dir("auto-commit-existing");
        std::fs::create_dir_all(&dir).unwrap();
        let temp = dir.join("kindclip-auto-2.tmp");
        let final_path = dir.join("kindclip-backup-2026-11-12.db");
        write_sqlite(&temp, b"new");
        write_sqlite(&final_path, b"old");

        let error = commit_auto_backup_at(&temp, &final_path).unwrap_err();

        assert!(error.contains("already exists"), "{error}");
        assert_eq!(std::fs::read(&final_path).unwrap(), sqlite_bytes(b"old"));
        assert!(!temp.exists());
        std::fs::remove_dir_all(dir.parent().unwrap()).ok();
    }

    #[test]
    fn commit_auto_backup_at_refuses_a_temp_file_from_another_folder() {
        let dir = auto_dir("auto-commit-foreign");
        let other = auto_dir("auto-commit-foreign-temp");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        let temp = other.join("kindclip-auto-3.tmp");
        write_sqlite(&temp, b"payload");
        let final_path = dir.join("kindclip-backup-2026-11-12.db");

        let error = commit_auto_backup_at(&temp, &final_path).unwrap_err();

        assert!(error.contains("temporary"), "{error}");
        assert!(
            temp.exists(),
            "the foreign temp file must survive the rejection"
        );
        assert!(!final_path.exists());
        std::fs::remove_dir_all(dir.parent().unwrap()).ok();
        std::fs::remove_dir_all(other.parent().unwrap()).ok();
    }

    #[test]
    fn prune_auto_backups_in_keeps_the_newest_and_protects_live_files() {
        let dir = auto_dir("auto-prune");
        let oldest = snapshot(&dir, 1);
        let second = snapshot(&dir, 2);
        for day in 3..=9 {
            snapshot(&dir, day);
        }
        std::fs::write(dir.join("kindclip.db"), b"live").unwrap();
        std::fs::write(dir.join("kindclip.db-wal"), b"wal").unwrap();
        std::fs::write(dir.join("kindclip.db-shm"), b"shm").unwrap();
        std::fs::write(dir.join("kindclip.db-journal"), b"journal").unwrap();
        std::fs::write(dir.join("kindclip.db.before-restore"), b"previous").unwrap();
        std::fs::write(dir.join("notes.txt"), b"notes").unwrap();
        let outside = dir.parent().unwrap().join("kindclip-backup-2026-01-01.db");
        write_sqlite(&outside, b"outside");
        let newest = dir.join("kindclip-backup-2026-01-09.db");

        let report = prune_auto_backups_in(
            &dir,
            7,
            &[
                oldest.clone(),
                second.clone(),
                dir.join("kindclip.db"),
                dir.join("kindclip.db-wal"),
                dir.join("kindclip.db-shm"),
                dir.join("kindclip.db-journal"),
                outside.clone(),
                newest.clone(),
            ],
            SystemTime::now(),
        );

        assert_eq!(report.deleted, 2);
        assert_eq!(report.failed, 6);
        assert!(!oldest.exists());
        assert!(!second.exists());
        assert!(newest.exists());
        assert_eq!(std::fs::read(dir.join("kindclip.db")).unwrap(), b"live");
        assert_eq!(std::fs::read(dir.join("kindclip.db-wal")).unwrap(), b"wal");
        assert_eq!(std::fs::read(dir.join("kindclip.db-shm")).unwrap(), b"shm");
        assert_eq!(
            std::fs::read(dir.join("kindclip.db-journal")).unwrap(),
            b"journal"
        );
        assert!(dir.join("kindclip.db.before-restore").exists());
        assert!(dir.join("notes.txt").exists());
        assert!(outside.exists());
        std::fs::remove_dir_all(dir.parent().unwrap()).ok();
    }

    #[test]
    fn prune_auto_backups_in_removes_only_stale_temp_files() {
        let dir = auto_dir("auto-prune-temps");
        std::fs::create_dir_all(&dir).unwrap();
        let stale = dir.join("kindclip-auto-stale.tmp");
        let fresh = dir.join("kindclip-auto-fresh.tmp");
        std::fs::write(&stale, b"x").unwrap();
        std::fs::write(&fresh, b"x").unwrap();
        let long_ago = SystemTime::now() - Duration::from_secs(48 * 60 * 60);
        std::fs::File::options()
            .write(true)
            .open(&stale)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(long_ago))
            .unwrap();

        let report = prune_auto_backups_in(&dir, 7, &[], SystemTime::now());

        assert_eq!(report.temps_deleted, 1);
        assert!(!stale.exists());
        assert!(fresh.exists());
        std::fs::remove_dir_all(dir.parent().unwrap()).ok();
    }

    #[test]
    fn prune_auto_backups_in_accepts_a_missing_folder() {
        let dir = std::env::temp_dir().join("kindclip-auto-prune-missing");
        std::fs::remove_dir_all(&dir).ok();

        let report = prune_auto_backups_in(&dir, 7, &[], SystemTime::now());

        assert_eq!(report.deleted, 0);
        assert_eq!(report.failed, 0);
    }
}
