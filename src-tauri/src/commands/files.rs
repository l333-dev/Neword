use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const LEGACY_RECOVERY_DIR_NAME: &str = "neword-recovery";
const RECOVERY_DIR_NAME: &str = "recovery";
const BACKUPS_DIR_NAME: &str = "backups";
const STATE_DIR_NAME: &str = "state";
const LOGS_DIR_NAME: &str = "logs";
const LOCKS_DIR_NAME: &str = "locks";
const RECOVERY_MIGRATION_STATE_FILE: &str = "recovery-migration-v1.json";
const BACKUP_MANIFEST_FILE: &str = "manifest.json";
const MAX_PROJECT_OPEN_BYTES: u64 = 250 * 1024 * 1024;
const EDIT_LOCK_STALE_MILLIS: u128 = 30 * 60 * 1000;

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

#[derive(Debug, Serialize)]
pub struct AppDataPaths {
    app_data_dir: String,
    recovery_dir: String,
    backups_dir: String,
    state_dir: String,
    logs_dir: String,
    locks_dir: String,
    legacy_recovery_dir: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RecoveryMigrationState {
    completed: bool,
    checked_at: Option<String>,
    migrated_count: usize,
    invalid_count: usize,
    warnings: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct BackupManifestEntry {
    id: String,
    file_name: String,
    original_path: String,
    original_path_hash: String,
    created_at: String,
    byte_size: u64,
    format_version: Option<u64>,
    title: Option<String>,
    content_hash: String,
}

#[derive(Debug, Deserialize, Serialize, Default)]
struct BackupManifest {
    entries: Vec<BackupManifestEntry>,
}

#[derive(Debug, Serialize)]
pub struct BackupFileInfo {
    id: String,
    file_name: String,
    path: String,
    original_path: String,
    original_path_hash: String,
    created_at: String,
    byte_size: u64,
    format_version: Option<u64>,
    title: Option<String>,
    original_exists: bool,
    valid_json: bool,
    content_hash: String,
}

#[derive(Debug, Serialize)]
pub struct FileSnapshot {
    modified_millis: Option<u128>,
    byte_size: u64,
    content_hash: String,
}

#[derive(Debug, Serialize)]
pub struct OpenPathCandidate {
    path: String,
    exists: bool,
    is_file: bool,
    byte_size: u64,
    kind: String,
    supported: bool,
    safe_to_read: bool,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ProjectEditLock {
    schema_version: u32,
    lock_id: String,
    project_path_hash: String,
    project_path: Option<String>,
    process_id: Option<u32>,
    session_id: String,
    app_version: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct ProjectEditLockStatus {
    lock: Option<ProjectEditLock>,
    stale: bool,
    reason: String,
    pid_status: String,
    lock_state: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectEditLockRequest {
    project_path: String,
    session_id: String,
    app_version: String,
    keep_display_path: bool,
}

#[derive(Debug, Deserialize)]
pub struct RefreshProjectEditLockRequest {
    project_path: String,
    lock_id: String,
}

#[derive(Debug, Serialize)]
pub struct CleanupResult {
    deleted_count: usize,
    deleted_bytes: u64,
    failed_count: usize,
    warnings: Vec<String>,
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
    Ok(path.with_file_name(format!(".{file_name}.{millis}.{}.tmp", std::process::id())))
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
    let mut file = fs::File::create(&temp_path).map_err(|error| {
        file_error(
            "file.atomic_create_temp_failed",
            "atomic_write.create_temp",
            Some(&temp_path),
            true,
            "atomic保存用の一時ファイルを作成できませんでした。",
            Some(error.to_string()),
        )
    })?;
    if let Err(error) = file.write_all(bytes) {
        drop(file);
        let _ = fs::remove_file(&temp_path);
        return Err(file_error(
            "file.atomic_write_bytes_failed",
            "atomic_write.write",
            Some(&temp_path),
            true,
            "atomic保存用の一時ファイルへ書き込めませんでした。",
            Some(error.to_string()),
        ));
    }
    if let Err(error) = file.flush() {
        drop(file);
        let _ = fs::remove_file(&temp_path);
        return Err(file_error(
            "file.atomic_flush_failed",
            "atomic_write.flush",
            Some(&temp_path),
            true,
            "atomic保存用の一時ファイルをflushできませんでした。",
            Some(error.to_string()),
        ));
    }
    if let Err(error) = file.sync_all() {
        drop(file);
        let _ = fs::remove_file(&temp_path);
        return Err(file_error(
            "file.atomic_sync_failed",
            "atomic_write.sync",
            Some(&temp_path),
            true,
            "atomic保存用の一時ファイルをsyncできませんでした。",
            Some(error.to_string()),
        ));
    }
    drop(file);
    if let Err(error) = fs::rename(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(file_error(
            "file.atomic_rename_failed",
            "atomic_write.rename",
            Some(path),
            true,
            "atomic保存用の一時ファイルを保存先へ置換できませんでした。",
            Some(error.to_string()),
        ));
    }
    Ok(())
}

fn app_data_root(app: &AppHandle) -> Result<PathBuf, FileCommandError> {
    app.path().app_data_dir().map_err(|error| {
        file_error(
            "app_data.resolve_failed",
            "app_data",
            None,
            true,
            "アプリデータディレクトリを解決できませんでした。",
            Some(error.to_string()),
        )
    })
}

fn ensure_app_subdirs(app: &AppHandle) -> Result<AppDataPaths, FileCommandError> {
    let root = app_data_root(app)?;
    let recovery = root.join(RECOVERY_DIR_NAME);
    let backups = root.join(BACKUPS_DIR_NAME);
    let state = root.join(STATE_DIR_NAME);
    let logs = root.join(LOGS_DIR_NAME);
    let locks = root.join(LOCKS_DIR_NAME);
    for dir in [&root, &recovery, &backups, &state, &logs, &locks] {
        fs::create_dir_all(dir).map_err(|error| {
            file_error(
                "app_data.create_dir_failed",
                "app_data",
                Some(dir),
                true,
                "アプリデータディレクトリを作成できませんでした。",
                Some(error.to_string()),
            )
        })?;
        reject_symlink_dir(dir, "app_data")?;
    }
    Ok(AppDataPaths {
        app_data_dir: root.to_string_lossy().to_string(),
        recovery_dir: recovery.to_string_lossy().to_string(),
        backups_dir: backups.to_string_lossy().to_string(),
        state_dir: state.to_string_lossy().to_string(),
        logs_dir: logs.to_string_lossy().to_string(),
        locks_dir: locks.to_string_lossy().to_string(),
        legacy_recovery_dir: legacy_recovery_dir().to_string_lossy().to_string(),
    })
}

fn reject_symlink_dir(path: &Path, operation: &str) -> Result<(), FileCommandError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        file_error(
            "path.metadata_failed",
            operation,
            Some(path),
            true,
            "パス情報を取得できませんでした。",
            Some(error.to_string()),
        )
    })?;
    if metadata.file_type().is_symlink() {
        return Err(file_error(
            "path.symlink_rejected",
            operation,
            Some(path),
            false,
            "安全のためシンボリックリンクの保存先は使用しません。",
            None,
        ));
    }
    if !metadata.is_dir() {
        return Err(file_error(
            "path.not_directory",
            operation,
            Some(path),
            false,
            "保存先がディレクトリではありません。",
            None,
        ));
    }
    Ok(())
}

fn recovery_dir(app: &AppHandle) -> Result<PathBuf, FileCommandError> {
    Ok(PathBuf::from(ensure_app_subdirs(app)?.recovery_dir))
}

fn backups_dir(app: &AppHandle) -> Result<PathBuf, FileCommandError> {
    Ok(PathBuf::from(ensure_app_subdirs(app)?.backups_dir))
}

fn state_dir(app: &AppHandle) -> Result<PathBuf, FileCommandError> {
    Ok(PathBuf::from(ensure_app_subdirs(app)?.state_dir))
}

fn locks_dir(app: &AppHandle) -> Result<PathBuf, FileCommandError> {
    Ok(PathBuf::from(ensure_app_subdirs(app)?.locks_dir))
}

fn legacy_recovery_dir() -> PathBuf {
    std::env::temp_dir().join(LEGACY_RECOVERY_DIR_NAME)
}

fn stable_hash(value: &[u8]) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("fnv1a64-{hash:016x}")
}

fn safe_hash_for_text(value: &str) -> String {
    stable_hash(value.as_bytes())
}

fn backup_project_dir(app: &AppHandle, source_path: &Path) -> Result<PathBuf, FileCommandError> {
    let hash = safe_hash_for_text(&source_path.to_string_lossy());
    let dir = backups_dir(app)?.join(hash);
    fs::create_dir_all(&dir).map_err(|error| {
        file_error(
            "backup.create_dir_failed",
            "backup",
            Some(&dir),
            true,
            "バックアップディレクトリを作成できませんでした。",
            Some(error.to_string()),
        )
    })?;
    reject_symlink_dir(&dir, "backup")?;
    Ok(dir)
}

fn manifest_path(dir: &Path) -> PathBuf {
    dir.join(BACKUP_MANIFEST_FILE)
}

fn load_backup_manifest(dir: &Path) -> BackupManifest {
    let path = manifest_path(dir);
    let Ok(text) = fs::read_to_string(path) else {
        return BackupManifest::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn save_backup_manifest(dir: &Path, manifest: &BackupManifest) -> Result<(), FileCommandError> {
    let text = serde_json::to_vec_pretty(manifest).map_err(|error| {
        file_error(
            "backup.manifest_serialize_failed",
            "backup",
            Some(dir),
            false,
            "バックアップ管理情報を作成できませんでした。",
            Some(error.to_string()),
        )
    })?;
    write_atomic(&manifest_path(dir), &text)
}

fn project_json_metadata(bytes: &[u8]) -> (Option<u64>, Option<String>) {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return (None, None);
    };
    let format_version = value
        .get("formatVersion")
        .and_then(serde_json::Value::as_u64);
    let title = value
        .get("metadata")
        .and_then(|metadata| metadata.get("title"))
        .and_then(serde_json::Value::as_str)
        .map(ToString::to_string);
    (format_version, title)
}

fn create_backup(
    app: &AppHandle,
    path: &Path,
    limit: usize,
) -> Result<Option<BackupFileInfo>, FileCommandError> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|error| {
        file_error(
            "backup.source_read_failed",
            "backup",
            Some(path),
            true,
            "保存前バックアップ元を読み込めませんでした。",
            Some(error.to_string()),
        )
    })?;
    if serde_json::from_slice::<serde_json::Value>(&bytes).is_err() {
        return Ok(None);
    }
    let content_hash = stable_hash(&bytes);
    let dir = backup_project_dir(app, path)?;
    let mut manifest = load_backup_manifest(&dir);
    if manifest
        .entries
        .iter()
        .any(|entry| entry.content_hash == content_hash)
    {
        return Ok(None);
    }
    let millis = now_millis()?;
    let file_name = format!("backup-{millis}-{}.neword", std::process::id());
    let backup_path = dir.join(&file_name);
    write_atomic(&backup_path, &bytes)?;
    let metadata = fs::metadata(&backup_path).map_err(|error| {
        file_error(
            "backup.metadata_failed",
            "backup",
            Some(&backup_path),
            true,
            "バックアップ情報を取得できませんでした。",
            Some(error.to_string()),
        )
    })?;
    let (format_version, title) = project_json_metadata(&bytes);
    let entry = BackupManifestEntry {
        id: format!("backup-{millis}-{}", safe_hash_for_text(&file_name)),
        file_name: file_name.clone(),
        original_path: path.to_string_lossy().to_string(),
        original_path_hash: safe_hash_for_text(&path.to_string_lossy()),
        created_at: millis_to_iso(millis),
        byte_size: metadata.len(),
        format_version,
        title,
        content_hash,
    };
    manifest.entries.push(entry);
    rotate_backup_manifest(&dir, &mut manifest, limit);
    save_backup_manifest(&dir, &manifest)?;
    Ok(list_backup_infos_in_dir(&dir)
        .into_iter()
        .find(|info| info.file_name == file_name))
}

