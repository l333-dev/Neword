import { describe, expect, it } from "vitest";

import { trimTrailingEmptyParagraphsFromContent } from "../src/features/editor/contentCleanup";
import {
  applyLineHeightPreset,
  applyParagraphSpacingPreset,
  defaultEditingPreferences,
  documentDefaultsFromEditingPreferences,
  resolveParagraphGap,
  setEnterBehavior,
  UserEditingPreferencesSchema,
} from "../src/stores/editingPreferences";

describe("editing preferences", () => {
  it("applies line-height presets", () => {
    expect(applyLineHeightPreset(defaultEditingPreferences, "compact").visualLineHeight).toBe(1.2);
    expect(applyLineHeightPreset(defaultEditingPreferences, "normal").visualLineHeight).toBe(1.5);
    expect(applyLineHeightPreset(defaultEditingPreferences, "relaxed").visualLineHeight).toBe(1.8);
  });

  it("applies paragraph spacing presets", () => {
    const compact = applyParagraphSpacingPreset(defaultEditingPreferences, "compact");
    const normal = applyParagraphSpacingPreset(defaultEditingPreferences, "normal");
    const relaxed = applyParagraphSpacingPreset(defaultEditingPreferences, "relaxed");

    expect(compact.visualParagraphSpacingAfter).toBe(4);
    expect(compact.visualHeadingSpacingBefore).toBe(12);
    expect(normal.visualParagraphSpacingAfter).toBe(8);
    expect(normal.visualHeadingSpacingBefore).toBe(16);
    expect(relaxed.visualParagraphSpacingAfter).toBe(12);
    expect(relaxed.visualHeadingSpacingBefore).toBe(24);
  });

  it("keeps Enter and Shift+Enter behaviors distinct when swapped", () => {
    const swapped = setEnterBehavior(defaultEditingPreferences, "hardBreak");

    expect(swapped.enterBehavior).toBe("hardBreak");
    expect(swapped.shiftEnterBehavior).toBe("newParagraph");
    expect(UserEditingPreferencesSchema.safeParse(swapped).success).toBe(true);
  });

  it("rejects invalid custom values", () => {
    expect(
      UserEditingPreferencesSchema.safeParse({
        ...defaultEditingPreferences,
        visualLineHeightPreset: "custom",
        visualLineHeight: 0.5,
      }).success,
    ).toBe(false);
    expect(
      UserEditingPreferencesSchema.safeParse({
        ...defaultEditingPreferences,
        visualParagraphSpacingAfter: -1,
      }).success,
    ).toBe(false);
  });

  it("uses the larger paragraph gap explicitly", () => {
    expect(resolveParagraphGap(8, 0)).toBe(8);
    expect(resolveParagraphGap(4, 12)).toBe(12);
    expect(() => resolveParagraphGap(Number.NaN, 1)).toThrow();
  });

  it("creates document defaults only for new documents", () => {
    const defaults = documentDefaultsFromEditingPreferences(defaultEditingPreferences);

    expect(defaults.bodyParagraph.spacingAfterPt).toBe(6);
    expect(defaults.bodyParagraph.lineHeight).toBe(defaultEditingPreferences.visualLineHeight);
    expect(defaults.heading1.spacingBeforePt).toBe(12);
  });

  it("trims only trailing empty paragraphs and keeps meaningful empty paragraphs", () => {
    const content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "B" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "   " }] },
      ],
    };

    expect(trimTrailingEmptyParagraphsFromContent(content)).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "B" }] },
      ],
    });
  });
});
