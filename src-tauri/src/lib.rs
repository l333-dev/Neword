mod commands;
mod docx;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            commands::docx::inspect_docx_package,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| {
            eprintln!("failed to run application: {error}");
        });
}
