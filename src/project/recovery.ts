import { z } from "zod";

import {
  DocumentProjectSchema,
  type DocumentProject,
  type ImportWarning,
} from "../document-model/schema";
import { deserializeProject, serializeProject } from "./serialization";
import type { RecoveryFileInfo } from "./fileAccess";

export const AUTOSAVE_ENVELOPE_VERSION = 1;
export const AUTOSAVE_DEBOUNCE_MS = 1200;
export const RECOVERY_FILE_TTL_DAYS = 14;
export const RECOVERY_PROJECT_LIMIT = 5;
export const RECOVERY_TOTAL_BYTES_LIMIT = 100 * 1024 * 1024;

export type RecoveryKind = "autosave" | "backup";

export type AutosaveEnvelope = {
  envelopeVersion: typeof AUTOSAVE_ENVELOPE_VERSION;
  kind: "autosave";
  projectKey: string;
  sourcePathHash: string | null;
  sourcePath: string | null;
  autosavedAt: string;
  lastExplicitSaveAt: string | null;
  projectUpdatedAt: string;
  revision: number;
  contentHash: string;
  appVersion: string;
  project: DocumentProject;
};

export type RecoveryCandidate = {
  kind: RecoveryKind;
  fileName: string;
  path: string;
  modifiedAt: string | null;
  byteSize: number;
  valid: boolean;
  newerThanCurrent: boolean;
  sameAsCurrent: boolean;
  reason: string;
  envelope?: AutosaveEnvelope;
  project?: DocumentProject;
  warning?: ImportWarning;
};

const AutosaveEnvelopeSchema = z.object({
  envelopeVersion: z.literal(AUTOSAVE_ENVELOPE_VERSION),
  kind: z.literal("autosave"),
  projectKey: z.string().min(1),
  sourcePathHash: z.string().nullable(),
  sourcePath: z.string().nullable(),
  autosavedAt: z.iso.datetime(),
  lastExplicitSaveAt: z.iso.datetime().nullable(),
  projectUpdatedAt: z.iso.datetime(),
  revision: z.number().int().nonnegative(),
  contentHash: z.string().min(1),
  appVersion: z.string(),
  project: DocumentProjectSchema,
});

export function createProjectKey(projectPath: string | null, seed: string): string {
  return projectPath ? `path-${safeHash(projectPath)}` : `new-${safeHash(seed)}`;
}

export function autosaveFileName(projectKey: string): string {
  return `recovery-${projectKey.replace(/[^a-zA-Z0-9-]/g, "-")}.neword`;
}

export function legacyAutosaveFileName(projectKey: string): string {
  return `autosave-${projectKey.replace(/[^a-zA-Z0-9-]/g, "-")}.json`;
}

export function createAutosaveEnvelope(input: {
  project: DocumentProject;
  projectKey: string;
  projectPath: string | null;
  revision: number;
  lastExplicitSaveAt: string | null;
  now?: Date;
}): AutosaveEnvelope {
  const contentHash = projectContentHash(input.project);
  return {
    envelopeVersion: AUTOSAVE_ENVELOPE_VERSION,
    kind: "autosave",
    projectKey: input.projectKey,
    sourcePathHash: input.projectPath ? safeHash(input.projectPath) : null,
    sourcePath: input.projectPath,
    autosavedAt: (input.now ?? new Date()).toISOString(),
    lastExplicitSaveAt: input.lastExplicitSaveAt,
    projectUpdatedAt: input.project.updatedAt,
    revision: input.revision,
    contentHash,
    appVersion: "0.1.0",
    project: input.project,
  };
}

