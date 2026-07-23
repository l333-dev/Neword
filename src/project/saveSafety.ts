import type { FileSnapshot } from "./fileAccess";

export type ProjectFileKind = "project" | "docx" | "unsupported";

export function classifyDroppedOrOpenedPath(path: string): ProjectFileKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".neword") || lower.endsWith(".json")) return "project";
  if (lower.endsWith(".docx")) return "docx";
  return "unsupported";
}

export function shouldSuggestNewordExtension(path: string): boolean {
  return path.toLowerCase().endsWith(".json");
}

export function hasExternalFileChange(
  previous: FileSnapshot | null,
  current: FileSnapshot | null,
): boolean {
  if (!previous || !current) return false;
  return (
    previous.modified_millis !== current.modified_millis ||
    previous.byte_size !== current.byte_size ||
    previous.content_hash !== current.content_hash
  );
}

export function estimateSerializedSizeBytes(text: string): number {
  return new Blob([text]).size;
}
