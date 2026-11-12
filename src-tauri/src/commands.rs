//! Tauri commands: file import and export entry points (T4).

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

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

/// Open a directory in the system file manager through the opener's Rust API.
///
/// The plugin's Rust methods do not perform the command scope check, so the
/// webview never receives a filesystem opener permission.
fn open_directory(app: &tauri::AppHandle, dir: &Path, label: &str) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    std::fs::create_dir_all(dir)
        .map_err(|err| format!("cannot create '{}': {err}", dir.display()))?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|err| format!("cannot open '{}': {err}", dir.display()))?;
    log::info!("{label}: opened '{}'", dir.display());
    Ok(())
}

/// Open the diagnostic log directory in the system file manager.
#[tauri::command]
pub fn open_logs_dir(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let dir = app
        .path()
        .app_log_dir()
        .map_err(|err| format!("cannot resolve app log dir: {err}"))?;
    open_directory(&app, &dir, "logs")
}

/// Open the folder that holds the live database.
///
/// Used when the file itself cannot be revealed, for example before the first
/// launch created it. The parent directory is resolved in Rust so the webview
/// never needs to compute or request a filesystem path.
#[tauri::command]
pub fn open_db_dir(app: tauri::AppHandle) -> Result<(), String> {
    let db_path = db_file_path(app.clone())?;
    let dir = Path::new(&db_path)
        .parent()
        .ok_or_else(|| format!("'{db_path}' has no parent directory"))?;
    open_directory(&app, dir, "db")
}

/// Read `My Clippings.txt` from disk, hash it (S5 dedupe key) and parse it (S2).
#[tauri::command]
pub fn parse_clippings_file(path: String) -> Result<ParsedFile, String> {
    let bytes = std::fs::read(&path).map_err(|err| {
        log::warn!("import: cannot read '{path}': {err}");
        format!("cannot read file '{path}': {err}")
    })?;
    let file_hash: String = Sha256::digest(&bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let text = clippings_parser::decode_bytes(&bytes);
    let parsed = clippings_parser::parse_clippings_with_stats(&text);
    log::info!(
        "import: read '{path}' ({} bytes) into {} clippings with {} skipped blocks",
        bytes.len(),
        parsed.clippings.len(),
        parsed.skipped
    );
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
    let bytes = contents.len();
    std::fs::write(&path, contents).map_err(|err| {
        log::warn!("export: cannot write '{path}': {err}");
        format!("cannot write file '{path}': {err}")
    })?;
    log::info!("export: wrote '{path}' ({bytes} bytes)");
    Ok(())
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
    let size = read_sqlite_magic(Path::new(&path)).map_err(|err| {
        log::warn!("backup: rejected '{path}': {err}");
        err
    })?;
    log::info!("backup: validated '{path}' ({size} bytes)");
    Ok(size)
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
        Ok(()) => {
            log::info!("backup: cleared existing target '{}'", path.display());
            Ok(())
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => {
            log::warn!("backup: cannot clear '{}': {err}", path.display());
            Err(format!("cannot clear '{}': {err}", path.display()))
        }
    }
}

/* ------------------------------------------------------------------------- *
 * Automatic rotating backups
 * ------------------------------------------------------------------------- */

/// Automatic snapshots live in a `backups` folder next to the live database.
const AUTO_BACKUP_PREFIX: &str = "kindclip-backup-";
const AUTO_BACKUP_SUFFIX: &str = ".db";
/// In-flight `VACUUM INTO` targets left behind by an interrupted launch.
const AUTO_BACKUP_TEMP_PREFIX: &str = "kindclip-auto-";
const AUTO_BACKUP_TEMP_SUFFIX: &str = ".tmp";
/// A crash leftover older than this is removed during the next prune.
const AUTO_BACKUP_TEMP_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// One automatic snapshot as shown in the restore dialog.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoBackup {
    pub name: String,
    pub path: String,
    pub size: u64,
}

/// Where a launch writes its snapshot before committing it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoBackupPaths {
    pub dir: String,
    pub final_path: String,
    pub temp_path: String,
}

/// What a prune removed; failures are logged and never fail startup.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneReport {
    pub deleted: usize,
    pub failed: usize,
    pub temps_deleted: usize,
}

fn auto_backup_dir_at(config_dir: &Path) -> PathBuf {
    config_dir.join("backups")
}

