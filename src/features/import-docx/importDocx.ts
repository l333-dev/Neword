import DOMPurify from "dompurify";

import { classifyBlock, type ClassificationInput } from "../../classification/rules";
import {
  defaultPageSettings,
  defaultFooter,
  defaultHeader,
  defaultParagraphSettings,
  emptyHeaderFooterDocument,
  ParagraphFormattingSchema,
  type ClassificationResult,
  type DocumentAsset,
  type FooterContent,
  type HeaderContent,
  type ImportWarning,
  type PageSettings,
  type ParagraphFormatting,
  type ParagraphSettings,
} from "../../document-model/schema";
import { twipsToMillimeters, twipsToPoints } from "../../converters/units";
import type {
  DocxHeaderFooter,
  DocxImageRelationship,
  DocxInspection,
  DocxPageSettings,
  DocxParagraphFormatting,
  DocxSection,
} from "../../project/fileAccess";

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
  "colwidth",
  "data-paragraph-formatting",
  "data-page-break",
  "data-break-type",
  "data-source",
  "data-imported-from",
  "data-section-metadata",
  "data-asset-id",
  "data-width-px",
  "data-height-px",
  "data-alt-text",
  "data-image-alignment",
  "data-keep-aspect-ratio",
  "data-cell-background",
  "data-cell-vertical-align",
  "data-table-width-px",
  "data-unsupported-table",
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
  pageSettings: PageSettings;
  paragraphSettings: ParagraphSettings;
  header: HeaderContent;
  footer: FooterContent;
  warnings: ImportWarning[];
  sourceInfo: SourceFileInfo;
};

export type ImportPreview = ImportResult;

type ConvertDocxOptions = {
  arrayBuffer: ArrayBuffer;
  sourceInfo: SourceFileInfo;
  inspection?: DocxInspection;
};

export type MammothHtmlMessage = {
  type: string;
  message: string;
};

export type MammothHtmlResult = {
  value: string;
  messages: MammothHtmlMessage[];
};

function warning(
  code: string,
  message: string,
  severity: ImportWarning["severity"],
  location?: string,
  details?: Partial<ImportWarning>,
): ImportWarning {
  return {
    code,
    category: warningCategory(code),
    message,
    severity,
    location,
    humanReadableReason: message,
    affectedPart: details?.part ?? location,
    sourceReference: location,
    canContinue: severity !== "error",
    recommendation: warningRecommendation(code, severity),
    ...details,
  };
}

function warningCategory(code: string): NonNullable<ImportWarning["category"]> {
  if (code.includes("macro")) return "macro-detected";
  if (code.includes("external")) return "external-image-blocked";
  if (code.includes("relationship") || code.includes("missing_part"))
    return "malformed-relationship";
  if (code.includes("size_limit") || code.includes("oversized")) return "oversized-asset";
  if (code.startsWith("table.") || code.includes("table")) return "unsupported-table-feature";
  if (code.startsWith("header.") || code.startsWith("footer.")) return "unsupported-header-footer";
  if (code.startsWith("section.")) return "unsupported-section";
  if (code.includes("formatting") || code.includes("spacing")) return "lost-formatting";
  if (code.includes("numbering")) return "unsupported-numbering";
  if (code.includes("unsupported")) return "unsupported-element";
  return "general";
}

function warningRecommendation(code: string, severity: ImportWarning["severity"]): string {
  if (severity === "error") return "読み込みを中止し、元DOCXを確認してください。";
  if (code.includes("macro")) return "マクロは実行されません。必要なら元DOCXで確認してください。";
  if (code.includes("external"))
    return "外部画像は自動取得しません。必要ならローカル画像として挿入してください。";
  if (code.includes("table")) return "表の見た目をプレビューで確認してください。";
  if (code.startsWith("section.")) return "ページ設定やセクション区切りを確認してください。";
  return "プレビューを確認してから読み込みを続行してください。";
}

function aggregateImportWarnings(warnings: ImportWarning[]): ImportWarning[] {
  const aggregated = new Map<string, ImportWarning & { originalValue?: unknown }>();
  for (const item of warnings) {
    const key = [
      item.category ?? warningCategory(item.code),
      item.code,
      item.affectedPart ?? item.part ?? item.location ?? "",
      item.recommendation ??
        item.humanReadableReason ??
        item.message.replace(/（検出数: \d+）/g, ""),
    ].join("\u001f");
    const existing = aggregated.get(key);
    const itemCount =
      typeof item.originalValue === "object" &&
      item.originalValue !== null &&
      "count" in item.originalValue &&
      typeof item.originalValue.count === "number"
        ? item.originalValue.count
        : 1;
    if (!existing) {
      aggregated.set(key, {
        ...item,
        originalValue: {
          count: itemCount,
          examples: item.sourceReference ? [item.sourceReference] : [],
        },
      });
      continue;
    }
    const originalValue =
      typeof existing.originalValue === "object" && existing.originalValue !== null
        ? existing.originalValue
        : {};
    const previousCount =
      "count" in originalValue && typeof originalValue.count === "number" ? originalValue.count : 1;
    const examples =
      "examples" in originalValue && Array.isArray(originalValue.examples)
        ? originalValue.examples.filter((value): value is string => typeof value === "string")
        : [];
    if (item.sourceReference && !examples.includes(item.sourceReference) && examples.length < 5) {
      examples.push(item.sourceReference);
    }
    existing.originalValue = { count: previousCount + itemCount, examples };
    existing.message = `${item.message}（${previousCount + itemCount}件）`;
  }
  return [...aggregated.values()];
}

export function sanitizeImportHtml(html: string): string {
  const sanitized = DOMPurify.sanitize(normalizeTableHtml(html), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_ATTR: ["style"],
    ALLOW_DATA_ATTR: true,
  });
  return removeExternalImageSources(sanitized);
}

function normalizeTableHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const table of Array.from(document.querySelectorAll("table"))) {
    const width = positiveNumberFromCss(table.getAttribute("width") ?? table.style.width);
    if (width !== null) table.setAttribute("data-table-width-px", String(width));
    if (table.querySelector("table")) {
      table.setAttribute("data-unsupported-table", "nested");
    }
  }
  for (const cell of Array.from(document.querySelectorAll("td, th"))) {
    const cellElement = cell as HTMLElement;
    const background = normalizeCssColor(
      cellElement.getAttribute("bgcolor") || cellElement.style.backgroundColor || null,
    );
    if (background) cell.setAttribute("data-cell-background", background);
    const verticalAlign = normalizeVerticalAlign(
      cellElement.getAttribute("valign") || cellElement.style.verticalAlign || null,
    );
    if (verticalAlign) cell.setAttribute("data-cell-vertical-align", verticalAlign);
    const width = positiveNumberFromCss(
      cellElement.getAttribute("width") ?? cellElement.style.width,
    );
    if (width !== null) cell.setAttribute("colwidth", String(width));
  }
  return document.body.innerHTML;
}

function normalizeCssColor(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  const rgbMatch = trimmed.match(/^rgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)$/i);
  if (!rgbMatch) return null;
  const channels = rgbMatch.slice(1).map((channel) => Number(channel));
  if (channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
    return null;
  }
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function normalizeVerticalAlign(value: string | null): "top" | "middle" | "bottom" | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "center") return "middle";
  if (normalized === "top" || normalized === "middle" || normalized === "bottom") return normalized;
  return null;
}

function positiveNumberFromCss(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10000) return null;
  return Math.round(parsed);
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
  const mammoth = await import("mammoth/mammoth.browser");
  const result = await mammoth.default.convertToHtml({ arrayBuffer });
  return buildImportResultFromMammothHtml({
    mammothResult: result,
    sourceInfo,
    inspection,
  });
}

export function buildImportResultFromMammothHtml({
  mammothResult,
  sourceInfo,
  inspection,
}: {
  mammothResult: MammothHtmlResult;
  sourceInfo: SourceFileInfo;
  inspection?: DocxInspection;
}): ImportResult {
  const htmlWarnings = warningsFromHtml(mammothResult.value);
  const imageImport = imageAssetsFromInspection(inspection);
  const pageImport = pageSettingsFromInspection(inspection);
  const headerFooterImport = headerFooterFromInspection(inspection, sourceInfo.inspectedAt);
  const formattingImport = paragraphFormattingFromInspection(inspection);
  const sanitizedHtml = applyOoxmlFormattingToHtml(
    attachImageAssetsToHtml(sanitizeImportHtml(mammothResult.value), imageImport.assets),
    formattingImport.formatting,
    inspection?.paragraphs ?? [],
    inspection?.sections ?? [],
  );
  const document = importDocumentFromHtml(sanitizedHtml);
  document.stats.retainedImageCount = imageImport.assets.length;
  document.stats.warningImageCount += imageImport.warnings.length;
  document.stats.unsupportedImageFormats = unsupportedFormatsFromWarnings(imageImport.warnings);
  const warnings: ImportWarning[] = [
    ...warningsFromInspection(inspection),
    ...pageImport.warnings,
    ...headerFooterImport.warnings,
    ...formattingImport.warnings,
    ...imageImport.warnings,
    ...mammothResult.messages.map((message, index) =>
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
    warnings.push(
      warning("docx.empty_document", "読み込める本文が見つかりませんでした。", "warning"),
    );
  }

  return {
    document,
    assets: imageImport.assets,
    pageSettings: pageImport.pageSettings,
    paragraphSettings: firstParagraphSettings(formattingImport.formatting),
    header: headerFooterImport.header,
    footer: headerFooterImport.footer,
    warnings: aggregateImportWarnings(warnings),
    sourceInfo,
  };
}

function headerFooterFromInspection(
  inspection: DocxInspection | undefined,
  importedAt: string,
): {
  header: HeaderContent;
  footer: FooterContent;
  warnings: ImportWarning[];
} {
  const warnings: ImportWarning[] = [];
  const header = contentFromHeaderFooter(
    "header",
    inspection?.headers ?? [],
    defaultHeader,
    importedAt,
    warnings,
  );
  const footerBase = contentFromHeaderFooter(
    "footer",
    inspection?.footers ?? [],
    defaultFooter,
    importedAt,
    warnings,
  );
  const footer: FooterContent = {
    ...footerBase,
    pageNumberPosition: (inspection?.footers ?? []).some((item) => item.has_page_number)
      ? "center"
      : "none",
  };
  return { header, footer, warnings };
}

function contentFromHeaderFooter<T extends HeaderContent>(
  kind: "header" | "footer",
  items: DocxHeaderFooter[],
  fallback: T,
  importedAt: string,
  warnings: ImportWarning[],
): T {
  if (items.length === 0) return fallback;
  const defaultItem = items.find((item) => item.reference_type === "default") ?? items[0];
  if (!defaultItem) return fallback;
  const distinctTypes = new Set(items.map((item) => item.reference_type));
  if (items.length > 1 || distinctTypes.size > 1) {
    warnings.push(
      warning(
        kind === "header" ? "header.multiple_types" : "footer.multiple_types",
        kind === "header"
          ? "複数種類のヘッダーを検出しました。標準ヘッダーのみ取り込みます。"
          : "複数種類のフッターを検出しました。標準フッターのみ取り込みます。",
        "warning",
        "word/document.xml",
      ),
    );
  }
  for (const item of items) {
    if (item.reference_type === "first") {
      warnings.push(
        warning(
          kind === "header" ? "header.first_page_unsupported" : "footer.first_page_unsupported",
          kind === "header"
            ? "First Page Headerは標準ヘッダーへ統合できないため保持しません。"
            : "First Page Footerは標準フッターへ統合できないため保持しません。",
          "warning",
          item.source_part ?? "word/document.xml",
        ),
      );
    }
    if (item.reference_type === "even") {
      warnings.push(
        warning(
          kind === "header" ? "header.even_odd_unsupported" : "footer.even_odd_unsupported",
          kind === "header"
            ? "奇数偶数ページ別Headerは標準ヘッダーへ統合できないため保持しません。"
            : "奇数偶数ページ別Footerは標準フッターへ統合できないため保持しません。",
          "warning",
          item.source_part ?? "word/document.xml",
        ),
      );
    }
    for (const feature of item.unsupported_features) {
      warnings.push(
        warning(
          kind === "header" ? "header.word_feature_unsupported" : "footer.word_feature_unsupported",
          kind === "header"
            ? "Word固有のヘッダー機能を単純なテキストへ変換しました。"
            : "Word固有のフッター機能を単純なテキストへ変換しました。",
          "warning",
          item.source_part ?? "word/document.xml",
          { originalValue: feature },
        ),
      );
    }
  }
  return {
    ...fallback,
    editorContent: plainTextToTiptapDocument(defaultItem.text),
    plainText: defaultItem.text,
    importMetadata: {
      source: "docx_import",
      sourcePart: defaultItem.source_part ?? undefined,
      relationshipId: defaultItem.relationship_id ?? undefined,
      referenceType:
        defaultItem.reference_type === "first" || defaultItem.reference_type === "even"
          ? defaultItem.reference_type
          : "default",
      importedAt,
      warnings: defaultItem.unsupported_features,
    },
  };
}

function plainTextToTiptapDocument(plainText: string): unknown {
  if (plainText.length === 0) return emptyHeaderFooterDocument;
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: plainText }],
      },
    ],
  };
}

