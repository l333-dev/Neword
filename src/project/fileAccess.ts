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

export async function saveProjectWithDialog(project: DocumentProject): Promise<string | null> {
  const path = await save({
    title: "プロジェクトを保存",
    defaultPath: `${project.metadata.title || "document"}.json`,
    filters: [{ name: "Document Project", extensions: ["json"] }],
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

export async function openProjectWithDialog(): Promise<{
  path: string;
  project: DocumentProject;
} | null> {
  const path = await open({
    title: "プロジェクトを開く",
    multiple: false,
    filters: [{ name: "Document Project", extensions: ["json"] }],
  });
  if (!path || Array.isArray(path)) return null;
  const contents = await invoke<string>("read_text_file", { path });
  return { path, project: deserializeProject(contents) };
}

export async function openDocxWithDialog(): Promise<OpenDocxResult | null> {
  const path = await open({
    title: "DOCXを読み込む",
    multiple: false,
    filters: [{ name: "Word Document", extensions: ["docx"] }],
  });
  if (!path || Array.isArray(path)) return null;
  const inspection = await invoke<DocxInspection>("inspect_docx_package", { path });
  const base64 = await invoke<string>("read_binary_file_base64", { path });
  const normalized = path.replaceAll("\\", "/");
  return {
    path,
    name: normalized.split("/").at(-1) ?? "document.docx",
    base64,
    inspection,
  };
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
