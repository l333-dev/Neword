import { z } from "zod";

import {
  defaultEditingPreferences,
  UserEditingPreferencesSchema,
} from "../stores/editingPreferences";
import {
  DEFAULT_TOOLBAR_COMMAND_ORDER,
  normalizeHiddenToolbarCommands,
  normalizeToolbarOrder,
} from "./toolbar";

export const USER_PREFERENCES_FORMAT_VERSION = 2;

export const UserPreferencesWarningCodeSchema = z.enum([
  "CORRUPTED_PREFERENCES",
  "UNSUPPORTED_PREFERENCES_VERSION",
  "MIGRATED_LEGACY_EDITING_PREFERENCES",
  "INVALID_PREFERENCE_VALUE_REPLACED",
  "PREFERENCES_STORAGE_UNAVAILABLE",
  "PREFERENCES_SAVE_FAILED",
  "PREFERENCES_QUOTA_EXCEEDED",
]);

export type UserPreferencesWarningCode = z.infer<typeof UserPreferencesWarningCodeSchema>;

export type UserPreferencesWarning = {
  code: UserPreferencesWarningCode;
  message: string;
  path?: string;
};

const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const ToolbarButtonIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/);

export const AppearancePreferencesSchema = z.object({
  colorMode: z.enum(["light", "dark", "system"]),
  accentColor: HexColorSchema,
  uiFontScale: z.number().finite().min(0.75).max(1.5),
  editorMaxWidth: z.number().int().min(480).max(2000).nullable(),
});

export const LayoutPreferencesSchema = z.object({
  toolbarVisible: z.boolean(),
  sidebarVisible: z.boolean(),
  settingsVisible: z.boolean(),
  statusBarVisible: z.boolean(),
  toolbarPosition: z.enum(["top", "bottom", "left", "right"]),
  sidebarPosition: z.enum(["left", "right"]),
  settingsPosition: z.enum(["left", "right"]),
});

export const ToolbarPreferencesSchema = z.object({
  buttonOrder: z.array(ToolbarButtonIdSchema).max(200),
  hiddenButtons: z.array(ToolbarButtonIdSchema).max(200),
  buttonSize: z.enum(["small", "medium", "large"]),
  showLabels: z.boolean(),
});

export const UserPreferencesSchema = z.object({
  formatVersion: z.literal(USER_PREFERENCES_FORMAT_VERSION),
  appearance: AppearancePreferencesSchema,
  layout: LayoutPreferencesSchema,
  toolbar: ToolbarPreferencesSchema,
  editing: UserEditingPreferencesSchema,
  updatedAt: z.iso.datetime().or(z.literal("")),
});

export type AppearancePreferences = z.infer<typeof AppearancePreferencesSchema>;
export type LayoutPreferences = z.infer<typeof LayoutPreferencesSchema>;
export type ToolbarPreferences = z.infer<typeof ToolbarPreferencesSchema>;
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
export type UserPreferenceCategory = "appearance" | "layout" | "toolbar" | "editing";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K];
};

export type UserPreferencesUpdate = DeepPartial<
  Omit<UserPreferences, "formatVersion" | "updatedAt">
>;

export const DEFAULT_USER_PREFERENCES: UserPreferences = Object.freeze({
  formatVersion: USER_PREFERENCES_FORMAT_VERSION,
  appearance: Object.freeze({
    colorMode: "system",
    accentColor: "#4f6bed",
    uiFontScale: 1,
    editorMaxWidth: 900,
  }),
  layout: Object.freeze({
    toolbarVisible: true,
    sidebarVisible: true,
    settingsVisible: true,
    statusBarVisible: true,
    toolbarPosition: "top",
    sidebarPosition: "left",
    settingsPosition: "right",
  }),
  toolbar: Object.freeze({
    buttonOrder: Object.freeze([...DEFAULT_TOOLBAR_COMMAND_ORDER]) as unknown as string[],
    hiddenButtons: Object.freeze([]) as unknown as string[],
    buttonSize: "medium",
    showLabels: false,
  }),
  editing: Object.freeze({ ...defaultEditingPreferences }),
  updatedAt: "",
});

export function getDefaultUserPreferences(): UserPreferences {
  return structuredClone(DEFAULT_USER_PREFERENCES);
}

export function normalizeToolbarButtonIds(ids: readonly unknown[]): string[] {
  return normalizeToolbarOrder(ids);
}

export function migrateLegacyEditingPreferences(value: unknown): UserPreferences | null {
  const parsed = UserEditingPreferencesSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    ...getDefaultUserPreferences(),
    editing: parsed.data,
  };
}

