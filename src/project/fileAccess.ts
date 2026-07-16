import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

import type { DocumentProject } from "../document-model/schema";
import { deserializeProject, serializeProject } from "./serialization";

export type SaveStatus = "saved" | "dirty" | "saving" | "error";

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

export type DocxInspection = {
  has_document_xml: boolean;
  has_styles_xml: boolean;
  has_numbering_xml: boolean;
  has_settings_xml: boolean;
  has_headers: boolean;
  has_footers: boolean;
  has_macros: boolean;
  media_entries: string[];
  image_relationships: DocxImageRelationship[];
  entries: DocxEntryInfo[];
  warnings: string[];
};

export type OpenDocxResult = {
  path: string;
  name: string;
  base64: string;
  inspection: DocxInspection;
};

export async function saveProjectWithDialog(project: DocumentProject): Promise<string | null> {
  const path = await save({
    title: "プロジェクトを保存",
    defaultPath: `${project.metadata.title || "document"}.json`,
    filters: [{ name: "Document Project", extensions: ["json"] }],
  });
  if (!path) return null;
  await invoke("write_text_file_atomic", { path, contents: serializeProject(project) });
  return path;
}

export async function saveProjectToPath(path: string, project: DocumentProject): Promise<void> {
  await invoke("write_text_file_atomic", { path, contents: serializeProject(project) });
}

export async function openProjectWithDialog(): Promise<{ path: string; project: DocumentProject } | null> {
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

export async function writeBinaryFileWithDialog(defaultName: string, base64: string): Promise<string | null> {
  const path = await save({
    title: "DOCXを書き出す",
    defaultPath: defaultName,
    filters: [{ name: "Word Document", extensions: ["docx"] }],
  });
  if (!path) return null;
  await invoke("write_binary_file_base64_atomic", { path, base64 });
  return path;
}
