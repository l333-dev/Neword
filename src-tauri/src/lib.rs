mod commands;
mod docx;
mod menu;

use serde::Serialize;
use tauri::{Emitter, Manager};

const OPEN_PATHS_EVENT: &str = "neword://open-paths";

#[derive(Clone, Serialize)]
struct OpenPathsPayload {
    paths: Vec<String>,
    source: String,
}

fn candidate_paths(args: Vec<String>) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .take(16)
        .collect()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            let paths = candidate_paths(args);
            if !paths.is_empty() {
                let _ = app.emit(
                    OPEN_PATHS_EVENT,
                    OpenPathsPayload {
                        paths,
                        source: "single-instance".to_string(),
                    },
                );
            }
        }))
        .manage(commands::docx::DocxImportCancellationState::default())
        .setup(|app| {
            menu::install_app_menu(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::files::read_text_file,
            commands::files::read_binary_file_base64,
            commands::files::write_text_file_atomic,
            commands::files::write_text_file_atomic_with_backup,
            commands::files::write_binary_file_base64_atomic,
            commands::files::write_recovery_file,
            commands::files::read_recovery_file,
            commands::files::delete_recovery_file,
            commands::files::list_recovery_files,
            commands::files::recovery_dir_path,
            commands::files::app_data_paths,
            commands::files::list_legacy_recovery_files,
            commands::files::read_legacy_recovery_file,
            commands::files::migrate_legacy_recovery_file,
            commands::files::recovery_migration_state,
            commands::files::write_recovery_migration_state,
            commands::files::list_backup_files,
            commands::files::read_backup_file,
            commands::files::delete_backup_file,
            commands::files::delete_all_backups,
            commands::files::file_snapshot,
            commands::files::startup_open_paths,
            commands::files::inspect_open_path,
            commands::files::open_app_data_folder,
            commands::files::check_project_edit_lock,
            commands::files::create_project_edit_lock,
            commands::files::refresh_project_edit_lock,
            commands::files::release_project_edit_lock,
            commands::files::cleanup_temporary_files,
            commands::files::cleanup_stale_edit_locks,
            commands::docx::inspect_docx_package,
            commands::docx::inspect_docx_package_cancellable,
            commands::docx::cancel_docx_import,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| {
            eprintln!("failed to run application: {error}");
        });
}