export function migrateUserPreferences(value: unknown): {
  preferences: UserPreferences;
  warnings: UserPreferencesWarning[];
} {
  const warnings: UserPreferencesWarning[] = [];
  if (typeof value !== "object" || value === null) {
    return {
      preferences: getDefaultUserPreferences(),
      warnings: [
        {
          code: "INVALID_PREFERENCE_VALUE_REPLACED",
          message: "個人設定の形式が不正なため、既定値へ戻しました。",
        },
      ],
    };
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.formatVersion === "number" &&
    record.formatVersion > USER_PREFERENCES_FORMAT_VERSION
  ) {
    return {
      preferences: getDefaultUserPreferences(),
      warnings: [
        {
          code: "UNSUPPORTED_PREFERENCES_VERSION",
          message: "未対応の個人設定バージョンのため、既定値を使用します。",
          path: "formatVersion",
        },
      ],
    };
  }

  const candidate = {
    ...record,
    formatVersion: USER_PREFERENCES_FORMAT_VERSION,
    layout: migrateLayoutPreferences(record.layout),
  };
  const parsed = UserPreferencesSchema.safeParse(candidate);
  if (parsed.success) {
    return {
      preferences: normalizeUserPreferences(parsed.data),
      warnings,
    };
  }

  const defaults = getDefaultUserPreferences();
  const recovered: UserPreferences = {
    ...defaults,
    formatVersion: USER_PREFERENCES_FORMAT_VERSION,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : defaults.updatedAt,
  };

  recoverCategory(
    "appearance",
    record.appearance,
    AppearancePreferencesSchema,
    recovered,
    warnings,
  );
  recoverCategory("layout", record.layout, LayoutPreferencesSchema, recovered, warnings);
  recoverCategory("toolbar", record.toolbar, ToolbarPreferencesSchema, recovered, warnings);
  recoverCategory("editing", record.editing, UserEditingPreferencesSchema, recovered, warnings);

  const finalParsed = UserPreferencesSchema.safeParse(normalizeUserPreferences(recovered));
  return {
    preferences: finalParsed.success ? finalParsed.data : defaults,
    warnings:
      warnings.length > 0
        ? warnings
        : [
            {
              code: "INVALID_PREFERENCE_VALUE_REPLACED",
              message: "個人設定の一部が不正なため、既定値で補完しました。",
            },
          ],
  };
}

function migrateLayoutPreferences(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  return {
    ...getDefaultUserPreferences().layout,
    ...(value as Record<string, unknown>),
  };
}

function recoverCategory<K extends UserPreferenceCategory>(
  key: K,
  value: unknown,
  schema: z.ZodType<UserPreferences[K]>,
  recovered: UserPreferences,
  warnings: UserPreferencesWarning[],
): void {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    recovered[key] = parsed.data;
    return;
  }
  warnings.push({
    code: "INVALID_PREFERENCE_VALUE_REPLACED",
    message: `${key} 設定が不正なため、既定値で補完しました。`,
    path: key,
  });
}

function normalizeUserPreferences(preferences: UserPreferences): UserPreferences {
  return {
    ...preferences,
    toolbar: {
      ...preferences.toolbar,
      buttonOrder: normalizeToolbarOrder(preferences.toolbar.buttonOrder),
      hiddenButtons: normalizeHiddenToolbarCommands(preferences.toolbar.hiddenButtons),
    },
  };
}

export function updateUserPreferences(
  current: UserPreferences,
  update: UserPreferencesUpdate,
): UserPreferences {
  const candidate: UserPreferences = {
    ...current,
    appearance: {
      ...current.appearance,
      ...update.appearance,
    },
    layout: {
      ...current.layout,
      ...update.layout,
    },
    toolbar: {
      ...current.toolbar,
      ...update.toolbar,
    },
    editing: {
      ...current.editing,
      ...update.editing,
    },
  };
  return UserPreferencesSchema.parse(normalizeUserPreferences(candidate));
}

export function resetUserPreferences(): UserPreferences {
  return getDefaultUserPreferences();
}

export function resetUserPreferenceCategory(
  current: UserPreferences,
  category: UserPreferenceCategory,
): UserPreferences {
  const defaults = getDefaultUserPreferences();
  return {
    ...current,
    [category]: defaults[category],
  };
}

export function withUpdatedAt(preferences: UserPreferences, now = new Date()): UserPreferences {
  return {
    ...preferences,
    updatedAt: now.toISOString(),
  };
}