export function serializeAutosaveEnvelope(envelope: AutosaveEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export function parseAutosaveEnvelope(text: string): AutosaveEnvelope {
  const parsedJson = JSON.parse(text) as unknown;
  return AutosaveEnvelopeSchema.parse(parsedJson);
}

export function projectContentHash(project: DocumentProject): string {
  return safeHash(serializeProject(project));
}

export function safeHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64-${hash.toString(16).padStart(16, "0")}`;
}

export function recoveryCandidateFromAutosave(
  file: RecoveryFileInfo,
  text: string,
  currentProject: DocumentProject | null,
): RecoveryCandidate {
  try {
    const envelope = parseAutosaveEnvelope(text);
    const currentHash = currentProject ? projectContentHash(currentProject) : null;
    const modifiedAt =
      file.modified_millis === null ? null : new Date(file.modified_millis).toISOString();
    const autosaveTime = Date.parse(envelope.autosavedAt);
    const currentUpdated = currentProject ? Date.parse(currentProject.updatedAt) : 0;
    const sameAsCurrent = currentHash === envelope.contentHash;
    return {
      kind: "autosave",
      fileName: file.name,
      path: file.path,
      modifiedAt,
      byteSize: file.byte_size,
      valid: true,
      newerThanCurrent: !sameAsCurrent && autosaveTime > currentUpdated,
      sameAsCurrent,
      reason: sameAsCurrent
        ? "通常保存版と同一です。"
        : autosaveTime > currentUpdated
          ? "自動保存版の方が新しい可能性があります。"
          : "通常保存版の方が新しい可能性があります。",
      envelope,
      project: envelope.project,
    };
  } catch {
    return {
      kind: "autosave",
      fileName: file.name,
      path: file.path,
      modifiedAt:
        file.modified_millis === null ? null : new Date(file.modified_millis).toISOString(),
      byteSize: file.byte_size,
      valid: false,
      newerThanCurrent: false,
      sameAsCurrent: false,
      reason: "復旧ファイルが破損しているため読み込めません。",
    };
  }
}

export function recoveryCandidateFromBackup(
  fileName: string,
  path: string,
  text: string,
  currentProject: DocumentProject | null,
): RecoveryCandidate {
  try {
    const project = deserializeProject(text);
    const currentHash = currentProject ? projectContentHash(currentProject) : null;
    const projectHash = projectContentHash(project);
    return {
      kind: "backup",
      fileName,
      path,
      modifiedAt: null,
      byteSize: text.length,
      valid: true,
      newerThanCurrent: false,
      sameAsCurrent: currentHash === projectHash,
      reason: "保存前バックアップです。",
      project,
    };
  } catch {
    return {
      kind: "backup",
      fileName,
      path,
      modifiedAt: null,
      byteSize: text.length,
      valid: false,
      newerThanCurrent: false,
      sameAsCurrent: false,
      reason: "バックアップファイルが破損しているため読み込めません。",
    };
  }
}

export function shouldPruneRecovery(file: RecoveryFileInfo, now = new Date()): boolean {
  if (file.modified_millis === null) return false;
  const ageMs = now.getTime() - file.modified_millis;
  return ageMs > RECOVERY_FILE_TTL_DAYS * 24 * 60 * 60 * 1000;
}

export function recoveryFilesToPrune(
  files: RecoveryFileInfo[],
  now = new Date(),
): RecoveryFileInfo[] {
  const expired = files.filter((file) => shouldPruneRecovery(file, now));
  const byProject = new Map<string, RecoveryFileInfo[]>();
  for (const file of files) {
    const key = file.name
      .replace(/^autosave-/, "")
      .replace(/^recovery-/, "")
      .replace(/\.(json|neword)$/, "");
    byProject.set(key, [...(byProject.get(key) ?? []), file]);
  }
  const overLimit = [...byProject.values()].flatMap((items) =>
    items
      .slice()
      .sort((a, b) => (b.modified_millis ?? 0) - (a.modified_millis ?? 0))
      .slice(RECOVERY_PROJECT_LIMIT),
  );
  let total = files.reduce((sum, file) => sum + file.byte_size, 0);
  const overSize: RecoveryFileInfo[] = [];
  for (const file of files
    .slice()
    .sort((a, b) => (a.modified_millis ?? 0) - (b.modified_millis ?? 0))) {
    if (total <= RECOVERY_TOTAL_BYTES_LIMIT) break;
    overSize.push(file);
    total -= file.byte_size;
  }
  return uniqueRecoveryFiles([...expired, ...overLimit, ...overSize]);
}

function uniqueRecoveryFiles(files: RecoveryFileInfo[]): RecoveryFileInfo[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    if (seen.has(file.name)) return false;
    seen.add(file.name);
    return true;
  });
}