function firstParagraphSettings(formatting: Map<number, ParagraphFormatting>): ParagraphSettings {
  return formatting.values().next().value ?? defaultParagraphSettings;
}

export function importDocumentFromHtml(html: string): ImportDocument {
  const blocks = blocksFromHtml(html);
  const unsupportedImageFormats = new Set<string>();
  return {
    blocks,
    sanitizedHtml: html,
    stats: {
      headingCount: blocks.filter((block) => block.classification.blockType === "heading").length,
      paragraphCount: blocks.filter((block) => block.classification.blockType === "paragraph")
        .length,
      tableCount: blocks.filter((block) => block.classification.blockType === "table").length,
      imageCount: blocks.filter((block) => block.classification.blockType === "image").length,
      retainedImageCount: blocks.filter(
        (block) =>
          block.classification.blockType === "image" && block.html.includes("data-asset-id="),
      ).length,
      warningImageCount: blocks.filter(
        (block) => block.classification.blockType === "image" && block.warnings.length > 0,
      ).length,
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
      warning(
        "html.unsupported_block",
        "未対応のブロック要素を段落相当として扱います。",
        "warning",
        id,
      ),
    );
  }
  if ((tag === "img" || element.querySelector("img")) && !imageHasAssetReference(element)) {
    blockWarnings.push(
      warning(
        "image.unresolved_reference",
        "画像に対応する内部アセットが見つかりません。",
        "warning",
        id,
      ),
    );
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
    warnings.push(
      warning(
        "docx.macros_detected",
        "マクロを含む文書です。マクロは実行・保持しません。",
        "warning",
      ),
    );
  }
  if (inspection.has_headers && inspection.headers.length === 0) {
    warnings.push(
      warning(
        "header.unreferenced_part",
        "ヘッダーpartを検出しましたが、本文セクションから参照されていません。",
        "info",
      ),
    );
  }
  if (inspection.has_footers && inspection.footers.length === 0) {
    warnings.push(
      warning(
        "footer.unreferenced_part",
        "フッターpartを検出しましたが、本文セクションから参照されていません。",
        "info",
      ),
    );
  }
  if (!inspection.has_styles_xml) {
    warnings.push(
      warning(
        "docx.missing_styles",
        "styles.xmlが見つからないため、書式情報が不足する可能性があります。",
        "info",
      ),
    );
  }
  if (!inspection.has_numbering_xml) {
    warnings.push(
      warning(
        "docx.missing_numbering",
        "numbering.xmlが見つからないため、リスト情報が不足する可能性があります。",
        "info",
      ),
    );
  }

  for (const feature of inspection.unsupported_features ?? []) {
    warnings.push(
      warning(
        feature.code,
        `${feature.recommendation}（検出数: ${feature.count}）`,
        feature.severity,
        feature.affected_part,
        {
          category: feature.category as ImportWarning["category"],
          affectedPart: feature.affected_part,
          part: feature.affected_part,
          canContinue: feature.can_continue,
          recommendation: feature.recommendation,
          originalValue: { count: feature.count },
        },
      ),
    );
  }

  for (const entry of inspection.entries) {
    if (entry.name === "word/comments.xml") {
      warnings.push(
        warning(
          "docx.unsupported_comments",
          "コメントは未対応のため読み込みません。",
          "warning",
          entry.name,
        ),
      );
    }
    if (entry.name === "word/footnotes.xml" || entry.name === "word/endnotes.xml") {
      warnings.push(
        warning(
          "docx.unsupported_notes",
          "脚注または文末脚注は未対応のため読み込みません。",
          "warning",
          entry.name,
        ),
      );
    }
    if (entry.name.includes("/charts/") || entry.name.includes("/diagrams/")) {
      warnings.push(
        warning(
          "docx.unsupported_drawing",
          "グラフまたはSmartArtは未対応です。",
          "warning",
          entry.name,
        ),
      );
    }
  }
  for (const imageWarning of inspection.image_warnings ?? []) {
    warnings.push(
      warning(
        imageWarning.code,
        imageWarning.message,
        imageWarning.severity,
        imageWarning.relationship_id
          ? `relationship:${imageWarning.relationship_id}`
          : `image:${imageWarning.position ?? "?"}`,
        {
          part: imageWarning.part ?? undefined,
          originalValue: imageWarning.relationship_id ?? imageWarning.position,
          fallbackValue: imageWarning.simplified,
        },
      ),
    );
  }
  for (const tableWarning of inspection.table_warnings ?? []) {
    warnings.push(
      warning(
        tableWarning.code,
        tableWarning.message,
        tableWarning.severity,
        tableWarning.cell_index === null || tableWarning.cell_index === undefined
          ? `table:${tableWarning.table_index}`
          : `table:${tableWarning.table_index} row:${tableWarning.row_index ?? "?"} cell:${tableWarning.cell_index}`,
        { fallbackValue: tableWarning.simplified },
      ),
    );
  }
  if (inspection.sections.length > 1) {
    warnings.push(
      warning(
        "section.multiple_sections",
        "複数セクションを検出しました。今回は最初のセクション設定だけを文書全体へ適用します。",
        "warning",
        "word/document.xml",
        {
          part: "word/document.xml",
          originalValue: inspection.sections.length,
          fallbackValue: "first_section",
        },
      ),
    );
  }
  for (const section of inspection.sections) {
    const sectionCode =
      section.break_type === "continuous"
        ? "section.continuous_unsupported"
        : section.break_type === "oddPage"
          ? "section.odd_page_unsupported"
          : section.break_type === "evenPage"
            ? "section.even_page_unsupported"
            : null;
    if (section.index > 0 && sectionCode) {
      warnings.push(
        warning(
          sectionCode,
          "セクション区切りを検出しました。編集上は区切り位置と種類だけを保持します。",
          "warning",
          "word/document.xml",
          {
            part: "word/document.xml",
            paragraphIndex: section.paragraph_index ?? undefined,
            originalValue: section.break_type,
            fallbackValue: "pageBreak.sectionMetadata",
          },
        ),
      );
    }
    if (
      section.index > 0 &&
      section.break_type &&
      !["nextPage", "continuous", "evenPage", "oddPage"].includes(section.break_type)
    ) {
      warnings.push(
        warning(
          "section.unsupported_break_type",
          "未対応のセクション区切り種別を検出しました。",
          "warning",
          "word/document.xml",
          {
            part: "word/document.xml",
            paragraphIndex: section.paragraph_index ?? undefined,
            originalValue: section.break_type,
            fallbackValue: "ignored",
          },
        ),
      );
    }
    if (section.has_columns) {
      warnings.push(
        warning(
          "section.columns_unsupported",
          "段組み設定は検出のみ行い、本文には反映しません。",
          "warning",
          "word/document.xml",
          {
            part: "word/document.xml",
            paragraphIndex: section.paragraph_index ?? undefined,
          },
        ),
      );
    }
    if (section.has_page_borders) {
      warnings.push(
        warning(
          "section.page_borders_unsupported",
          "ページ罫線は検出のみ行い、書き出しには反映しません。",
          "warning",
          "word/document.xml",
          {
            part: "word/document.xml",
            paragraphIndex: section.paragraph_index ?? undefined,
          },
        ),
      );
    }
    if (section.has_title_page) {
      warnings.push(
        warning(
          "section.different_headers_footers",
          "先頭ページだけ異なるヘッダー/フッター設定を検出しましたが保持しません。",
          "warning",
          "word/document.xml",
          {
            part: "word/document.xml",
            paragraphIndex: section.paragraph_index ?? undefined,
          },
        ),
      );
    }
    if (
      section.index > 0 &&
      ((section.header_references?.length ?? 0) > 0 || (section.footer_references?.length ?? 0) > 0)
    ) {
      warnings.push(
        warning(
          "section.header_footer_simplified",
          "セクションごとのヘッダー/フッター参照は検出のみ行い、標準ヘッダー/フッターへ単純化します。",
          "warning",
          "word/document.xml",
          {
            part: "word/document.xml",
            paragraphIndex: section.paragraph_index ?? undefined,
            originalValue: {
              headers: section.header_references,
              footers: section.footer_references,
            },
            fallbackValue: "default_header_footer",
          },
        ),
      );
    }
  }
  for (const paragraph of inspection.paragraphs) {
    if (paragraph.has_rendered_page_break) {
      warnings.push(
        warning(
          "page_break.rendered_only",
          "Wordの表示結果由来の改ページを検出しました。明示的な改ページとしては取り込みません。",
          "info",
          `paragraph:${paragraph.index}`,
          {
            part: "word/document.xml",
            paragraphIndex: paragraph.index,
            originalValue: "w:lastRenderedPageBreak",
            fallbackValue: "ignored",
          },
        ),
      );
    }
    if (paragraph.has_column_break) {
      warnings.push(
        warning(
          "page_break.column_unsupported",
          "段組み用のカラム区切りは未対応のため、本文には反映しません。",
          "warning",
          `paragraph:${paragraph.index}`,
          {
            part: "word/document.xml",
            paragraphIndex: paragraph.index,
            originalValue: "w:br type=column",
            fallbackValue: "ignored",
          },
        ),
      );
    }
    if (paragraph.keep_next) {
      warnings.push(
        warning(
          "pagination.keep_next_limited",
          "keepNextは段落属性として保持しますが、画面上のページネーションとは完全一致しません。",
          "info",
          `paragraph:${paragraph.index}`,
          { part: "word/document.xml", paragraphIndex: paragraph.index },
        ),
      );
    }
    if (paragraph.keep_lines) {
      warnings.push(
        warning(
          "pagination.keep_lines_limited",
          "keepLinesは段落属性として保持しますが、画面上のページネーションとは完全一致しません。",
          "info",
          `paragraph:${paragraph.index}`,
          { part: "word/document.xml", paragraphIndex: paragraph.index },
        ),
      );
    }
    if (paragraph.widow_control !== null) {
      warnings.push(
        warning(
          "pagination.widow_control_limited",
          "widowControlは検出のみ行い、画面表示と書き出しには反映しません。",
          "info",
          `paragraph:${paragraph.index}`,
          {
            part: "word/document.xml",
            paragraphIndex: paragraph.index,
            originalValue: paragraph.widow_control,
          },
        ),
      );
    }
  }

  return warnings;
}

