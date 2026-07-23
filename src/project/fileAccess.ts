import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

import type { DocumentProject } from "../document-model/schema";
import { deserializeProject, serializeProject } from "./serialization";

export type SaveStatus =
  | "saved"
  | "dirty"
  | "saving"
  | "error"
  | "autosave-pending"
  | "autosaving"
  | "autosaved"
  | "autosave-error"
  | "recovered";

export const PROJECT_BACKUP_LIMIT = 5;
export const PROJECT_EXTENSION = "neword";
export const LEGACY_PROJECT_EXTENSION = "json";

export type FileCommandError = {
  code: string;
  operation: string;
  path: string | null;
  retryable: boolean;
  human_readable_message: string;
  technical_cause: string | null;
};

export type RecoveryFileInfo = {
  name: string;
  path: string;
  modified_millis: number | null;
  byte_size: number;
};

export type AppDataPaths = {
  app_data_dir: string;
  recovery_dir: string;
  backups_dir: string;
  state_dir: string;
  logs_dir: string;
  locks_dir: string;
  legacy_recovery_dir: string;
};

export type RecoveryMigrationState = {
  completed: boolean;
  checked_at: string | null;
  migrated_count: number;
  invalid_count: number;
  warnings: string[];
};

export type BackupFileInfo = {
  id: string;
  file_name: string;
  path: string;
  original_path: string;
  original_path_hash: string;
  created_at: string;
  byte_size: number;
  format_version: number | null;
  title: string | null;
  original_exists: boolean;
  valid_json: boolean;
  content_hash: string;
};

export type FileSnapshot = {
  modified_millis: number | null;
  byte_size: number;
  content_hash: string;
};

export type OpenPathCandidate = {
  path: string;
  exists: boolean;
  is_file: boolean;
  byte_size: number;
  kind: string;
  supported: boolean;
  safe_to_read: boolean;
};

export type ProjectEditLock = {
  schema_version: number;
  lock_id: string;
  project_path_hash: string;
  project_path: string | null;
  process_id: number | null;
  session_id: string;
  app_version: string;
  created_at: string;
  updated_at: string;
};

export type ProjectEditLockStatus = {
  lock: ProjectEditLock | null;
  stale: boolean;
  reason: string;
  pid_status: "none" | "exists" | "missing" | "unknown";
  lock_state:
    | "none"
    | "active"
    | "heartbeat_stale_pid_exists"
    | "pid_missing_heartbeat_fresh"
    | "stale"
    | "pid_unknown_heartbeat_fresh"
    | "heartbeat_stale_pid_unknown";
};

export type CleanupResult = {
  deleted_count: number;
  deleted_bytes: number;
  failed_count: number;
  warnings: string[];
};

export type DocxEntryInfo = {
  name: string;
  compressed_size: number;
  uncompressed_size: number;
};

export type DocxImageRelationship = {
  relationship_id: string;
  relationship_type: string;
  target: string;
  source_part: string;
  resolved_part: string | null;
  mime_type: string | null;
  byte_size: number | null;
  data_base64: string | null;
  external: boolean;
  checksum: string | null;
  warning_code: string | null;
  warning_message: string | null;
};

export type DocxImageWarning = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  relationship_id: string | null;
  part: string | null;
  position: number | null;
  simplified: string | null;
};

export type DocxPageMargins = {
  top_twips: number | null;
  right_twips: number | null;
  bottom_twips: number | null;
  left_twips: number | null;
  header_twips: number | null;
  footer_twips: number | null;
  gutter_twips: number | null;
};

export type DocxPageSettings = {
  width_twips: number | null;
  height_twips: number | null;
  orientation: string | null;
  margins: DocxPageMargins | null;
};

export type DocxSection = {
  index: number;
  paragraph_index: number | null;
  page_settings: DocxPageSettings | null;
  break_type: string | null;
  has_columns: boolean;
  has_page_borders: boolean;
  has_title_page: boolean;
  header_references?: string[];
  footer_references?: string[];
};

export type DocxHeaderFooter = {
  kind: "header" | "footer";
  reference_type: string;
  relationship_id: string | null;
  source_part: string | null;
  text: string;
  has_page_number: boolean;
  unsupported_features: string[];
};

export type DocxParagraphFormatting = {
  index: number;
  alignment: string | null;
  indent_left_twips: number | null;
  indent_right_twips: number | null;
  first_line_twips: number | null;
  hanging_twips: number | null;
  spacing_before_twips: number | null;
  spacing_after_twips: number | null;
  line_twips: number | null;
  line_rule: string | null;
  page_break_before: boolean;
  keep_next: boolean;
  keep_lines: boolean;
  widow_control: boolean | null;
  has_page_break: boolean;
  has_rendered_page_break?: boolean;
  has_column_break?: boolean;
};

