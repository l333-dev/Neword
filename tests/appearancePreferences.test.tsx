import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { AppearancePreferencesPanel } from "../src/features/preferences/AppearancePreferencesPanel";
import { useResolvedColorMode } from "../src/features/preferences/useResolvedColorMode";
import {
  createPreferenceCssVariables,
  customEditingDisplayUpdate,
  editingDisplayUpdateFromParagraphPreset,
  editorMaxWidthToCss,
  resolveColorMode,
} from "../src/preferences/appearance";
import {
  getDefaultUserPreferences,
  updateUserPreferences,
  type UserPreferences,
  type UserPreferencesUpdate,
} from "../src/preferences/userPreferences";

describe("appearance preference theme resolution", () => {
  it("resolves explicit light and dark modes", () => {
    expect(resolveColorMode("light", true)).toBe("light");
    expect(resolveColorMode("dark", false)).toBe("dark");
  });

  it("resolves system mode from matchMedia state and follows changes", () => {
    const matchMedia = installMatchMediaMock(true);
    const values: string[] = [];

    function Probe() {
      const resolved = useResolvedColorMode("system");
      useEffect(() => {
        values.push(resolved);
      }, [resolved]);
      return <span>{resolved}</span>;
    }

    const rendered = render(<Probe />);
    expect(screen.getByText("dark")).toBeTruthy();

    act(() => matchMedia.dispatch(false));
    expect(screen.getByText("light")).toBeTruthy();
    expect(values).toEqual(["dark", "light"]);

    rendered.unmount();
    expect(matchMedia.listenerCount()).toBe(0);
  });

  it("does not crash when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);

    function Probe() {
      return <span>{useResolvedColorMode("system")}</span>;
    }

    render(<Probe />);
    expect(screen.getByText("light")).toBeTruthy();
    vi.unstubAllGlobals();
  });
});

