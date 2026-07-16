import DOMPurify from "dompurify";
import mammoth from "mammoth/mammoth.browser";

import { classifyBlock, type ClassificationInput } from "../../classification/rules";
import type { ClassificationResult, DocumentAsset, ImportWarning } from "../../document-model/schema";
import type { DocxImageRelationship, DocxInspection } from "../../project/fileAccess";

const ALLOWED_TAGS = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "strong",
  "em",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "img",
  "br",
  "div",
];

const ALLOWED_ATTR = [
  "alt",
  "src",
  "title",
  "width",
  "height",
  "href",
  "colspan",
  "rowspan",
  "data-page-break",
  "data-asset-id",
];

export type SourceFileInfo = {
  name: string;
  sizeBytes: number;
  path?: string;
  inspectedAt: string;
};

export type ImportDocumentStats = {
  headingCount: number;
  paragraphCount: number;
  tableCount: number;
  imageCount: number;
  retainedImageCount: number;
  warningImageCount: number;
  unsupportedImageFormats: string[];
};

export type ImportDocumentBlock = {
  id: string;
  html: string;
  text: string;
  styleName?: string;
  classification: ClassificationResult;
  warnings: ImportWarning[];
};

export type ImportDocument = {
  blocks: ImportDocumentBlock[];
  sanitizedHtml: string;
  stats: ImportDocumentStats;
};

export type ImportResult = {
  document: ImportDocument;
  assets: DocumentAsset[];
  warnings: ImportWarning[];
  sourceInfo: SourceFileInfo;
};

export type ImportPreview = ImportResult;

type ConvertDocxOptions = {
  arrayBuffer: ArrayBuffer;
  sourceInfo: SourceFileInfo;
  inspection?: DocxInspection;
};

function warning(
  code: string,
  message: string,
  severity: ImportWarning["severity"],
  location?: string,
): ImportWarning {
  return { code, message, severity, location };
}

export function sanitizeImportHtml(html: string): string {
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_ATTR: ["style"],
    ALLOW_DATA_ATTR: true,
  });
  return removeExternalImageSources(sanitized);
}

export async function convertDocxFileToImportResult(file: File): Promise<ImportResult> {
  return convertDocxArrayBufferToImportResult({
    arrayBuffer: await file.arrayBuffer(),
    sourceInfo: {
      name: file.name,
      sizeBytes: file.size,
      inspectedAt: new Date().toISOString(),
    },
  });
}

export async function convertDocxBase64ToImportResult(
  base64: string,
  sourceInfo: SourceFileInfo,
  inspection: DocxInspection,
): Promise<ImportResult> {
  return convertDocxArrayBufferToImportResult({
    arrayBuffer: base64ToArrayBuffer(base64),
    sourceInfo,
    inspection,
  });
}

export async function convertDocxToPreview(file: File): Promise<ImportPreview> {
  return convertDocxFileToImportResult(file);
}

export async function convertDocxArrayBufferToImportResult({
  arrayBuffer,
  sourceInfo,
  inspection,
}: ConvertDocxOptions): Promise<ImportResult> {
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const htmlWarnings = warningsFromHtml(result.value);
  const imageImport = imageAssetsFromInspection(inspection);
  const sanitizedHtml = attachImageAssetsToHtml(sanitizeImportHtml(result.value), imageImport.assets);
  const document = importDocumentFromHtml(sanitizedHtml);
  document.stats.retainedImageCount = imageImport.assets.length;
  document.stats.warningImageCount += imageImport.warnings.length;
  document.stats.unsupportedImageFormats = unsupportedFormatsFromWarnings(imageImport.warnings);
  const warnings: ImportWarning[] = [
    ...warningsFromInspection(inspection),
    ...imageImport.warnings,
    ...result.messages.map((message, index) =>
      warning(
        "mammoth.message",
        message.message,
        message.type === "warning" ? "warning" : "info",
        `mammoth:${index}`,
      ),
    ),
    ...htmlWarnings,
  ];

  if (document.blocks.length === 0) {
    warnings.push(warning("docx.empty_document", "読み込める本文が見つかりませんでした。", "warning"));
  }

  return {
    document,
    assets: imageImport.assets,
    warnings,
    sourceInfo,
  };
}

