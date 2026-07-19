use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::Serialize;

const BACKUP_EXTENSION: &str = "bak";
const RECOVERY_DIR_NAME: &str = "neword-recovery";

#[derive(Debug, Serialize)]
pub struct FileCommandError {
    code: String,
    operation: String,
    path: Option<String>,
    retryable: bool,
    human_readable_message: String,
    technical_cause: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RecoveryFileInfo {
    name: String,
    path: String,
    modified_millis: Option<u128>,
    byte_size: u64,
}

fn file_error(
    code: &str,
    operation: &str,
    path: Option<&Path>,
    retryable: bool,
    message: &str,
    cause: Option<String>,
) -> FileCommandError {
    FileCommandError {
        code: code.to_string(),
        operation: operation.to_string(),
        path: path.map(|item| item.to_string_lossy().to_string()),
        retryable,
        human_readable_message: message.to_string(),
        technical_cause: cause,
    }
}

fn temp_path_for(path: &Path) -> Result<PathBuf, FileCommandError> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            file_error(
                "path.invalid_file_name",
                "temp_path",
                Some(path),
                false,
                "保存先ファイル名が不正です。",
                None,
            )
        })?;
    let millis = now_millis().unwrap_or(0);
    Ok(path.with_file_name(format!(".{file_name}.{millis}.tmp")))
}

fn ensure_parent(path: &Path, operation: &str) -> Result<(), FileCommandError> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    if !parent.exists() {
        return Err(file_error(
            "path.parent_missing",
            operation,
            Some(path),
            false,
            "保存先の親ディレクトリが存在しません。",
            None,
        ));
    }
    if !parent.is_dir() {
        return Err(file_error(
            "path.parent_not_directory",
            operation,
            Some(path),
            false,
            "保存先の親パスがディレクトリではありません。",
            None,
        ));
    }
    Ok(())
}

fn now_millis() -> Result<u128, FileCommandError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(|error| {
            file_error(
                "time.system_time_error",
                "time",
                None,
                true,
                "現在時刻を取得できませんでした。",
                Some(error.to_string()),
            )
        })
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), FileCommandError> {
    ensure_parent(path, "atomic_write")?;
    let temp_path = temp_path_for(path)?;
    let write_result = (|| {
        let mut file = fs::File::create(&temp_path).map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.flush().map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&temp_path, path).map_err(|error| error.to_string())
    })();
    if let Err(message) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(file_error(
            "file.atomic_write_failed",
            "atomic_write",
            Some(path),
            true,
            "ファイルのatomic保存に失敗しました。",
            Some(message),
        ));
    }
    Ok(())
}

fn backup_path_for(path: &Path) -> Result<PathBuf, FileCommandError> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            file_error(
                "path.invalid_file_name",
                "backup_path",
                Some(path),
                false,
                "バックアップ対象ファイル名が不正です。",
                None,
            )
        })?;
    let millis = now_millis()?;
    Ok(path.with_file_name(format!("{file_name}.{millis}.{BACKUP_EXTENSION}")))
}

fn create_backup(path: &Path) -> Result<Option<PathBuf>, FileCommandError> {
    if !path.exists() {
        return Ok(None);
    }
    let backup_path = backup_path_for(path)?;
    fs::copy(path, &backup_path).map_err(|error| {
        file_error(
            "backup.copy_failed",
            "backup",
            Some(path),
            true,
            "保存前バックアップを作成できませんでした。",
            Some(error.to_string()),
        )
    })?;
    Ok(Some(backup_path))
}

fn rotate_backups(path: &Path, limit: usize) {
    if limit == 0 {
        return;
    }
    let Some(parent) = path.parent() else {
        return;
    };
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return;
    };
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    let mut backups = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with(&format!("{file_name}.")) || !name.ends_with(".bak") {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            let modified = metadata.modified().ok()?;
            Some((entry.path(), modified))
        })
        .collect::<Vec<_>>();
    backups.sort_by_key(|(_, modified)| *modified);
    let remove_count = backups.len().saturating_sub(limit);
    for (backup_path, _) in backups.into_iter().take(remove_count) {
        let _ = fs::remove_file(backup_path);
    }
}

fn recovery_dir() -> Result<PathBuf, FileCommandError> {
    let mut dir = std::env::temp_dir();
    dir.push(RECOVERY_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|error| {
        file_error(
            "recovery.create_dir_failed",
            "recovery_dir",
            Some(&dir),
            true,
            "復旧ディレクトリを作成できませんでした。",
            Some(error.to_string()),
        )
    })?;
    Ok(dir)
}

fn safe_recovery_file_name(name: &str) -> Result<String, FileCommandError> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || !name.ends_with(".json")
    {
        return Err(file_error(
            "recovery.invalid_name",
            "recovery",
            None,
            false,
            "復旧ファイル名が不正です。",
            None,
        ));
    }
    Ok(name.to_string())
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, FileCommandError> {
    let path = PathBuf::from(path);
    fs::read_to_string(&path).map_err(|error| {
        file_error(
            "file.read_failed",
            "read",
            Some(&path),
            true,
            "ファイルを読み込めませんでした。",
            Some(error.to_string()),
        )
    })
}

