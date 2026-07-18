import { z } from "zod";

import { pixelsToPoints } from "../converters/units";
import type { DocumentDefaults } from "../document-model/schema";

export const LineHeightPresetSchema = z.enum(["compact", "normal", "relaxed", "custom"]);
export const ParagraphSpacingPresetSchema = z.enum(["compact", "normal", "relaxed", "custom"]);
export const EditingBehaviorSchema = z.enum(["newParagraph", "hardBreak"]);
export const EmptyParagraphHeightSchema = z.enum(["singleLine", "collapsed", "doubleLine"]);

export const UserEditingPreferencesSchema = z
  .object({
    enterBehavior: EditingBehaviorSchema,
    shiftEnterBehavior: EditingBehaviorSchema,
    visualLineHeightPreset: LineHeightPresetSchema,
    visualLineHeight: z.number().finite().min(1).max(2.5),
    visualParagraphSpacingPreset: ParagraphSpacingPresetSchema,
    visualParagraphSpacingBefore: z.number().finite().min(0).max(96),
    visualParagraphSpacingAfter: z.number().finite().min(0).max(96),
    visualHeadingSpacingBefore: z.number().finite().min(0).max(128),
    visualHeadingSpacingAfter: z.number().finite().min(0).max(128),
    visualListItemSpacing: z.number().finite().min(0).max(64),
    visualBlockquoteSpacing: z.number().finite().min(0).max(96),
    emptyParagraphHeight: EmptyParagraphHeightSchema,
    trimTrailingEmptyParagraphs: z.boolean(),
    collapseAccidentalEmptyParagraphs: z.boolean(),
    autoParagraphSpacing: z.boolean(),
    showParagraphMarks: z.boolean(),
    showHardBreakMarks: z.boolean(),
    showPageBreakMarks: z.boolean(),
  })
  .superRefine((preferences, context) => {
    if (preferences.enterBehavior === preferences.shiftEnterBehavior) {
      context.addIssue({
        code: "custom",
        message: "enterBehavior and shiftEnterBehavior must remain distinct",
        path: ["shiftEnterBehavior"],
      });
    }
  });

export type LineHeightPreset = z.infer<typeof LineHeightPresetSchema>;
export type ParagraphSpacingPreset = z.infer<typeof ParagraphSpacingPresetSchema>;
export type UserEditingPreferences = z.infer<typeof UserEditingPreferencesSchema>;

export type EditingPreferencePreset = {
  id: Exclude<ParagraphSpacingPreset, "custom">;
  label: string;
  lineHeight: number;
  paragraphSpacingBefore: number;
  paragraphSpacingAfter: number;
  headingSpacingBefore: number;
  headingSpacingAfter: number;
  listItemSpacing: number;
  blockquoteSpacing: number;
};

export const lineHeightPresetValues: Record<Exclude<LineHeightPreset, "custom">, number> = {
  compact: 1.2,
  normal: 1.5,
  relaxed: 1.8,
};

export const paragraphSpacingPresets: Record<
  Exclude<ParagraphSpacingPreset, "custom">,
  EditingPreferencePreset
> = {
  compact: {
    id: "compact",
    label: "コンパクト",
    lineHeight: 1.25,
    paragraphSpacingBefore: 0,
    paragraphSpacingAfter: 4,
    headingSpacingBefore: 12,
    headingSpacingAfter: 4,
    listItemSpacing: 2,
    blockquoteSpacing: 4,
  },
  normal: {
    id: "normal",
    label: "標準",
    lineHeight: 1.5,
    paragraphSpacingBefore: 0,
    paragraphSpacingAfter: 8,
    headingSpacingBefore: 16,
    headingSpacingAfter: 8,
    listItemSpacing: 4,
    blockquoteSpacing: 8,
  },
  relaxed: {
    id: "relaxed",
    label: "ゆったり",
    lineHeight: 1.75,
    paragraphSpacingBefore: 0,
    paragraphSpacingAfter: 12,
    headingSpacingBefore: 24,
    headingSpacingAfter: 12,
    listItemSpacing: 6,
    blockquoteSpacing: 12,
  },
};

