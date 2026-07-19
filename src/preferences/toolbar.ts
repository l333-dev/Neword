export const TOOLBAR_COMMAND_IDS = [
  "bold",
  "italic",
  "underline",
  "strike",
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "paragraph",
  "alignLeft",
  "alignCenter",
  "alignRight",
  "alignJustify",
  "bulletList",
  "orderedList",
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
  "insertImage",
  "figureCaption",
  "tableCaption",
  "insertPageBreak",
  "deletePageBreak",
  "undo",
  "redo",
] as const;

export type ToolbarCommandId = (typeof TOOLBAR_COMMAND_IDS)[number];

export const DEFAULT_TOOLBAR_COMMAND_ORDER: ToolbarCommandId[] = [...TOOLBAR_COMMAND_IDS];

const toolbarCommandIdSet = new Set<string>(TOOLBAR_COMMAND_IDS);

export function isToolbarCommandId(value: unknown): value is ToolbarCommandId {
  return typeof value === "string" && toolbarCommandIdSet.has(value);
}

export function normalizeToolbarOrder(
  storedOrder: readonly unknown[],
  defaultOrder: readonly ToolbarCommandId[] = DEFAULT_TOOLBAR_COMMAND_ORDER,
): ToolbarCommandId[] {
  const normalized: ToolbarCommandId[] = [];
  const seen = new Set<ToolbarCommandId>();
  for (const id of storedOrder) {
    if (!isToolbarCommandId(id) || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  for (const id of defaultOrder) {
    if (seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

export function normalizeHiddenToolbarCommands(ids: readonly unknown[]): ToolbarCommandId[] {
  const normalized: ToolbarCommandId[] = [];
  const seen = new Set<ToolbarCommandId>();
  for (const id of ids) {
    if (!isToolbarCommandId(id) || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

export function moveToolbarCommand(
  order: readonly ToolbarCommandId[],
  commandId: ToolbarCommandId,
  direction: "up" | "down",
): ToolbarCommandId[] {
  const next = [...order];
  const index = next.indexOf(commandId);
  if (index === -1) return next;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= next.length) return next;
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}
