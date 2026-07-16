import type { DocumentProject, PageSettings } from "../../document-model/schema";

export type ExportInline = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
};

export type ExportBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4; align: "left" | "center" | "right"; content: ExportInline[] }
  | { type: "paragraph"; align: "left" | "center" | "right"; content: ExportInline[] }
  | { type: "bullet_list"; items: ExportInline[][] }
  | { type: "ordered_list"; items: ExportInline[][] }
  | { type: "table"; rows: ExportInline[][][] }
  | { type: "image"; assetId: string; altText: string }
  | { type: "caption"; kind: "figure" | "table"; content: ExportInline[] }
  | { type: "page_break" };

export type ExportDocument = {
  title: string;
  pageSettings: PageSettings;
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
            text: node.text,
            bold: marks.includes("bold"),
            italic: marks.includes("italic"),
            underline: marks.includes("underline"),
            strike: marks.includes("strike"),
          },
        ];
      }
      return inlineFromNodes(node.content);
    }) ?? []
  );
}

function alignFromAttrs(attrs: Record<string, unknown> | undefined): "left" | "center" | "right" {
  return attrs?.textAlign === "center" || attrs?.textAlign === "right" ? attrs.textAlign : "left";
}

export function projectToExportDocument(project: DocumentProject): ExportDocument {
  const doc = project.editorContent as TiptapNode;
  const blocks: ExportBlock[] = [];
  for (const node of doc.content ?? []) {
      if (node.type === "heading") {
        const rawLevel = node.attrs?.level;
        const level = rawLevel === 2 || rawLevel === 3 || rawLevel === 4 ? rawLevel : 1;
        blocks.push({ type: "heading", level, align: alignFromAttrs(node.attrs), content: inlineFromNodes(node.content) });
        continue;
      }
      if (node.type === "paragraph") {
        blocks.push({ type: "paragraph", align: alignFromAttrs(node.attrs), content: inlineFromNodes(node.content) });
        continue;
      }
      if (node.type === "bulletList" || node.type === "orderedList") {
        const items =
          node.content?.map((item) => inlineFromNodes(item.content?.flatMap((child) => child.content ?? []))) ?? [];
        blocks.push({ type: node.type === "bulletList" ? "bullet_list" : "ordered_list", items });
        continue;
      }
      if (node.type === "table") {
        const rows =
          node.content?.map(
            (row) =>
              row.content?.map((cell) => inlineFromNodes(cell.content?.flatMap((child) => child.content ?? []))) ??
              [],
          ) ?? [];
        blocks.push({ type: "table", rows });
        continue;
      }
      if (node.type === "image") {
        blocks.push({
          type: "image",
          assetId: typeof node.attrs?.src === "string" ? node.attrs.src : "",
          altText: typeof node.attrs?.alt === "string" ? node.attrs.alt : "",
        });
        continue;
      }
      if (node.type === "pageBreak") blocks.push({ type: "page_break" });
  }

  return {
    title: project.metadata.title,
    pageSettings: project.pageSettings,
    blocks,
  };
}
