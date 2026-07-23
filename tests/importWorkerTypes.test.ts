import { describe, expect, it } from "vitest";

import {
  ImportWorkerInputSchema,
  sanitizeWorkerError,
} from "../src/features/import-docx/importWorkerTypes";

describe("import worker message validation", () => {
  it("accepts ArrayBuffer input with source metadata", () => {
    const result = ImportWorkerInputSchema.safeParse({
      arrayBuffer: new ArrayBuffer(8),
      sourceInfo: {
        name: "日本語.docx",
        sizeBytes: 8,
        path: "/tmp/日本語.docx",
        inspectedAt: "2026-07-23T00:00:00.000Z",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid worker input", () => {
    const result = ImportWorkerInputSchema.safeParse({
      arrayBuffer: "not-buffer",
      sourceInfo: {
        name: "bad.docx",
        sizeBytes: -1,
        inspectedAt: "2026-07-23T00:00:00.000Z",
      },
    });

    expect(result.success).toBe(false);
  });

  it("redacts base64-like data URLs from worker errors", () => {
    const error = sanitizeWorkerError(
      new Error("failed data:image/png;base64,ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/="),
      "mammoth-convert",
    );

    expect(error.message).toContain("[data omitted]");
    expect(error.message).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  });
});
