import type { FileSnapshot } from "./fileAccess";
import { hasExternalFileChange } from "./saveSafety";

export type ExternalConflictChoice = "reload" | "save-as" | "overwrite" | "cancel";

export type ExternalConflictRequest = {
  path: string;
  previous: FileSnapshot;
  current: FileSnapshot;
};

export function createExternalConflictRequest(input: {
  path: string | null;
  previous: FileSnapshot | null;
  current: FileSnapshot | null;
}): ExternalConflictRequest | null {
  if (!input.path || !input.previous || !input.current) return null;
  if (!hasExternalFileChange(input.previous, input.current)) return null;
  return {
    path: input.path,
    previous: input.previous,
    current: input.current,
  };
}
