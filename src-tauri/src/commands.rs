//! Tauri commands: file import entry points (T4).

use serde::Serialize;
use sha2::{Digest, Sha256};

/// A parsed clippings file, ready for the frontend import orchestration.
#[derive(Debug, Serialize)]
pub struct ParsedFile {
    pub path: String,
    pub file_hash: String,
    pub clippings: Vec<clippings_parser::Clipping>,
}

/// Absolute path of the SQLite file owned by tauri-plugin-sql.
///
/// `sqlite:kindclip.db` is resolved by the plugin against the app data dir,
/// so revealing this path shows the user where their library lives.
#[tauri::command]
pub fn db_file_path(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("cannot resolve app data dir: {err}"))?;
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
    let clippings = clippings_parser::parse_clippings(&text);
    Ok(ParsedFile {
        path,
        file_hash,
        clippings,
    })
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
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn missing_file_is_an_error() {
        let result = parse_clippings_file("/definitely/not/here/clippings.txt".to_string());
        assert!(result.is_err());
    }
}
