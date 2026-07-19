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

const defaultImageSettings = {
  widthPx: 320,
  heightPx: 240,
  originalWidthPx: 320,
  originalHeightPx: 240,
  keepAspectRatio: true,
  alignment: "left" as const,
  altText: "",
};

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
    rerender(<SaveStatus status="autosave-pending" />);
    expect(screen.getByText("自動保存待機中")).toBeTruthy();
    rerender(<SaveStatus status="autosaved" />);
    expect(screen.getByText("自動保存済み")).toBeTruthy();
    rerender(<SaveStatus status="autosave-error" />);
    expect(screen.getByText("自動保存エラー")).toBeTruthy();
    rerender(<SaveStatus status="recovered" />);
    expect(screen.getByText("復旧版を編集中")).toBeTruthy();
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
    expect(
      within(toolbar)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([
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
      "行↑",
      "行↓",
      "列←",
      "列→",
      "行-",
      "列-",
      "表-",
      "結合",
      "解除",
      "H行",
      "画像",
      "図題",
      "表題",
      "改頁",
      "改頁-",
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
        paragraphSettings={createNewProject().paragraphSettings}
        header={createNewProject().header}
        footer={createNewProject().footer}
        tableCellSettings={{ backgroundColor: null, verticalAlign: "top" }}
        imageSettings={defaultImageSettings}
        userPreferences={preferences}
        preferenceSaveError={null}
        showAdvancedEditingSettings={false}
        canApplyToSelectedBlock={false}
        canEditSelectedTableCell={false}
        canEditSelectedImage={false}
        imageError={null}
        onUpdatePreferences={onUpdatePreferences}
        onUpdateEditingPreferences={onUpdateEditingPreferences}
        onToggleAdvancedEditingSettings={vi.fn()}
        onApplyPreferencesToDocumentDefaults={vi.fn()}
        onApplyPreferencesToSelectedBlock={vi.fn()}
        onUpdatePageSettings={onUpdatePageSettings}
        onUpdateSelectedParagraphSettings={vi.fn()}
        onUpdateSelectedTableCellSettings={vi.fn()}
        onUpdateSelectedImageSettings={vi.fn()}
        onResetSelectedImageSize={vi.fn()}
        onDeleteSelectedImage={vi.fn()}
        onUpdateHeader={vi.fn()}
        onUpdateFooter={vi.fn()}
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
    expect(
      screen.getByText("非表示後は上部の設定ボタンまたはCtrl+,で再表示できます。"),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText("用紙の向き"), { target: { value: "landscape" } });
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
        paragraphSettings={createNewProject().paragraphSettings}
        header={createNewProject().header}
        footer={createNewProject().footer}
        tableCellSettings={{ backgroundColor: null, verticalAlign: "top" }}
        imageSettings={defaultImageSettings}
        userPreferences={preferences}
        preferenceSaveError={null}
        showAdvancedEditingSettings={false}
        canApplyToSelectedBlock={false}
        canEditSelectedTableCell={false}
        canEditSelectedImage={false}
        imageError={null}
        onUpdatePreferences={onUpdatePreferences}
        onUpdateEditingPreferences={vi.fn()}
        onToggleAdvancedEditingSettings={vi.fn()}
        onApplyPreferencesToDocumentDefaults={vi.fn()}
        onApplyPreferencesToSelectedBlock={vi.fn()}
        onUpdatePageSettings={vi.fn()}
        onUpdateSelectedParagraphSettings={vi.fn()}
        onUpdateSelectedTableCellSettings={vi.fn()}
        onUpdateSelectedImageSettings={vi.fn()}
        onResetSelectedImageSize={vi.fn()}
        onDeleteSelectedImage={vi.fn()}
        onUpdateHeader={vi.fn()}
        onUpdateFooter={vi.fn()}
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

  it("updates page settings and selected paragraph settings from document sections", () => {
    const project = createNewProject();
    const onUpdatePageSettings = vi.fn();
    const onUpdateSelectedParagraphSettings = vi.fn();
    const onUpdateSelectedTableCellSettings = vi.fn();

    render(
      <SettingsPanel
        pageSettings={project.pageSettings}
        header={project.header}
        footer={project.footer}
        tableCellSettings={{ backgroundColor: "#DBEAFE", verticalAlign: "middle" }}
        imageSettings={{ ...defaultImageSettings, widthPx: 200, heightPx: 100, altText: "図" }}
        paragraphSettings={{
          indentLeftMm: 1,
          indentRightMm: 2,
          firstLineIndentMm: 3,
          spaceBeforePt: 4,
          spaceAfterPt: 5,
          lineSpacing: { type: "multiple", value: 1.5 },
        }}
        userPreferences={getDefaultUserPreferences()}
        preferenceSaveError={null}
        showAdvancedEditingSettings={false}
        canApplyToSelectedBlock={true}
        canEditSelectedTableCell={true}
        canEditSelectedImage={true}
        imageError={null}
        onUpdatePreferences={vi.fn()}
        onUpdateEditingPreferences={vi.fn()}
        onToggleAdvancedEditingSettings={vi.fn()}
        onApplyPreferencesToDocumentDefaults={vi.fn()}
        onApplyPreferencesToSelectedBlock={vi.fn()}
        onUpdatePageSettings={onUpdatePageSettings}
        onUpdateSelectedParagraphSettings={onUpdateSelectedParagraphSettings}
        onUpdateSelectedTableCellSettings={onUpdateSelectedTableCellSettings}
        onUpdateSelectedImageSettings={vi.fn()}
        onResetSelectedImageSize={vi.fn()}
        onDeleteSelectedImage={vi.fn()}
        onUpdateHeader={vi.fn()}
        onUpdateFooter={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("用紙サイズ"), { target: { value: "Letter" } });
    expect(onUpdatePageSettings).toHaveBeenCalledWith({ size: "Letter" });
    fireEvent.change(screen.getByLabelText("上余白 mm"), { target: { value: "12" } });
    expect(onUpdatePageSettings).toHaveBeenCalledWith({
      margins: { ...project.pageSettings.margins, topMm: 12 },
    });
    fireEvent.change(screen.getByLabelText("左インデント mm"), { target: { value: "10" } });
    expect(onUpdateSelectedParagraphSettings).toHaveBeenCalledWith({ indentLeftMm: 10 });
    fireEvent.change(screen.getByLabelText("段落間隔 Before"), { target: { value: "6" } });
    expect(onUpdateSelectedParagraphSettings).toHaveBeenCalledWith({ spaceBeforePt: 6 });
    fireEvent.change(screen.getByLabelText("段落行間"), { target: { value: "2" } });
    expect(onUpdateSelectedParagraphSettings).toHaveBeenCalledWith({
      lineSpacing: { type: "multiple", value: 2 },
    });
    fireEvent.change(screen.getByLabelText("セル背景色"), { target: { value: "#FEE2E2" } });
    expect(onUpdateSelectedTableCellSettings).toHaveBeenCalledWith({
      backgroundColor: "#FEE2E2",
    });
    fireEvent.change(screen.getByLabelText("セル縦方向配置"), { target: { value: "bottom" } });
    expect(onUpdateSelectedTableCellSettings).toHaveBeenCalledWith({ verticalAlign: "bottom" });
  });

  it("disables table cell settings outside a table", () => {
    const project = createNewProject();

    render(
      <SettingsPanel
        pageSettings={project.pageSettings}
        paragraphSettings={project.paragraphSettings}
        header={project.header}
        footer={project.footer}
        tableCellSettings={{ backgroundColor: null, verticalAlign: "top" }}
        imageSettings={defaultImageSettings}
        userPreferences={getDefaultUserPreferences()}
        preferenceSaveError={null}
        showAdvancedEditingSettings={false}
        canApplyToSelectedBlock={false}
        canEditSelectedTableCell={false}
        canEditSelectedImage={false}
        imageError={null}
        onUpdatePreferences={vi.fn()}
        onUpdateEditingPreferences={vi.fn()}
        onToggleAdvancedEditingSettings={vi.fn()}
        onApplyPreferencesToDocumentDefaults={vi.fn()}
        onApplyPreferencesToSelectedBlock={vi.fn()}
        onUpdatePageSettings={vi.fn()}
        onUpdateSelectedParagraphSettings={vi.fn()}
        onUpdateSelectedTableCellSettings={vi.fn()}
        onUpdateSelectedImageSettings={vi.fn()}
        onResetSelectedImageSize={vi.fn()}
        onDeleteSelectedImage={vi.fn()}
        onUpdateHeader={vi.fn()}
        onUpdateFooter={vi.fn()}
      />,
    );

    expect(screen.getByLabelText<HTMLSelectElement>("セル背景色").disabled).toBe(true);
    expect(screen.getByLabelText<HTMLSelectElement>("セル縦方向配置").disabled).toBe(true);
  });

  it("updates selected image settings and actions", () => {
    const project = createNewProject();
    const onUpdateSelectedImageSettings = vi.fn();
    const onResetSelectedImageSize = vi.fn();
    const onDeleteSelectedImage = vi.fn();

    render(
      <SettingsPanel
        pageSettings={project.pageSettings}
        paragraphSettings={project.paragraphSettings}
        header={project.header}
        footer={project.footer}
        tableCellSettings={{ backgroundColor: null, verticalAlign: "top" }}
        imageSettings={{
          ...defaultImageSettings,
          widthPx: 240,
          heightPx: 120,
          alignment: "center",
          altText: "画像",
        }}
        userPreferences={getDefaultUserPreferences()}
        preferenceSaveError={null}
        showAdvancedEditingSettings={false}
        canApplyToSelectedBlock={false}
        canEditSelectedTableCell={false}
        canEditSelectedImage={true}
        imageError={null}
        onUpdatePreferences={vi.fn()}
        onUpdateEditingPreferences={vi.fn()}
        onToggleAdvancedEditingSettings={vi.fn()}
        onApplyPreferencesToDocumentDefaults={vi.fn()}
        onApplyPreferencesToSelectedBlock={vi.fn()}
        onUpdatePageSettings={vi.fn()}
        onUpdateSelectedParagraphSettings={vi.fn()}
        onUpdateSelectedTableCellSettings={vi.fn()}
        onUpdateSelectedImageSettings={onUpdateSelectedImageSettings}
        onResetSelectedImageSize={onResetSelectedImageSize}
        onDeleteSelectedImage={onDeleteSelectedImage}
        onUpdateHeader={vi.fn()}
        onUpdateFooter={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("画像幅 px"), { target: { value: "320" } });
    expect(onUpdateSelectedImageSettings).toHaveBeenCalledWith({ widthPx: 320 });
    fireEvent.click(screen.getByLabelText("画像の縦横比を維持"));
    expect(onUpdateSelectedImageSettings).toHaveBeenCalledWith({ keepAspectRatio: false });
    fireEvent.change(screen.getByLabelText("画像配置"), { target: { value: "right" } });
    expect(onUpdateSelectedImageSettings).toHaveBeenCalledWith({ alignment: "right" });
    fireEvent.change(screen.getByLabelText("画像代替テキスト"), { target: { value: "説明" } });
    expect(onUpdateSelectedImageSettings).toHaveBeenCalledWith({ altText: "説明" });
    fireEvent.click(screen.getByText("元のサイズに戻す"));
    expect(onResetSelectedImageSize).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("画像を削除"));
    expect(onDeleteSelectedImage).toHaveBeenCalledTimes(1);
  });

  it("renders independent header and footer editors and updates page number position", () => {
    const project = createNewProject();
    const onUpdateFooter = vi.fn();

    render(
      <SettingsPanel
        pageSettings={project.pageSettings}
        paragraphSettings={project.paragraphSettings}
        header={{ ...project.header, plainText: "Header text" }}
        footer={{ ...project.footer, plainText: "Footer text", pageNumberPosition: "none" }}
        tableCellSettings={{ backgroundColor: null, verticalAlign: "top" }}
        imageSettings={defaultImageSettings}
        userPreferences={getDefaultUserPreferences()}
        preferenceSaveError={null}
        showAdvancedEditingSettings={false}
        canApplyToSelectedBlock={true}
        canEditSelectedTableCell={false}
        canEditSelectedImage={false}
        imageError={null}
        onUpdatePreferences={vi.fn()}
        onUpdateEditingPreferences={vi.fn()}
        onToggleAdvancedEditingSettings={vi.fn()}
        onApplyPreferencesToDocumentDefaults={vi.fn()}
        onApplyPreferencesToSelectedBlock={vi.fn()}
        onUpdatePageSettings={vi.fn()}
        onUpdateSelectedParagraphSettings={vi.fn()}
        onUpdateSelectedTableCellSettings={vi.fn()}
        onUpdateSelectedImageSettings={vi.fn()}
        onResetSelectedImageSize={vi.fn()}
        onDeleteSelectedImage={vi.fn()}
        onUpdateHeader={vi.fn()}
        onUpdateFooter={onUpdateFooter}
      />,
    );

    expect(screen.getByLabelText("Header editor")).toBeTruthy();
    expect(screen.getByLabelText("Footer editor")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("ページ番号"), { target: { value: "right" } });

    expect(onUpdateFooter).toHaveBeenCalledWith({
      ...project.footer,
      plainText: "Footer text",
      pageNumberPosition: "right",
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
    "addRowBefore",
    "addRowAfter",
    "addColumnBefore",
    "addColumnAfter",
    "deleteRow",
    "deleteColumn",
    "deleteTable",
    "mergeCells",
    "splitCell",
    "toggleHeaderRow",
    "insertContent",
    "deletePageBreak",
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