describe("appearance preference CSS variables", () => {
  it("converts user preferences to CSS variables", () => {
    const preferences = updateUserPreferences(getDefaultUserPreferences(), {
      appearance: {
        accentColor: "#123456",
        uiFontScale: 1.2,
        editorMaxWidth: 1200,
      },
      editing: {
        visualLineHeight: 1.7,
        visualParagraphSpacingBefore: 2,
        visualParagraphSpacingAfter: 10,
        visualHeadingSpacingBefore: 22,
        visualHeadingSpacingAfter: 11,
      },
    });

    const variables = createPreferenceCssVariables(preferences, "light");

    expect(variables["--accent-color"]).toBe("#123456");
    expect(variables["--accent-color-hover"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(variables["--focus-ring-color"]).toBe("rgb(18 52 86 / 0.32)");
    expect(variables["--ui-font-scale"]).toBe("1.2");
    expect(variables["--editor-max-width"]).toBe("1200px");
    expect(variables["--editor-line-height"]).toBe("1.7");
    expect(variables["--paragraph-space-before"]).toBe("2px");
    expect(variables["--paragraph-space-after"]).toBe("10px");
    expect(variables["--heading-space-before"]).toBe("22px");
    expect(variables["--heading-space-after"]).toBe("11px");
  });

  it("uses none for unlimited editor width and falls back from invalid accent colors", () => {
    const preferences = getDefaultUserPreferences();
    preferences.appearance.accentColor = "not-a-color";
    preferences.appearance.editorMaxWidth = null;

    const variables = createPreferenceCssVariables(preferences, "dark");

    expect(editorMaxWidthToCss(null)).toBe("none");
    expect(variables["--editor-max-width"]).toBe("none");
    expect(variables["--accent-color"]).toBe("#4f6bed");
  });
});

describe("appearance editing display presets", () => {
  it("returns expected built-in paragraph spacing presets", () => {
    const compact = updateUserPreferences(
      getDefaultUserPreferences(),
      editingDisplayUpdateFromParagraphPreset(getDefaultUserPreferences().editing, "compact"),
    );
    const normal = updateUserPreferences(
      getDefaultUserPreferences(),
      editingDisplayUpdateFromParagraphPreset(getDefaultUserPreferences().editing, "normal"),
    );
    const relaxed = updateUserPreferences(
      getDefaultUserPreferences(),
      editingDisplayUpdateFromParagraphPreset(getDefaultUserPreferences().editing, "relaxed"),
    );

    expect(compact.editing.visualLineHeight).toBe(1.25);
    expect(compact.editing.visualParagraphSpacingAfter).toBe(4);
    expect(normal.editing.visualLineHeight).toBe(1.5);
    expect(normal.editing.visualHeadingSpacingBefore).toBe(16);
    expect(relaxed.editing.visualLineHeight).toBe(1.75);
    expect(relaxed.editing.visualHeadingSpacingAfter).toBe(12);
  });

  it("marks display spacing as custom when details change", () => {
    const updated = updateUserPreferences(
      getDefaultUserPreferences(),
      customEditingDisplayUpdate({ visualParagraphSpacingAfter: 14 }),
    );

    expect(updated.editing.visualParagraphSpacingPreset).toBe("custom");
    expect(updated.editing.visualParagraphSpacingAfter).toBe(14);
  });
});

describe("AppearancePreferencesPanel", () => {
  it("edits appearance and display preferences without losing stored values", () => {
    render(<PanelHarness />);

    fireEvent.change(screen.getByLabelText("テーマ"), { target: { value: "dark" } });
    fireEvent.change(screen.getByLabelText("アクセントカラー"), {
      target: { value: "#112233" },
    });
    fireEvent.change(screen.getByLabelText("UI文字サイズ"), { target: { value: "1.25" } });
    fireEvent.change(screen.getByLabelText("エディタ最大幅"), { target: { value: "1100" } });
    fireEvent.change(screen.getByLabelText("段落間隔プリセット"), {
      target: { value: "relaxed" },
    });

    expect(screen.getByLabelText<HTMLSelectElement>("テーマ").value).toBe("dark");
    expect(screen.getByLabelText<HTMLInputElement>("アクセントカラー").value).toBe("#112233");
    expect(screen.getByLabelText<HTMLInputElement>("UI文字サイズ").value).toBe("1.25");
    expect(screen.getByLabelText<HTMLInputElement>("エディタ最大幅").value).toBe("1100");
    expect(screen.getByLabelText<HTMLSelectElement>("段落間隔プリセット").value).toBe("relaxed");
    expect(screen.getByLabelText<HTMLInputElement>("表示行間").value).toBe("1.75");
  });

  it("can switch editor width to unlimited and shows save failures", () => {
    render(<PanelHarness saveError="個人設定の保存に失敗しました。" />);

    fireEvent.click(screen.getByLabelText("エディタ幅制限なし"));

    expect(screen.queryByLabelText("エディタ最大幅")).toBeNull();
    expect(screen.getByText("個人設定の保存に失敗しました。")).toBeTruthy();
  });

  it("marks detailed spacing changes as custom", () => {
    render(<PanelHarness />);

    fireEvent.click(screen.getByText("表示の詳細設定"));
    fireEvent.change(screen.getByLabelText("段落後 px"), { target: { value: "18" } });

    expect(screen.getByLabelText<HTMLSelectElement>("段落間隔プリセット").value).toBe("custom");
  });
});

describe("display preferences stay separate from documents", () => {
  it("does not mutate editor JSON or project-like data when display settings change", () => {
    const project = {
      dirty: false,
      editorContent: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "本文" }] }],
      },
    };
    const before = structuredClone(project);

    const preferences = updateUserPreferences(getDefaultUserPreferences(), {
      appearance: { colorMode: "dark", accentColor: "#334455" },
      editing: { visualLineHeight: 1.8, visualParagraphSpacingAfter: 20 },
    });
    createPreferenceCssVariables(preferences, "dark");

    expect(project).toEqual(before);
    expect(JSON.stringify(preferences)).not.toContain("editorContent");
  });
});

function PanelHarness({ saveError = null }: { saveError?: string | null }) {
  const [preferences, setPreferences] = useState<UserPreferences>(() =>
    getDefaultUserPreferences(),
  );
  const update = (patch: UserPreferencesUpdate) => {
    setPreferences((current) => updateUserPreferences(current, patch));
  };
  return (
    <AppearancePreferencesPanel preferences={preferences} onChange={update} saveError={saveError} />
  );
}

function installMatchMediaMock(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    dispatchEvent: () => true,
  } as MediaQueryList;
  vi.stubGlobal("matchMedia", () => media);
  return {
    dispatch(nextMatches: boolean) {
      matches = nextMatches;
      for (const listener of listeners) {
        listener({ matches: nextMatches } as MediaQueryListEvent);
      }
    },
    listenerCount() {
      return listeners.size;
    },
  };
}
