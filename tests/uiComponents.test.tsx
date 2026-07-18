import { createRef } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { describe, expect, it, vi } from "vitest";

import { AppSidebar } from "../src/components/AppSidebar";
import { AppTopbar } from "../src/components/AppTopbar";
import { SaveStatus } from "../src/components/SaveStatus";
import { SettingsPanel } from "../src/components/SettingsPanel";
import { createNewProject } from "../src/document-model/schema";
import { EditorToolbar } from "../src/features/editor/EditorToolbar";
import { DEFAULT_TOOLBAR_COMMAND_ORDER } from "../src/preferences/toolbar";
import { getDefaultUserPreferences } from "../src/stores/userPreferences";

describe("AppTopbar", () => {
  it("renders save status and calls file operation handlers", () => {
    const handlers = {
      onTitleChange: vi.fn(),
      onNewProject: vi.fn(),
      onOpenProject: vi.fn(),
      onSaveProject: vi.fn(),
      onSaveProjectAs: vi.fn(),
      onImportDocx: vi.fn(),
      onExportDocx: vi.fn(),
      onOpenSettings: vi.fn(),
      onDarkModeChange: vi.fn(),
      onImageSelected: vi.fn(),
    };

    render(
      <AppTopbar
        title="文書"
        saveStatus="error"
        characterCount={1234}
        darkModeChecked={false}
        showSaveStatus={true}
        imageInputRef={createRef<HTMLInputElement>()}
        {...handlers}
      />,
    );

    expect(screen.getByText("保存エラー")).toBeTruthy();
    expect(screen.getByText("1,234 文字")).toBeTruthy();
    fireEvent.click(screen.getByText("新規"));
    fireEvent.click(screen.getByText("開く"));
    fireEvent.click(screen.getByText("保存"));
    fireEvent.click(screen.getByText("別名保存"));
    fireEvent.click(screen.getByText("DOCX読込"));
    fireEvent.click(screen.getByText("DOCX書出"));
    fireEvent.click(screen.getByText("設定"));
    fireEvent.change(screen.getByLabelText("文書名"), { target: { value: "次の文書" } });

    expect(handlers.onNewProject).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenProject).toHaveBeenCalledTimes(1);
    expect(handlers.onSaveProject).toHaveBeenCalledTimes(1);
    expect(handlers.onSaveProjectAs).toHaveBeenCalledTimes(1);
    expect(handlers.onImportDocx).toHaveBeenCalledTimes(1);
    expect(handlers.onExportDocx).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenSettings).toHaveBeenCalledTimes(1);
    expect(handlers.onTitleChange).toHaveBeenCalledWith("次の文書");
  });

  it("hides normal save status but keeps save errors visible", () => {
    const requiredProps = {
      title: "文書",
      characterCount: 0,
      darkModeChecked: false,
      showSaveStatus: false,
      imageInputRef: createRef<HTMLInputElement>(),
      onTitleChange: vi.fn(),
      onNewProject: vi.fn(),
      onOpenProject: vi.fn(),
      onSaveProject: vi.fn(),
      onSaveProjectAs: vi.fn(),
      onImportDocx: vi.fn(),
      onExportDocx: vi.fn(),
      onOpenSettings: vi.fn(),
      onDarkModeChange: vi.fn(),
      onImageSelected: vi.fn(),
    };
    const { rerender } = render(<AppTopbar saveStatus="saved" {...requiredProps} />);

    expect(screen.queryByText("保存済み")).toBeNull();
    rerender(<AppTopbar saveStatus="error" {...requiredProps} />);
    expect(screen.getByText("保存エラー")).toBeTruthy();
  });
});

describe("SaveStatus", () => {
  it("renders all save status labels", () => {
    const { rerender } = render(<SaveStatus status="saved" />);
    expect(screen.getByText("保存済み")).toBeTruthy();
    rerender(<SaveStatus status="dirty" />);
    expect(screen.getByText("未保存")).toBeTruthy();
    rerender(<SaveStatus status="saving" />);
    expect(screen.getByText("保存中")).toBeTruthy();
    rerender(<SaveStatus status="error" />);
    expect(screen.getByText("保存エラー")).toBeTruthy();
  });
});

