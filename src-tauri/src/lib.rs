//! kindclip application library entry point.
//!
//! Commands and services (import, store) are wired here in T3/T4.
//! Pure `My Clippings.txt` parsing lives in the `clippings-parser` crate.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running kindclip");
}
