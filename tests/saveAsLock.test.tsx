import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  save: vi.fn(),
  open: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mocks.open,
  save: mocks.save,
}));

import App from "../src/App";

describe("Save As edit-lock safety", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.invoke.mockReset();
    mocks.save.mockReset();
    mocks.open.mockReset();
    mocks.save.mockResolvedValue("/tmp/locked-project.neword");
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "app_data_paths") {
        return Promise.resolve({
          app_data_dir: "/tmp/neword-app",
          recovery_dir: "/tmp/neword-app/recovery",
          backups_dir: "/tmp/neword-app/backups",
          state_dir: "/tmp/neword-app/state",
          logs_dir: "/tmp/neword-app/logs",
          locks_dir: "/tmp/neword-app/locks",
          legacy_recovery_dir: "/tmp/neword-recovery",
        });
      }
      if (
        command === "list_backup_files" ||
        command === "list_recovery_files" ||
        command === "list_legacy_recovery_files"
      ) {
        return Promise.resolve([]);
      }
      if (command === "recovery_migration_state") {
        return Promise.resolve({
          completed: true,
          checked_at: "2026-07-23T00:00:00.000Z",
          migrated_count: 0,
          invalid_count: 0,
          warnings: [],
        });
      }
      if (command === "check_project_edit_lock") {
        return Promise.resolve({
          lock: {
            schema_version: 1,
            lock_id: "lock-other",
            project_path_hash: "fnv1a64-other",
            project_path: "/tmp/locked-project.neword",
            process_id: 12345,
            session_id: "other-session",
            app_version: "0.1.0",
            created_at: "1",
            updated_at: "2",
          },
          stale: false,
          reason: "別セッションで編集中の可能性があります。",
          pid_status: "exists",
          lock_state: "active",
        });
      }
      return Promise.resolve(undefined);
    });
  });

  it("does not overwrite a locked Save As target when the user cancels the lock dialog", async () => {
    render(<App />);

    fireEvent.click(screen.getByText("名前を付けて保存"));
    expect(await screen.findByLabelText("編集競合")).toBeTruthy();
    fireEvent.click(screen.getByText("キャンセル"));

    await waitFor(() => {
      expect(mocks.invoke).not.toHaveBeenCalledWith(
        "write_text_file_atomic_with_backup",
        expect.anything(),
      );
    });
  });
});
