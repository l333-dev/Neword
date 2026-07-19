import {
  ParagraphFormattingSchema,
  type DocumentAsset,
  type DocumentDefaults,
  type DocumentProject,
  type FooterContent,
  type HeaderContent,
  type PageSettings,
  type ParagraphFormatting,
  type ParagraphSettings,
} from "../../document-model/schema";

export type ExportInline =
  | {
      type: "text";
      text: string;
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      strike?: boolean;
    }
  | { type: "hard_break" };

export type ExportTableCell = {
  header: boolean;
  colspan: number;
  rowspan: number;
  colwidth: number[];
  backgroundColor?: string;
  verticalAlign?: "top" | "middle" | "bottom";
  paragraphs: ExportInline[][];
};

export type ExportBlock =
  | {
      type: "heading";
      level: 1 | 2 | 3 | 4;
      align: "left" | "center" | "right" | "justify";
      formatting?: ParagraphFormatting;
      content: ExportInline[];
    }
  | {
      type: "paragraph";
      align: "left" | "center" | "right" | "justify";
      formatting?: ParagraphFormatting;
      content: ExportInline[];
    }
  | { type: "bullet_list"; items: ExportInline[][] }
  | { type: "ordered_list"; items: ExportInline[][] }
  | { type: "table"; tableWidthPx?: number; rows: ExportTableCell[][] }
  | {
      type: "image";
      assetId: string;
      altText: string;
      widthPx?: number;
      heightPx?: number;
      alignment: "left" | "center" | "right";
    }
  | { type: "caption"; kind: "figure" | "table"; content: ExportInline[] }
  | {
      type: "page_break";
      breakType: "page" | "sectionNextPage" | "sectionContinuous";
      source?: string;
      importedFrom?: string;
      sectionMetadata?: unknown;
    };

export type ExportDocument = {
  title: string;
  pageSettings: PageSettings;
  paragraphSettings: ParagraphSettings;
  header: HeaderContent;
  footer: FooterContent;
  documentDefaults: DocumentDefaults;
  assets: DocumentAsset[];
  blocks: ExportBlock[];
};

type TiptapNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: { type?: string }[];
  content?: TiptapNode[];
};

function inlineFromNodes(nodes: TiptapNode[] | undefined): ExportInline[] {
  return (
    nodes?.flatMap((node) => {
      if (node.text) {
        const marks = node.marks?.map((mark) => mark.type) ?? [];
        return [
          {
            type: "text",
            text: node.text,
            bold: marks.includes("bold"),
            italic: marks.includes("italic"),
            underline: marks.includes("underline"),
            strike: marks.includes("strike"),
          },
        ];
      }
      if (node.type === "hardBreak") return [{ type: "hard_break" }];
      return inlineFromNodes(node.content);
    }) ?? []
  );
}

function alignFromAttrs(
  attrs: Record<string, unknown> | undefined,
): "left" | "center" | "right" | "justify" {
  const formatting = paragraphFormattingFromAttrs(attrs);
  if (
    attrs?.textAlign === "center" ||
    attrs?.textAlign === "right" ||
    attrs?.textAlign === "justify"
  ) {
    return attrs.textAlign;
  }
  return formatting?.alignment ?? "left";
}

function paragraphFormattingFromAttrs(
  attrs: Record<string, unknown> | undefined,
): ParagraphFormatting | undefined {
  const parsed = ParagraphFormattingSchema.safeParse(attrs?.paragraphFormatting);
  return parsed.success ? parsed.data : undefined;
}

