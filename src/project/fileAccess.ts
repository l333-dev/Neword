import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

import type { DocumentProject } from "../document-model/schema";
import { deserializeProject, serializeProject } from "./serialization";

export type SaveStatus = "saved" | "dirty" | "saving" | "error";

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