export const defaultEditingPreferences: UserEditingPreferences = {
  enterBehavior: "newParagraph",
  shiftEnterBehavior: "hardBreak",
  visualLineHeightPreset: "normal",
  visualLineHeight: 1.5,
  visualParagraphSpacingPreset: "normal",
  visualParagraphSpacingBefore: 0,
  visualParagraphSpacingAfter: 8,
  visualHeadingSpacingBefore: 16,
  visualHeadingSpacingAfter: 8,
  visualListItemSpacing: 4,
  visualBlockquoteSpacing: 8,
  emptyParagraphHeight: "singleLine",
  trimTrailingEmptyParagraphs: true,
  collapseAccidentalEmptyParagraphs: false,
  autoParagraphSpacing: true,
  showParagraphMarks: false,
  showHardBreakMarks: false,
  showPageBreakMarks: false,
};

export function applyLineHeightPreset(
  preferences: UserEditingPreferences,
  preset: LineHeightPreset,
): UserEditingPreferences {
  if (preset === "custom") return { ...preferences, visualLineHeightPreset: "custom" };
  return {
    ...preferences,
    visualLineHeightPreset: preset,
    visualLineHeight: lineHeightPresetValues[preset],
  };
}

export function applyParagraphSpacingPreset(
  preferences: UserEditingPreferences,
  preset: ParagraphSpacingPreset,
): UserEditingPreferences {
  if (preset === "custom") return { ...preferences, visualParagraphSpacingPreset: "custom" };
  const values = paragraphSpacingPresets[preset];
  return {
    ...preferences,
    visualParagraphSpacingPreset: preset,
    visualLineHeight: values.lineHeight,
    visualParagraphSpacingBefore: values.paragraphSpacingBefore,
    visualParagraphSpacingAfter: values.paragraphSpacingAfter,
    visualHeadingSpacingBefore: values.headingSpacingBefore,
    visualHeadingSpacingAfter: values.headingSpacingAfter,
    visualListItemSpacing: values.listItemSpacing,
    visualBlockquoteSpacing: values.blockquoteSpacing,
  };
}

export function setEnterBehavior(
  preferences: UserEditingPreferences,
  enterBehavior: UserEditingPreferences["enterBehavior"],
): UserEditingPreferences {
  return {
    ...preferences,
    enterBehavior,
    shiftEnterBehavior: enterBehavior === "newParagraph" ? "hardBreak" : "newParagraph",
  };
}

export function resolveParagraphGap(previousAfter: number, nextBefore: number): number {
  const parsed = z
    .tuple([z.number().finite().min(0), z.number().finite().min(0)])
    .parse([previousAfter, nextBefore]);
  return Math.max(parsed[0], parsed[1]);
}

export function parseEditingPreferences(value: unknown): UserEditingPreferences {
  const parsed = UserEditingPreferencesSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultEditingPreferences;
}

export function documentDefaultsFromEditingPreferences(
  preferences: UserEditingPreferences,
): DocumentDefaults {
  return {
    bodyParagraph: {
      spacingBeforePt: pixelsToPoints(preferences.visualParagraphSpacingBefore),
      spacingAfterPt: pixelsToPoints(preferences.visualParagraphSpacingAfter),
      lineHeight: preferences.visualLineHeight,
    },
    heading1: {
      spacingBeforePt: pixelsToPoints(preferences.visualHeadingSpacingBefore),
      spacingAfterPt: pixelsToPoints(preferences.visualHeadingSpacingAfter),
      lineHeight: preferences.visualLineHeight,
    },
    heading2: {
      spacingBeforePt: pixelsToPoints(preferences.visualHeadingSpacingBefore),
      spacingAfterPt: pixelsToPoints(preferences.visualHeadingSpacingAfter),
      lineHeight: preferences.visualLineHeight,
    },
    heading3: {
      spacingBeforePt: pixelsToPoints(preferences.visualHeadingSpacingBefore),
      spacingAfterPt: pixelsToPoints(preferences.visualHeadingSpacingAfter),
      lineHeight: preferences.visualLineHeight,
    },
    heading4: {
      spacingBeforePt: pixelsToPoints(preferences.visualHeadingSpacingBefore),
      spacingAfterPt: pixelsToPoints(preferences.visualHeadingSpacingAfter),
      lineHeight: preferences.visualLineHeight,
    },
  };
}
