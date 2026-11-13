use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;

use super::backup::read_sqlite_magic;

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

pub(crate) fn auto_backup_dir_at(config_dir: &Path) -> PathBuf {
    config_dir.join("backups")
}

/// Whether a date is the `YYYY-MM-DD` shape the name contract accepts.
fn is_iso_date(date: &str) -> bool {
    let bytes = date.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    if !bytes
        .iter()
        .enumerate()
        .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
    {
        return false;
    }
    let month = date[5..7].parse::<u32>().unwrap_or(0);
    let day = date[8..10].parse::<u32>().unwrap_or(0);
    (1..=12).contains(&month) && (1..=31).contains(&day)
}

/// `kindclip-backup-YYYY-MM-DD.db` from a local calendar date. This is the
/// only place the automatic name is composed; the frontend supplies the date.
pub(crate) fn auto_backup_name(date: &str) -> Result<String, String> {
    if !is_iso_date(date) {
        return Err(format!("'{date}' is not a YYYY-MM-DD date"));
    }
    Ok(format!("{AUTO_BACKUP_PREFIX}{date}{AUTO_BACKUP_SUFFIX}"))
}

/// `kindclip-backup-YYYY-MM-DD.db`; the only name retention may touch.
pub(crate) fn is_auto_backup_name(name: &str) -> bool {
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

pub(crate) fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

/// Resolve the snapshot folder and the two paths of this launch's attempt.
pub(crate) fn prepare_auto_backup_at(dir: &Path, date: &str) -> Result<AutoBackupPaths, String> {
    let final_name = auto_backup_name(date)?;
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
        final_path: path_string(&dir.join(&final_name)),
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
/// Once the temp path is confirmed to be this folder's `kindclip-auto-*.tmp`,
/// the temporary file is removed on every later failure, so a crash or a
/// rejected snapshot can never leave a damaged file under a backup name. An
/// existing final name is never overwritten, and a path that is not this
/// folder's temporary file is rejected without deleting it.
pub(crate) fn commit_auto_backup_at(temp: &Path, final_path: &Path) -> Result<(), String> {
    let final_name = final_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    if !is_auto_backup_name(&final_name) {
        return Err(format!("'{final_name}' is not an automatic backup name"));
    }
    let temp_name = temp
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let is_temp_name = temp_name.starts_with(AUTO_BACKUP_TEMP_PREFIX)
        && temp_name.ends_with(AUTO_BACKUP_TEMP_SUFFIX);
    if !is_temp_name || temp.parent() != final_path.parent() {
        // Never delete a path this command did not create: a foreign file
        // passed as `temp` must survive the rejection.
        return Err(format!(
            "cannot commit '{}': the temporary file is not part of the backup folder",
            temp.display()
        ));
    }
    // The temp path is ours from here on, so cleanup on failure is safe.
    let discard = |message: String| -> String {
        let _ = std::fs::remove_file(temp);
        message
    };
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

/// `kindclip-backup-YYYY-MM-DD.db` for a local date; the frontend never
/// composes the name, so TS and Rust cannot disagree about it.
#[tauri::command]
pub fn backup_file_name(date: String) -> Result<String, String> {
    auto_backup_name(&date)
}

/// Resolve/create the snapshot folder and return this launch's target paths.
#[tauri::command]
pub fn prepare_auto_backup(app: tauri::AppHandle, date: String) -> Result<AutoBackupPaths, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("cannot resolve app config dir: {err}"))?;
    prepare_auto_backup_at(&auto_backup_dir_at(&dir), &date)
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