function pageSettingsFromInspection(inspection: DocxInspection | undefined): {
  pageSettings: PageSettings;
  warnings: ImportWarning[];
} {
  if (!inspection?.sections[0]?.page_settings)
    return { pageSettings: defaultPageSettings, warnings: [] };
  const settings = inspection.sections[0].page_settings;
  const warnings: ImportWarning[] = [];
  const rawWidth = settings.width_twips;
  const rawHeight = settings.height_twips;
  let widthMm = rawWidth === null ? defaultPageSettings.widthMm : twipsToMillimeters(rawWidth);
  let heightMm = rawHeight === null ? defaultPageSettings.heightMm : twipsToMillimeters(rawHeight);
  let orientation: PageSettings["orientation"] =
    settings.orientation === "landscape" || widthMm > heightMm ? "landscape" : "portrait";

  if (
    settings.orientation &&
    settings.orientation !== "landscape" &&
    settings.orientation !== "portrait"
  ) {
    warnings.push(
      warning(
        "page.unsupported_orientation",
        "未対応のページ方向です。用紙サイズから方向を推定します。",
        "warning",
        "word/document.xml",
        {
          part: "word/document.xml",
          originalValue: settings.orientation,
          fallbackValue: orientation,
        },
      ),
    );
  }

  if (!isReasonablePageDimension(widthMm) || !isReasonablePageDimension(heightMm)) {
    warnings.push(
      warning(
        "page.invalid_size",
        "ページサイズが異常なためA4既定値へ戻します。",
        "warning",
        "word/document.xml",
        {
          part: "word/document.xml",
          originalValue: { width_twips: rawWidth, height_twips: rawHeight },
          fallbackValue: {
            widthMm: defaultPageSettings.widthMm,
            heightMm: defaultPageSettings.heightMm,
          },
        },
      ),
    );
    widthMm = defaultPageSettings.widthMm;
    heightMm = defaultPageSettings.heightMm;
    orientation = "portrait";
  }

  if (orientation === "landscape" && widthMm < heightMm) [widthMm, heightMm] = [heightMm, widthMm];
  if (orientation === "portrait" && widthMm > heightMm) [widthMm, heightMm] = [heightMm, widthMm];

  const margins = settings.margins;
  const marginsFromDocx = {
    topMm: twipsToMarginMm(margins?.top_twips, defaultPageSettings.margins.topMm),
    rightMm: twipsToMarginMm(margins?.right_twips, defaultPageSettings.margins.rightMm),
    bottomMm: twipsToMarginMm(margins?.bottom_twips, defaultPageSettings.margins.bottomMm),
    leftMm: twipsToMarginMm(margins?.left_twips, defaultPageSettings.margins.leftMm),
    headerMm:
      margins?.header_twips === null || margins?.header_twips === undefined
        ? undefined
        : twipsToMillimeters(margins.header_twips),
    footerMm:
      margins?.footer_twips === null || margins?.footer_twips === undefined
        ? undefined
        : twipsToMillimeters(margins.footer_twips),
    gutterMm:
      margins?.gutter_twips === null || margins?.gutter_twips === undefined
        ? undefined
        : twipsToMillimeters(margins.gutter_twips),
  };

  if (
    Object.values(marginsFromDocx).some(
      (value) => typeof value === "number" && (value < 0 || value > 250),
    )
  ) {
    warnings.push(
      warning(
        "page.invalid_margins",
        "ページ余白が異常なため既定余白へ戻します。",
        "warning",
        "word/document.xml",
        {
          part: "word/document.xml",
          originalValue: margins,
          fallbackValue: defaultPageSettings.margins,
        },
      ),
    );
    return { pageSettings: defaultPageSettings, warnings };
  }

  const pageSettings: PageSettings = {
    ...defaultPageSettings,
    size: inferPageSize(widthMm, heightMm),
    widthMm,
    heightMm,
    orientation,
    margins: marginsFromDocx,
    marginsMm: {
      top: marginsFromDocx.topMm,
      right: marginsFromDocx.rightMm,
      bottom: marginsFromDocx.bottomMm,
      left: marginsFromDocx.leftMm,
    },
  };
  return { pageSettings, warnings };
}

