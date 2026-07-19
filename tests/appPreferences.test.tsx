import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "../src/App";
import { USER_PREFERENCES_STORAGE_KEY } from "../src/preferences/storage";

describe("App appearance preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    }));
  });

  it("applies theme changes without marking the document dirty", () => {
    const rendered = render(<App />);
    const app = rendered.container.querySelector(".app");

    expect(screen.getByText("保存済み")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("テーマ"), { target: { value: "dark" } });

    expect(screen.getByText("保存済み")).toBeTruthy();
    expect(app?.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY)).not.toContain(
      "editorContent",
    );
  });

  it("renders the editor inside a page frame that reflects page settings", () => {
    const rendered = render(<App />);
    const pageFrame = screen.getByLabelText("ページ表示");

    expect(pageFrame.getAttribute("data-orientation")).toBe("portrait");
    expect(pageFrame.style.getPropertyValue("--page-width")).toBe("672px");
    expect(pageFrame.style.getPropertyValue("--page-min-height")).toBe("950px");

    fireEvent.change(screen.getByLabelText("向き"), { target: { value: "landscape" } });

    expect(pageFrame.getAttribute("data-orientation")).toBe("landscape");
    expect(rendered.container.querySelector(".editor-canvas")).toBeTruthy();
  });

  it("hides and reopens settings from the fixed topbar button without making the document dirty", async () => {
    render(<App />);

    fireEvent.click(screen.getByLabelText("設定パネルを表示"));
    expect(screen.queryByLabelText("文書設定")).toBeNull();
    expect(screen.getByText("設定")).toBeTruthy();
    expect(screen.getByText("保存済み")).toBeTruthy();

    fireEvent.click(screen.getByText("設定"));

    expect(await screen.findByLabelText("文書設定")).toBeTruthy();
    expect(screen.getByText("保存済み")).toBeTruthy();
  });

  it("reopens settings with Ctrl+,", async () => {
    render(<App />);

    fireEvent.click(screen.getByLabelText("設定パネルを表示"));
    expect(screen.queryByLabelText("文書設定")).toBeNull();

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });

    expect(await screen.findByLabelText("文書設定")).toBeTruthy();
  });

  it("persists layout visibility and position preferences without document content", async () => {
    render(<App />);

    fireEvent.click(screen.getByLabelText("アウトラインを表示"));
    fireEvent.change(screen.getByLabelText("設定パネル位置"), { target: { value: "left" } });

    await waitFor(() => {
      const saved = window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY) ?? "";
      expect(saved).toContain('"sidebarVisible":false');
      expect(saved).toContain('"settingsPosition":"left"');
      expect(saved).not.toContain("editorContent");
    });
  });

  it("hides layout regions without changing the document dirty state", () => {
    render(<App />);

    fireEvent.click(screen.getByLabelText("アウトラインを表示"));
    expect(screen.queryByLabelText("文書アウトライン")).toBeNull();
    fireEvent.click(screen.getByLabelText("ツールバーを表示"));
    expect(screen.queryByLabelText("書式ツールバー")).toBeNull();
    fireEvent.click(screen.getByLabelText("保存状態を表示"));
    expect(screen.queryByText("保存済み")).toBeNull();

    const saved = window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY) ?? "";
    expect(saved).not.toContain("editorContent");
    expect(screen.queryByText("未保存")).toBeNull();
  });

  it("persists toolbar preferences without changing the document dirty state", async () => {
    render(<App />);
    const settings = screen.getByLabelText("文書設定");

    fireEvent.change(within(settings).getByLabelText("ツールバー位置"), {
      target: { value: "bottom" },
    });
    fireEvent.change(within(settings).getByLabelText("ボタンサイズ"), {
      target: { value: "large" },
    });
    fireEvent.click(within(settings).getByLabelText("ボタンのラベルを表示"));
    fireEvent.click(within(settings).getByLabelText("太字"));
    fireEvent.click(within(settings).getByLabelText("斜体を上へ移動"));

    expect(screen.getByText("保存済み")).toBeTruthy();
    await waitFor(() => {
      const saved = window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY) ?? "";
      expect(saved).toContain('"toolbarPosition":"bottom"');
      expect(saved).toContain('"buttonSize":"large"');
      expect(saved).toContain('"showLabels":true');
      expect(saved).toContain('"hiddenButtons":["bold"]');
      expect(saved).not.toContain("editorContent");
    });
  });
});