function tableCellFromNode(node: TiptapNode): ExportTableCell {
  const attrs = node.attrs ?? {};
  const colspan = positiveIntegerAttr(attrs.colspan) ?? 1;
  const rowspan = positiveIntegerAttr(attrs.rowspan) ?? 1;
  const colwidth = Array.isArray(attrs.colwidth)
    ? attrs.colwidth
        .map((value) => numericAttr(value))
        .filter((value): value is number => value !== undefined && value > 0)
    : [];
  const paragraphs =
    node.content
      ?.filter((child) => child.type === "paragraph" || child.type === "heading")
      .map((child) => inlineFromNodes(child.content)) ?? [];
  return {
    header: node.type === "tableHeader",
    colspan,
    rowspan,
    colwidth,
    backgroundColor:
      typeof attrs.backgroundColor === "string" && /^#[0-9A-Fa-f]{6}$/.test(attrs.backgroundColor)
        ? attrs.backgroundColor.toUpperCase()
        : undefined,
    verticalAlign:
      attrs.verticalAlign === "middle" ||
      attrs.verticalAlign === "bottom" ||
      attrs.verticalAlign === "top"
        ? attrs.verticalAlign
        : undefined,
    paragraphs: paragraphs.length > 0 ? paragraphs : [[]],
  };
}

export function projectToExportDocument(project: DocumentProject): ExportDocument {
  const doc = project.editorContent as TiptapNode;
  const blocks: ExportBlock[] = [];
  for (const node of doc.content ?? []) {
    if (node.type === "heading") {
      const rawLevel = node.attrs?.level;
      const level = rawLevel === 2 || rawLevel === 3 || rawLevel === 4 ? rawLevel : 1;
      blocks.push({
        type: "heading",
        level,
        align: alignFromAttrs(node.attrs),
        formatting: paragraphFormattingFromAttrs(node.attrs),
        content: inlineFromNodes(node.content),
      });
      continue;
    }
    if (node.type === "paragraph") {
      blocks.push({
        type: "paragraph",
        align: alignFromAttrs(node.attrs),
        formatting: paragraphFormattingFromAttrs(node.attrs),
        content: inlineFromNodes(node.content),
      });
      continue;
    }
    if (node.type === "bulletList" || node.type === "orderedList") {
      const items =
        node.content?.map((item) =>
          inlineFromNodes(item.content?.flatMap((child) => child.content ?? [])),
        ) ?? [];
      blocks.push({ type: node.type === "bulletList" ? "bullet_list" : "ordered_list", items });
      continue;
    }
    if (node.type === "table") {
      const rows =
        node.content?.map((row) => row.content?.map((cell) => tableCellFromNode(cell)) ?? []) ?? [];
      blocks.push({ type: "table", tableWidthPx: numericAttr(node.attrs?.tableWidthPx), rows });
      continue;
    }
    if (node.type === "image") {
      blocks.push({
        type: "image",
        assetId:
          typeof node.attrs?.assetId === "string"
            ? node.attrs.assetId
            : typeof node.attrs?.src === "string"
              ? node.attrs.src
              : "",
        altText:
          typeof node.attrs?.altText === "string"
            ? node.attrs.altText
            : typeof node.attrs?.alt === "string"
              ? node.attrs.alt
              : "",
        widthPx: numericAttr(node.attrs?.widthPx) ?? numericAttr(node.attrs?.width),
        heightPx: numericAttr(node.attrs?.heightPx) ?? numericAttr(node.attrs?.height),
        alignment:
          node.attrs?.alignment === "center" || node.attrs?.alignment === "right"
            ? node.attrs.alignment
            : "left",
      });
      continue;
    }
    if (node.type === "pageBreak") {
      blocks.push({
        type: "page_break",
        breakType:
          node.attrs?.breakType === "sectionNextPage" ||
          node.attrs?.breakType === "sectionContinuous"
            ? node.attrs.breakType
            : "page",
        source: typeof node.attrs?.source === "string" ? node.attrs.source : undefined,
        importedFrom:
          typeof node.attrs?.importedFrom === "string" ? node.attrs.importedFrom : undefined,
        sectionMetadata: node.attrs?.sectionMetadata,
      });
    }
  }

  return {
    title: project.metadata.title,
    pageSettings: project.pageSettings,
    paragraphSettings: project.paragraphSettings,
    header: project.header,
    footer: project.footer,
    documentDefaults: project.documentDefaults,
    assets: project.assets,
    blocks,
  };
}

function positiveIntegerAttr(value: unknown): number | undefined {
  const parsed = numericAttr(value);
  if (parsed === undefined) return undefined;
  const integer = Math.round(parsed);
  return integer > 0 ? integer : undefined;
}

function numericAttr(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}