function twipsToMarginMm(value: number | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  return twipsToMillimeters(value);
}

function isReasonablePageDimension(value: number): boolean {
  return Number.isFinite(value) && value >= 25 && value <= 2000;
}

function inferPageSize(widthMm: number, heightMm: number): PageSettings["size"] {
  const short = Math.min(widthMm, heightMm);
  const long = Math.max(widthMm, heightMm);
  if (closeMm(short, 210) && closeMm(long, 297)) return "A4";
  if (closeMm(short, 215.9) && closeMm(long, 279.4)) return "Letter";
  return "Custom";
}

function closeMm(left: number, right: number): boolean {
  return Math.abs(left - right) < 1;
}

function paragraphFormattingFromInspection(inspection: DocxInspection | undefined): {
  formatting: Map<number, ParagraphFormatting>;
  warnings: ImportWarning[];
} {
  const formatting = new Map<number, ParagraphFormatting>();
  const warnings: ImportWarning[] = [];
  for (const paragraph of inspection?.paragraphs ?? []) {
    const converted = convertParagraphFormatting(paragraph, warnings);
    if (Object.keys(converted).length > 0) formatting.set(paragraph.index, converted);
  }
  return { formatting, warnings };
}

function convertParagraphFormatting(
  paragraph: DocxParagraphFormatting,
  warnings: ImportWarning[],
): ParagraphFormatting {
  const formatting: ParagraphFormatting = {};
  const alignment = alignmentFromOoxml(paragraph.alignment);
  if (alignment) formatting.alignment = alignment;
  if (paragraph.alignment && !alignment) {
    warnings.push(
      warning(
        "paragraph.unsupported_alignment",
        "未対応の段落揃えです。左揃えとして扱います。",
        "warning",
        `paragraph:${paragraph.index}`,
        {
          part: "word/document.xml",
          paragraphIndex: paragraph.index,
          originalValue: paragraph.alignment,
          fallbackValue: "left",
        },
      ),
    );
    formatting.alignment = "left";
  }
  const indentLeftMm = safeTwipsToMm(paragraph.indent_left_twips);
  const indentRightMm = safeTwipsToMm(paragraph.indent_right_twips);
  const firstLineIndentMm = safeTwipsToMm(paragraph.first_line_twips);
  const hangingIndentMm = safeTwipsToMm(paragraph.hanging_twips);
  if (indentLeftMm !== undefined) formatting.indentLeftMm = indentLeftMm;
  if (indentRightMm !== undefined) formatting.indentRightMm = indentRightMm;
  if (firstLineIndentMm !== undefined) formatting.firstLineIndentMm = firstLineIndentMm;
  if (hangingIndentMm !== undefined) formatting.hangingIndentMm = hangingIndentMm;
  if (
    [indentLeftMm, indentRightMm, firstLineIndentMm, hangingIndentMm].some(
      (value) => value !== undefined && Math.abs(value) > 250,
    )
  ) {
    warnings.push(
      warning(
        "paragraph.invalid_indent",
        "段落インデントが大きすぎるため保持しません。",
        "warning",
        `paragraph:${paragraph.index}`,
        {
          part: "word/document.xml",
          paragraphIndex: paragraph.index,
          originalValue: paragraph,
        },
      ),
    );
    delete formatting.indentLeftMm;
    delete formatting.indentRightMm;
    delete formatting.firstLineIndentMm;
    delete formatting.hangingIndentMm;
  }
  const beforePt = safeTwipsToPt(paragraph.spacing_before_twips);
  const afterPt = safeTwipsToPt(paragraph.spacing_after_twips);
  if (beforePt !== undefined) formatting.spaceBeforePt = beforePt;
  if (afterPt !== undefined) formatting.spaceAfterPt = afterPt;
  if (paragraph.line_twips !== null) {
    const lineSpacing = lineSpacingFromOoxml(paragraph.line_twips, paragraph.line_rule);
    if (lineSpacing) formatting.lineSpacing = lineSpacing;
    else {
      warnings.push(
        warning(
          "paragraph.unsupported_line_rule",
          "未対応の行間指定です。行間は保持しません。",
          "warning",
          `paragraph:${paragraph.index}`,
          {
            part: "word/document.xml",
            paragraphIndex: paragraph.index,
            originalValue: { line: paragraph.line_twips, lineRule: paragraph.line_rule },
          },
        ),
      );
    }
  }
  if (beforePt !== undefined || afterPt !== undefined || formatting.lineSpacing) {
    warnings.push(
      warning(
        "PARAGRAPH_SPACING_SIMPLIFIED",
        "Word固有の段落間隔または行間設定を、このアプリの単純な段落書式へ変換しました。",
        "info",
        `paragraph:${paragraph.index}`,
        {
          part: "word/document.xml",
          paragraphIndex: paragraph.index,
          originalValue: {
            spacingBeforeTwips: paragraph.spacing_before_twips,
            spacingAfterTwips: paragraph.spacing_after_twips,
            lineTwips: paragraph.line_twips,
            lineRule: paragraph.line_rule,
          },
          fallbackValue: {
            spaceBeforePt: formatting.spaceBeforePt,
            spaceAfterPt: formatting.spaceAfterPt,
            lineSpacing: formatting.lineSpacing,
          },
        },
      ),
    );
  }
  if (paragraph.page_break_before) formatting.pageBreakBefore = true;
  if (paragraph.keep_next) formatting.keepWithNext = true;
  if (paragraph.keep_lines) formatting.keepLinesTogether = true;
  if (paragraph.widow_control !== null) {
    warnings.push(
      warning(
        "paragraph.formatting_loss",
        "widowControlは検出のみ行い、書き出しには反映しません。",
        "info",
        `paragraph:${paragraph.index}`,
        {
          part: "word/document.xml",
          paragraphIndex: paragraph.index,
          originalValue: paragraph.widow_control,
        },
      ),
    );
  }
  const parsed = ParagraphFormattingSchema.safeParse(formatting);
  if (!parsed.success) {
    warnings.push(
      warning(
        "paragraph.invalid_spacing",
        "段落書式が内部検証に失敗したため保持しません。",
        "warning",
        `paragraph:${paragraph.index}`,
        {
          part: "word/document.xml",
          paragraphIndex: paragraph.index,
          originalValue: formatting,
        },
      ),
    );
    return {};
  }
  return parsed.data;
}