fn should_create_backup_for_save(path: &Path, backup_existing: bool) -> bool {
    backup_existing && path.exists()
}

fn rotate_backup_manifest(dir: &Path, manifest: &mut BackupManifest, limit: usize) {
    manifest
        .entries
        .sort_by(|a, b| a.created_at.cmp(&b.created_at));
    let remove_count = manifest.entries.len().saturating_sub(limit);
    let removed = manifest.entries.drain(0..remove_count).collect::<Vec<_>>();
    for entry in removed {
        let _ = fs::remove_file(dir.join(entry.file_name));
    }
}

fn list_backup_infos_in_dir(dir: &Path) -> Vec<BackupFileInfo> {
    let manifest = load_backup_manifest(dir);
    manifest
        .entries
        .into_iter()
        .filter_map(|entry| {
            let path = dir.join(&entry.file_name);
            let bytes = fs::read(&path).ok()?;
            let metadata = fs::metadata(&path).ok()?;
            Some(BackupFileInfo {
                id: entry.id,
                file_name: entry.file_name,
                path: path.to_string_lossy().to_string(),
                original_path: entry.original_path.clone(),
                original_path_hash: entry.original_path_hash,
                created_at: entry.created_at,
                byte_size: metadata.len(),
                format_version: entry.format_version,
                title: entry.title,
                original_exists: PathBuf::from(entry.original_path).exists(),
                valid_json: serde_json::from_slice::<serde_json::Value>(&bytes).is_ok(),
                content_hash: entry.content_hash,
            })
        })
        .collect()
}

