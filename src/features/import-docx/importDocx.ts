import DOMPurify from "dompurify";
import mammoth from "mammoth/mammoth.browser";

import { classifyBlock, type ClassificationInput } from "../../classification/rules";
import type { ClassificationResult, ImportWarning } from "../../document-model/schema";

export type ImportPreviewBlock = {
  id: string;
  html: string;
  text: string;
  styleName?: string;
  classification: ClassificationResult;
  warnings: ImportWarning[];
};

export type ImportPreview = {
  fileName: string;
  sanitizedHtml: string;
  blocks: ImportPreviewBlock[];
  warnings: ImportWarning[];
};

export async function convertDocxToPreview(file: File): Promise<ImportPreview> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const sanitizedHtml = DOMPurify.sanitize(result.value, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["alt", "src", "href"],
  });
  const warnings: ImportWarning[] = result.messages.map((message, index) => ({
    id: `mammoth-${index}`,
    severity: message.type === "warning" ? "warning" : "info",
    message: message.message,
    source: "mammoth",
  }));

  return {
    fileName: file.name,
    sanitizedHtml,
    blocks: blocksFromHtml(sanitizedHtml),
    warnings,
  };
}

export function blocksFromHtml(html: string): ImportPreviewBlock[] {
  const document = new DOMParser().parseFromString(html, "text/html");
  const elements = Array.from(document.body.children);
  return elements.map((element, index) => {
    const id = `import-block-${index}`;
    const tag = element.tagName.toLowerCase();
    const text = element.textContent;
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
      marks: [],
    };
    return {
      id,
      html: element.outerHTML,
      text,
      styleName: input.styleName,
      classification: classifyBlock(input),
      warnings: [],
    };
  });
}
