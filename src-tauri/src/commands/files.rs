use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use base64::Engine;

fn temp_path_for(path: &Path) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "invalid file name".to_string())?;
    Ok(path.with_file_name(format!(".{file_name}.tmp")))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp_path = temp_path_for(path)?;
    {
        let mut file = fs::File::create(&temp_path).map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
    }
    fs::rename(&temp_path, path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn write_text_file_atomic(path: String, contents: String) -> Result<(), String> {
    write_atomic(Path::new(&path), contents.as_bytes())
}

#[tauri::command]
pub fn write_binary_file_base64_atomic(path: String, base64: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64)
        .map_err(|error| error.to_string())?;
    write_atomic(Path::new(&path), &bytes)
}
