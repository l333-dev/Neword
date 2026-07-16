import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TextAlign from "@tiptap/extension-text-align";
import StarterKit from "@tiptap/starter-kit";

import { PageBreak } from "./page-break";

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

export const editorExtensions = [
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
    alignments: ["left", "center", "right"],
  }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  AssetImage.configure({ allowBase64: true }),
  PageBreak,
];
