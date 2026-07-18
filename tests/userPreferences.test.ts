import { describe, expect, it } from "vitest";

import { createNewProject } from "../src/document-model/schema";
import { DEFAULT_TOOLBAR_COMMAND_ORDER } from "../src/preferences/toolbar";
import {
  DEFAULT_USER_PREFERENCES,
  getDefaultUserPreferences,
  migrateUserPreferences,
  resetUserPreferenceCategory,
  resetUserPreferences,
  updateUserPreferences,
  UserPreferencesSchema,
} from "../src/stores/userPreferences";

describe("UserPreferences defaults and schema", () => {
  it("creates defaults that pass the schema", () => {
    expect(UserPreferencesSchema.parse(getDefaultUserPreferences())).toEqual(
      DEFAULT_USER_PREFERENCES,
    );
  });

  it("returns independent default objects", () => {
    const first = getDefaultUserPreferences();
    const second = getDefaultUserPreferences();

    first.appearance.accentColor = "#000000";
    first.editing.visualParagraphSpacingAfter = 44;

    expect(second.appearance.accentColor).toBe("#4f6bed");
    expect(second.editing.visualParagraphSpacingAfter).toBe(8);
    expect(getDefaultUserPreferences().appearance.accentColor).toBe("#4f6bed");
  });

  it("accepts valid preferences", () => {
    const preferences = getDefaultUserPreferences();
    preferences.appearance.colorMode = "dark";
    preferences.appearance.accentColor = "#AABBCC";

    expect(UserPreferencesSchema.safeParse(preferences).success).toBe(true);
  });

  it("rejects invalid schema values", () => {
    expect(
      UserPreferencesSchema.safeParse({
        ...getDefaultUserPreferences(),
        appearance: { ...getDefaultUserPreferences().appearance, colorMode: "sepia" },
      }).success,
    ).toBe(false);
    expect(
      UserPreferencesSchema.safeParse({
        ...getDefaultUserPreferences(),
        appearance: { ...getDefaultUserPreferences().appearance, accentColor: "red" },
      }).success,
    ).toBe(false);
    expect(
      UserPreferencesSchema.safeParse({
        ...getDefaultUserPreferences(),
        appearance: { ...getDefaultUserPreferences().appearance, uiFontScale: 2 },
      }).success,
    ).toBe(false);
    expect(
      UserPreferencesSchema.safeParse({
        ...getDefaultUserPreferences(),
        appearance: { ...getDefaultUserPreferences().appearance, editorMaxWidth: 200 },
      }).success,
    ).toBe(false);
    expect(
      UserPreferencesSchema.safeParse({
        ...getDefaultUserPreferences(),
        editing: { ...getDefaultUserPreferences().editing, visualLineHeight: 4 },
      }).success,
    ).toBe(false);
    expect(
      UserPreferencesSchema.safeParse({
        ...getDefaultUserPreferences(),
        editing: { ...getDefaultUserPreferences().editing, visualParagraphSpacingBefore: -1 },
      }).success,
    ).toBe(false);
    expect(
      UserPreferencesSchema.safeParse({
        ...getDefaultUserPreferences(),
        editing: { ...getDefaultUserPreferences().editing, enterBehavior: "newLine" },
      }).success,
    ).toBe(false);
  });

  it("handles unknown future versions safely", () => {
    const migrated = migrateUserPreferences({ ...getDefaultUserPreferences(), formatVersion: 99 });

    expect(migrated.preferences).toEqual(getDefaultUserPreferences());
    expect(migrated.warnings.map((warning) => warning.code)).toContain(
      "UNSUPPORTED_PREFERENCES_VERSION",
    );
  });

  it("migrates version 1 layout preferences to the current layout shape", () => {
    const migrated = migrateUserPreferences({
      ...getDefaultUserPreferences(),
      formatVersion: 1,
      layout: {
        toolbarVisible: false,
        sidebarVisible: false,
        statusBarVisible: false,
        toolbarPosition: "top",
        sidebarPosition: "right",
      },
    });

    expect(migrated.preferences.formatVersion).toBe(2);
    expect(migrated.preferences.layout.toolbarVisible).toBe(false);
    expect(migrated.preferences.layout.sidebarVisible).toBe(false);
    expect(migrated.preferences.layout.statusBarVisible).toBe(false);
    expect(migrated.preferences.layout.sidebarPosition).toBe("right");
    expect(migrated.preferences.layout.settingsVisible).toBe(true);
    expect(migrated.preferences.layout.settingsPosition).toBe("right");
  });
});

describe("UserPreferences updates", () => {
  it("updates appearance without losing other categories", () => {
    const updated = updateUserPreferences(getDefaultUserPreferences(), {
      appearance: { colorMode: "light" },
    });

    expect(updated.appearance.colorMode).toBe("light");
    expect(updated.appearance.accentColor).toBe("#4f6bed");
    expect(updated.layout).toEqual(getDefaultUserPreferences().layout);
  });

  it("updates editing without losing other editing values", () => {
    const updated = updateUserPreferences(getDefaultUserPreferences(), {
      editing: { visualLineHeight: 1.8 },
    });

    expect(updated.editing.visualLineHeight).toBe(1.8);
    expect(updated.editing.enterBehavior).toBe("newParagraph");
    expect(updated.editing.shiftEnterBehavior).toBe("hardBreak");
  });

  it("updates toolbar arrays without losing layout", () => {
    const updated = updateUserPreferences(getDefaultUserPreferences(), {
      toolbar: { buttonOrder: ["bold", "italic", "bold", "../bad"] },
    });

    expect(updated.toolbar.buttonOrder.slice(0, 2)).toEqual(["bold", "italic"]);
    expect(updated.toolbar.buttonOrder).toHaveLength(DEFAULT_TOOLBAR_COMMAND_ORDER.length);
    expect(updated.layout.sidebarVisible).toBe(true);
    expect(updated.layout.settingsVisible).toBe(true);
  });

  it("updates layout without losing other layout values", () => {
    const updated = updateUserPreferences(getDefaultUserPreferences(), {
      layout: { settingsVisible: false, settingsPosition: "left" },
    });

    expect(updated.layout.settingsVisible).toBe(false);
    expect(updated.layout.settingsPosition).toBe("left");
    expect(updated.layout.sidebarVisible).toBe(true);
    expect(updated.layout.toolbarVisible).toBe(true);
  });

  it("resets all preferences and individual categories", () => {
    const changed = updateUserPreferences(getDefaultUserPreferences(), {
      appearance: { colorMode: "dark" },
      editing: { visualLineHeight: 2 },
    });

    expect(resetUserPreferences()).toEqual(getDefaultUserPreferences());
    expect(resetUserPreferenceCategory(changed, "appearance").appearance).toEqual(
      getDefaultUserPreferences().appearance,
    );
    expect(resetUserPreferenceCategory(changed, "appearance").editing.visualLineHeight).toBe(2);
  });
});

describe("UserPreferences document separation", () => {
  it("does not mutate DocumentProject when preferences are updated", () => {
    const project = createNewProject(new Date("2026-07-18T00:00:00.000Z"));
    const before = structuredClone(project);

    updateUserPreferences(getDefaultUserPreferences(), {
      editing: { visualLineHeight: 2 },
    });

    expect(project).toEqual(before);
  });

  it("does not include document content in serialized preferences", () => {
    const serialized = JSON.stringify(getDefaultUserPreferences());

    expect(serialized).not.toContain("editorContent");
    expect(serialized).not.toContain("日本語の本文");
    expect(serialized).not.toContain("無題の文書");
  });
});
