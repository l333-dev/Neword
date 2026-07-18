type TiptapNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  text?: string;
  content?: TiptapNode[];
};

export function trimTrailingEmptyParagraphsFromContent(content: unknown): unknown {
  if (!isTiptapNode(content) || !Array.isArray(content.content)) return content;
  const nextContent = [...content.content];
  while (nextContent.length > 1 && isEmptyParagraph(nextContent.at(-1))) {
    nextContent.pop();
  }
  return {
    ...content,
    content: nextContent,
  };
}

function isTiptapNode(value: unknown): value is TiptapNode {
  return typeof value === "object" && value !== null;
}

function isEmptyParagraph(node: TiptapNode | undefined): boolean {
  if (!node || node.type !== "paragraph") return false;
  if (!node.content || node.content.length === 0) return true;
  return node.content.every(
    (child) => child.type === "text" && (child.text ?? "").trim().length === 0,
  );
}
