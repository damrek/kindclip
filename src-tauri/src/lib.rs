//! kindclip application library entry point.
//!
//! Data layer (T3): schema migrations run automatically when the
//! `sqlite:kindclip.db` pool is (pre)loaded. All SQL goes through the
//! frontend port (`src/lib/db.ts`); Rust owns parsing (T2) and the import and
//! export entry points (T4).

use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
use tauri_plugin_sql::{Migration, MigrationKind};
use tauri_plugin_window_state::StateFlags;

mod commands;

const DB_URL: &str = "sqlite:kindclip.db";
const LOG_MAX_BYTES: u128 = 1_000_000;
const LOG_FILES_KEPT: usize = 3;

/// Development runs use their own file so `tauri dev` output never mixes with
/// the log an installed build keeps for a bug report.
fn log_file_name() -> String {
    if cfg!(debug_assertions) {
        "kindclip-dev".into()
    } else {
        "kindclip".into()
    }
}

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
        Migration {
            version: 5,
            description: "search_folding",
            sql: include_str!("../migrations/005_search_folding.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                // sqlx logs bound parameters at debug level; clipping and note
                // text must never reach the diagnostic file.
                .level_for("sqlx", log::LevelFilter::Warn)
                .level_for("tauri_plugin_sql", log::LevelFilter::Info)
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some(log_file_name()),
                    }),
                ])
                .rotation_strategy(RotationStrategy::KeepSome(LOG_FILES_KEPT))
                .max_file_size(LOG_MAX_BYTES)
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .build(),
        )
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    StateFlags::SIZE
                        | StateFlags::POSITION
                        | StateFlags::MAXIMIZED
                        | StateFlags::VISIBLE,
                )
                .build(),
        )
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let db_path = app.path().app_config_dir()?.join("kindclip.db");
            log::info!(
                "kindclip {} started on {} {} (db: {})",
                app.package_info().version,
                std::env::consts::OS,
                std::env::consts::ARCH,
                db_path.display()
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::parse_clippings_file,
            commands::db_file_path,
            commands::open_logs_dir,
            commands::open_db_dir,
            commands::write_export_file,
            commands::export_default_path,
            commands::check_export_targets,
            commands::write_export_files,
            commands::validate_backup_file,
            commands::clear_backup_target,
            commands::restore_database_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running kindclip");
}