export function importDocumentFromHtml(html: string): ImportDocument {
  const blocks = blocksFromHtml(html);
  const unsupportedImageFormats = new Set<string>();
  return {
    blocks,
    sanitizedHtml: html,
    stats: {
      headingCount: blocks.filter((block) => block.classification.blockType === "heading").length,
      paragraphCount: blocks.filter((block) => block.classification.blockType === "paragraph").length,
      tableCount: blocks.filter((block) => block.classification.blockType === "table").length,
      imageCount: blocks.filter((block) => block.classification.blockType === "image").length,
      retainedImageCount: blocks.filter(
        (block) => block.classification.blockType === "image" && block.html.includes("data-asset-id="),
      ).length,
      warningImageCount: blocks.filter((block) => block.classification.blockType === "image" && block.warnings.length > 0)
        .length,
      unsupportedImageFormats: [...unsupportedImageFormats],
    },
  };
}

export function blocksFromHtml(html: string): ImportDocumentBlock[] {
  const document = new DOMParser().parseFromString(html, "text/html");
  const elements = Array.from(document.body.children);
  return elements.map((element, index) => blockFromElement(element, index));
}

function blockFromElement(element: Element, index: number): ImportDocumentBlock {
  const id = `import-block-${index}`;
  const tag = element.tagName.toLowerCase();
  const text = element.textContent ?? "";
  const blockWarnings: ImportWarning[] = [];
  if (tag === "div" && element.getAttribute("data-page-break") !== "true") {
    blockWarnings.push(
      warning("html.unsupported_block", "未対応のブロック要素を段落相当として扱います。", "warning", id),
    );
  }
  if ((tag === "img" || element.querySelector("img")) && !imageHasAssetReference(element)) {
    blockWarnings.push(warning("image.unresolved_reference", "画像に対応する内部アセットが見つかりません。", "warning", id));
  }

  const input: ClassificationInput = {
    blockId: id,
    text,
    headingLevel: tag.match(/^h[1-4]$/) ? Number(tag.slice(1)) : undefined,
    styleName: tag.match(/^h[1-4]$/) ? `Heading ${tag.slice(1)}` : undefined,
    isBulletList: tag === "ul",
    isOrderedList: tag === "ol",
    isTable: tag === "table",
    isImage: tag === "img" || element.querySelector("img") !== null,
    isPageBreak: element.getAttribute("data-page-break") === "true",
    marks: marksInElement(element),
  };

  return {
    id,
    html: element.outerHTML,
    text,
    styleName: input.styleName,
    classification: classifyBlock(input),
    warnings: blockWarnings,
  };
}

function imageHasAssetReference(element: Element): boolean {
  if (element.getAttribute("data-asset-id")) return true;
  return element.querySelector("img[data-asset-id]") !== null;
}

function marksInElement(element: Element): string[] {
  const marks = new Set<string>();
  for (const mark of ["strong", "em", "u", "s"]) {
    if (element.querySelector(mark)) marks.add(mark);
  }
  return [...marks];
}

function warningsFromInspection(inspection: DocxInspection | undefined): ImportWarning[] {
  if (!inspection) return [];

  const warnings: ImportWarning[] = [];
  if (inspection.has_macros) {
    warnings.push(warning("docx.macros_detected", "マクロを含む文書です。マクロは実行・保持しません。", "warning"));
  }
  if (inspection.has_headers) {
    warnings.push(warning("docx.unsupported_headers", "ヘッダーは検出しましたが、本文には変換しません。", "warning"));
  }
  if (inspection.has_footers) {
    warnings.push(warning("docx.unsupported_footers", "フッターは検出しましたが、本文には変換しません。", "warning"));
  }
  if (!inspection.has_styles_xml) {
    warnings.push(warning("docx.missing_styles", "styles.xmlが見つからないため、書式情報が不足する可能性があります。", "info"));
  }
  if (!inspection.has_numbering_xml) {
    warnings.push(warning("docx.missing_numbering", "numbering.xmlが見つからないため、リスト情報が不足する可能性があります。", "info"));
  }

  for (const entry of inspection.entries) {
    if (entry.name === "word/comments.xml") {
      warnings.push(warning("docx.unsupported_comments", "コメントは未対応のため読み込みません。", "warning", entry.name));
    }
    if (entry.name === "word/footnotes.xml" || entry.name === "word/endnotes.xml") {
      warnings.push(warning("docx.unsupported_notes", "脚注または文末脚注は未対応のため読み込みません。", "warning", entry.name));
    }
    if (entry.name.includes("/charts/") || entry.name.includes("/diagrams/")) {
      warnings.push(warning("docx.unsupported_drawing", "グラフまたはSmartArtは未対応です。", "warning", entry.name));
    }
  }

  return warnings;
}