fn millis_to_iso(millis: u128) -> String {
    format!("{millis}")
}

fn recovery_migration_state_path(app: &AppHandle) -> Result<PathBuf, FileCommandError> {
    Ok(state_dir(app)?.join(RECOVERY_MIGRATION_STATE_FILE))
}

fn safe_recovery_file_name(name: &str) -> Result<String, FileCommandError> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || !(name.ends_with(".json") || name.ends_with(".neword"))
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

fn safe_backup_id(id: &str) -> Result<String, FileCommandError> {
    if id.is_empty() || !id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-') {
        return Err(file_error(
            "backup.invalid_id",
            "backup",
            None,
            false,
            "バックアップIDが不正です。",
            None,
        ));
    }
    Ok(id.to_string())
}

fn file_snapshot_for(path: &Path) -> Result<FileSnapshot, FileCommandError> {
    let bytes = fs::read(path).map_err(|error| {
        file_error(
            "file.read_failed",
            "snapshot",
            Some(path),
            true,
            "ファイル情報を取得できませんでした。",
            Some(error.to_string()),
        )
    })?;
    let metadata = fs::metadata(path).map_err(|error| {
        file_error(
            "file.metadata_failed",
            "snapshot",
            Some(path),
            true,
            "ファイル情報を取得できませんでした。",
            Some(error.to_string()),
        )
    })?;
    let modified_millis = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis());
    Ok(FileSnapshot {
        modified_millis,
        byte_size: metadata.len(),
        content_hash: stable_hash(&bytes),
    })
}

