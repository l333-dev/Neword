import type { SaveStatus } from "../project/fileAccess";

export type UnsavedChoice = "save" | "discard" | "cancel";
export type GuardedActionResult = "continue" | "stay";

export function hasUnsavedChanges(status: SaveStatus): boolean {
  return (
    status === "dirty" ||
    status === "autosave-pending" ||
    status === "autosaving" ||
    status === "autosaved" ||
    status === "autosave-error" ||
    status === "error" ||
    status === "recovered"
  );
}

export function guardedActionResult(input: {
  choice: UnsavedChoice;
  saveSucceeded?: boolean;
}): GuardedActionResult {
  if (input.choice === "cancel") return "stay";
  if (input.choice === "discard") return "continue";
  return input.saveSucceeded ? "continue" : "stay";
}
