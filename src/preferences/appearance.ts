import type { UserEditingPreferences } from "../stores/editingPreferences";
import {
  applyParagraphSpacingPreset,
  paragraphSpacingPresets,
  type ParagraphSpacingPreset,
} from "../stores/editingPreferences";
import {
  getDefaultUserPreferences,
  type UserPreferences,
  type UserPreferencesUpdate,
} from "./userPreferences";

export type ResolvedColorMode = "light" | "dark";

type CssVariables = Record<`--${string}`, string>;

type ThemePalette = {
  appBg: string;
  panelBg: string;
  panelBgSecondary: string;
  editorBg: string;
  textPrimary: string;
  textSecondary: string;
  borderColor: string;
};

const lightPalette: ThemePalette = {
  appBg: "#f3f5f7",
  panelBg: "#ffffff",
  panelBgSecondary: "#f8fafc",
  editorBg: "#ffffff",
  textPrimary: "#1c2329",
  textSecondary: "#64748b",
  borderColor: "#cbd5e1",
};

const darkPalette: ThemePalette = {
  appBg: "#171b20",
  panelBg: "#20262d",
  panelBgSecondary: "#1b2027",
  editorBg: "#fdfdfb",
  textPrimary: "#eef2f5",
  textSecondary: "#a8b3c1",
  borderColor: "#3a414a",
};

export function resolveColorMode(colorMode: UserPreferences["appearance"]["colorMode"], prefersDark: boolean): ResolvedColorMode {
  if (colorMode === "dark") return "dark";
  if (colorMode === "light") return "light";
  return prefersDark ? "dark" : "light";
}

export function sanitizeAccentColor(color: string): string {
  const defaults = getDefaultUserPreferences();
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : defaults.appearance.accentColor;
}

export function createAccentPalette(color: string): {
  accentColor: string;
  accentColorHover: string;
  accentColorSoft: string;
  focusRingColor: string;
} {
  const accentColor = sanitizeAccentColor(color);
  return {
    accentColor,
    accentColorHover: adjustHexColor(accentColor, -0.12),
    accentColorSoft: mixHexColor(accentColor, "#ffffff", 0.86),
    focusRingColor: rgbaFromHex(accentColor, 0.32),
  };
}

export function editorMaxWidthToCss(value: UserPreferences["appearance"]["editorMaxWidth"]): string {
  return value === null ? "none" : `${value}px`;
}

export function createPreferenceCssVariables(
  preferences: UserPreferences,
  resolvedColorMode: ResolvedColorMode,
): CssVariables {
  const palette = resolvedColorMode === "dark" ? darkPalette : lightPalette;
  const accent = createAccentPalette(preferences.appearance.accentColor);
  return {
    "--app-bg": palette.appBg,
    "--panel-bg": palette.panelBg,
    "--panel-bg-secondary": palette.panelBgSecondary,
    "--editor-bg": palette.editorBg,
    "--text-primary": palette.textPrimary,
    "--text-secondary": palette.textSecondary,
    "--border-color": palette.borderColor,
    "--accent-color": accent.accentColor,
    "--accent-color-hover": accent.accentColorHover,
    "--accent-color-soft": accent.accentColorSoft,
    "--focus-ring-color": accent.focusRingColor,
    "--ui-font-scale": String(preferences.appearance.uiFontScale),
    "--editor-max-width": editorMaxWidthToCss(preferences.appearance.editorMaxWidth),
    "--editor-line-height": String(preferences.editing.visualLineHeight),
    "--paragraph-space-before": `${preferences.editing.visualParagraphSpacingBefore}px`,
    "--paragraph-space-after": `${preferences.editing.visualParagraphSpacingAfter}px`,
    "--heading-space-before": `${preferences.editing.visualHeadingSpacingBefore}px`,
    "--heading-space-after": `${preferences.editing.visualHeadingSpacingAfter}px`,
    "--list-item-space": `${preferences.editing.visualListItemSpacing}px`,
    "--blockquote-space": `${preferences.editing.visualBlockquoteSpacing}px`,
  };
}

export function editingDisplayUpdateFromParagraphPreset(
  editing: UserEditingPreferences,
  preset: ParagraphSpacingPreset,
): UserPreferencesUpdate {
  return {
    editing: applyParagraphSpacingPreset(editing, preset),
  };
}

export function customEditingDisplayUpdate(
  patch: Partial<
    Pick<
      UserEditingPreferences,
      | "visualLineHeight"
      | "visualParagraphSpacingBefore"
      | "visualParagraphSpacingAfter"
      | "visualHeadingSpacingBefore"
      | "visualHeadingSpacingAfter"
      | "visualListItemSpacing"
      | "visualBlockquoteSpacing"
    >
  >,
): UserPreferencesUpdate {
  const editing: NonNullable<UserPreferencesUpdate["editing"]> = {
    ...patch,
    visualParagraphSpacingPreset: "custom",
  };
  if (patch.visualLineHeight !== undefined) {
    editing.visualLineHeightPreset = "custom";
  }
  return {
    editing,
  };
}

export { paragraphSpacingPresets };

function adjustHexColor(color: string, amount: number): string {
  const rgb = hexToRgb(color);
  const adjust = (channel: number) =>
    clamp(Math.round(channel + (amount >= 0 ? 255 - channel : channel) * amount), 0, 255);
  return rgbToHex(adjust(rgb.r), adjust(rgb.g), adjust(rgb.b));
}

function mixHexColor(color: string, target: string, targetRatio: number): string {
  const from = hexToRgb(color);
  const to = hexToRgb(target);
  const mix = (a: number, b: number) => clamp(Math.round(a * (1 - targetRatio) + b * targetRatio), 0, 255);
  return rgbToHex(mix(from.r, to.r), mix(from.g, to.g), mix(from.b, to.b));
}

function rgbaFromHex(color: string, alpha: number): string {
  const rgb = hexToRgb(color);
  return `rgb(${rgb.r} ${rgb.g} ${rgb.b} / ${alpha})`;
}

function hexToRgb(color: string): { r: number; g: number; b: number } {
  const sanitized = sanitizeAccentColor(color);
  return {
    r: Number.parseInt(sanitized.slice(1, 3), 16),
    g: Number.parseInt(sanitized.slice(3, 5), 16),
    b: Number.parseInt(sanitized.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
