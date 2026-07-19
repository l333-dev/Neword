import type { Editor } from "@tiptap/react";

import type { ToolbarCommandId } from "../../preferences/toolbar";

export type ToolbarGroupId =
  "text" | "heading" | "block" | "alignment" | "list" | "table" | "insert" | "history";

export type ToolbarCommandContext = {
  editor: Editor;
  onInsertImage: () => void;
  onInsertPageBreak: () => void;
};

export type ToolbarCommandDefinition = {
  id: ToolbarCommandId;
  label: string;
  shortLabel: string;
  group: ToolbarGroupId;
  isActive?: (editor: Editor) => boolean;
  isEnabled?: (editor: Editor) => boolean;
  execute: (context: ToolbarCommandContext) => void;
};

export const TOOLBAR_COMMAND_DEFINITIONS: ToolbarCommandDefinition[] = [
  command("bold", "太字", "B", "text", ({ editor }) => editor.chain().focus().toggleBold().run(), {
    isActive: (editor) => editor.isActive("bold"),
  }),
  command(
    "italic",
    "斜体",
    "I",
    "text",
    ({ editor }) => editor.chain().focus().toggleItalic().run(),
    { isActive: (editor) => editor.isActive("italic") },
  ),
  command(
    "underline",
    "下線",
    "U",
    "text",
    ({ editor }) => editor.chain().focus().toggleUnderline().run(),
    { isActive: (editor) => editor.isActive("underline") },
  ),
  command(
    "strike",
    "取り消し線",
    "S",
    "text",
    ({ editor }) => editor.chain().focus().toggleStrike().run(),
    { isActive: (editor) => editor.isActive("strike") },
  ),
  ...([1, 2, 3, 4] as const).map((level) =>
    command(
      `heading${level}`,
      `見出し${level}`,
      `H${level}`,
      "heading",
      ({ editor }) => editor.chain().focus().toggleHeading({ level }).run(),
      { isActive: (editor) => editor.isActive("heading", { level }) },
    ),
  ),
  command("paragraph", "本文", "本文", "block", ({ editor }) =>
    editor.chain().focus().setParagraph().run(),
  ),
  command("alignLeft", "左揃え", "左", "alignment", ({ editor }) =>
    editor.chain().focus().setTextAlign("left").run(),
  ),
  command("alignCenter", "中央揃え", "中", "alignment", ({ editor }) =>
    editor.chain().focus().setTextAlign("center").run(),
  ),
  command("alignRight", "右揃え", "右", "alignment", ({ editor }) =>
    editor.chain().focus().setTextAlign("right").run(),
  ),
  command("alignJustify", "両端揃え", "両", "alignment", ({ editor }) =>
    editor.chain().focus().setTextAlign("justify").run(),
  ),
  command("bulletList", "箇条書き", "箇条", "list", ({ editor }) =>
    editor.chain().focus().toggleBulletList().run(),
  ),
  command("orderedList", "番号付きリスト", "番号", "list", ({ editor }) =>
    editor.chain().focus().toggleOrderedList().run(),
  ),
  command("insertTable", "表を挿入", "表", "table", ({ editor }) =>
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  ),
  command(
    "addRowBefore",
    "上に行を追加",
    "行↑",
    "table",
    ({ editor }) => editor.chain().focus().addRowBefore().run(),
    { isEnabled: (editor) => editor.isActive("table") },
  ),
  command(
    "addRowAfter",
    "下に行を追加",
    "行↓",
    "table",
    ({ editor }) => editor.chain().focus().addRowAfter().run(),
    { isEnabled: (editor) => editor.isActive("table") },
  ),
  command(
    "addColumnBefore",
    "左に列を追加",
    "列←",
    "table",
    ({ editor }) => editor.chain().focus().addColumnBefore().run(),
    { isEnabled: (editor) => editor.isActive("table") },
  ),
  command(
    "addColumnAfter",
    "右に列を追加",
    "列→",
    "table",
    ({ editor }) => editor.chain().focus().addColumnAfter().run(),
    { isEnabled: (editor) => editor.isActive("table") },
  ),
  command(
    "deleteRow",
    "現在の行を削除",
    "行-",
    "table",
    ({ editor }) => editor.chain().focus().deleteRow().run(),
    { isEnabled: (editor) => editor.isActive("table") },
  ),
  command(
    "deleteColumn",
    "現在の列を削除",
    "列-",
    "table",
    ({ editor }) => editor.chain().focus().deleteColumn().run(),
    { isEnabled: (editor) => editor.isActive("table") },
  ),
  command(
    "deleteTable",
    "表を削除",
    "表-",
    "table",
    ({ editor }) => editor.chain().focus().deleteTable().run(),
    { isEnabled: (editor) => editor.isActive("table") },
  ),
  command(
    "mergeCells",
    "選択セルを結合",
    "結合",
    "table",
    ({ editor }) => editor.chain().focus().mergeCells().run(),
    { isEnabled: (editor) => editor.isActive("table") },
  ),
  command(
    "splitCell",
    "現在のセルを結合解除",
    "解除",
    "table",
    ({ editor }) => editor.chain().focus().splitCell().run(),
    { isEnabled: (editor) => editor.isActive("table") },
  ),
  command(
    "toggleHeaderRow",
    "ヘッダー行を切り替え",
    "H行",
    "table",
    ({ editor }) => editor.chain().focus().toggleHeaderRow().run(),
    { isEnabled: (editor) => editor.isActive("table") },
  ),
  command("insertImage", "画像を挿入", "画像", "insert", ({ onInsertImage }) => onInsertImage()),
  command("figureCaption", "図題を挿入", "図題", "insert", ({ editor }) =>
    editor.chain().focus().insertContent("<p>図1 </p>").run(),
  ),
  command("tableCaption", "表題を挿入", "表題", "insert", ({ editor }) =>
    editor.chain().focus().insertContent("<p>表1 </p>").run(),
  ),
  command("insertPageBreak", "改ページ", "改頁", "insert", ({ onInsertPageBreak }) =>
    onInsertPageBreak(),
  ),
  command(
    "deletePageBreak",
    "選択中の改ページを削除",
    "改頁-",
    "insert",
    ({ editor }) => editor.chain().focus().deletePageBreak().run(),
    {
      isActive: (editor) => editor.isActive("pageBreak"),
      isEnabled: (editor) => editor.isActive("pageBreak"),
    },
  ),
  command("undo", "元に戻す", "戻", "history", ({ editor }) => editor.chain().focus().undo().run()),
  command("redo", "やり直す", "進", "history", ({ editor }) => editor.chain().focus().redo().run()),
];

export const toolbarCommandDefinitionsById = new Map(
  TOOLBAR_COMMAND_DEFINITIONS.map((definition) => [definition.id, definition]),
);

function command(
  id: ToolbarCommandId,
  label: string,
  shortLabel: string,
  group: ToolbarGroupId,
  execute: ToolbarCommandDefinition["execute"],
  extra: Partial<Pick<ToolbarCommandDefinition, "isActive" | "isEnabled">> = {},
): ToolbarCommandDefinition {
  return {
    id,
    label,
    shortLabel,
    group,
    execute,
    ...extra,
  };
}
