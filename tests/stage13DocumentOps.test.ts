import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { commandFromKeyboardEvent } from "../src/app/appCommands";
import { OnboardingStorageEnvelopeSchema, defaultOnboardingState } from "../src/app/onboarding";
import { UserPreferencesStorageEnvelopeSchema } from "../src/preferences/storage";
import { getDefaultUserPreferences } from "../src/preferences/userPreferences";
import {
  RecentProjectsStorageEnvelopeSchema,
  addRecentProject,
  getDefaultRecentProjects,
} from "../src/project/recentProjects";
import { createEditorExtensions } from "../src/features/editor/editorConfig";
import {
  findSearchMatches,
  replaceMatches,
  updateSearchHighlight,
} from "../src/features/editor/search";
import { createDocumentStatistics } from "../src/features/editor/outline";
import type { ProjectEditLockStatus } from "../src/project/fileAccess";
import { shouldWarnAboutEditLock } from "../src/project/editLocks";

function keyboard(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

function createEditor(content: string): Editor {
  return new Editor({
    extensions: createEditorExtensions(),
    content,
  });
}

describe("stage 13 search and replace", () => {
  it("maps Ctrl/Cmd+F to find", () => {
    expect(commandFromKeyboardEvent(keyboard({ key: "f", ctrlKey: true }))).toBe("edit.find");
  });

  it("finds Japanese, full-width, heading, list, and table text", () => {
    const editor = createEditor(`
      <h1>日本語の見出し</h1>
      <p>本文に日本語とＡＢＣがあります。</p>
      <ul><li>箇条書き日本語</li></ul>
      <table><tr><td>表セル日本語</td></tr></table>
    `);
    const result = findSearchMatches(editor.state.doc, "日本語", {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });

    expect(result.error).toBeNull();
    expect(result.matches.length).toBeGreaterThanOrEqual(4);
  });

  it("handles invalid regex and zero-width regex safely", () => {
    const editor = createEditor("<p>abc</p>");
    expect(
      findSearchMatches(editor.state.doc, "(", {
        caseSensitive: false,
        wholeWord: false,
        regex: true,
      }).error,
    ).toBe("正規表現が不正です。");
    expect(
      findSearchMatches(editor.state.doc, "^", {
        caseSensitive: false,
        wholeWord: false,
        regex: true,
      }).matches,
    ).toHaveLength(0);
  });

  it("replaces current and all matches without search marks in document JSON", () => {
    const editor = createEditor("<p>alpha beta alpha</p>");
    const options = { caseSensitive: false, wholeWord: false, regex: false };
    const first = findSearchMatches(editor.state.doc, "alpha", options).matches;
    updateSearchHighlight(editor, first, 0);
    expect(JSON.stringify(editor.getJSON())).not.toContain("search-match");

    expect(replaceMatches(editor, [first[0]], "gamma", options, 1)).toBe(1);
    const second = findSearchMatches(editor.state.doc, "alpha", options).matches;
    expect(replaceMatches(editor, second, "delta", options)).toBe(1);
    expect(editor.getText()).toContain("gamma beta delta");
  });

  it("does not replace in read-only editors", () => {
    const editor = createEditor("<p>alpha</p>");
    editor.setEditable(false);
    const matches = findSearchMatches(editor.state.doc, "alpha", {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    }).matches;
    expect(
      replaceMatches(editor, matches, "beta", {
        caseSensitive: false,
        wholeWord: false,
        regex: false,
      }),
    ).toBe(0);
    expect(editor.getText()).toBe("alpha");
  });
});

describe("stage 13 localStorage envelopes and statistics", () => {
  it("validates stored envelopes for settings, recent projects, and onboarding", () => {
    expect(
      UserPreferencesStorageEnvelopeSchema.safeParse({
        schemaVersion: 1,
        updatedAt: "2026-07-23T00:00:00.000Z",
        data: getDefaultUserPreferences(),
      }).success,
    ).toBe(true);
    expect(
      RecentProjectsStorageEnvelopeSchema.safeParse({
        schemaVersion: 1,
        updatedAt: "2026-07-23T00:00:00.000Z",
        data: addRecentProject(getDefaultRecentProjects(), {
          path: "/tmp/日本語.neword",
          now: new Date("2026-07-23T00:00:00.000Z"),
        }),
      }).success,
    ).toBe(true);
    expect(
      OnboardingStorageEnvelopeSchema.safeParse({
        schemaVersion: 1,
        updatedAt: "2026-07-23T00:00:00.000Z",
        data: defaultOnboardingState(new Date("2026-07-23T00:00:00.000Z")),
      }).success,
    ).toBe(true);
  });

  it("computes document statistics without claiming Japanese word segmentation", () => {
    const editor = createEditor(
      "<h1>見出し</h1><p>Hello 日本語</p><table><tr><td>セル</td></tr></table>",
    );
    const stats = createDocumentStatistics(editor.getJSON());
    expect(stats.headingCount).toBe(1);
    expect(stats.tableCount).toBe(1);
    expect(stats.asciiWordCount).toBe(1);
    expect(stats.japaneseCharacterCount).toBeGreaterThan(0);
  });
});

describe("stage 13 edit locks", () => {
  it("warns for uncertain PID and heartbeat combinations but not confirmed stale locks", () => {
    const base: ProjectEditLockStatus = {
      lock: {
        schema_version: 1,
        lock_id: "lock",
        project_path_hash: "hash",
        project_path: "/tmp/a.neword",
        process_id: 999999,
        session_id: "other",
        app_version: "0.1.0",
        created_at: "1",
        updated_at: "2",
      },
      stale: false,
      reason: "uncertain",
      pid_status: "unknown",
      lock_state: "pid_unknown_heartbeat_fresh",
    };
    expect(shouldWarnAboutEditLock(base)).toBe(true);
    expect(shouldWarnAboutEditLock({ ...base, stale: true, lock_state: "stale" })).toBe(false);
  });
});