function alignmentFromOoxml(value: string | null): ParagraphFormatting["alignment"] | undefined {
  if (value === null) return undefined;
  if (value === "left" || value === "start") return "left";
  if (value === "center") return "center";
  if (value === "right" || value === "end") return "right";
  if (value === "both" || value === "distribute") return "justify";
  return undefined;
}

function safeTwipsToMm(value: number | null): number | undefined {
  if (value === null) return undefined;
  return twipsToMillimeters(value);
}

function safeTwipsToPt(value: number | null): number | undefined {
  if (value === null) return undefined;
  return twipsToPoints(value);
}

function lineSpacingFromOoxml(
  line: number,
  lineRule: string | null,
): ParagraphFormatting["lineSpacing"] | undefined {
  if (lineRule === null || lineRule === "auto") {
    return { type: line === 240 ? "single" : "multiple", value: line / 240 };
  }
  if (lineRule === "exact") return { type: "exact", value: twipsToPoints(line) };
  if (lineRule === "atLeast") return { type: "atLeast", value: twipsToPoints(line) };
  return undefined;
}

function applyOoxmlFormattingToHtml(
  html: string,
  formatting: Map<number, ParagraphFormatting>,
  paragraphs: DocxParagraphFormatting[],
  sections: DocxSection[],
): string {
  if (
    formatting.size === 0 &&
    !paragraphs.some(
      (paragraph) =>
        paragraph.has_page_break ||
        sectionMetadataForParagraph(paragraph.index, sections)?.breakType,
    )
  )
    return html;
  const document = new DOMParser().parseFromString(html, "text/html");
  const blocks = Array.from(document.body.children).filter((element) =>
    /^(p|h[1-4])$/i.test(element.tagName),
  );
  let blockIndex = 0;
  for (const paragraph of paragraphs) {
    if (isStandalonePageBreakParagraph(paragraph)) {
      const previousBlock = blocks[Math.max(0, blockIndex - 1)];
      if (previousBlock?.nextElementSibling?.getAttribute("data-page-break") !== "true") {
        const pageBreak = createPageBreakElement(document, {
          breakType: "page",
          source: "docx",
          importedFrom: "w:br",
        });
        previousBlock?.after(pageBreak);
      }
      continue;
    }
    const element = blocks[blockIndex];
    if (!element) continue;
    blockIndex += 1;
    const paragraphFormatting = formatting.get(paragraph.index);
    if (!paragraphFormatting && !paragraph.has_page_break) continue;
    if (!paragraphFormatting) {
      if (element.nextElementSibling?.getAttribute("data-page-break") !== "true") {
        const pageBreak = createPageBreakElement(document, {
          breakType: "page",
          source: "docx",
          importedFrom: "w:br",
        });
        element.after(pageBreak);
      }
      continue;
    }
    element.setAttribute("data-paragraph-formatting", JSON.stringify(paragraphFormatting));
    const style = styleFromParagraphFormatting(paragraphFormatting);
    if (style) element.setAttribute("style", style);
    if (
      paragraphFormatting.pageBreakBefore &&
      element.previousElementSibling?.getAttribute("data-page-break") !== "true"
    ) {
      const pageBreak = createPageBreakElement(document, {
        breakType: "page",
        source: "docx",
        importedFrom: "w:pageBreakBefore",
      });
      element.before(pageBreak);
    }
    if (paragraph.has_page_break) {
      if (element?.nextElementSibling?.getAttribute("data-page-break") !== "true") {
        const pageBreak = createPageBreakElement(document, {
          breakType: "page",
          source: "docx",
          importedFrom: "w:br",
        });
        element?.after(pageBreak);
      }
    }
    const sectionMetadata = sectionMetadataForParagraph(paragraph.index, sections);
    if (sectionMetadata && element.nextElementSibling?.getAttribute("data-page-break") !== "true") {
      element.after(
        createPageBreakElement(document, {
          breakType: sectionMetadata.breakType,
          source: "docx",
          importedFrom: "w:sectPr",
          sectionMetadata,
        }),
      );
    }
  }
  return document.body.innerHTML;
}

