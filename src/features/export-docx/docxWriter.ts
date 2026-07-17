import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  LineRuleType,
  Packer,
  PageBreak,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
} from "docx";

import { millimetersToTwips, pointsToTwips } from "../../converters/units";
import type { ExportBlock, ExportDocument, ExportInline } from "./exportDocument";

type ExportParagraphBlock = Extract<ExportBlock, { type: "heading" | "paragraph" }>;

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

function alignment(value: "left" | "center" | "right" | "justify"): (typeof AlignmentType)[keyof typeof AlignmentType] {
  if (value === "center") return AlignmentType.CENTER;
  if (value === "right") return AlignmentType.RIGHT;
  if (value === "justify") return AlignmentType.JUSTIFIED;
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

function paragraphOptions(block: ExportParagraphBlock): IParagraphOptions {
  const formatting = block.formatting;
  return {
    alignment: alignment(block.align),
    pageBreakBefore: formatting?.pageBreakBefore,
    keepNext: formatting?.keepWithNext,
    keepLines: formatting?.keepLinesTogether,
    indent: formatting
      ? {
          left:
            formatting.indentLeftMm === undefined ? undefined : millimetersToTwips(formatting.indentLeftMm),
          right:
            formatting.indentRightMm === undefined ? undefined : millimetersToTwips(formatting.indentRightMm),
          firstLine:
            formatting.firstLineIndentMm === undefined
              ? undefined
              : millimetersToTwips(formatting.firstLineIndentMm),
          hanging:
            formatting.hangingIndentMm === undefined ? undefined : millimetersToTwips(formatting.hangingIndentMm),
        }
      : undefined,
    spacing: formatting
      ? {
          before: formatting.spaceBeforePt === undefined ? undefined : pointsToTwips(formatting.spaceBeforePt),
          after: formatting.spaceAfterPt === undefined ? undefined : pointsToTwips(formatting.spaceAfterPt),
          line: lineSpacingValue(formatting.lineSpacing),
          lineRule: lineRule(formatting.lineSpacing),
        }
      : undefined,
  };
}

function lineSpacingValue(
  lineSpacing: NonNullable<ExportParagraphBlock["formatting"]>["lineSpacing"],
): number | undefined {
  if (!lineSpacing) return undefined;
  if (lineSpacing.type === "single" || lineSpacing.type === "multiple") return Math.round(lineSpacing.value * 240);
  return pointsToTwips(lineSpacing.value);
}

function lineRule(
  lineSpacing: NonNullable<ExportParagraphBlock["formatting"]>["lineSpacing"],
): (typeof LineRuleType)[keyof typeof LineRuleType] | undefined {
  if (!lineSpacing) return undefined;
  if (lineSpacing.type === "exact") return LineRuleType.EXACT;
  if (lineSpacing.type === "atLeast") return LineRuleType.AT_LEAST;
  return LineRuleType.AUTO;
}

function blockToDocx(block: ExportBlock, exportDocument: ExportDocument): Paragraph | Table {
  if (block.type === "heading") {
    return new Paragraph({
      ...paragraphOptions(block),
      heading: heading(block.level),
      children: runs(block.content),
    });
  }
  if (block.type === "paragraph" || block.type === "caption") {
    return new Paragraph({
      ...(block.type === "paragraph" ? paragraphOptions(block) : { alignment: AlignmentType.CENTER }),
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
  const margins = exportDocument.pageSettings.margins;
  const document = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: millimetersToTwips(exportDocument.pageSettings.widthMm),
              height: millimetersToTwips(exportDocument.pageSettings.heightMm),
              orientation:
                exportDocument.pageSettings.orientation === "landscape"
                  ? PageOrientation.LANDSCAPE
                  : PageOrientation.PORTRAIT,
            },
            margin: {
              top: millimetersToTwips(margins.topMm),
              right: millimetersToTwips(margins.rightMm),
              bottom: millimetersToTwips(margins.bottomMm),
              left: millimetersToTwips(margins.leftMm),
              header: margins.headerMm === undefined ? undefined : millimetersToTwips(margins.headerMm),
              footer: margins.footerMm === undefined ? undefined : millimetersToTwips(margins.footerMm),
              gutter: margins.gutterMm === undefined ? undefined : millimetersToTwips(margins.gutterMm),
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
