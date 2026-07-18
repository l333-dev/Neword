import { describe, expect, it } from "vitest";

import {
  LEGACY_EDITING_PREFERENCES_STORAGE_KEY,
  loadUserPreferences,
  saveUserPreferences,
  USER_PREFERENCES_STORAGE_KEY,
  type PreferencesStorage,
} from "../src/preferences/storage";
import {
  getDefaultUserPreferences,
  UserPreferencesSchema,
  type UserPreferences,
} from "../src/preferences/userPreferences";
import { defaultEditingPreferences } from "../src/stores/editingPreferences";

class MemoryPreferencesStorage implements PreferencesStorage {
  readonly values = new Map<string, string>();
  readonly backups = new Map<string, string>();

  constructor(private readonly failMode: "none" | "load" | "save" = "none") {}

  load(key: string): string | null {
    if (this.failMode === "load") throw new Error("load failed");
    return this.values.get(key) ?? null;
  }

  save(key: string, value: string): void {
    if (this.failMode === "save") throw new Error("save failed");
    this.values.set(key, value);
  }

  backupCorrupted(key: string, rawValue: string): void {
    this.backups.set(key, rawValue);
  }
}

describe("UserPreferences storage", () => {
  it("returns defaults when no preferences exist", () => {
    const result = loadUserPreferences(new MemoryPreferencesStorage());

    expect(result.source).toBe("default");
    expect(result.preferences).toEqual(getDefaultUserPreferences());
  });

  it("saves and loads valid preferences", () => {
    const storage = new MemoryPreferencesStorage();
    const preferences = {
      ...getDefaultUserPreferences(),
      appearance: { ...getDefaultUserPreferences().appearance, colorMode: "dark" },
    } satisfies UserPreferences;
    const saved = saveUserPreferences(preferences, storage, new Date("2026-07-18T00:00:00.000Z"));

    expect(saved.ok).toBe(true);
    const loaded = loadUserPreferences(storage);
    expect(loaded.source).toBe("stored");
    expect(loaded.preferences.appearance.colorMode).toBe("dark");
    expect(loaded.preferences.updatedAt).toBe("2026-07-18T00:00:00.000Z");
  });

  it("does not crash on corrupted JSON", () => {
    const storage = new MemoryPreferencesStorage();
    storage.values.set(USER_PREFERENCES_STORAGE_KEY, "{broken");

    const result = loadUserPreferences(storage);

    expect(result.source).toBe("default");
    expect(result.preferences).toEqual(getDefaultUserPreferences());
    expect(result.warnings.map((warning) => warning.code)).toContain("CORRUPTED_PREFERENCES");
    expect(storage.backups.get(USER_PREFERENCES_STORAGE_KEY)).toBe("{broken");
  });

  it("does not crash on invalid schema values and keeps valid categories", () => {
    const storage = new MemoryPreferencesStorage();
    storage.values.set(
      USER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        ...getDefaultUserPreferences(),
        appearance: { ...getDefaultUserPreferences().appearance, accentColor: "red" },
        layout: { ...getDefaultUserPreferences().layout, sidebarVisible: false },
      }),
    );

    const result = loadUserPreferences(storage);

    expect(result.source).toBe("stored");
    expect(result.preferences.appearance).toEqual(getDefaultUserPreferences().appearance);
    expect(result.preferences.layout.sidebarVisible).toBe(false);
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "INVALID_PREFERENCE_VALUE_REPLACED",
    );
  });

  it("returns a structured warning when storage is unavailable", () => {
    const result = loadUserPreferences(new MemoryPreferencesStorage("load"));

    expect(result.source).toBe("default");
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "PREFERENCES_STORAGE_UNAVAILABLE",
    );
  });

  it("does not swallow save failures", () => {
    const result = saveUserPreferences(
      getDefaultUserPreferences(),
      new MemoryPreferencesStorage("save"),
    );

    expect(result.ok).toBe(false);
    expect(result.warnings.map((warning) => warning.code)).toContain("PREFERENCES_SAVE_FAILED");
  });

  it("migrates legacy editing preferences and keeps the old key", () => {
    const storage = new MemoryPreferencesStorage();
    const legacyValue = {
      ...defaultEditingPreferences,
      enterBehavior: "hardBreak",
      shiftEnterBehavior: "newParagraph",
      visualLineHeight: 1.8,
    };
    storage.values.set(LEGACY_EDITING_PREFERENCES_STORAGE_KEY, JSON.stringify(legacyValue));

    const first = loadUserPreferences(storage);
    const second = loadUserPreferences(storage);

    expect(first.source).toBe("migrated");
    expect(first.preferences.editing.enterBehavior).toBe("hardBreak");
    expect(UserPreferencesSchema.safeParse(first.preferences).success).toBe(true);
    expect(storage.values.has(LEGACY_EDITING_PREFERENCES_STORAGE_KEY)).toBe(true);
    expect(storage.values.has(USER_PREFERENCES_STORAGE_KEY)).toBe(true);
    expect(second.source).toBe("stored");
    expect(second.preferences).toEqual(first.preferences);
    expect(first.warnings.map((warning) => warning.code)).toContain(
      "MIGRATED_LEGACY_EDITING_PREFERENCES",
    );
  });

  it("prefers the new key over legacy editing preferences", () => {
    const storage = new MemoryPreferencesStorage();
    storage.values.set(
      LEGACY_EDITING_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        ...defaultEditingPreferences,
        enterBehavior: "hardBreak",
        shiftEnterBehavior: "newParagraph",
      }),
    );
    saveUserPreferences(
      {
        ...getDefaultUserPreferences(),
        editing: {
          ...getDefaultUserPreferences().editing,
          enterBehavior: "newParagraph",
          shiftEnterBehavior: "hardBreak",
          visualLineHeight: 2,
        },
      },
      storage,
      new Date("2026-07-18T00:00:00.000Z"),
    );

    const result = loadUserPreferences(storage);

    expect(result.source).toBe("stored");
    expect(result.preferences.editing.enterBehavior).toBe("newParagraph");
    expect(result.preferences.editing.visualLineHeight).toBe(2);
  });

  it("does not persist document content", () => {
    const storage = new MemoryPreferencesStorage();
    saveUserPreferences(getDefaultUserPreferences(), storage, new Date("2026-07-18T00:00:00.000Z"));

    const saved = storage.values.get(USER_PREFERENCES_STORAGE_KEY) ?? "";
    expect(saved).not.toContain("editorContent");
    expect(saved).not.toContain("documentDefaults");
    expect(saved).not.toContain("日本語の本文");
  });
});