#[tauri::command]
pub fn read_binary_file_base64(path: String) -> Result<String, FileCommandError> {
    let path = PathBuf::from(path);
    let bytes = fs::read(&path).map_err(|error| {
        file_error(
            "file.read_failed",
            "read_binary",
            Some(&path),
            true,
            "ファイルを読み込めませんでした。",
            Some(error.to_string()),
        )
    })?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub fn write_text_file_atomic(path: String, contents: String) -> Result<(), FileCommandError> {
    write_atomic(Path::new(&path), contents.as_bytes())
}

#[tauri::command]
pub fn write_text_file_atomic_with_backup(
    path: String,
    contents: String,
    backup_limit: usize,
) -> Result<(), FileCommandError> {
    let path = PathBuf::from(path);
    let _backup = create_backup(&path)?;
    write_atomic(&path, contents.as_bytes())?;
    rotate_backups(&path, backup_limit);
    Ok(())
}

#[tauri::command]
pub fn write_binary_file_base64_atomic(
    path: String,
    base64: String,
) -> Result<(), FileCommandError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64)
        .map_err(|error| {
            file_error(
                "base64.decode_failed",
                "write_binary",
                Some(Path::new(&path)),
                false,
                "base64データを復号できませんでした。",
                Some(error.to_string()),
            )
        })?;
    write_atomic(Path::new(&path), &bytes)
}

#[tauri::command]
pub fn write_recovery_file(name: String, contents: String) -> Result<String, FileCommandError> {
    let name = safe_recovery_file_name(&name)?;
    let mut path = recovery_dir()?;
    path.push(name);
    write_atomic(&path, contents.as_bytes())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_recovery_file(name: String) -> Result<String, FileCommandError> {
    let name = safe_recovery_file_name(&name)?;
    let mut path = recovery_dir()?;
    path.push(name);
    read_text_file(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_recovery_file(name: String) -> Result<(), FileCommandError> {
    let name = safe_recovery_file_name(&name)?;
    let mut path = recovery_dir()?;
    path.push(name);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(file_error(
            "recovery.delete_failed",
            "delete_recovery",
            Some(&path),
            true,
            "復旧ファイルを削除できませんでした。",
            Some(error.to_string()),
        )),
    }
}

#[tauri::command]
pub fn list_recovery_files() -> Result<Vec<RecoveryFileInfo>, FileCommandError> {
    let dir = recovery_dir()?;
    let entries = fs::read_dir(&dir).map_err(|error| {
        file_error(
            "recovery.list_failed",
            "list_recovery",
            Some(&dir),
            true,
            "復旧ファイル一覧を取得できませんでした。",
            Some(error.to_string()),
        )
    })?;
    let mut files = Vec::new();
    for entry in entries {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if safe_recovery_file_name(name).is_err() {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let modified_millis = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis());
        files.push(RecoveryFileInfo {
            name: name.to_string(),
            path: path.to_string_lossy().to_string(),
            modified_millis,
            byte_size: metadata.len(),
        });
    }
    files.sort_by_key(|file| file.modified_millis.unwrap_or(0));
    files.reverse();
    Ok(files)
}

#[cfg(test)]
mod tests {
    use std::error::Error;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> Result<PathBuf, Box<dyn Error>> {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let path = std::env::temp_dir().join(format!(
            "neword-files-{name}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&path)?;
        Ok(path)
    }

    #[test]
    fn atomic_write_replaces_file_and_rotates_backups() -> Result<(), Box<dyn Error>> {
        let dir = temp_dir("atomic")?;
        let path = dir.join("project.json");
        fs::write(&path, "old")?;

        super::write_text_file_atomic_with_backup(
            path.to_string_lossy().to_string(),
            "one".into(),
            2,
        )
        .map_err(|error| error.human_readable_message)?;
        super::write_text_file_atomic_with_backup(
            path.to_string_lossy().to_string(),
            "two".into(),
            2,
        )
        .map_err(|error| error.human_readable_message)?;
        super::write_text_file_atomic_with_backup(
            path.to_string_lossy().to_string(),
            "three".into(),
            2,
        )
        .map_err(|error| error.human_readable_message)?;

        let backups = fs::read_dir(&dir)?
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".bak"))
            .count();
        assert_eq!(fs::read_to_string(&path)?, "three");
        assert_eq!(backups, 2);
        fs::remove_dir_all(dir)?;
        Ok(())
    }

    #[test]
    fn atomic_write_rejects_missing_parent_without_creating_target() -> Result<(), Box<dyn Error>> {
        let dir = temp_dir("missing-parent")?;
        let path = dir.join("missing").join("project.json");
        let result =
            super::write_text_file_atomic(path.to_string_lossy().to_string(), "data".into());

        assert!(matches!(
            result,
            Err(error) if error.code == "path.parent_missing"
        ));
        assert!(!path.exists());
        fs::remove_dir_all(dir)?;
        Ok(())
    }

    #[test]
    fn recovery_file_name_rejects_path_traversal() {
        assert!(super::safe_recovery_file_name("../bad.json").is_err());
        assert!(super::safe_recovery_file_name("nested/bad.json").is_err());
        assert!(super::safe_recovery_file_name("ok.json").is_ok());
    }
}
