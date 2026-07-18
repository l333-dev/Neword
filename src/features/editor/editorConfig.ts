import Image from "@tiptap/extension-image";
import { Extension } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TextAlign from "@tiptap/extension-text-align";
import StarterKit from "@tiptap/starter-kit";

import { ParagraphFormattingSchema, type ParagraphFormatting } from "../../document-model/schema";
import {
  defaultEditingPreferences,
  type UserEditingPreferences,
} from "../../stores/editingPreferences";
import { PageBreak } from "./page-break";

function parseParagraphFormatting(value: string | null): ParagraphFormatting | null {
  if (!value) return null;
  try {
    const parsed = ParagraphFormattingSchema.safeParse(JSON.parse(value) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function paragraphFormattingStyle(formatting: ParagraphFormatting | null): string | null {
  if (!formatting) return null;
  const declarations: string[] = [];
  if (formatting.indentLeftMm !== undefined)
    declarations.push(`margin-left: ${formatting.indentLeftMm}mm`);
  if (formatting.indentRightMm !== undefined)
    declarations.push(`margin-right: ${formatting.indentRightMm}mm`);
  if (formatting.firstLineIndentMm !== undefined)
    declarations.push(`text-indent: ${formatting.firstLineIndentMm}mm`);
  if (formatting.hangingIndentMm !== undefined)
    declarations.push(`text-indent: -${formatting.hangingIndentMm}mm`);
  if (formatting.spaceBeforePt !== undefined)
    declarations.push(`margin-top: ${formatting.spaceBeforePt}pt`);
  if (formatting.spaceAfterPt !== undefined)
    declarations.push(`margin-bottom: ${formatting.spaceAfterPt}pt`);
  if (formatting.lineSpacing?.type === "single" || formatting.lineSpacing?.type === "multiple") {
    declarations.push(`line-height: ${formatting.lineSpacing.value}`);
  }
  if (formatting.pageBreakBefore) declarations.push("break-before: page");
  return declarations.length > 0 ? declarations.join("; ") : null;
}

const ParagraphFormatting = Extension.create({
  name: "paragraphFormatting",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          paragraphFormatting: {
            default: null,
            parseHTML: (element) =>
              parseParagraphFormatting(element.getAttribute("data-paragraph-formatting")),
            renderHTML: (attributes) => {
              const parsed = ParagraphFormattingSchema.safeParse(attributes.paragraphFormatting);
              const formatting = parsed.success ? parsed.data : null;
              const style = paragraphFormattingStyle(formatting);
              return {
                ...(formatting ? { "data-paragraph-formatting": JSON.stringify(formatting) } : {}),
                ...(style ? { style } : {}),
              };
            },
          },
        },
      },
    ];
  },
});

const AssetImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      assetId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-asset-id"),
        renderHTML: (attributes) =>
          typeof attributes.assetId === "string" ? { "data-asset-id": attributes.assetId } : {},
      },
      width: {
        default: null,
        parseHTML: (element) => element.getAttribute("width"),
        renderHTML: (attributes) =>
          typeof attributes.width === "string" || typeof attributes.width === "number"
            ? { width: attributes.width }
            : {},
      },
      height: {
        default: null,
        parseHTML: (element) => element.getAttribute("height"),
        renderHTML: (attributes) =>
          typeof attributes.height === "string" || typeof attributes.height === "number"
            ? { height: attributes.height }
            : {},
      },
    };
  },
});

const SimpleLineBreakBehavior = Extension.create<{
  getPreferences: () => UserEditingPreferences;
}>({
  name: "simpleLineBreakBehavior",
  addOptions() {
    return {
      getPreferences: () => defaultEditingPreferences,
    };
  },
  addKeyboardShortcuts() {
    const runBehavior = (behavior: UserEditingPreferences["enterBehavior"]) => {
      if (behavior === "hardBreak") {
        return this.editor.commands.setHardBreak();
      }
      return this.editor.commands.splitBlock();
    };
    return {
      Enter: () => runBehavior(this.options.getPreferences().enterBehavior),
      "Shift-Enter": () => runBehavior(this.options.getPreferences().shiftEnterBehavior),
    };
  },
});

export function createEditorExtensions(
  getPreferences: () => UserEditingPreferences = () => defaultEditingPreferences,
) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: {
        openOnClick: false,
        autolink: true,
        protocols: ["http", "https", "mailto"],
      },
    }),
    TextAlign.configure({
      types: ["heading", "paragraph"],
      alignments: ["left", "center", "right", "justify"],
    }),
    SimpleLineBreakBehavior.configure({ getPreferences }),
    ParagraphFormatting,
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    AssetImage.configure({ allowBase64: true }),
    PageBreak,
  ];
}

export const editorExtensions = createEditorExtensions();