describe("AppSidebar", () => {
  it("renders outline items and calls the select callback", () => {
    const onSelectItem = vi.fn();
    const item = { id: "heading-1", level: 2, text: "見出し" };

    render(<AppSidebar items={[item]} onSelectItem={onSelectItem} />);
    fireEvent.click(screen.getByText("見出し"));

    expect(screen.getByText("見出し")).toBeTruthy();
    expect(onSelectItem).toHaveBeenCalledWith(item);
  });

  it("renders the empty outline message", () => {
    render(<AppSidebar items={[]} />);
    expect(screen.getByText("見出しはまだありません。")).toBeTruthy();
  });
});

describe("EditorToolbar", () => {
  it("renders the existing button order and calls editor commands", () => {
    const { editor, chain } = createEditorMock();
    const onInsertImage = vi.fn();
    const onInsertPageBreak = vi.fn();

    render(
      <EditorToolbar
        editor={editor}
        preferences={getDefaultUserPreferences().toolbar}
        onInsertImage={onInsertImage}
        onInsertPageBreak={onInsertPageBreak}
      />,
    );

    const toolbar = screen.getByLabelText("書式ツールバー");
    expect(within(toolbar).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "B",
      "I",
      "U",
      "S",
      "H1",
      "H2",
      "H3",
      "H4",
      "本文",
      "左",
      "中",
      "右",
      "両",
      "箇条",
      "番号",
      "表",
      "行+",
      "列+",
      "行-",
      "列-",
      "画像",
      "図題",
      "表題",
      "改頁",
      "戻",
      "進",
    ]);

    fireEvent.click(screen.getByLabelText("太字"));
    fireEvent.click(screen.getByText("H2"));
    fireEvent.click(screen.getByText("画像"));
    fireEvent.click(screen.getByText("改頁"));

    expect(chain.toggleBold).toHaveBeenCalledTimes(1);
    expect(chain.toggleHeading).toHaveBeenCalledWith({ level: 2 });
    expect(onInsertImage).toHaveBeenCalledTimes(1);
    expect(onInsertPageBreak).toHaveBeenCalledTimes(1);
  });

  it("does not crash when editor is null", () => {
    const onInsertPageBreak = vi.fn();
    render(
      <EditorToolbar
        editor={null}
        preferences={getDefaultUserPreferences().toolbar}
        onInsertImage={vi.fn()}
        onInsertPageBreak={onInsertPageBreak}
      />,
    );

    fireEvent.click(screen.getByLabelText("太字"));
    fireEvent.click(screen.getByText("改頁"));

    expect(onInsertPageBreak).toHaveBeenCalledTimes(0);
  });

  it("uses saved order, hidden buttons, labels, and size attributes", () => {
    const { editor } = createEditorMock();
    render(
      <EditorToolbar
        editor={editor}
        preferences={{
          buttonOrder: ["redo", "bold", ...DEFAULT_TOOLBAR_COMMAND_ORDER],
          hiddenButtons: ["bold"],
          buttonSize: "large",
          showLabels: true,
        }}
        position="bottom"
        onInsertImage={vi.fn()}
        onInsertPageBreak={vi.fn()}
      />,
    );

    const toolbar = screen.getByLabelText("書式ツールバー");
    expect(toolbar.getAttribute("data-position")).toBe("bottom");
    expect(toolbar.getAttribute("data-button-size")).toBe("large");
    expect(toolbar.getAttribute("data-show-labels")).toBe("true");
    expect(within(toolbar).queryByLabelText("太字")).toBeNull();
    expect(within(toolbar).getAllByRole("button")[0]?.textContent).toBe("進やり直す");
  });
});