fn classify_path(path: &Path) -> String {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "neword" | "json" => "project".to_string(),
        "docx" => "docx".to_string(),
        _ => "unsupported".to_string(),
    }
}

fn lock_path_for(app: &AppHandle, project_path: &Path) -> Result<PathBuf, FileCommandError> {
    let hash = safe_hash_for_text(&project_path.to_string_lossy());
    Ok(locks_dir(app)?.join(format!("{hash}.lock.json")))
}

fn now_millis_string() -> Result<String, FileCommandError> {
    Ok(now_millis()?.to_string())
}

fn load_lock(path: &Path) -> Option<ProjectEditLock> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn heartbeat_is_stale(lock: &ProjectEditLock) -> bool {
    let Ok(updated) = lock.updated_at.parse::<u128>() else {
        return true;
    };
    let Ok(now) = now_millis() else {
        return false;
    };
    now.saturating_sub(updated) > EDIT_LOCK_STALE_MILLIS
}

fn pid_status(process_id: Option<u32>) -> String {
    let Some(pid) = process_id else {
        return "unknown".to_string();
    };
    #[cfg(target_os = "linux")]
    {
        match fs::metadata(PathBuf::from(format!("/proc/{pid}"))) {
            Ok(_) => "exists".to_string(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => "missing".to_string(),
            Err(_) => "unknown".to_string(),
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = pid;
        "unknown".to_string()
    }
}

fn classify_lock_state(lock: &ProjectEditLock) -> (bool, String, String, String) {
    let heartbeat_stale = heartbeat_is_stale(lock);
    let pid = pid_status(lock.process_id);
    let state = match (heartbeat_stale, pid.as_str()) {
        (false, "exists") => "active",
        (true, "exists") => "heartbeat_stale_pid_exists",
        (false, "missing") => "pid_missing_heartbeat_fresh",
        (true, "missing") => "stale",
        (false, _) => "pid_unknown_heartbeat_fresh",
        (true, _) => "heartbeat_stale_pid_unknown",
    }
    .to_string();
    let stale = state == "stale";
    let reason = match state.as_str() {
        "active" => "別セッションで編集中の可能性があります。",
        "heartbeat_stale_pid_exists" => {
            "heartbeatは古いですが、記録されたPIDは存在します。利用者の判断が必要です。"
        }
        "pid_missing_heartbeat_fresh" => {
            "PIDは存在しませんがheartbeatは新しいため、利用者の判断が必要です。"
        }
        "stale" => "PIDも存在せずheartbeatも古いため、古い編集ロックの可能性が高いです。",
        "pid_unknown_heartbeat_fresh" => {
            "PID確認はできませんがheartbeatは新しいため、編集中の可能性があります。"
        }
        _ => "heartbeatは古いですがPID確認ができないため、利用者の判断が必要です。",
    }
    .to_string();
    (stale, pid, state, reason)
}

fn remove_lock_if_matches(
    app: &AppHandle,
    project_path: &Path,
    lock_id: &str,
) -> Result<(), FileCommandError> {
    let path = lock_path_for(app, project_path)?;
    let Some(lock) = load_lock(&path) else {
        return Ok(());
    };
    if lock.lock_id != lock_id {
        return Ok(());
    }
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(file_error(
            "lock.delete_failed",
            "edit_lock",
            Some(&path),
            true,
            "編集ロックを解除できませんでした。",
            Some(error.to_string()),
        )),
    }
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
    app: AppHandle,
    path: String,
    contents: String,
    backup_limit: usize,
    backup_existing: bool,
) -> Result<(), FileCommandError> {
    let path = PathBuf::from(path);
    serde_json::from_str::<serde_json::Value>(&contents).map_err(|error| {
        file_error(
            "json.validation_failed",
            "atomic_write",
            Some(&path),
            false,
            "保存前のJSON検証に失敗しました。",
            Some(error.to_string()),
        )
    })?;
    if should_create_backup_for_save(&path, backup_existing) {
        let _backup = create_backup(&app, &path, backup_limit)?;
    }
    write_atomic(&path, contents.as_bytes())?;
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
pub fn write_recovery_file(
    app: AppHandle,
    name: String,
    contents: String,
) -> Result<String, FileCommandError> {
    let name = safe_recovery_file_name(&name)?;
    serde_json::from_str::<serde_json::Value>(&contents).map_err(|error| {
        file_error(
            "recovery.validation_failed",
            "write_recovery",
            None,
            false,
            "リカバリデータのJSON検証に失敗しました。",
            Some(error.to_string()),
        )
    })?;
    let mut path = recovery_dir(&app)?;
    path.push(name);
    write_atomic(&path, contents.as_bytes())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_recovery_file(app: AppHandle, name: String) -> Result<String, FileCommandError> {
    let name = safe_recovery_file_name(&name)?;
    let mut path = recovery_dir(&app)?;
    path.push(name);
    read_text_file(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_recovery_file(app: AppHandle, name: String) -> Result<(), FileCommandError> {
    let name = safe_recovery_file_name(&name)?;
    let mut path = recovery_dir(&app)?;
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
pub fn list_recovery_files(app: AppHandle) -> Result<Vec<RecoveryFileInfo>, FileCommandError> {
    let dir = recovery_dir(&app)?;
    list_recovery_files_in_dir(&dir)
}

fn list_recovery_files_in_dir(dir: &Path) -> Result<Vec<RecoveryFileInfo>, FileCommandError> {
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

#[tauri::command]
pub fn recovery_dir_path(app: AppHandle) -> Result<String, FileCommandError> {
    recovery_dir(&app).map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn app_data_paths(app: AppHandle) -> Result<AppDataPaths, FileCommandError> {
    ensure_app_subdirs(&app)
}

#[tauri::command]
pub fn list_legacy_recovery_files() -> Result<Vec<RecoveryFileInfo>, FileCommandError> {
    let dir = legacy_recovery_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }
    list_recovery_files_in_dir(&dir)
}

#[tauri::command]
pub fn read_legacy_recovery_file(name: String) -> Result<String, FileCommandError> {
    let name = safe_recovery_file_name(&name)?;
    let mut path = legacy_recovery_dir();
    path.push(name);
    read_text_file(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn migrate_legacy_recovery_file(
    app: AppHandle,
    name: String,
) -> Result<String, FileCommandError> {
    let name = safe_recovery_file_name(&name)?;
    let mut source = legacy_recovery_dir();
    source.push(&name);
    let mut target = recovery_dir(&app)?;
    target.push(&name);
    if target.exists() {
        let source_meta = fs::metadata(&source).ok();
        let target_meta = fs::metadata(&target).ok();
        let source_modified = source_meta
            .and_then(|meta| meta.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        let target_modified = target_meta
            .and_then(|meta| meta.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        if target_modified >= source_modified {
            return Ok(target.to_string_lossy().to_string());
        }
    }
    let bytes = fs::read(&source).map_err(|error| {
        file_error(
            "recovery_legacy.read_failed",
            "migrate_recovery",
            Some(&source),
            true,
            "旧リカバリファイルを読み込めませんでした。",
            Some(error.to_string()),
        )
    })?;
    write_atomic(&target, &bytes)?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn recovery_migration_state(
    app: AppHandle,
) -> Result<RecoveryMigrationState, FileCommandError> {
    let path = recovery_migration_state_path(&app)?;
    let Ok(text) = fs::read_to_string(path) else {
        return Ok(RecoveryMigrationState {
            completed: false,
            checked_at: None,
            migrated_count: 0,
            invalid_count: 0,
            warnings: Vec::new(),
        });
    };
    serde_json::from_str(&text).map_err(|error| {
        file_error(
            "recovery_migration.state_invalid",
            "recovery_migration",
            None,
            true,
            "リカバリ移行状態を読み込めませんでした。",
            Some(error.to_string()),
        )
    })
}

#[tauri::command]
pub fn write_recovery_migration_state(
    app: AppHandle,
    state: RecoveryMigrationState,
) -> Result<(), FileCommandError> {
    let path = recovery_migration_state_path(&app)?;
    let text = serde_json::to_vec_pretty(&state).map_err(|error| {
        file_error(
            "recovery_migration.state_serialize_failed",
            "recovery_migration",
            Some(&path),
            false,
            "リカバリ移行状態を保存できませんでした。",
            Some(error.to_string()),
        )
    })?;
    write_atomic(&path, &text)
}

#[tauri::command]
pub fn list_backup_files(app: AppHandle) -> Result<Vec<BackupFileInfo>, FileCommandError> {
    let root = backups_dir(&app)?;
    let entries = fs::read_dir(&root).map_err(|error| {
        file_error(
            "backup.list_failed",
            "backup",
            Some(&root),
            true,
            "バックアップ一覧を取得できませんでした。",
            Some(error.to_string()),
        )
    })?;
    let mut backups = Vec::new();
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        backups.extend(list_backup_infos_in_dir(&path));
    }
    backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(backups)
}

#[tauri::command]
pub fn read_backup_file(app: AppHandle, id: String) -> Result<String, FileCommandError> {
    let id = safe_backup_id(&id)?;
    for backup in list_backup_files(app.clone())? {
        if backup.id == id {
            return read_text_file(backup.path);
        }
    }
    Err(file_error(
        "backup.not_found",
        "backup",
        None,
        false,
        "バックアップが見つかりませんでした。",
        None,
    ))
}

#[tauri::command]
pub fn delete_backup_file(app: AppHandle, id: String) -> Result<(), FileCommandError> {
    let id = safe_backup_id(&id)?;
    let root = backups_dir(&app)?;
    let mut found = false;
    let entries = fs::read_dir(&root).map_err(|error| {
        file_error(
            "backup.list_failed",
            "backup",
            Some(&root),
            true,
            "バックアップ一覧を取得できませんでした。",
            Some(error.to_string()),
        )
    })?;
    for entry in entries.filter_map(Result::ok) {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let mut manifest = load_backup_manifest(&dir);
        if let Some(index) = manifest.entries.iter().position(|entry| entry.id == id) {
            let entry = manifest.entries.remove(index);
            let path = dir.join(entry.file_name);
            match fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(file_error(
                        "backup.delete_failed",
                        "backup",
                        Some(&path),
                        true,
                        "バックアップを削除できませんでした。",
                        Some(error.to_string()),
                    ));
                }
            }
            save_backup_manifest(&dir, &manifest)?;
            found = true;
            break;
        }
    }
    if found {
        Ok(())
    } else {
        Err(file_error(
            "backup.not_found",
            "backup",
            None,
            false,
            "バックアップが見つかりませんでした。",
            None,
        ))
    }
}

#[tauri::command]
pub fn delete_all_backups(app: AppHandle) -> Result<(), FileCommandError> {
    let root = backups_dir(&app)?;
    for entry in fs::read_dir(&root)
        .map_err(|error| {
            file_error(
                "backup.list_failed",
                "backup",
                Some(&root),
                true,
                "バックアップ一覧を取得できませんでした。",
                Some(error.to_string()),
            )
        })?
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if path.is_dir() {
            fs::remove_dir_all(&path).map_err(|error| {
                file_error(
                    "backup.delete_failed",
                    "backup",
                    Some(&path),
                    true,
                    "バックアップを削除できませんでした。",
                    Some(error.to_string()),
                )
            })?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn file_snapshot(path: String) -> Result<FileSnapshot, FileCommandError> {
    file_snapshot_for(Path::new(&path))
}

#[tauri::command]
pub fn startup_open_paths() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .take(16)
        .collect()
}

#[tauri::command]
pub fn inspect_open_path(path: String) -> Result<OpenPathCandidate, FileCommandError> {
    let path_buf = PathBuf::from(&path);
    let kind = classify_path(&path_buf);
    let exists = path_buf.exists();
    let metadata = fs::metadata(&path_buf).ok();
    let is_file = metadata.as_ref().is_some_and(|metadata| metadata.is_file());
    let byte_size = metadata.as_ref().map_or(0, fs::Metadata::len);
    let supported = kind == "project" || kind == "docx";
    Ok(OpenPathCandidate {
        path,
        exists,
        is_file,
        byte_size,
        kind,
        supported,
        safe_to_read: exists && is_file && supported && byte_size <= MAX_PROJECT_OPEN_BYTES,
    })
}

#[tauri::command]
pub fn open_app_data_folder(app: AppHandle, folder: String) -> Result<(), FileCommandError> {
    let paths = ensure_app_subdirs(&app)?;
    let path = match folder.as_str() {
        "app_data" => PathBuf::from(paths.app_data_dir),
        "recovery" => PathBuf::from(paths.recovery_dir),
        "backups" => PathBuf::from(paths.backups_dir),
        _ => {
            return Err(file_error(
                "app_data.invalid_folder",
                "open_folder",
                None,
                false,
                "開けるフォルダー種別が不正です。",
                None,
            ));
        }
    };
    open_known_directory(&path)
}

fn open_known_directory(path: &Path) -> Result<(), FileCommandError> {
    if !path.is_dir() {
        return Err(file_error(
            "path.not_directory",
            "open_folder",
            Some(path),
            false,
            "開く対象がディレクトリではありません。",
            None,
        ));
    }
    #[cfg(target_os = "linux")]
    let mut command = Command::new("xdg-open");
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(path);
        return command.spawn().map(|_| ()).map_err(|error| {
            file_error(
                "open_folder.failed",
                "open_folder",
                Some(path),
                true,
                "フォルダーを開けませんでした。",
                Some(error.to_string()),
            )
        });
    };
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        command.arg(path);
        command.spawn().map(|_| ()).map_err(|error| {
            file_error(
                "open_folder.failed",
                "open_folder",
                Some(path),
                true,
                "フォルダーを開けませんでした。",
                Some(error.to_string()),
            )
        })
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        Err(file_error(
            "open_folder.unsupported_os",
            "open_folder",
            Some(path),
            false,
            "このOSではフォルダーを開けません。",
            None,
        ))
    }
}

#[tauri::command]
pub fn check_project_edit_lock(
    app: AppHandle,
    project_path: String,
) -> Result<ProjectEditLockStatus, FileCommandError> {
    let path = lock_path_for(&app, Path::new(&project_path))?;
    let Some(lock) = load_lock(&path) else {
        return Ok(ProjectEditLockStatus {
            lock: None,
            stale: false,
            reason: "ロックはありません。".to_string(),
            pid_status: "none".to_string(),
            lock_state: "none".to_string(),
        });
    };
    let (stale, pid_status, lock_state, reason) = classify_lock_state(&lock);
    Ok(ProjectEditLockStatus {
        lock: Some(lock),
        stale,
        reason,
        pid_status,
        lock_state,
    })
}

#[tauri::command]
pub fn create_project_edit_lock(
    app: AppHandle,
    request: CreateProjectEditLockRequest,
) -> Result<ProjectEditLock, FileCommandError> {
    let project_path = PathBuf::from(&request.project_path);
    let path = lock_path_for(&app, &project_path)?;
    let now = now_millis_string()?;
    let lock = ProjectEditLock {
        schema_version: 1,
        lock_id: format!("lock-{}-{}", now, std::process::id()),
        project_path_hash: safe_hash_for_text(&project_path.to_string_lossy()),
        project_path: if request.keep_display_path {
            Some(project_path.to_string_lossy().to_string())
        } else {
            None
        },
        process_id: Some(std::process::id()),
        session_id: request.session_id,
        app_version: request.app_version,
        created_at: now.clone(),
        updated_at: now,
    };
    let text = serde_json::to_vec_pretty(&lock).map_err(|error| {
        file_error(
            "lock.serialize_failed",
            "edit_lock",
            Some(&path),
            false,
            "編集ロックを作成できませんでした。",
            Some(error.to_string()),
        )
    })?;
    write_atomic(&path, &text)?;
    Ok(lock)
}

#[tauri::command]
pub fn refresh_project_edit_lock(
    app: AppHandle,
    request: RefreshProjectEditLockRequest,
) -> Result<(), FileCommandError> {
    let project_path = PathBuf::from(&request.project_path);
    let path = lock_path_for(&app, &project_path)?;
    let Some(mut lock) = load_lock(&path) else {
        return Ok(());
    };
    if lock.lock_id != request.lock_id {
        return Ok(());
    }
    lock.updated_at = now_millis_string()?;
    let text = serde_json::to_vec_pretty(&lock).map_err(|error| {
        file_error(
            "lock.serialize_failed",
            "edit_lock",
            Some(&path),
            false,
            "編集ロックを更新できませんでした。",
            Some(error.to_string()),
        )
    })?;
    write_atomic(&path, &text)
}

#[tauri::command]
pub fn release_project_edit_lock(
    app: AppHandle,
    project_path: String,
    lock_id: String,
) -> Result<(), FileCommandError> {
    remove_lock_if_matches(&app, Path::new(&project_path), &lock_id)
}

#[tauri::command]
pub fn cleanup_temporary_files(app: AppHandle) -> Result<CleanupResult, FileCommandError> {
    let paths = ensure_app_subdirs(&app)?;
    let roots = [
        PathBuf::from(paths.recovery_dir),
        PathBuf::from(paths.backups_dir),
        PathBuf::from(paths.state_dir),
        PathBuf::from(paths.logs_dir),
    ];
    let now = now_millis()?;
    let mut result = CleanupResult {
        deleted_count: 0,
        deleted_bytes: 0,
        failed_count: 0,
        warnings: Vec::new(),
    };
    for root in roots {
        cleanup_temporary_files_in_dir(&root, now, &mut result);
    }
    Ok(result)
}

fn cleanup_temporary_files_in_dir(root: &Path, now: u128, result: &mut CleanupResult) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            cleanup_temporary_files_in_dir(&path, now, result);
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let app_owned_temp = name.contains(".tmp") || name.starts_with("neword-files-");
        if !app_owned_temp {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or(now);
        if now.saturating_sub(modified) < 24 * 60 * 60 * 1000 {
            continue;
        }
        let size = metadata.len();
        match fs::remove_file(&path) {
            Ok(()) => {
                result.deleted_count += 1;
                result.deleted_bytes += size;
            }
            Err(error) => {
                result.failed_count += 1;
                result
                    .warnings
                    .push(format!("delete_failed:{name}:{error}"));
            }
        }
    }
}

#[tauri::command]
pub fn cleanup_stale_edit_locks(app: AppHandle) -> Result<CleanupResult, FileCommandError> {
    let dir = locks_dir(&app)?;
    let mut result = CleanupResult {
        deleted_count: 0,
        deleted_bytes: 0,
        failed_count: 0,
        warnings: Vec::new(),
    };
    let entries = fs::read_dir(&dir).map_err(|error| {
        file_error(
            "lock.list_failed",
            "edit_lock",
            Some(&dir),
            true,
            "編集ロックを列挙できませんでした。",
            Some(error.to_string()),
        )
    })?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !entry
            .file_type()
            .map(|item| item.is_file())
            .unwrap_or(false)
        {
            continue;
        }
        let Some(lock) = load_lock(&path) else {
            result.warnings.push("invalid_lock_skipped".to_string());
            continue;
        };
        let (stale, _pid, _state, _reason) = classify_lock_state(&lock);
        if !stale {
            continue;
        }
        let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
        match fs::remove_file(&path) {
            Ok(()) => {
                result.deleted_count += 1;
                result.deleted_bytes += size;
            }
            Err(error) => {
                result.failed_count += 1;
                result.warnings.push(format!("lock_delete_failed:{error}"));
            }
        }
    }
    Ok(result)
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
    fn atomic_write_replaces_file_without_truncating_existing() -> Result<(), Box<dyn Error>> {
        let dir = temp_dir("atomic")?;
        let path = dir.join("project.json");
        fs::write(&path, "old")?;

        super::write_text_file_atomic(path.to_string_lossy().to_string(), "new".into())
            .map_err(|error| error.human_readable_message)?;

        let temp_files = fs::read_dir(&dir)?
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(fs::read_to_string(&path)?, "new");
        assert_eq!(temp_files, 0);
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
    fn atomic_write_reports_rename_stage_without_losing_existing_directory(
    ) -> Result<(), Box<dyn Error>> {
        let dir = temp_dir("rename-stage")?;
        let path = dir.join("日本語 名前.neword");
        fs::create_dir(&path)?;

        let result =
            super::write_text_file_atomic(path.to_string_lossy().to_string(), "data".into());

        assert!(matches!(
            result,
            Err(error)
                if error.code == "file.atomic_rename_failed"
                    && error.operation == "atomic_write.rename"
        ));
        assert!(path.is_dir());
        let temp_files = fs::read_dir(&dir)?
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(temp_files, 0);
        fs::remove_dir_all(dir)?;
        Ok(())
    }

    #[test]
    fn backup_is_only_created_for_existing_overwrite_targets() -> Result<(), Box<dyn Error>> {
        let dir = temp_dir("backup-decision")?;
        let first_save = dir.join("test.neword");
        assert!(!super::should_create_backup_for_save(&first_save, true));

        fs::write(&first_save, "{}")?;
        assert!(super::should_create_backup_for_save(&first_save, true));
        assert!(!super::should_create_backup_for_save(&first_save, false));

        fs::remove_dir_all(dir)?;
        Ok(())
    }

    #[test]
    fn recovery_file_name_rejects_path_traversal() {
        assert!(super::safe_recovery_file_name("../bad.json").is_err());
        assert!(super::safe_recovery_file_name("nested/bad.json").is_err());
        assert!(super::safe_recovery_file_name("ok.json").is_ok());
        assert!(super::safe_recovery_file_name("ok.neword").is_ok());
    }
}
