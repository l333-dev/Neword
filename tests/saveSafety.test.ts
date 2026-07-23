import { describe, expect, it } from "vitest";

import {
  classifyDroppedOrOpenedPath,
  hasExternalFileChange,
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