type PageBreakHtmlOptions = {
  breakType: "page" | "sectionNextPage" | "sectionContinuous";
  source: "user" | "docx";
  importedFrom?: string;
  sectionMetadata?: SectionBreakMetadata;
};

type SectionBreakMetadata = {
  sectionIndex: number;
  paragraphIndex: number;
  originalBreakType: string | null;
  breakType: "page" | "sectionNextPage" | "sectionContinuous";
  pageSettings: DocxPageSettings | null;
  headerReferences: string[];
  footerReferences: string[];
};

function createPageBreakElement(document: Document, options: PageBreakHtmlOptions): HTMLDivElement {
  const pageBreak = document.createElement("div");
  pageBreak.setAttribute("data-page-break", "true");
  pageBreak.setAttribute("data-break-type", options.breakType);
  pageBreak.setAttribute("data-source", options.source);
  if (options.importedFrom) pageBreak.setAttribute("data-imported-from", options.importedFrom);
  if (options.sectionMetadata) {
    pageBreak.setAttribute("data-section-metadata", JSON.stringify(options.sectionMetadata));
  }
  return pageBreak;
}

function sectionMetadataForParagraph(
  paragraphIndex: number,
  sections: DocxSection[],
): SectionBreakMetadata | null {
  const section = sections.find(
    (candidate) => candidate.paragraph_index === paragraphIndex && candidate.index > 0,
  );
  if (!section) return null;
  return {
    sectionIndex: section.index,
    paragraphIndex,
    originalBreakType: section.break_type,
    breakType: sectionBreakType(section.break_type),
    pageSettings: section.page_settings,
    headerReferences: section.header_references ?? [],
    footerReferences: section.footer_references ?? [],
  };
}

