//! kindclip application library entry point.
//!
//! Data layer (T3): schema migrations run automatically when the
//! `sqlite:kindclip.db` pool is (pre)loaded. All SQL goes through the
//! frontend port (`src/lib/db.ts`); Rust owns parsing (T2) and the import and
//! export entry points (T4).

use tauri_plugin_sql::{Migration, MigrationKind};

mod commands;

const DB_URL: &str = "sqlite:kindclip.db";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "init_kindclip_schema",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "user_settings",
            sql: include_str!("../migrations/002_settings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "note_editing",
            sql: include_str!("../migrations/003_note_editing.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "clipping_tags",
            sql: include_str!("../migrations/004_tags.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::parse_clippings_file,
            commands::db_file_path,
            commands::write_export_file,
            commands::export_default_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running kindclip");
}
