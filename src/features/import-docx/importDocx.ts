import DOMPurify from "dompurify";
import mammoth from "mammoth/mammoth.browser";

import { classifyBlock, type ClassificationInput } from "../../classification/rules";
import {
  defaultPageSettings,
  ParagraphFormattingSchema,
  type ClassificationResult,
  type DocumentAsset,
  type ImportWarning,
  type PageSettings,
  type ParagraphFormatting,
} from "../../document-model/schema";
import {
  twipsToMillimeters,
  twipsToPoints,
} from "../../converters/units";
import type { DocxImageRelationship, DocxInspection, DocxParagraphFormatting } from "../../project/fileAccess";

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
  "data-paragraph-formatting",
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
  pageSettings: PageSettings;
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
  details?: Partial<ImportWarning>,
): ImportWarning {
  return { code, message, severity, location, ...details };
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
  const pageImport = pageSettingsFromInspection(inspection);
  const formattingImport = paragraphFormattingFromInspection(inspection);
  const sanitizedHtml = applyOoxmlFormattingToHtml(
    attachImageAssetsToHtml(sanitizeImportHtml(result.value), imageImport.assets),
    formattingImport.formatting,
    inspection?.paragraphs ?? [],
  );
  const document = importDocumentFromHtml(sanitizedHtml);
  document.stats.retainedImageCount = imageImport.assets.length;
  document.stats.warningImageCount += imageImport.warnings.length;
  document.stats.unsupportedImageFormats = unsupportedFormatsFromWarnings(imageImport.warnings);
  const warnings: ImportWarning[] = [
    ...warningsFromInspection(inspection),
    ...pageImport.warnings,
    ...formattingImport.warnings,
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
    pageSettings: pageImport.pageSettings,
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
  if (inspection.sections.length > 1) {
    warnings.push(
      warning(
        "section.multiple_sections",
        "複数セクションを検出しました。今回は最初のセクション設定だけを文書全体へ適用します。",
        "warning",
        "word/document.xml",
        { part: "word/document.xml", originalValue: inspection.sections.length, fallbackValue: "first_section" },
      ),
    );
  }
  for (const section of inspection.sections) {
    if (section.index > 0 && section.break_type && !["nextPage", "continuous", "evenPage", "oddPage"].includes(section.break_type)) {
      warnings.push(
        warning("section.unsupported_break_type", "未対応のセクション区切り種別を検出しました。", "warning", "word/document.xml", {
          part: "word/document.xml",
          paragraphIndex: section.paragraph_index ?? undefined,
          originalValue: section.break_type,
          fallbackValue: "ignored",
        }),
      );
    }
    if (section.has_columns) {
      warnings.push(
        warning("section.columns_unsupported", "段組み設定は検出のみ行い、本文には反映しません。", "warning", "word/document.xml", {
          part: "word/document.xml",
          paragraphIndex: section.paragraph_index ?? undefined,
        }),
      );
    }
    if (section.has_page_borders) {
      warnings.push(
        warning("section.page_borders_unsupported", "ページ罫線は検出のみ行い、書き出しには反映しません。", "warning", "word/document.xml", {
          part: "word/document.xml",
          paragraphIndex: section.paragraph_index ?? undefined,
        }),
      );
    }
    if (section.has_title_page) {
      warnings.push(
        warning("section.different_headers_footers", "先頭ページだけ異なるヘッダー/フッター設定を検出しましたが保持しません。", "warning", "word/document.xml", {
          part: "word/document.xml",
          paragraphIndex: section.paragraph_index ?? undefined,
        }),
      );
    }
  }

  return warnings;
}

function pageSettingsFromInspection(inspection: DocxInspection | undefined): {
  pageSettings: PageSettings;
  warnings: ImportWarning[];
} {
  if (!inspection?.sections[0]?.page_settings) return { pageSettings: defaultPageSettings, warnings: [] };
  const settings = inspection.sections[0].page_settings;
  const warnings: ImportWarning[] = [];
  const rawWidth = settings.width_twips;
  const rawHeight = settings.height_twips;
  let widthMm = rawWidth === null ? defaultPageSettings.widthMm : twipsToMillimeters(rawWidth);
  let heightMm = rawHeight === null ? defaultPageSettings.heightMm : twipsToMillimeters(rawHeight);
  let orientation: PageSettings["orientation"] =
    settings.orientation === "landscape" || widthMm > heightMm ? "landscape" : "portrait";

  if (settings.orientation && settings.orientation !== "landscape" && settings.orientation !== "portrait") {
    warnings.push(
      warning("page.unsupported_orientation", "未対応のページ方向です。用紙サイズから方向を推定します。", "warning", "word/document.xml", {
        part: "word/document.xml",
        originalValue: settings.orientation,
        fallbackValue: orientation,
      }),
    );
  }

  if (!isReasonablePageDimension(widthMm) || !isReasonablePageDimension(heightMm)) {
    warnings.push(
      warning("page.invalid_size", "ページサイズが異常なためA4既定値へ戻します。", "warning", "word/document.xml", {
        part: "word/document.xml",
        originalValue: { width_twips: rawWidth, height_twips: rawHeight },
        fallbackValue: { widthMm: defaultPageSettings.widthMm, heightMm: defaultPageSettings.heightMm },
      }),
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
    headerMm: margins?.header_twips === null || margins?.header_twips === undefined ? undefined : twipsToMillimeters(margins.header_twips),
    footerMm: margins?.footer_twips === null || margins?.footer_twips === undefined ? undefined : twipsToMillimeters(margins.footer_twips),
    gutterMm: margins?.gutter_twips === null || margins?.gutter_twips === undefined ? undefined : twipsToMillimeters(margins.gutter_twips),
  };

  if (Object.values(marginsFromDocx).some((value) => typeof value === "number" && (value < 0 || value > 250))) {
    warnings.push(
      warning("page.invalid_margins", "ページ余白が異常なため既定余白へ戻します。", "warning", "word/document.xml", {
        part: "word/document.xml",
        originalValue: margins,
        fallbackValue: defaultPageSettings.margins,
      }),
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
      warning("paragraph.unsupported_alignment", "未対応の段落揃えです。左揃えとして扱います。", "warning", `paragraph:${paragraph.index}`, {
        part: "word/document.xml",
        paragraphIndex: paragraph.index,
        originalValue: paragraph.alignment,
        fallbackValue: "left",
      }),
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
  if ([indentLeftMm, indentRightMm, firstLineIndentMm, hangingIndentMm].some((value) => value !== undefined && Math.abs(value) > 250)) {
    warnings.push(warning("paragraph.invalid_indent", "段落インデントが大きすぎるため保持しません。", "warning", `paragraph:${paragraph.index}`, {
      part: "word/document.xml",
      paragraphIndex: paragraph.index,
      originalValue: paragraph,
    }));
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
      warnings.push(warning("paragraph.unsupported_line_rule", "未対応の行間指定です。行間は保持しません。", "warning", `paragraph:${paragraph.index}`, {
        part: "word/document.xml",
        paragraphIndex: paragraph.index,
        originalValue: { line: paragraph.line_twips, lineRule: paragraph.line_rule },
      }));
    }
  }
  if (paragraph.page_break_before) formatting.pageBreakBefore = true;
  if (paragraph.keep_next) formatting.keepWithNext = true;
  if (paragraph.keep_lines) formatting.keepLinesTogether = true;
  if (paragraph.widow_control !== null) {
    warnings.push(warning("paragraph.formatting_loss", "widowControlは検出のみ行い、書き出しには反映しません。", "info", `paragraph:${paragraph.index}`, {
      part: "word/document.xml",
      paragraphIndex: paragraph.index,
      originalValue: paragraph.widow_control,
    }));
  }
  const parsed = ParagraphFormattingSchema.safeParse(formatting);
  if (!parsed.success) {
    warnings.push(warning("paragraph.invalid_spacing", "段落書式が内部検証に失敗したため保持しません。", "warning", `paragraph:${paragraph.index}`, {
      part: "word/document.xml",
      paragraphIndex: paragraph.index,
      originalValue: formatting,
    }));
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
): string {
  if (formatting.size === 0 && !paragraphs.some((paragraph) => paragraph.has_page_break)) return html;
  const document = new DOMParser().parseFromString(html, "text/html");
  const blocks = Array.from(document.body.children).filter((element) => /^(p|h[1-4])$/i.test(element.tagName));
  let blockIndex = 0;
  for (const paragraph of paragraphs) {
    if (isStandalonePageBreakParagraph(paragraph)) {
      const previousBlock = blocks[Math.max(0, blockIndex - 1)];
      if (previousBlock?.nextElementSibling?.getAttribute("data-page-break") !== "true") {
        const pageBreak = document.createElement("div");
        pageBreak.setAttribute("data-page-break", "true");
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
        const pageBreak = document.createElement("div");
        pageBreak.setAttribute("data-page-break", "true");
        element.after(pageBreak);
      }
      continue;
    }
    element.setAttribute("data-paragraph-formatting", JSON.stringify(paragraphFormatting));
    const style = styleFromParagraphFormatting(paragraphFormatting);
    if (style) element.setAttribute("style", style);
    if (paragraphFormatting.pageBreakBefore && element.previousElementSibling?.getAttribute("data-page-break") !== "true") {
      const pageBreak = document.createElement("div");
      pageBreak.setAttribute("data-page-break", "true");
      element.before(pageBreak);
    }
    if (paragraph.has_page_break) {
      if (element?.nextElementSibling?.getAttribute("data-page-break") !== "true") {
        const pageBreak = document.createElement("div");
        pageBreak.setAttribute("data-page-break", "true");
        element?.after(pageBreak);
      }
    }
  }
  return document.body.innerHTML;
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
  if (formatting.alignment) declarations.push(`text-align: ${formatting.alignment === "justify" ? "justify" : formatting.alignment}`);
  if (formatting.indentLeftMm !== undefined) declarations.push(`margin-left: ${formatting.indentLeftMm}mm`);
  if (formatting.indentRightMm !== undefined) declarations.push(`margin-right: ${formatting.indentRightMm}mm`);
  if (formatting.firstLineIndentMm !== undefined) declarations.push(`text-indent: ${formatting.firstLineIndentMm}mm`);
  if (formatting.hangingIndentMm !== undefined) declarations.push(`text-indent: -${formatting.hangingIndentMm}mm`);
  if (formatting.spaceBeforePt !== undefined) declarations.push(`margin-top: ${formatting.spaceBeforePt}pt`);
  if (formatting.spaceAfterPt !== undefined) declarations.push(`margin-bottom: ${formatting.spaceAfterPt}pt`);
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
