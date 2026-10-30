//! Tauri commands: file import and export entry points (T4).

use serde::Serialize;
use sha2::{Digest, Sha256};

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
}
