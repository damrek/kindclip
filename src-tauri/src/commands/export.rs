use std::path::{Path, PathBuf};

use serde::Deserialize;

use super::CommandError;

/// The separator set a file name must never carry: it is joined onto a folder.
fn has_path_separator(name: &str) -> bool {
    name.contains('/') || name.contains('\\')
}

/// Reject empty export names and names containing path separators (S10).
///
/// Export names are joined onto the Downloads directory, so a name with a
/// separator could point the write outside it.
pub(crate) fn validate_file_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("file name cannot be empty".to_string());
    }
    if has_path_separator(name) {
        return Err(format!("file name '{name}' cannot contain path separators"));
    }
    Ok(())
}

/// Write the exported document to disk (S4): the frontend picks the target
/// path through the native save dialog and this command persists the contents.
#[tauri::command]
pub fn write_export_file(path: String, contents: String) -> Result<(), CommandError> {
    let bytes = contents.len();
    std::fs::write(&path, contents).map_err(|err| {
        log::warn!("export: cannot write '{path}': {err}");
        CommandError::new("export", format!("cannot write file '{path}': {err}"))
    })?;
    log::info!("export: wrote '{path}' ({bytes} bytes)");
    Ok(())
}

/// Reject anything that is not one safe `.md` path component (S6).
///
/// Per-book names are joined onto a user-chosen directory, so a separator,
/// `..`, NUL or control character could escape it.
pub(crate) fn validate_export_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("file name cannot be empty".to_string());
    }
    if has_path_separator(name) || name.contains("..") {
        return Err(format!(
            "file name '{name}' must be a single path component"
        ));
    }
    if name.chars().any(char::is_control) {
        return Err(format!(
            "file name '{name}' cannot contain control characters"
        ));
    }
    if !name.to_ascii_lowercase().ends_with(".md") {
        return Err(format!("file name '{name}' must end in .md"));
    }
    Ok(())
}

/// Resolve and validate a per-book export destination (S6).
pub(crate) fn export_dir(dir: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(dir);
    let metadata = std::fs::metadata(&path)
        .map_err(|err| format!("cannot read export directory '{dir}': {err}"))?;
    if !metadata.is_dir() {
        return Err(format!("'{dir}' is not a directory"));
    }
    Ok(path)
}

/// One file of a per-book export: a single path component and its contents.
#[derive(Debug, Deserialize)]
pub struct ExportFile {
    pub name: String,
    pub contents: String,
}

/// Report which per-book targets already exist, before replacing anything (S7).
#[tauri::command]
pub fn check_export_targets(dir: String, names: Vec<String>) -> Result<Vec<String>, CommandError> {
    let path = export_dir(&dir).map_err(|err| CommandError::new("export", err))?;
    let mut existing = Vec::new();
    for name in names {
        validate_export_name(&name).map_err(|err| CommandError::new("export", err))?;
        if path.join(&name).exists() {
            existing.push(name);
        }
    }
    Ok(existing)
}

/// Write one per-book file atomically: temp in the target directory then rename.
pub(crate) fn write_export_file_atomic(
    dir: &Path,
    name: &str,
    contents: &str,
    index: usize,
) -> Result<(), String> {
    let target = dir.join(name);
    let temp = dir.join(format!(
        ".kindclip-export-{}-{index}.tmp",
        std::process::id()
    ));
    std::fs::write(&temp, contents).map_err(|err| format!("cannot write file '{name}': {err}"))?;
    std::fs::rename(&temp, &target).map_err(|err| {
        std::fs::remove_file(&temp).ok();
        format!("cannot write file '{name}': {err}")
    })
}

/// Mid-run failure log line: counts only, never a generated file name (S9).
pub(crate) fn per_book_failure_message(index: usize, total: usize) -> String {
    format!("export: stopped after {index}/{total} per-book files")
}

/// Write the per-book files into a chosen folder and return the written count
/// (S6). Writes are per-file atomic, not all-or-nothing; a mid-run failure
/// reports how many files were written.
#[tauri::command]
pub fn write_export_files(dir: String, files: Vec<ExportFile>) -> Result<usize, CommandError> {
    let path = export_dir(&dir).map_err(|err| CommandError::new("export", err))?;
    let total = files.len();
    for file in &files {
        validate_export_name(&file.name).map_err(|err| CommandError::new("export", err))?;
    }
    for (index, file) in files.iter().enumerate() {
        write_export_file_atomic(&path, &file.name, &file.contents, index).map_err(|err| {
            log::warn!("{}", per_book_failure_message(index, total));
            CommandError::new(
                "export",
                format!("wrote {index} of {total} files before failing: {err}"),
            )
        })?;
    }
    log::info!("export: wrote {total} per-book files to '{dir}'");
    Ok(total)
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
) -> Result<String, CommandError> {
    use tauri::Manager;
    validate_file_name(&suggested_file_name).map_err(|err| CommandError::new("export", err))?;
    let dir = app.path().download_dir().map_err(|err| {
        CommandError::new("export", format!("cannot resolve download dir: {err}"))
    })?;
    Ok(dir.join(&suggested_file_name).to_string_lossy().to_string())
}

/// Path with `suffix` appended to the full file name (`db` + `-wal`, …).
pub(crate) fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::commands::test_support::fresh_dir;

    fn per_book_dir(name: &str) -> PathBuf {
        fresh_dir(&format!("kindclip-t6-per-book-{name}"))
    }

    fn export_file(name: &str, contents: &str) -> ExportFile {
        ExportFile {
            name: name.to_string(),
            contents: contents.to_string(),
        }
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
}
