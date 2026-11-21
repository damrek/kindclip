//! Shared fixtures for the command tests: throwaway directories and files
//! that carry a valid SQLite header.

use std::path::{Path, PathBuf};

/// Fresh, empty directory under the system temp dir; any leftover from an
/// interrupted run is removed first.
pub(crate) fn fresh_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(name);
    std::fs::remove_dir_all(&dir).ok();
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

pub(crate) fn backup_dir(name: &str) -> PathBuf {
    fresh_dir(&format!("kindclip-t5-{name}"))
}

/// Bytes of a minimal file that passes the SQLite header check.
pub(crate) fn sqlite_bytes(contents: &[u8]) -> Vec<u8> {
    let mut bytes = b"SQLite format 3\0".to_vec();
    bytes.extend_from_slice(contents);
    bytes
}

pub(crate) fn write_sqlite(path: &Path, contents: &[u8]) {
    std::fs::write(path, sqlite_bytes(contents)).unwrap();
}
