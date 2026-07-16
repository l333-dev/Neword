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
