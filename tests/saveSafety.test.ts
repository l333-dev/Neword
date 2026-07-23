import { describe, expect, it } from "vitest";

import {
  classifyDroppedOrOpenedPath,
  hasExternalFileChange,
  projectSavePathFromDialogPath,
  shouldSuggestNewordExtension,
} from "../src/project/saveSafety";

describe("saveSafety", () => {
  it("classifies project and DOCX paths without trusting content", () => {
    expect(classifyDroppedOrOpenedPath("/tmp/a.neword")).toBe("project");
    expect(classifyDroppedOrOpenedPath("/tmp/a.json")).toBe("project");
    expect(classifyDroppedOrOpenedPath("/tmp/a.docx")).toBe("docx");
    expect(classifyDroppedOrOpenedPath("/tmp/a.txt")).toBe("unsupported");
  });

  it("suggests .neword only for legacy JSON project paths", () => {
    expect(shouldSuggestNewordExtension("/tmp/a.json")).toBe(true);
    expect(shouldSuggestNewordExtension("/tmp/a.neword")).toBe(false);
  });

  it("adds .neword to save dialog paths while preserving project extensions", () => {
    expect(projectSavePathFromDialogPath("/tmp/test")).toBe("/tmp/test.neword");
    expect(projectSavePathFromDialogPath("/tmp/test.neword")).toBe("/tmp/test.neword");
    expect(projectSavePathFromDialogPath("/tmp/test.json")).toBe("/tmp/test.json");
    expect(projectSavePathFromDialogPath("/tmp/空白 あり/日本語 名前")).toBe(
      "/tmp/空白 あり/日本語 名前.neword",
    );
    expect(projectSavePathFromDialogPath("C:\\Users\\me\\日本語 名前")).toBe(
      "C:\\Users\\me\\日本語 名前.neword",
    );
  });

  it("detects external file changes from snapshot metadata and hash", () => {
    const previous = {
      modified_millis: 1,
      byte_size: 10,
      content_hash: "fnv1a64-a",
    };
    expect(hasExternalFileChange(previous, { ...previous })).toBe(false);
    expect(hasExternalFileChange(previous, { ...previous, byte_size: 11 })).toBe(true);
    expect(hasExternalFileChange(previous, { ...previous, content_hash: "fnv1a64-b" })).toBe(true);
  });
});
