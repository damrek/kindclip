use std::path::{Path, PathBuf};

use serde::Deserialize;

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
    let bytes = contents.len();
    std::fs::write(&path, contents).map_err(|err| {
        log::warn!("export: cannot write '{path}': {err}");
        format!("cannot write file '{path}': {err}")
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
    if name.contains('/') || name.contains('\\') || name.contains("..") {
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
pub fn check_export_targets(dir: String, names: Vec<String>) -> Result<Vec<String>, String> {
    let path = export_dir(&dir)?;
    let mut existing = Vec::new();
    for name in names {
        validate_export_name(&name)?;
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
pub fn write_export_files(dir: String, files: Vec<ExportFile>) -> Result<usize, String> {
    let path = export_dir(&dir)?;
    let total = files.len();
    for file in &files {
        validate_export_name(&file.name)?;
    }
    for (index, file) in files.iter().enumerate() {
        write_export_file_atomic(&path, &file.name, &file.contents, index).map_err(|err| {
            log::warn!("{}", per_book_failure_message(index, total));
            format!("wrote {index} of {total} files before failing: {err}")
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
pub(crate) fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}
