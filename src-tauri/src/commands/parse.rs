use serde::Serialize;

use super::CommandError;
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

/// Read `My Clippings.txt` from disk, hash it (S5 dedupe key) and parse it (S2).
#[tauri::command]
pub fn parse_clippings_file(path: String) -> Result<ParsedFile, CommandError> {
    let bytes = std::fs::read(&path).map_err(|err| {
        log::warn!("import: cannot read '{path}': {err}");
        CommandError::new("parse", format!("cannot read file '{path}': {err}"))
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
