import { describe, expect, it } from "vitest";

import { commandFromKeyboardEvent, isAppCommand, type AppCommand } from "../src/app/appCommands";
import { shouldWarnAboutEditLock } from "../src/project/editLocks";
import { createExternalConflictRequest } from "../src/project/externalConflict";
import { classifyDroppedOrOpenedPath } from "../src/project/saveSafety";
import type { ProjectEditLockStatus } from "../src/project/fileAccess";

function keyboard(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("stage 12 command routing", () => {
  it("recognizes typed menu command ids", () => {
    expect(isAppCommand("file.save")).toBe(true);
    expect(isAppCommand("unknown.save")).toBe(false);
  });

  it.each<[KeyboardEventInit, AppCommand]>([
    [{ key: "n", ctrlKey: true }, "file.new"],
    [{ key: "o", ctrlKey: true }, "file.open"],
    [{ key: "s", ctrlKey: true }, "file.save"],
    [{ key: "s", ctrlKey: true, shiftKey: true }, "file.save_as"],
    [{ key: ",", metaKey: true }, "view.toggle_settings"],
    [{ key: "q", ctrlKey: true }, "file.quit"],
    [{ key: "z", ctrlKey: true }, "edit.undo"],
    [{ key: "z", ctrlKey: true, shiftKey: true }, "edit.redo"],
  ])("maps shortcut to command", (init, expected) => {
    expect(commandFromKeyboardEvent(keyboard(init))).toBe(expected);
  });
});

describe("stage 12 file routing", () => {
  it("keeps .neword project, legacy JSON, and DOCX distinct", () => {
    expect(classifyDroppedOrOpenedPath("/tmp/日本語.neword")).toBe("project");
    expect(classifyDroppedOrOpenedPath("/tmp/legacy.json")).toBe("project");
    expect(classifyDroppedOrOpenedPath("/tmp/input.docx")).toBe("docx");
    expect(classifyDroppedOrOpenedPath("/tmp/not-a-project.txt")).toBe("unsupported");
  });
});

describe("stage 12 edit lock and external conflict", () => {
  it("warns only for active non-stale locks", () => {
    const active: ProjectEditLockStatus = {
      lock: {
        schema_version: 1,
        lock_id: "lock-1",
        project_path_hash: "fnv1a64-a",
        project_path: null,
        process_id: 1,
        session_id: "session",
        app_version: "0.1.0",
        created_at: "1",
        updated_at: "2",
      },
      stale: false,
      reason: "active",
      pid_status: "exists",
      lock_state: "active",
    };
    expect(shouldWarnAboutEditLock(active)).toBe(true);
    expect(shouldWarnAboutEditLock({ ...active, stale: true, lock_state: "stale" })).toBe(false);
    expect(
      shouldWarnAboutEditLock({
        lock: null,
        stale: false,
        reason: "none",
        pid_status: "none",
        lock_state: "none",
      }),
    ).toBe(false);
  });

  it("creates external conflict requests only for changed snapshots", () => {
    const previous = { modified_millis: 1, byte_size: 10, content_hash: "a" };
    expect(
      createExternalConflictRequest({
        path: "/tmp/a.neword",
        previous,
        current: { ...previous },
      }),
    ).toBeNull();
    expect(
      createExternalConflictRequest({
        path: "/tmp/a.neword",
        previous,
        current: { ...previous, content_hash: "b" },
      })?.path,
    ).toBe("/tmp/a.neword");
  });
});
