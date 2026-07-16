import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
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

function imageType(mimeType: string): "png" | "jpg" | "gif" | null {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/gif") return "gif";
  return null;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function imageDimensions(block: Extract<ExportBlock, { type: "image" }>): { width: number; height: number } {
  if (block.widthPx && block.heightPx) return { width: block.widthPx, height: block.heightPx };
  if (block.widthPx) return { width: block.widthPx, height: Math.max(1, Math.round(block.widthPx * 0.75)) };
  if (block.heightPx) return { width: Math.max(1, Math.round(block.heightPx * 1.33)), height: block.heightPx };
  return { width: 320, height: 240 };
}

function blockToDocx(block: ExportBlock, exportDocument: ExportDocument): Paragraph | Table {
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
  if (block.type === "image") {
    const asset = exportDocument.assets.find((candidate) => candidate.id === block.assetId);
    const type = asset ? imageType(asset.mimeType) : null;
    if (!asset?.dataBase64 || !type) {
      throw new Error(`Image asset cannot be exported: ${block.assetId}`);
    }
    const dimensions = imageDimensions({
      ...block,
      widthPx: block.widthPx ?? asset.widthPx,
      heightPx: block.heightPx ?? asset.heightPx,
    });
    return new Paragraph({
      children: [
        new ImageRun({
          type,
          data: base64ToBytes(asset.dataBase64),
          transformation: dimensions,
          altText: {
            name: block.altText || asset.altText || asset.fileName || asset.name || "image",
            title: block.altText || asset.altText || asset.fileName || asset.name || "image",
            description: block.altText || asset.altText || "",
          },
        }),
      ],
    });
  }
  return new Paragraph({
    children: [new TextRun("[未対応ブロック]")],
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
        children: exportDocument.blocks.map((block) => blockToDocx(block, exportDocument)),
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