export type DocxTableWarning = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  table_index: number;
  row_index: number | null;
  cell_index: number | null;
  simplified: string | null;
};

export type DocxUnsupportedFeature = {
  code: string;
  category: string;
  severity: "info" | "warning" | "error";
  count: number;
  affected_part: string;
  can_continue: boolean;
  recommendation: string;
};

export type DocxInspection = {
  has_document_xml: boolean;
  has_styles_xml: boolean;
  has_numbering_xml: boolean;
  has_settings_xml: boolean;
  has_headers: boolean;
  has_footers: boolean;
  has_macros: boolean;
  headers: DocxHeaderFooter[];
  footers: DocxHeaderFooter[];
  media_entries: string[];
  image_relationships: DocxImageRelationship[];
  image_warnings: DocxImageWarning[];
  sections: DocxSection[];
  paragraphs: DocxParagraphFormatting[];
  table_warnings: DocxTableWarning[];
  unsupported_features: DocxUnsupportedFeature[];
  entries: DocxEntryInfo[];
  warnings: string[];
};

export type OpenDocxResult = {
  path: string;
  name: string;
  base64: string;
  inspection: DocxInspection;
};

export type OpenImageResult = {
  path: string;
  name: string;
  base64: string;
};

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? "image";
}

function docxNameFromPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.split("/").at(-1) ?? "document.docx";
}

export async function saveProjectWithDialog(project: DocumentProject): Promise<string | null> {
  const path = await save({
    title: "プロジェクトを保存",
    defaultPath: `${project.metadata.title || "document"}.${PROJECT_EXTENSION}`,
    filters: [
      { name: "Neword Project", extensions: [PROJECT_EXTENSION] },
      { name: "Legacy JSON Project", extensions: [LEGACY_PROJECT_EXTENSION] },
    ],
  });
  if (!path) return null;
  await invoke("write_text_file_atomic_with_backup", {
    path,
    contents: serializeProject(project),
    backupLimit: PROJECT_BACKUP_LIMIT,
  });
  return path;
}

export async function saveProjectToPath(path: string, project: DocumentProject): Promise<void> {
  await invoke("write_text_file_atomic_with_backup", {
    path,
    contents: serializeProject(project),
    backupLimit: PROJECT_BACKUP_LIMIT,
  });
}

export async function writeProjectAutosave(name: string, contents: string): Promise<string> {
  return invoke<string>("write_recovery_file", { name, contents });
}

export async function listRecoveryFiles(): Promise<RecoveryFileInfo[]> {
  return invoke<RecoveryFileInfo[]>("list_recovery_files");
}

export async function readRecoveryFile(name: string): Promise<string> {
  return invoke<string>("read_recovery_file", { name });
}

export async function deleteRecoveryFile(name: string): Promise<void> {
  await invoke("delete_recovery_file", { name });
}

export async function recoveryDirPath(): Promise<string> {
  return invoke<string>("recovery_dir_path");
}

export async function getAppDataPaths(): Promise<AppDataPaths> {
  return invoke<AppDataPaths>("app_data_paths");
}

export async function listLegacyRecoveryFiles(): Promise<RecoveryFileInfo[]> {
  return invoke<RecoveryFileInfo[]>("list_legacy_recovery_files");
}

export async function readLegacyRecoveryFile(name: string): Promise<string> {
  return invoke<string>("read_legacy_recovery_file", { name });
}

export async function migrateLegacyRecoveryFile(name: string): Promise<string> {
  return invoke<string>("migrate_legacy_recovery_file", { name });
}

export async function recoveryMigrationState(): Promise<RecoveryMigrationState> {
  return invoke<RecoveryMigrationState>("recovery_migration_state");
}

export async function writeRecoveryMigrationState(state: RecoveryMigrationState): Promise<void> {
  await invoke("write_recovery_migration_state", { state });
}

export async function listBackupFiles(): Promise<BackupFileInfo[]> {
  return invoke<BackupFileInfo[]>("list_backup_files");
}

export async function readBackupFile(id: string): Promise<string> {
  return invoke<string>("read_backup_file", { id });
}

export async function deleteBackupFile(id: string): Promise<void> {
  await invoke("delete_backup_file", { id });
}

export async function deleteAllBackups(): Promise<void> {
  await invoke("delete_all_backups");
}

export async function getFileSnapshot(path: string): Promise<FileSnapshot> {
  return invoke<FileSnapshot>("file_snapshot", { path });
}

