import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

import { mmToTwips } from "../../converters/units";
import type { ExportBlock, ExportDocument, ExportInline } from "./exportDocument";

function runs(content: ExportInline[]): TextRun[] {
  return content.map(
    (inline) =>
      new TextRun({
        text: inline.text,
        bold: inline.bold,
        italics: inline.italic,
        underline: inline.underline ? {} : undefined,
        strike: inline.strike,
      }),
  );
}

function alignment(value: "left" | "center" | "right"): (typeof AlignmentType)[keyof typeof AlignmentType] {
  if (value === "center") return AlignmentType.CENTER;
  if (value === "right") return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

function heading(level: 1 | 2 | 3 | 4): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  if (level === 1) return HeadingLevel.HEADING_1;
  if (level === 2) return HeadingLevel.HEADING_2;
  if (level === 3) return HeadingLevel.HEADING_3;
  return HeadingLevel.HEADING_4;
}

function blockToDocx(block: ExportBlock): Paragraph | Table {
  if (block.type === "heading") {
    return new Paragraph({
      heading: heading(block.level),
      alignment: alignment(block.align),
      children: runs(block.content),
    });
  }
  if (block.type === "paragraph" || block.type === "caption") {
    return new Paragraph({
      alignment: block.type === "paragraph" ? alignment(block.align) : AlignmentType.CENTER,
      children: runs(block.content),
    });
  }
  if (block.type === "bullet_list" || block.type === "ordered_list") {
    return new Paragraph({
      children: block.items.flatMap((item, index) => [
        new TextRun(`${block.type === "bullet_list" ? "・" : `${index + 1}.`} `),
        ...runs(item),
        new TextRun({ text: index === block.items.length - 1 ? "" : "\n", break: 1 }),
      ]),
    });
  }
  if (block.type === "table") {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: block.rows.map(
        (row) =>
          new TableRow({
            children: row.map(
              (cell) =>
                new TableCell({
                  children: [new Paragraph({ children: runs(cell) })],
                }),
            ),
          }),
      ),
    });
  }
  if (block.type === "page_break") {
    return new Paragraph({ children: [new PageBreak()] });
  }
  return new Paragraph({
    children: [new TextRun(`[未対応: ${block.type}]`)],
  });
}

export async function exportDocumentToDocxBase64(exportDocument: ExportDocument): Promise<string> {
  const margins = exportDocument.pageSettings.marginsMm;
  const document = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: mmToTwips(margins.top),
              right: mmToTwips(margins.right),
              bottom: mmToTwips(margins.bottom),
              left: mmToTwips(margins.left),
            },
          },
        },
        children: exportDocument.blocks.map(blockToDocx),
      },
    ],
  });
  const blob = await Packer.toBlob(document);
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
