//! kindclip application library entry point.
//!
//! Data layer (T3): schema migrations run automatically when the
//! `sqlite:kindclip.db` pool is (pre)loaded. All SQL goes through the
//! frontend port (`src/lib/db.ts`); Rust owns parsing (T2) and import
//! entry points (T4).

use tauri_plugin_sql::{Migration, MigrationKind};

const DB_URL: &str = "sqlite:kindclip.db";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "init_kindclip_schema",
        sql: include_str!("../migrations/001_init.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running kindclip");
}
