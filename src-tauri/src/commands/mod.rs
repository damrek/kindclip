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

#[cfg(test)]
mod test_support;

pub(crate) use auto_backup::*;
pub(crate) use backup::*;
pub(crate) use diagnostics::*;
pub(crate) use export::*;
pub(crate) use parse::*;
pub(crate) use restore::*;