/// `kindclip-backup-YYYY-MM-DD.db`; the only name retention may touch.
fn is_auto_backup_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix(AUTO_BACKUP_PREFIX) else {
        return false;
    };
    let Some(date) = rest.strip_suffix(AUTO_BACKUP_SUFFIX) else {
        return false;
    };
    let bytes = date.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

/// Resolve the snapshot folder and the two paths of this launch's attempt.
pub(crate) fn prepare_auto_backup_at(
    dir: &Path,
    final_name: &str,
) -> Result<AutoBackupPaths, String> {
    if !is_auto_backup_name(final_name) {
        return Err(format!("'{final_name}' is not an automatic backup name"));
    }
    std::fs::create_dir_all(dir)
        .map_err(|err| format!("cannot create '{}': {err}", dir.display()))?;
    let stamp = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    let temp_name = format!(
        "{AUTO_BACKUP_TEMP_PREFIX}{}-{stamp}{AUTO_BACKUP_TEMP_SUFFIX}",
        std::process::id()
    );
    Ok(AutoBackupPaths {
        dir: path_string(dir),
        final_path: path_string(&dir.join(final_name)),
        temp_path: path_string(&dir.join(temp_name)),
    })
}

/// Dated snapshots in the folder, newest first. A missing folder is empty.
pub(crate) fn list_auto_backups_in(dir: &Path) -> Result<Vec<AutoBackup>, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(format!("cannot read '{}': {err}", dir.display())),
    };
    let mut snapshots = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_auto_backup_name(&name) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        snapshots.push(AutoBackup {
            name,
            path: path_string(&entry.path()),
            size: metadata.len(),
        });
    }
    snapshots.sort_by(|left, right| right.name.cmp(&left.name));
    Ok(snapshots)
}

/// Validate the written snapshot and move it to its final dated name.
///
/// The temporary file is removed on every failure, so a crash or a rejected
/// snapshot can never leave a damaged file under a backup name. An existing
/// final name is never overwritten: it already counts as today's snapshot.
pub(crate) fn commit_auto_backup_at(temp: &Path, final_path: &Path) -> Result<(), String> {
    let discard = |message: String| -> String {
        let _ = std::fs::remove_file(temp);
        message
    };
    let final_name = final_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    if !is_auto_backup_name(&final_name) {
        return Err(discard(format!(
            "'{final_name}' is not an automatic backup name"
        )));
    }
    let temp_name = temp
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let is_temp_name = temp_name.starts_with(AUTO_BACKUP_TEMP_PREFIX)
        && temp_name.ends_with(AUTO_BACKUP_TEMP_SUFFIX);
    if !is_temp_name || temp.parent() != final_path.parent() {
        return Err(discard(format!(
            "cannot commit '{}': the temporary file is not part of the backup folder",
            temp.display()
        )));
    }
    if final_path.exists() {
        return Err(discard(format!(
            "'{}' already exists; today's snapshot is kept",
            final_path.display()
        )));
    }
    if let Err(err) = read_sqlite_magic(temp) {
        return Err(discard(err));
    }
    std::fs::rename(temp, final_path)
        .map_err(|err| discard(format!("cannot commit '{}': {err}", final_path.display())))?;
    log::info!("auto-backup: committed '{}'", final_path.display());
    Ok(())
}

/// Delete the snapshots the frontend selected, keeping the newest `keep`.
///
/// Every candidate is re-validated here: the name must match the dated
/// pattern, the file must live in this folder, and the newest snapshots are
/// protected even if the caller asks for them. Stale crash leftovers in the
/// folder are removed in the same pass.
pub(crate) fn prune_auto_backups_in(
    dir: &Path,
    keep: usize,
    candidates: &[PathBuf],
    now: SystemTime,
) -> PruneReport {
    let mut report = PruneReport::default();
    let mut protected: Vec<String> = list_auto_backups_in(dir)
        .unwrap_or_default()
        .into_iter()
        .map(|snapshot| snapshot.name)
        .collect();
    protected.truncate(keep.max(1));

    for candidate in candidates {
        let name = candidate
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default();
        let is_inside = candidate.parent() == Some(dir);
        if !is_inside || !is_auto_backup_name(&name) || protected.contains(&name) {
            log::warn!("auto-backup: refused to prune '{}'", candidate.display());
            report.failed += 1;
            continue;
        }
        match std::fs::remove_file(candidate) {
            Ok(()) => report.deleted += 1,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => {
                report.failed += 1;
                log::warn!(
                    "auto-backup: cannot remove '{}': {err}",
                    candidate.display()
                );
            }
        }
    }

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with(AUTO_BACKUP_TEMP_PREFIX)
                || !name.ends_with(AUTO_BACKUP_TEMP_SUFFIX)
            {
                continue;
            }
            let age = entry
                .metadata()
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(|modified| now.duration_since(modified).ok());
            if age.is_some_and(|age| age >= AUTO_BACKUP_TEMP_MAX_AGE)
                && std::fs::remove_file(entry.path()).is_ok()
            {
                report.temps_deleted += 1;
            }
        }
    }

    report
}

