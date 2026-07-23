type TiptapNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
};

export type OutlineItem = {
  id: string;
  level: number;
  text: string;
  position?: number;
};

export type DocumentStatistics = {
  charactersWithSpaces: number;
  charactersWithoutSpaces: number;
  asciiWordCount: number;
  japaneseCharacterCount: number;
  paragraphCount: number;
  headingCount: number;
  tableCount: number;
  imageCount: number;
  listItemCount: number;
  pageBreakCount: number;
  estimatedReadingMinutes: number;
};

function textFromNode(node: TiptapNode): string {
  if (node.text) return node.text;
  return node.content?.map(textFromNode).join("") ?? "";
}

export function createOutline(doc: unknown): OutlineItem[] {
  const root = doc as TiptapNode;
  return (
    root.content
      ?.map((node, index) => {
        if (node.type !== "heading") return null;
        const rawLevel = node.attrs?.level;
        const level = typeof rawLevel === "number" ? rawLevel : 1;
        return {
          id: `heading-${index}`,
          level,
          text: textFromNode(node).trim() || "(無題の見出し)",
        };
      })
      .filter((item): item is OutlineItem => item !== null) ?? []
  );
}

export function countCharacters(doc: unknown): number {
  const root = doc as TiptapNode;
  return textFromNode(root).length;
}

export function createDocumentStatistics(doc: unknown): DocumentStatistics {
  const root = doc as TiptapNode;
  const text = textFromNode(root);
  const stats: DocumentStatistics = {
    charactersWithSpaces: text.length,
    charactersWithoutSpaces: text.replace(/\s/gu, "").length,
    asciiWordCount: text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/gu)?.length ?? 0,
    japaneseCharacterCount:
      text.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu)?.length ?? 0,
    paragraphCount: 0,
    headingCount: 0,
    tableCount: 0,
    imageCount: 0,
    listItemCount: 0,
    pageBreakCount: 0,
    estimatedReadingMinutes: 1,
  };
  visit(root, (node) => {
    if (node.type === "paragraph") stats.paragraphCount += 1;
    if (node.type === "heading") stats.headingCount += 1;
    if (node.type === "table") stats.tableCount += 1;
    if (node.type === "image") stats.imageCount += 1;
    if (node.type === "listItem") stats.listItemCount += 1;
    if (node.type === "pageBreak") stats.pageBreakCount += 1;
  });
  const readingUnits = stats.asciiWordCount + stats.japaneseCharacterCount / 2;
  stats.estimatedReadingMinutes = Math.max(1, Math.ceil(readingUnits / 400));
  return stats;
}

function visit(node: TiptapNode, visitor: (node: TiptapNode) => void): void {
  visitor(node);
  for (const child of node.content ?? []) visit(child, visitor);
}