function sectionBreakType(value: string | null): "page" | "sectionNextPage" | "sectionContinuous" {
  if (value === "continuous") return "sectionContinuous";
  if (value === "nextPage" || value === "evenPage" || value === "oddPage") return "sectionNextPage";
  return "sectionNextPage";
}

function isStandalonePageBreakParagraph(paragraph: DocxParagraphFormatting): boolean {
  return (
    paragraph.has_page_break &&
    paragraph.alignment === null &&
    paragraph.indent_left_twips === null &&
    paragraph.indent_right_twips === null &&
    paragraph.first_line_twips === null &&
    paragraph.hanging_twips === null &&
    paragraph.spacing_before_twips === null &&
    paragraph.spacing_after_twips === null &&
    paragraph.line_twips === null &&
    paragraph.line_rule === null &&
    !paragraph.page_break_before &&
    !paragraph.keep_next &&
    !paragraph.keep_lines &&
    paragraph.widow_control === null
  );
}

function styleFromParagraphFormatting(formatting: ParagraphFormatting): string {
  const declarations: string[] = [];
  if (formatting.alignment)
    declarations.push(
      `text-align: ${formatting.alignment === "justify" ? "justify" : formatting.alignment}`,
    );
  if (formatting.indentLeftMm !== undefined)
    declarations.push(`margin-left: ${formatting.indentLeftMm}mm`);
  if (formatting.indentRightMm !== undefined)
    declarations.push(`margin-right: ${formatting.indentRightMm}mm`);
  if (formatting.firstLineIndentMm !== undefined)
    declarations.push(`text-indent: ${formatting.firstLineIndentMm}mm`);
  if (formatting.hangingIndentMm !== undefined)
    declarations.push(`text-indent: -${formatting.hangingIndentMm}mm`);
  if (formatting.spaceBeforePt !== undefined)
    declarations.push(`margin-top: ${formatting.spaceBeforePt}pt`);
  if (formatting.spaceAfterPt !== undefined)
    declarations.push(`margin-bottom: ${formatting.spaceAfterPt}pt`);
  if (formatting.lineSpacing?.type === "multiple" || formatting.lineSpacing?.type === "single") {
    declarations.push(`line-height: ${formatting.lineSpacing.value}`);
  }
  return declarations.join("; ");
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
    const dimensions = imageDimensionsFromBase64(relationship.mime_type, relationship.data_base64);
    if (dimensions) {
      asset.widthPx = dimensions.widthPx;
      asset.heightPx = dimensions.heightPx;
      asset.originalWidthPx = dimensions.widthPx;
      asset.originalHeightPx = dimensions.heightPx;
    }
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
    if (asset.widthPx) image.setAttribute("data-width-px", String(asset.widthPx));
    if (asset.heightPx) image.setAttribute("data-height-px", String(asset.heightPx));
    if (asset.altText) image.setAttribute("data-alt-text", asset.altText);
    image.setAttribute("data-keep-aspect-ratio", "true");
  }
  return document.body.innerHTML;
}

function imageDimensionsFromBase64(
  mimeType: string,
  base64: string,
): { widthPx: number; heightPx: number } | null {
  const bytes = base64ToBytes(base64);
  if (mimeType === "image/png" && bytes.length >= 24) {
    return {
      widthPx: readUint32Be(bytes, 16),
      heightPx: readUint32Be(bytes, 20),
    };
  }
  if (mimeType === "image/gif" && bytes.length >= 10) {
    return {
      widthPx: readUint16Le(bytes, 6),
      heightPx: readUint16Le(bytes, 8),
    };
  }
  if (mimeType === "image/jpeg") return jpegDimensions(bytes);
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

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function readUint16Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100;
}

function readUint16Be(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x100 + bytes[offset + 1];
}

function jpegDimensions(bytes: Uint8Array): { widthPx: number; heightPx: number } | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    const length = readUint16Be(bytes, offset + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        heightPx: readUint16Be(bytes, offset + 5),
        widthPx: readUint16Be(bytes, offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function stableAssetId(relationship: DocxImageRelationship): string {
  const checksum =
    relationship.checksum?.replace(/[^a-zA-Z0-9]/g, "-") ?? relationship.relationship_id;
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
      warnings.push(
        warning("html.external_image", "外部リンク画像は自動取得しません。", "warning", src),
      );
    }
  }
  Array.from(document.querySelectorAll("table")).forEach((table, tableIndex) => {
    const rows = Array.from(
      table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr"),
    );
    const cells = Array.from(
      table.querySelectorAll(
        [
          ":scope > thead > tr > th",
          ":scope > thead > tr > td",
          ":scope > tbody > tr > th",
          ":scope > tbody > tr > td",
          ":scope > tr > th",
          ":scope > tr > td",
        ].join(", "),
      ),
    );
    if (table.querySelector("table")) {
      warnings.push(
        warning(
          "table.nested_unsupported",
          "入れ子になった表は単純化されます。",
          "warning",
          `table:${tableIndex}`,
          { fallbackValue: "inner table is kept as sanitized HTML where possible" },
        ),
      );
    }
    if (rows.length > 200 || cells.length > 4000) {
      warnings.push(
        warning(
          "table.size_limited",
          "大きすぎる表を検出しました。編集性能に影響する可能性があります。",
          "warning",
          `table:${tableIndex}`,
          { fallbackValue: `rows:${rows.length} cells:${cells.length}` },
        ),
      );
    }
  });

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