function imageAssetsFromInspection(inspection: DocxInspection | undefined): {
  assets: DocumentAsset[];
  warnings: ImportWarning[];
} {
  if (!inspection) return { assets: [], warnings: [] };

  const assets: DocumentAsset[] = [];
  const warnings: ImportWarning[] = [];
  const assetByChecksum = new Map<string, DocumentAsset>();

  for (const relationship of inspection.image_relationships) {
    if (relationship.warning_code) {
      warnings.push(
        warning(
          relationship.warning_code,
          relationship.warning_message ?? "画像relationshipを読み込めませんでした。",
          relationship.warning_code === "image.invalid_relationship_target" ? "error" : "warning",
          imageWarningLocation(relationship),
        ),
      );
    }
    if (
      !relationship.data_base64 ||
      !relationship.mime_type ||
      relationship.byte_size === null ||
      relationship.resolved_part === null
    ) {
      continue;
    }

    const dedupeKey = `${relationship.mime_type}:${relationship.checksum ?? relationship.data_base64}`;
    const existing = assetByChecksum.get(dedupeKey);
    if (existing) {
      continue;
    }

    const asset: DocumentAsset = {
      id: stableAssetId(relationship),
      kind: "image",
      name: fileNameFromPart(relationship.resolved_part),
      fileName: fileNameFromPart(relationship.resolved_part),
      mimeType: relationship.mime_type,
      dataBase64: relationship.data_base64,
      sizeBytes: relationship.byte_size,
      byteSize: relationship.byte_size,
      sourcePart: relationship.resolved_part,
      relationshipId: relationship.relationship_id,
      checksum: relationship.checksum ?? undefined,
    };
    assetByChecksum.set(dedupeKey, asset);
    assets.push(asset);
  }

  return { assets, warnings };
}

function attachImageAssetsToHtml(html: string, assets: DocumentAsset[]): string {
  if (assets.length === 0) return html;
  const document = new DOMParser().parseFromString(html, "text/html");
  const images = Array.from(document.images).filter((image) => {
    const src = image.getAttribute("src") ?? "";
    return !/^https?:\/\//i.test(src);
  });
  for (const [index, image] of images.entries()) {
    const asset = assets[Math.min(index, assets.length - 1)];
    if (!asset?.dataBase64) continue;
    image.setAttribute("data-asset-id", asset.id);
    image.setAttribute("src", `data:${asset.mimeType};base64,${asset.dataBase64}`);
  }
  return document.body.innerHTML;
}

function stableAssetId(relationship: DocxImageRelationship): string {
  const checksum = relationship.checksum?.replace(/[^a-zA-Z0-9]/g, "-") ?? relationship.relationship_id;
  return `asset-${checksum}`;
}

function fileNameFromPart(part: string): string {
  return part.split("/").at(-1) ?? "image";
}

function imageWarningLocation(relationship: DocxImageRelationship): string {
  return [
    relationship.source_part,
    relationship.relationship_id,
    relationship.target,
    relationship.resolved_part ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

function unsupportedFormatsFromWarnings(warnings: ImportWarning[]): string[] {
  const formats = warnings
    .filter((item) => item.code === "image.unsupported_format" && item.location)
    .map((item) => item.location ?? "");
  return [...new Set(formats)];
}

function warningsFromHtml(html: string): ImportWarning[] {
  const document = new DOMParser().parseFromString(html, "text/html");
  const warnings: ImportWarning[] = [];

  for (const image of Array.from(document.images)) {
    const src = image.getAttribute("src") ?? "";
    if (/^https?:\/\//i.test(src)) {
      warnings.push(warning("html.external_image", "外部リンク画像は自動取得しません。", "warning", src));
    }
  }

  return warnings;
}

function removeExternalImageSources(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const image of Array.from(document.images)) {
    const src = image.getAttribute("src") ?? "";
    if (/^https?:\/\//i.test(src)) {
      image.removeAttribute("src");
    }
  }
  return document.body.innerHTML;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
