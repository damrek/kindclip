use std::path::Path;

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
pub(crate) fn open_directory(
    app: &tauri::AppHandle,
    dir: &Path,
    label: &str,
) -> Result<(), String> {
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