describe("SettingsPanel", () => {
  it("shows stored appearance settings and separates preference and document events", () => {
    const preferences = getDefaultUserPreferences();
    preferences.appearance.colorMode = "dark";
    preferences.appearance.accentColor = "#112233";
    const onUpdatePreferences = vi.fn();
    const onUpdateEditingPreferences = vi.fn();
    const onUpdatePageSettings = vi.fn();

    render(
      <SettingsPanel
        pageSettings={createNewProject().pageSettings}
        userPreferences={preferences}
        preferenceSaveError={null}
        showAdvancedEditingSettings={false}
        canApplyToSelectedBlock={false}
        onUpdatePreferences={onUpdatePreferences}
        onUpdateEditingPreferences={onUpdateEditingPreferences}
        onToggleAdvancedEditingSettings={vi.fn()}
        onApplyPreferencesToDocumentDefaults={vi.fn()}
        onApplyPreferencesToSelectedBlock={vi.fn()}
        onUpdatePageSettings={onUpdatePageSettings}
      />,
    );

    expect(screen.getByLabelText<HTMLSelectElement>("テーマ").value).toBe("dark");
    expect(screen.getByLabelText<HTMLInputElement>("アクセントカラー").value).toBe("#112233");

    fireEvent.change(screen.getByLabelText("テーマ"), { target: { value: "light" } });
    expect(onUpdatePreferences).toHaveBeenCalledWith({ appearance: { colorMode: "light" } });
    expect(onUpdatePageSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("アウトラインを表示"));
    expect(onUpdatePreferences).toHaveBeenCalledWith({ layout: { sidebarVisible: false } });
    fireEvent.change(screen.getByLabelText("設定パネル位置"), { target: { value: "left" } });
    expect(onUpdatePreferences).toHaveBeenCalledWith({ layout: { settingsPosition: "left" } });
    expect(screen.getByText("非表示後は上部の設定ボタンまたはCtrl+,で再表示できます。")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("向き"), { target: { value: "landscape" } });
    expect(onUpdatePageSettings).toHaveBeenCalledWith({ orientation: "landscape" });

    fireEvent.click(screen.getByLabelText("段落記号"));
    expect(onUpdateEditingPreferences).toHaveBeenCalledTimes(1);
  });

  it("updates and resets toolbar preferences", () => {
    const preferences = getDefaultUserPreferences();
    const onUpdatePreferences = vi.fn();

    render(
      <SettingsPanel
        pageSettings={createNewProject().pageSettings}
        userPreferences={preferences}
        preferenceSaveError={null}
        showAdvancedEditingSettings={false}
        canApplyToSelectedBlock={false}
        onUpdatePreferences={onUpdatePreferences}
        onUpdateEditingPreferences={vi.fn()}
        onToggleAdvancedEditingSettings={vi.fn()}
        onApplyPreferencesToDocumentDefaults={vi.fn()}
        onApplyPreferencesToSelectedBlock={vi.fn()}
        onUpdatePageSettings={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("ツールバー位置"), { target: { value: "bottom" } });
    expect(onUpdatePreferences).toHaveBeenCalledWith({ layout: { toolbarPosition: "bottom" } });
    fireEvent.change(screen.getByLabelText("ボタンサイズ"), { target: { value: "small" } });
    expect(onUpdatePreferences).toHaveBeenCalledWith({ toolbar: { buttonSize: "small" } });
    fireEvent.click(screen.getByLabelText("ボタンのラベルを表示"));
    expect(onUpdatePreferences).toHaveBeenCalledWith({ toolbar: { showLabels: true } });
    fireEvent.click(screen.getByLabelText("太字"));
    expect(onUpdatePreferences).toHaveBeenCalledWith({ toolbar: { hiddenButtons: ["bold"] } });
    fireEvent.click(screen.getByLabelText("斜体を上へ移動"));
    expect(onUpdatePreferences).toHaveBeenCalledWith({
      toolbar: {
        buttonOrder: ["italic", "bold", ...DEFAULT_TOOLBAR_COMMAND_ORDER.slice(2)],
      },
    });
    fireEvent.click(screen.getByText("ツールバー設定を初期値に戻す"));
    expect(onUpdatePreferences).toHaveBeenCalledWith({
      layout: { toolbarVisible: true, toolbarPosition: "top" },
      toolbar: {
        buttonOrder: DEFAULT_TOOLBAR_COMMAND_ORDER,
        hiddenButtons: [],
        buttonSize: "medium",
        showLabels: false,
      },
    });
  });
});

function createEditorMock(): {
  editor: Editor;
  chain: Record<string, ReturnType<typeof vi.fn>>;
} {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const chainMethodNames = [
    "focus",
    "toggleBold",
    "toggleItalic",
    "toggleUnderline",
    "toggleStrike",
    "toggleHeading",
    "setParagraph",
    "setTextAlign",
    "toggleBulletList",
    "toggleOrderedList",
    "insertTable",
    "addRowAfter",
    "addColumnAfter",
    "deleteRow",
    "deleteColumn",
    "insertContent",
    "undo",
    "redo",
  ];
  for (const name of chainMethodNames) {
    chain[name] = vi.fn(() => chain);
  }
  chain.run = vi.fn(() => true);

  return {
    editor: {
      chain: () => chain,
      isActive: vi.fn((name: string) => name === "bold"),
    } as unknown as Editor,
    chain,
  };
}
