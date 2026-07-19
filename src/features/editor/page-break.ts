import { Node, type CommandProps } from "@tiptap/core";

export type PageBreakType = "page" | "sectionNextPage" | "sectionContinuous";

export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  defining: true,
  addAttributes() {
    return {
      breakType: {
        default: "page",
        parseHTML: (element) => {
          const value = element.getAttribute("data-break-type");
          return value === "sectionNextPage" || value === "sectionContinuous" ? value : "page";
        },
        renderHTML: (attributes) => {
          const breakType = (attributes as Record<string, unknown>).breakType;
          return {
            "data-break-type":
              breakType === "sectionNextPage" || breakType === "sectionContinuous"
                ? breakType
                : "page",
          };
        },
      },
      source: {
        default: "user",
        parseHTML: (element) => element.getAttribute("data-source") ?? "import",
        renderHTML: (attributes) => ({
          "data-source": typeof attributes.source === "string" ? attributes.source : "user",
        }),
      },
      importedFrom: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-imported-from"),
        renderHTML: (attributes) =>
          typeof attributes.importedFrom === "string"
            ? { "data-imported-from": attributes.importedFrom }
            : {},
      },
      sectionMetadata: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute("data-section-metadata");
          if (!raw) return null;
          try {
            return JSON.parse(raw) as unknown;
          } catch {
            return null;
          }
        },
        renderHTML: (attributes) =>
          attributes.sectionMetadata === null || attributes.sectionMetadata === undefined
            ? {}
            : { "data-section-metadata": JSON.stringify(attributes.sectionMetadata) },
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-page-break": "true", class: "page-break" }];
  },
  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ commands }: CommandProps) =>
          commands.insertContent({
            type: this.name,
            attrs: { breakType: "page", source: "user" },
          }),
      deletePageBreak:
        () =>
        ({ commands, editor }: CommandProps) => {
          if (!editor.isActive(this.name)) return false;
          return commands.deleteSelection();
        },
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageBreak: {
      setPageBreak: () => ReturnType;
      deletePageBreak: () => ReturnType;
    };
  }
}
