import {
  getDefaultUserPreferences,
  migrateLegacyEditingPreferences,
  migrateUserPreferences,
  UserPreferencesSchema,
  withUpdatedAt,
  type UserPreferences,
  type UserPreferencesWarning,
} from "./userPreferences";

export const USER_PREFERENCES_STORAGE_KEY = "neword.userPreferences.v1";
export const LEGACY_EDITING_PREFERENCES_STORAGE_KEY = "neword.editingPreferences.v1";

export type LoadUserPreferencesResult = {
  preferences: UserPreferences;
  source: "stored" | "migrated" | "default";
  warnings: UserPreferencesWarning[];
};

export type SaveUserPreferencesResult =
  | { ok: true; preferences: UserPreferences; warnings: UserPreferencesWarning[] }
  | { ok: false; preferences: UserPreferences; warnings: UserPreferencesWarning[] };

export interface PreferencesStorage {
  load(key: string): string | null;
  save(key: string, value: string): void;
  backupCorrupted?(key: string, rawValue: string): void;
}

export function createLocalStoragePreferencesStorage(
  getLocalStorage = () => globalThis.window?.localStorage,
): PreferencesStorage {
  return {
    load(key) {
      const storage = getLocalStorage();
      if (!storage) throw new Error("localStorage is unavailable");
      return storage.getItem(key);
    },
    save(key, value) {
      const storage = getLocalStorage();
      if (!storage) throw new Error("localStorage is unavailable");
      storage.setItem(key, value);
    },
    backupCorrupted(key, rawValue) {
      const storage = getLocalStorage();
      if (!storage) return;
      storage.setItem(`${key}.corrupted`, rawValue);
    },
  };
}

export function loadUserPreferences(
  storage: PreferencesStorage = createLocalStoragePreferencesStorage(),
): LoadUserPreferencesResult {
  const warnings: UserPreferencesWarning[] = [];
  const storedRaw = loadRaw(storage, USER_PREFERENCES_STORAGE_KEY, warnings);
  if (storedRaw !== null) {
    const parsedJson = parseRawJson(storedRaw, storage, USER_PREFERENCES_STORAGE_KEY);
    warnings.push(...parsedJson.warnings);
    if (!parsedJson.success) {
      return { preferences: getDefaultUserPreferences(), source: "default", warnings };
    }
    const migrated = migrateUserPreferences(parsedJson.value);
    warnings.push(...migrated.warnings);
    return {
      preferences: migrated.preferences,
      source: migrated.warnings.some(
        (warning) => warning.code === "UNSUPPORTED_PREFERENCES_VERSION",
      )
        ? "default"
        : "stored",
      warnings,
    };
  }

  const legacyRaw = loadRaw(storage, LEGACY_EDITING_PREFERENCES_STORAGE_KEY, warnings);
  if (legacyRaw !== null) {
    const parsedLegacy = parseRawJson(legacyRaw, storage, LEGACY_EDITING_PREFERENCES_STORAGE_KEY);
    warnings.push(...parsedLegacy.warnings);
    if (parsedLegacy.success) {
      const migrated = migrateLegacyEditingPreferences(parsedLegacy.value);
      if (migrated) {
        const migrationWarning: UserPreferencesWarning = {
          code: "MIGRATED_LEGACY_EDITING_PREFERENCES",
          message: "旧編集設定を個人設定形式へ移行しました。",
        };
        const saveResult = saveUserPreferences(migrated, storage);
        return {
          preferences: saveResult.preferences,
          source: "migrated",
          warnings: [migrationWarning, ...warnings, ...saveResult.warnings],
        };
      }
      warnings.push({
        code: "INVALID_PREFERENCE_VALUE_REPLACED",
        message: "旧編集設定が不正なため、既定値を使用します。",
      });
    }
  }

  return { preferences: getDefaultUserPreferences(), source: "default", warnings };
}

export function saveUserPreferences(
  preferences: UserPreferences,
  storage: PreferencesStorage = createLocalStoragePreferencesStorage(),
  now = new Date(),
): SaveUserPreferencesResult {
  const preferencesToSave = withUpdatedAt(preferences, now);
  const parsed = UserPreferencesSchema.safeParse(preferencesToSave);
  if (!parsed.success) {
    return {
      ok: false,
      preferences,
      warnings: [
        {
          code: "INVALID_PREFERENCE_VALUE_REPLACED",
          message: "個人設定が不正なため保存しませんでした。",
        },
      ],
    };
  }
  try {
    storage.save(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(parsed.data));
    return { ok: true, preferences: parsed.data, warnings: [] };
  } catch {
    return {
      ok: false,
      preferences: parsed.data,
      warnings: [
        {
          code: "PREFERENCES_SAVE_FAILED",
          message: "個人設定の保存に失敗しました。",
        },
      ],
    };
  }
}

function loadRaw(
  storage: PreferencesStorage,
  key: string,
  warnings: UserPreferencesWarning[],
): string | null {
  try {
    return storage.load(key);
  } catch {
    warnings.push({
      code: "PREFERENCES_STORAGE_UNAVAILABLE",
      message: "個人設定ストレージを利用できません。",
    });
    return null;
  }
}

function parseRawJson(
  rawValue: string,
  storage: PreferencesStorage,
  key: string,
):
  | { success: true; value: unknown; warnings: UserPreferencesWarning[] }
  | {
      success: false;
      warnings: UserPreferencesWarning[];
    } {
  try {
    return { success: true, value: JSON.parse(rawValue) as unknown, warnings: [] };
  } catch {
    storage.backupCorrupted?.(key, rawValue);
    return {
      success: false,
      warnings: [
        {
          code: "CORRUPTED_PREFERENCES",
          message: "個人設定JSONが壊れているため、既定値を使用します。",
        },
      ],
    };
  }
}
