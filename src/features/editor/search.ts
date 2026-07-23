import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type SearchOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
};

export type SearchMatch = {
  id: string;
  from: number;
  to: number;
  text: string;
  groups: string[];
};

type SearchHighlightState = {
  ranges: SearchMatch[];
  currentIndex: number;
};

export const searchHighlightPluginKey = new PluginKey<SearchHighlightState>("newordSearch");

const defaultHighlightState: SearchHighlightState = { ranges: [], currentIndex: -1 };

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAsciiWordChar(value: string | undefined): boolean {
  return value !== undefined && /^[A-Za-z0-9_]$/.test(value);
}

function acceptsWholeWord(text: string, start: number, end: number): boolean {
  return !isAsciiWordChar(text[start - 1]) && !isAsciiWordChar(text[end]);
}

export function createSearchRegex(
  query: string,
  options: SearchOptions,
): { ok: true; regex: RegExp } | { ok: false; message: string } {
  if (query.length === 0) return { ok: false, message: "検索語を入力してください。" };
  try {
    const source = options.regex ? query : escapeRegex(query);
    return { ok: true, regex: new RegExp(source, options.caseSensitive ? "gu" : "giu") };
  } catch {
    return { ok: false, message: "正規表現が不正です。" };
  }
}

export function findSearchMatches(
  doc: ProseMirrorNode,
  query: string,
  options: SearchOptions,
  limit = 1000,
): { matches: SearchMatch[]; error: string | null; truncated: boolean } {
  const regexResult = createSearchRegex(query, options);
  if (!regexResult.ok) return { matches: [], error: regexResult.message, truncated: false };

  const matches: SearchMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text || matches.length >= limit) return true;
    const text = node.text;
    regexResult.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regexResult.regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (match[0].length === 0) {
        regexResult.regex.lastIndex += 1;
        continue;
      }
      if (!options.wholeWord || acceptsWholeWord(text, start, end)) {
        matches.push({
          id: `match-${matches.length}`,
          from: pos + start,
          to: pos + end,
          text: match[0],
          groups: match.slice(1),
        });
        if (matches.length >= limit) break;
      }
    }
    return true;
  });
  return { matches, error: null, truncated: matches.length >= limit };
}

export function replacementText(match: SearchMatch, replacement: string, regex: boolean): string {
  if (!regex) return replacement;
  return replacement.replace(
    /\$(\d+)/g,
    (_token, index: string) => match.groups[Number(index) - 1] ?? "",
  );
}

export function replaceMatches(
  editor: Editor,
  matches: readonly SearchMatch[],
  replacement: string,
  options: SearchOptions,
  maxCount = matches.length,
): number {
  if (!editor.isEditable) return 0;
  const selected = matches.slice(0, maxCount);
  if (selected.length === 0) return 0;
  const transaction = editor.state.tr;
  for (const match of [...selected].reverse()) {
    transaction.insertText(
      replacementText(match, replacement, options.regex),
      match.from,
      match.to,
    );
  }
  editor.view.dispatch(transaction.scrollIntoView());
  return selected.length;
}

export function updateSearchHighlight(
  editor: Editor,
  ranges: SearchMatch[],
  currentIndex: number,
): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(searchHighlightPluginKey, {
      ranges,
      currentIndex,
    } satisfies SearchHighlightState),
  );
}

function decorationsFromState(doc: ProseMirrorNode, state: SearchHighlightState): DecorationSet {
  const decorations = state.ranges.map((range, index) =>
    Decoration.inline(range.from, range.to, {
      class: index === state.currentIndex ? "search-match search-match-current" : "search-match",
    }),
  );
  return DecorationSet.create(doc, decorations);
}

export const SearchHighlight = Extension.create({
  name: "searchHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchHighlightState>({
        key: searchHighlightPluginKey,
        state: {
          init: () => defaultHighlightState,
          apply(transaction: Transaction, value: SearchHighlightState) {
            const next = transaction.getMeta(searchHighlightPluginKey) as
              SearchHighlightState | undefined;
            if (next) return next;
            if (transaction.docChanged) return defaultHighlightState;
            return value;
          },
        },
        props: {
          decorations(state) {
            return decorationsFromState(
              state.doc,
              searchHighlightPluginKey.getState(state) ?? defaultHighlightState,
            );
          },
        },
      }),
    ];
  },
});