export async function startupOpenPaths(): Promise<string[]> {
  return invoke<string[]>("startup_open_paths");
}

export async function inspectOpenPath(path: string): Promise<OpenPathCandidate> {
  return invoke<OpenPathCandidate>("inspect_open_path", { path });
}

export async function openAppDataFolder(
  folder: "app_data" | "recovery" | "backups",
): Promise<void> {
  await invoke("open_app_data_folder", { folder });
}

export async function checkProjectEditLock(path: string): Promise<ProjectEditLockStatus> {
  return invoke<ProjectEditLockStatus>("check_project_edit_lock", { projectPath: path });
}

export async function createProjectEditLock(input: {
  projectPath: string;
  sessionId: string;
  appVersion: string;
  keepDisplayPath: boolean;
}): Promise<ProjectEditLock> {
  return invoke<ProjectEditLock>("create_project_edit_lock", {
    request: {
      project_path: input.projectPath,
      session_id: input.sessionId,
      app_version: input.appVersion,
      keep_display_path: input.keepDisplayPath,
    },
  });
}

export async function refreshProjectEditLock(input: {
  projectPath: string;
  lockId: string;
}): Promise<void> {
  await invoke("refresh_project_edit_lock", {
    request: {
      project_path: input.projectPath,
      lock_id: input.lockId,
    },
  });
}

export async function releaseProjectEditLock(path: string, lockId: string): Promise<void> {
  await invoke("release_project_edit_lock", { projectPath: path, lockId });
}

export async function cleanupTemporaryFiles(): Promise<CleanupResult> {
  return invoke<CleanupResult>("cleanup_temporary_files");
}

export async function cleanupStaleEditLocks(): Promise<CleanupResult> {
  return invoke<CleanupResult>("cleanup_stale_edit_locks");
}

export async function openProjectWithDialog(): Promise<{
  path: string;
  project: DocumentProject;
} | null> {
  const path = await open({
    title: "プロジェクトを開く",
    multiple: false,
    filters: [
      { name: "Neword Project", extensions: [PROJECT_EXTENSION] },
      { name: "Legacy JSON Project", extensions: [LEGACY_PROJECT_EXTENSION] },
    ],
  });
  if (!path || Array.isArray(path)) return null;
  const contents = await invoke<string>("read_text_file", { path });
  return { path, project: deserializeProject(contents) };
}

export async function openProjectFromPath(path: string): Promise<{
  path: string;
  project: DocumentProject;
}> {
  const contents = await invoke<string>("read_text_file", { path });
  return { path, project: deserializeProject(contents) };
}

export async function openDocxWithDialog(): Promise<OpenDocxResult | null> {
  const path = await selectDocxPath();
  if (!path) return null;
  return openDocxFromPath(path);
}

export async function selectDocxPath(): Promise<string | null> {
  const path = await open({
    title: "DOCXを読み込む",
    multiple: false,
    filters: [{ name: "Word Document", extensions: ["docx"] }],
  });
  if (!path || Array.isArray(path)) return null;
  return path;
}

export async function openDocxFromPath(path: string): Promise<OpenDocxResult> {
  const inspection = await invoke<DocxInspection>("inspect_docx_package", { path });
  const base64 = await invoke<string>("read_binary_file_base64", { path });
  return {
    path,
    name: docxNameFromPath(path),
    base64,
    inspection,
  };
}

export async function openDocxFromPathCancellable(
  path: string,
  requestId: string,
): Promise<OpenDocxResult> {
  const inspection = await invoke<DocxInspection>("inspect_docx_package_cancellable", {
    path,
    requestId,
  });
  const base64 = await invoke<string>("read_binary_file_base64", { path });
  return {
    path,
    name: docxNameFromPath(path),
    base64,
    inspection,
  };
}

export async function cancelDocxImport(requestId: string): Promise<void> {
  await invoke("cancel_docx_import", { requestId });
}

export async function openImageWithDialog(): Promise<OpenImageResult | null> {
  const path = await open({
    title: "画像を挿入",
    multiple: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
  });
  if (!path || Array.isArray(path)) return null;
  const base64 = await invoke<string>("read_binary_file_base64", { path });
  return { path, name: fileNameFromPath(path), base64 };
}

export async function writeBinaryFileWithDialog(
  defaultName: string,
  base64: string,
): Promise<string | null> {
  const path = await save({
    title: "DOCXを書き出す",
    defaultPath: defaultName,
    filters: [{ name: "Word Document", extensions: ["docx"] }],
  });
  if (!path) return null;
  await invoke("write_binary_file_base64_atomic", { path, base64 });
  return path;
}
