import { describe, expect, it } from "vitest";

import { classifyAppError, sanitizeTechnicalDetails } from "../src/app/appErrors";
import { defaultOnboardingState, dismissFirstRunGuide } from "../src/app/onboarding";
import { guardedActionResult, hasUnsavedChanges } from "../src/app/unsavedChanges";
import { DOCUMENT_FORMAT_VERSION } from "../src/document-model/schema";
import { createBlankDocumentProject } from "../src/document-model/newProject";
import { defaultEditingPreferences } from "../src/stores/editingPreferences";
import {
  addRecentProject,
  clearRecentProjects,
  getDefaultRecentProjects,
  removeRecentProject,
  sanitizeRecentProjects,
  type RecentProjects,
} from "../src/project/recentProjects";

describe("stage 10 new document", () => {
  it("creates an unsaved blank project with safe initial values", () => {
    const result = createBlankDocumentProject({
      editingPreferences: defaultEditingPreferences,
      now: new Date("2026-07-21T00:00:00.000Z"),
    });

    expect(result.isUnsaved).toBe(true);
    expect(result.projectPath).toBeNull();
    expect(result.project.formatVersion).toBe(DOCUMENT_FORMAT_VERSION);
    expect(result.project.assets).toEqual([]);
    expect(result.project.warnings).toEqual([]);
    expect(result.project.classifications).toEqual([]);
    expect(result.project.metadata.sourceFileName).toBeUndefined();
    expect(result.project.createdAt).toBe("2026-07-21T00:00:00.000Z");
    expect(result.project.updatedAt).toBe("2026-07-21T00:00:00.000Z");
  });
});

describe("stage 10 recent projects", () => {
  it("keeps newest entries first, deduplicated, and capped", () => {
    const recent = Array.from({ length: 12 }).reduce<RecentProjects>(
      (current, _, index) =>
        addRecentProject(current, {
          path: `/tmp/project-${index % 11}.json`,
          now: new Date(Date.UTC(2026, 6, 21, 0, index)),
        }),
      getDefaultRecentProjects(),
    );

    expect(recent.entries).toHaveLength(10);
    expect(recent.entries[0]?.path).toBe("/tmp/project-0.json");
    expect(recent.entries.filter((entry) => entry.path === "/tmp/project-0.json")).toHaveLength(1);
  });

  it("repairs invalid stored data and removes entries", () => {
    const repaired = sanitizeRecentProjects({
      formatVersion: 1,
      entries: [
        { path: "/tmp/ok.json", displayName: "ok", lastOpenedAt: "2026-07-21T00:00:00.000Z" },
        { path: "", displayName: "bad", lastOpenedAt: "nope" },
      ],
    });

    expect(repaired.entries).toHaveLength(1);
    expect(removeRecentProject(repaired, "/tmp/ok.json").entries).toEqual([]);
    expect(clearRecentProjects().entries).toEqual([]);
  });
});

describe("stage 10 unsaved guard", () => {
  it("continues only for discard or successful save", () => {
    expect(hasUnsavedChanges("dirty")).toBe(true);
    expect(hasUnsavedChanges("saved")).toBe(false);
    expect(guardedActionResult({ choice: "cancel" })).toBe("stay");
    expect(guardedActionResult({ choice: "discard" })).toBe("continue");
    expect(guardedActionResult({ choice: "save", saveSucceeded: false })).toBe("stay");
    expect(guardedActionResult({ choice: "save", saveSucceeded: true })).toBe("continue");
  });
});

describe("stage 10 error display", () => {
  it("maps errors to user-facing messages without leaking long document data", () => {
    const error = classifyAppError(
      {
        code: "file.read_failed",
        human_readable_message: "read failed",
        technical_cause: "No such file or directory",
      },
      "プロジェクト読み込み",
    );

    expect(error.kind).toBe("file_not_found");
    expect(error.nextActions.length).toBeGreaterThan(0);
    expect(sanitizeTechnicalDetails(`data:image/png;base64,${"A".repeat(200)}`)).not.toContain(
      "A".repeat(160),
    );
  });

  it("keeps structured atomic save errors visible instead of using the unknown fallback", () => {
    const error = classifyAppError(
      {
        code: "file.atomic_rename_failed",
        operation: "atomic_write.rename",
        path: "/tmp/日本語 名前.neword",
        human_readable_message: "atomic保存用の一時ファイルを保存先へ置換できませんでした。",
        technical_cause: "Is a directory",
      },
      "プロジェクト別名保存",
    );

    expect(error.kind).toBe("cannot_write_destination");
    expect(error.summary).not.toBe("不明なエラーが発生しました。");
    expect(error.technicalDetails).toContain("atomic_write.rename");
    expect(error.technicalDetails).toContain("/tmp/日本語 名前.neword");
  });
});

describe("stage 10 onboarding", () => {
  it("is shown until dismissed", () => {
    const state = defaultOnboardingState(new Date("2026-07-21T00:00:00.000Z"));
    expect(state.firstRunGuideDismissed).toBe(false);
    expect(dismissFirstRunGuide(state).firstRunGuideDismissed).toBe(true);
  });
});
