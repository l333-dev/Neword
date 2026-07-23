import { beforeEach, describe, expect, it, vi } from "vitest";

import { createNewProject } from "../src/document-model/schema";
import { saveProjectToPath, saveProjectWithDialog } from "../src/project/fileAccess";
import { serializeProject } from "../src/project/serialization";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mocks.open,
  save: mocks.save,
}));

describe("project save file access", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.open.mockReset();
    mocks.save.mockReset();
  });

  it("saves a first test.neword project when the dialog returns a path without extension", async () => {
    const project = createNewProject(new Date("2026-07-23T00:00:00.000Z"));
    mocks.save.mockResolvedValue("/tmp/test");
    mocks.invoke.mockResolvedValue(undefined);

    await expect(saveProjectWithDialog(project)).resolves.toBe("/tmp/test.neword");

    expect(mocks.invoke).toHaveBeenCalledWith("write_text_file_atomic_with_backup", {
      path: "/tmp/test.neword",
      contents: serializeProject(project),
      backupLimit: 5,
      backupExisting: true,
    });
  });

  it("overwrites an existing project path through the backup-aware atomic command", async () => {
    const project = createNewProject(new Date("2026-07-23T00:00:00.000Z"));
    mocks.invoke.mockResolvedValue(undefined);

    await saveProjectToPath("/tmp/test.neword", project);

    expect(mocks.invoke).toHaveBeenCalledWith("write_text_file_atomic_with_backup", {
      path: "/tmp/test.neword",
      contents: serializeProject(project),
      backupLimit: 5,
      backupExisting: true,
    });
  });

  it("saves as a Japanese file name with spaces and appends .neword", async () => {
    const project = createNewProject(new Date("2026-07-23T00:00:00.000Z"));
    mocks.save.mockResolvedValue("/tmp/日本語 名前");
    mocks.invoke.mockResolvedValue(undefined);

    await expect(saveProjectWithDialog(project)).resolves.toBe("/tmp/日本語 名前.neword");

    expect(mocks.invoke).toHaveBeenCalledWith(
      "write_text_file_atomic_with_backup",
      expect.objectContaining({ path: "/tmp/日本語 名前.neword" }),
    );
  });
});