/// Resolve/create the snapshot folder and return this launch's target paths.
#[tauri::command]
pub fn prepare_auto_backup(
    app: tauri::AppHandle,
    final_name: String,
) -> Result<AutoBackupPaths, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("cannot resolve app config dir: {err}"))?;
    prepare_auto_backup_at(&auto_backup_dir_at(&dir), &final_name)
}

/// List the automatic snapshots for the restore dialog, newest first.
#[tauri::command]
pub fn list_auto_backups(app: tauri::AppHandle) -> Result<Vec<AutoBackup>, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("cannot resolve app config dir: {err}"))?;
    list_auto_backups_in(&auto_backup_dir_at(&dir))
}

/// Validate and rename the in-flight snapshot; never overwrites a snapshot.
#[tauri::command]
pub fn commit_auto_backup(temp_path: String, final_path: String) -> Result<(), String> {
    commit_auto_backup_at(Path::new(&temp_path), Path::new(&final_path))
}

/// Remove the snapshots selected by the retention policy plus stale temps.
#[tauri::command]
pub fn prune_auto_backups(
    app: tauri::AppHandle,
    keep: u32,
    candidates: Vec<String>,
) -> Result<PruneReport, String> {
    use tauri::Manager;
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("cannot resolve app config dir: {err}"))?;
    let dir = auto_backup_dir_at(&config_dir);
    let paths: Vec<PathBuf> = candidates.iter().map(PathBuf::from).collect();
    let report = prune_auto_backups_in(&dir, keep as usize, &paths, SystemTime::now());
    log::info!(
        "auto-backup: pruned {} snapshots ({} failed), removed {} stale temp files",
        report.deleted,
        report.failed,
        report.temps_deleted
    );
    Ok(report)
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
    log::info!("restore: restarting the app to reopen the restored database");
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
    fn prepare_auto_backup_at_creates_the_folder_and_the_final_path() {
        let dir = auto_dir("auto-prepare");
        let paths = prepare_auto_backup_at(&dir, "kindclip-backup-2026-11-12.db").unwrap();

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
        let error = prepare_auto_backup_at(&dir, "kindclip.db").unwrap_err();

        assert!(error.contains("automatic backup name"), "{error}");
    }

    #[test]
    fn prepare_auto_backup_at_gives_each_run_its_own_temp_file() {
        let dir = auto_dir("auto-prepare-temp");
        let first = prepare_auto_backup_at(&dir, "kindclip-backup-2026-11-12.db").unwrap();
        let second = prepare_auto_backup_at(&dir, "kindclip-backup-2026-11-13.db").unwrap();

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
        std::fs::write(dir.join("kindclip.db.before-restore"), b"previous").unwrap();
        std::fs::write(dir.join("notes.txt"), b"notes").unwrap();
        let newest = dir.join("kindclip-backup-2026-01-09.db");

        let report = prune_auto_backups_in(
            &dir,
            7,
            &[
                oldest.clone(),
                second.clone(),
                dir.join("kindclip.db"),
                newest.clone(),
            ],
            SystemTime::now(),
        );

        assert_eq!(report.deleted, 2);
        assert_eq!(report.failed, 2);
        assert!(!oldest.exists());
        assert!(!second.exists());
        assert!(newest.exists());
        assert_eq!(std::fs::read(dir.join("kindclip.db")).unwrap(), b"live");
        assert!(dir.join("kindclip.db.before-restore").exists());
        assert!(dir.join("notes.txt").exists());
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
