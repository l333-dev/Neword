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

const HexColorPattern = /^#[0-9A-Fa-f]{6}$/;
const VerticalAlignValues = new Set(["top", "middle", "bottom"]);
const ImageAlignmentValues = new Set(["left", "center", "right"]);

function parsePositivePixel(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/px$/i, ""));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 8000) return null;
  return Math.round(parsed);
}

function renderImageStyle(attributes: Record<string, unknown>): string | undefined {
  const declarations: string[] = [];
  if (typeof attributes.widthPx === "number") declarations.push(`width: ${attributes.widthPx}px`);
  if (typeof attributes.heightPx === "number")
    declarations.push(`height: ${attributes.heightPx}px`);
  if (attributes.alignment === "center") {
    declarations.push("display: block", "margin-left: auto", "margin-right: auto");
  } else if (attributes.alignment === "right") {
    declarations.push("display: block", "margin-left: auto");
  } else if (attributes.alignment === "left") {
    declarations.push("display: block", "margin-right: auto");
  }
  return declarations.length > 0 ? declarations.join("; ") : undefined;
}

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
      widthPx: {
        default: null,
        parseHTML: (element) =>
          parsePositivePixel(
            element.getAttribute("data-width-px") ?? element.getAttribute("width"),
          ),
        renderHTML: () => ({}),
      },
      heightPx: {
        default: null,
        parseHTML: (element) =>
          parsePositivePixel(
            element.getAttribute("data-height-px") ?? element.getAttribute("height"),
          ),
        renderHTML: () => ({}),
      },
      keepAspectRatio: {
        default: true,
        parseHTML: (element) => element.getAttribute("data-keep-aspect-ratio") !== "false",
        renderHTML: (attributes) => ({
          "data-keep-aspect-ratio": attributes.keepAspectRatio === false ? "false" : "true",
        }),
      },
      alignment: {
        default: "left",
        parseHTML: (element) => {
          const value =
            element.getAttribute("data-image-alignment") ?? element.style.textAlign ?? "left";
          return ImageAlignmentValues.has(value) ? value : "left";
        },
        renderHTML: (attributes) =>
          typeof attributes.alignment === "string" && ImageAlignmentValues.has(attributes.alignment)
            ? { "data-image-alignment": attributes.alignment }
            : {},
      },
      altText: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-alt-text") ?? element.getAttribute("alt"),
        renderHTML: (attributes) =>
          typeof attributes.altText === "string"
            ? { "data-alt-text": attributes.altText, alt: attributes.altText }
            : {},
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const style = renderImageStyle(HTMLAttributes);
    return [
      "img",
      {
        ...HTMLAttributes,
        ...(typeof HTMLAttributes.widthPx === "number" ? { width: HTMLAttributes.widthPx } : {}),
        ...(typeof HTMLAttributes.heightPx === "number" ? { height: HTMLAttributes.heightPx } : {}),
        ...(typeof HTMLAttributes.widthPx === "number"
          ? { "data-width-px": String(HTMLAttributes.widthPx) }
          : {}),
        ...(typeof HTMLAttributes.heightPx === "number"
          ? { "data-height-px": String(HTMLAttributes.heightPx) }
          : {}),
        ...(style ? { style } : {}),
      },
    ];
  },
});

function parseHexColor(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (HexColorPattern.test(trimmed)) return trimmed.toUpperCase();
  const rgbMatch = trimmed.match(/^rgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)$/i);
  if (!rgbMatch) return null;
  const channels = rgbMatch.slice(1).map((channel) => Number(channel));
  if (channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
    return null;
  }
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function parseVerticalAlign(value: string | null): "top" | "middle" | "bottom" | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return VerticalAlignValues.has(normalized) ? (normalized as "top" | "middle" | "bottom") : null;
}

const TableWithLayout = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tableWidthPx: {
        default: null,
        parseHTML: (element) => {
          const dataWidth = element.getAttribute("data-table-width-px");
          const parsed = dataWidth === null ? Number.NaN : Number(dataWidth);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        },
        renderHTML: (attributes) =>
          typeof attributes.tableWidthPx === "number" && Number.isFinite(attributes.tableWidthPx)
            ? {
                "data-table-width-px": String(attributes.tableWidthPx),
                style: `width: ${attributes.tableWidthPx}px`,
              }
            : {},
      },
    };
  },
});

const tableCellFormattingAttributes = {
  backgroundColor: {
    default: null,
    parseHTML: (element: HTMLElement) =>
      parseHexColor(
        element.getAttribute("data-cell-background") || element.style.backgroundColor || null,
      ),
    renderHTML: (attributes: Record<string, unknown>) =>
      typeof attributes.backgroundColor === "string" &&
      HexColorPattern.test(attributes.backgroundColor)
        ? {
            "data-cell-background": attributes.backgroundColor,
            style: `background-color: ${attributes.backgroundColor}`,
          }
        : {},
  },
  verticalAlign: {
    default: null,
    parseHTML: (element: HTMLElement) =>
      parseVerticalAlign(
        element.getAttribute("data-cell-vertical-align") || element.style.verticalAlign || null,
      ),
    renderHTML: (attributes: Record<string, unknown>) =>
      typeof attributes.verticalAlign === "string" &&
      VerticalAlignValues.has(attributes.verticalAlign)
        ? {
            "data-cell-vertical-align": attributes.verticalAlign,
            style: `vertical-align: ${attributes.verticalAlign}`,
          }
        : {},
  },
};

const TableCellWithFormatting = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...tableCellFormattingAttributes,
    };
  },
});

const TableHeaderWithFormatting = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...tableCellFormattingAttributes,
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
    TableWithLayout.configure({ resizable: true }),
    TableRow,
    TableHeaderWithFormatting,
    TableCellWithFormatting,
    AssetImage.configure({ allowBase64: true }),
    PageBreak,
  ];
}

export const editorExtensions = createEditorExtensions();
