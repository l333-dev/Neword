import { readFile } from "node:fs/promises";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  blocksFromHtml,
  convertDocxArrayBufferToImportResult,
  importDocumentFromHtml,
  sanitizeImportHtml,
  type SourceFileInfo,
} from "../src/features/import-docx/importDocx";
import { createNewProject } from "../src/document-model/schema";
import { deserializeProject, serializeProject } from "../src/project/serialization";
import { exportDocumentToDocxBase64 } from "../src/features/export-docx/docxWriter";
import { projectToExportDocument } from "../src/features/export-docx/exportDocument";
import type { DocxInspection } from "../src/project/fileAccess";

const fixturePath = "tests/fixtures/japanese-import-sample.docx";
const pngFixturePath = "tests/fixtures/image-png.docx";
const jpegFixturePath = "tests/fixtures/image-jpeg.docx";
const duplicateFixturePath = "tests/fixtures/image-duplicate.docx";
const externalFixturePath = "tests/fixtures/image-external-relationship.docx";
const brokenFixturePath = "tests/fixtures/image-broken-relationship.docx";

describe("DOCX import preview blocks", () => {
  it("handles Japanese paragraphs and headings", () => {
    const blocks = blocksFromHtml("<h1>実験目的</h1><p>日本語の段落です。</p>");
    expect(blocks[0]?.classification.blockType).toBe("heading");
    expect(blocks[1]?.text).toBe("日本語の段落です。");
  });

  it("handles lists, tables, images, and captions", () => {
    const blocks = blocksFromHtml(
      '<ul><li>a</li></ul><ol><li>b</li></ol><table><tr><td>c</td></tr></table><p>図1 装置</p><p>表 1 結果</p><p><img src="data:image/png;base64,x" alt="y"></p>',
    );
    expect(blocks.map((block) => block.classification.blockType)).toContain("bullet_list");
    expect(blocks.map((block) => block.classification.blockType)).toContain("ordered_list");
    expect(blocks.map((block) => block.classification.blockType)).toContain("table");
    expect(blocks.map((block) => block.classification.blockType)).toContain("figure_caption");
    expect(blocks.map((block) => block.classification.blockType)).toContain("table_caption");
    expect(blocks.map((block) => block.classification.blockType)).toContain("image");
  });

  it("is deterministic", () => {
    const html = "<p>考察</p><p>本文</p>";
    expect(blocksFromHtml(html)).toEqual(blocksFromHtml(html));
  });

  it("sanitizes dangerous HTML and external image sources", () => {
    const html = sanitizeImportHtml(
      '<p onclick="alert(1)" style="color:red">本文<script>alert(1)</script></p><img src="https://example.test/image.png" onerror="alert(1)">',
    );
    expect(html).toContain("<p>本文</p>");
    expect(html).toContain("<img>");
    expect(html).not.toContain("script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("https://example.test");
  });

  it("handles empty imported HTML safely", () => {
    const document = importDocumentFromHtml("");
    expect(document.blocks).toEqual([]);
    expect(document.stats.imageCount).toBe(0);
    expect(document.stats.retainedImageCount).toBe(0);
  });

  it("keeps explicit page break metadata from sanitized HTML", () => {
    const html = sanitizeImportHtml(
      '<p>前</p><div data-page-break="true" data-break-type="sectionNextPage" data-source="docx" data-imported-from="w:sectPr" data-section-metadata="{&quot;originalBreakType&quot;:&quot;nextPage&quot;}"></div><p>後</p>',
    );
    const document = importDocumentFromHtml(html);

    expect(document.sanitizedHtml).toContain('data-break-type="sectionNextPage"');
    expect(document.sanitizedHtml).toContain('data-imported-from="w:sectPr"');
    expect(document.blocks[1]?.classification.blockType).toBe("page_break");
  });

  it("keeps supported table attributes while sanitizing imported HTML", () => {
    const html = sanitizeImportHtml(
      '<table style="width:500px"><tr><th colspan="2" bgcolor="#dbeafe" valign="middle" style="width:120px;background-color:#dbeafe;vertical-align:middle">見出し</th></tr><tr><td rowspan="2" style="width:80px;background-color:rgb(254, 226, 226);vertical-align:bottom">本文</td></tr></table>',
    );

    expect(html).toContain('data-table-width-px="500"');
    expect(html).toContain('colspan="2"');
    expect(html).toContain('rowspan="2"');
    expect(html).toContain('colwidth="120"');
    expect(html).toContain('colwidth="80"');
    expect(html).toContain('data-cell-background="#DBEAFE"');
    expect(html).toContain('data-cell-background="#FEE2E2"');
    expect(html).toContain('data-cell-vertical-align="middle"');
    expect(html).toContain('data-cell-vertical-align="bottom"');
    expect(html).not.toContain("style=");
  });
});

describe("DOCX fixture import", () => {
  it("keeps supported Japanese document structures and reports unsupported elements", async () => {
    const buffer = await readFile(fixturePath);
    const inspection = await inspectFixture(buffer);
    const bytes = new Uint8Array(buffer);
    const result = await convertDocxArrayBufferToImportResult({
      arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      sourceInfo: sourceInfo(buffer.byteLength),
      inspection,
    });

    const blockTypes = result.document.blocks.map((block) => block.classification.blockType);
    const text = result.document.blocks.map((block) => block.text).join("\n");

    expect(text).toContain("日本語の本文です。");
    expect(result.document.stats.headingCount).toBeGreaterThanOrEqual(2);
    expect(blockTypes).toContain("bullet_list");
    expect(blockTypes).toContain("ordered_list");
    expect(blockTypes).toContain("table");
    expect(result.document.stats.tableCount).toBeGreaterThanOrEqual(1);
    expect(result.document.stats.imageCount).toBeGreaterThanOrEqual(1);
    expect(result.warnings.map((warning) => warning.code)).toContain("docx.unsupported_comments");
    expect(result.warnings.map((warning) => warning.code)).toContain("docx.unsupported_drawing");
  });

  it("converts table inspection metadata into ImportWarning", async () => {
    const buffer = await readFile(fixturePath);
    const inspection = await inspectFixture(buffer);
    inspection.table_warnings = [
      {
        code: "table.nested_unsupported",
        message: "入れ子になった表は単純化されます。",
        severity: "warning",
        table_index: 0,
        row_index: 1,
        cell_index: 2,
        simplified: "nested table structure is not preserved",
      },
    ];
    const bytes = new Uint8Array(buffer);
    const result = await convertDocxArrayBufferToImportResult({
      arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      sourceInfo: sourceInfo(buffer.byteLength),
      inspection,
    });

    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "table.nested_unsupported",
        location: "table:0 row:1 cell:2",
        fallbackValue: "nested table structure is not preserved",
      }),
    );
  });

  it("converts image inspection metadata into ImportWarning", async () => {
    const buffer = await readFile(fixturePath);
    const inspection = await inspectFixture(buffer);
    inspection.image_warnings = [
      {
        code: "image.anchored_unsupported",
        message: "anchored imageは通常の画像配置へ単純化します。",
        severity: "warning",
        relationship_id: "rIdImage",
        part: "word/document.xml",
        position: 0,
        simplified: "anchor positioning and wrapping are ignored",
      },
    ];
    const bytes = new Uint8Array(buffer);
    const result = await convertDocxArrayBufferToImportResult({
      arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      sourceInfo: sourceInfo(buffer.byteLength),
      inspection,
    });

    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "image.anchored_unsupported",
        location: "relationship:rIdImage",
        part: "word/document.xml",
        fallbackValue: "anchor positioning and wrapping are ignored",
      }),
    );
  });

  it("converts aggregated unsupported feature metadata into safe ImportWarnings", async () => {
    const buffer = await readFile(fixturePath);
    const inspection = await inspectFixture(buffer);
    inspection.unsupported_features = [
      {
        code: "docx.unsupported_math",
        category: "unsupported-element",
        severity: "warning",
        count: 2,
        affected_part: "word/document.xml",
        can_continue: true,
        recommendation: "数式は編集可能な数式として保持されません。",
      },
      {
        code: "docx.unsupported_math",
        category: "unsupported-element",
        severity: "warning",
        count: 3,
        affected_part: "word/document.xml",
        can_continue: true,
        recommendation: "数式は編集可能な数式として保持されません。",
      },
    ];
    const bytes = new Uint8Array(buffer);
    const result = await convertDocxArrayBufferToImportResult({
      arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      sourceInfo: sourceInfo(buffer.byteLength),
      inspection,
    });
    const mathWarnings = result.warnings.filter(
      (warning) => warning.code === "docx.unsupported_math",
    );

    expect(mathWarnings).toHaveLength(1);
    expect(mathWarnings[0]).toEqual(
      expect.objectContaining({
        category: "unsupported-element",
        severity: "warning",
        affectedPart: "word/document.xml",
      }),
    );
    expect(JSON.stringify(mathWarnings[0])).not.toContain("<m:oMath");
  });

  it("creates an image asset from a PNG DOCX image", async () => {
    const result = await importFixture(pngFixturePath);

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]?.mimeType).toBe("image/png");
    expect(result.assets[0]?.fileName).toBe("日本語画像.png");
    expect(result.assets[0]?.originalWidthPx).toBeGreaterThan(0);
    expect(result.assets[0]?.originalHeightPx).toBeGreaterThan(0);
    expect(result.document.sanitizedHtml).toContain("data-asset-id=");
    expect(result.document.sanitizedHtml).toContain("data-width-px=");
    expect(result.document.sanitizedHtml).toContain("data-height-px=");
  });

  it("creates an image asset from a JPEG DOCX image", async () => {
    const result = await importFixture(jpegFixturePath);

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]?.mimeType).toBe("image/jpeg");
  });

  it("does not create duplicate assets for the same image relationship", async () => {
    const result = await importFixture(duplicateFixturePath);

    expect(result.document.stats.imageCount).toBeGreaterThanOrEqual(2);
    expect(result.assets).toHaveLength(1);
  });

  it("keeps image assets through project JSON serialization", async () => {
    const result = await importFixture(pngFixturePath);
    const project = createNewProject(new Date("2026-07-17T00:00:00.000Z"));
    const saved = deserializeProject(
      serializeProject({
        ...project,
        editorContent: {
          type: "doc",
          content: [
            {
              type: "image",
              attrs: { assetId: result.assets[0]?.id, src: "data:image/png;base64,unused" },
            },
          ],
        },
        assets: result.assets,
      }),
    );

    expect(saved.assets[0]?.dataBase64).toBe(result.assets[0]?.dataBase64);
  });

  it("generates warnings for external image relationships", async () => {
    const result = await importFixture(externalFixturePath);

    expect(result.assets).toHaveLength(0);
    expect(result.warnings.map((item) => item.code)).toContain("image.external_relationship");
  });

  it("generates warnings for broken image relationships", async () => {
    const result = await importFixture(brokenFixturePath);

    expect(result.assets).toHaveLength(0);
    expect(result.warnings.map((item) => item.code)).toContain("image.missing_part");
  });

  it("generates warnings for unsupported image formats", async () => {
    const buffer = await readFile(pngFixturePath);
    const inspection = await inspectFixture(buffer);
    inspection.image_relationships.push({
      relationship_id: "rIdTiff",
      relationship_type:
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
      target: "media/image.tiff",
      source_part: "word/document.xml",
      resolved_part: "word/media/image.tiff",
      mime_type: null,
      byte_size: null,
      data_base64: null,
      external: false,
      checksum: null,
      warning_code: "image.unsupported_format",
      warning_message: "未対応の画像形式です。",
    });
    const bytes = new Uint8Array(buffer);
    const result = await convertDocxArrayBufferToImportResult({
      arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      sourceInfo: sourceInfo(buffer.byteLength),
      inspection,
    });

    expect(result.warnings.map((item) => item.code)).toContain("image.unsupported_format");
  });

  it("applies inspected page settings and paragraph formatting to imported HTML", async () => {
    const buffer = await readFile(fixturePath);
    const inspection = await inspectFixture(buffer);
    inspection.sections = [
      {
        index: 0,
        paragraph_index: null,
        page_settings: {
          width_twips: 16838,
          height_twips: 11906,
          orientation: "landscape",
          margins: {
            top_twips: 680,
            right_twips: 737,
            bottom_twips: 794,
            left_twips: 850,
            header_twips: 454,
            footer_twips: 510,
            gutter_twips: 113,
          },
        },
        break_type: null,
        has_columns: false,
        has_page_borders: false,
        has_title_page: false,
      },
    ];
    inspection.paragraphs = [
      {
        index: 0,
        alignment: "both",
        indent_left_twips: 567,
        indent_right_twips: 283,
        first_line_twips: null,
        hanging_twips: 170,
        spacing_before_twips: 120,
        spacing_after_twips: 240,
        line_twips: 360,
        line_rule: "auto",
        page_break_before: true,
        keep_next: true,
        keep_lines: true,
        widow_control: true,
        has_page_break: true,
      },
    ];
    const bytes = new Uint8Array(buffer);
    const result = await convertDocxArrayBufferToImportResult({
      arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      sourceInfo: sourceInfo(buffer.byteLength),
      inspection,
    });

    expect(result.pageSettings.orientation).toBe("landscape");
    expect(result.pageSettings.widthMm).toBeCloseTo(297, 0);
    expect(result.pageSettings.margins.leftMm).toBeCloseTo(15, 0);
    expect(result.paragraphSettings.alignment).toBe("justify");
    expect(result.paragraphSettings.indentLeftMm).toBeCloseTo(10, 0);
    expect(result.paragraphSettings.indentRightMm).toBeCloseTo(5, 0);
    expect(result.paragraphSettings.hangingIndentMm).toBeCloseTo(3, 0);
    expect(result.paragraphSettings.spaceBeforePt).toBe(6);
    expect(result.paragraphSettings.spaceAfterPt).toBe(12);
    expect(result.paragraphSettings.lineSpacing).toEqual({ type: "multiple", value: 1.5 });
    expect(result.paragraphSettings.pageBreakBefore).toBe(true);
    expect(result.paragraphSettings.keepWithNext).toBe(true);
    expect(result.paragraphSettings.keepLinesTogether).toBe(true);
    expect(result.document.sanitizedHtml).toContain('data-page-break="true"');
    expect(result.document.sanitizedHtml).toContain("data-paragraph-formatting=");
    expect(result.document.sanitizedHtml).toContain("text-align: justify");
    expect(result.warnings.map((item) => item.code)).toContain("PARAGRAPH_SPACING_SIMPLIFIED");
    expect(result.warnings.map((item) => item.code)).toContain("paragraph.formatting_loss");
  });

  it("imports inspected header, footer, and page number metadata", async () => {
    const buffer = await readFile(fixturePath);
    const inspection = await inspectFixture(buffer);
    inspection.headers = [
      {
        kind: "header",
        reference_type: "default",
        relationship_id: "rIdHeader1",
        source_part: "word/header1.xml",
        text: "Imported Header",
        has_page_number: false,
        unsupported_features: [],
      },
      {
        kind: "header",
        reference_type: "first",
        relationship_id: "rIdHeaderFirst",
        source_part: "word/header2.xml",
        text: "First Header",
        has_page_number: false,
        unsupported_features: ["drawing"],
      },
    ];
    inspection.footers = [
      {
        kind: "footer",
        reference_type: "default",
        relationship_id: "rIdFooter1",
        source_part: "word/footer1.xml",
        text: "Imported Footer",
        has_page_number: true,
        unsupported_features: [],
      },
      {
        kind: "footer",
        reference_type: "even",
        relationship_id: "rIdFooterEven",
        source_part: "word/footer2.xml",
        text: "Even Footer",
        has_page_number: false,
        unsupported_features: ["field"],
      },
    ];
    const bytes = new Uint8Array(buffer);
    const result = await convertDocxArrayBufferToImportResult({
      arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      sourceInfo: sourceInfo(buffer.byteLength),
      inspection,
    });

    expect(result.header.plainText).toBe("Imported Header");
    expect(result.header.importMetadata.sourcePart).toBe("word/header1.xml");
    expect(result.footer.plainText).toBe("Imported Footer");
    expect(result.footer.pageNumberPosition).toBe("center");
    expect(result.warnings.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "header.multiple_types",
        "header.first_page_unsupported",
        "header.word_feature_unsupported",
        "footer.multiple_types",
        "footer.even_odd_unsupported",
        "footer.word_feature_unsupported",
      ]),
    );
  });

  it("warns about multiple sections and unsupported section decorations", async () => {
    const buffer = await readFile(fixturePath);
    const inspection = await inspectFixture(buffer);
    inspection.sections = [
      {
        index: 0,
        paragraph_index: null,
        page_settings: null,
        break_type: null,
        has_columns: false,
        has_page_borders: false,
        has_title_page: false,
      },
      {
        index: 1,
        paragraph_index: 2,
        page_settings: null,
        break_type: "nextColumn",
        has_columns: true,
        has_page_borders: true,
        has_title_page: true,
      },
    ];
    const bytes = new Uint8Array(buffer);
    const result = await convertDocxArrayBufferToImportResult({
      arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      sourceInfo: sourceInfo(buffer.byteLength),
      inspection,
    });

    expect(result.warnings.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "section.multiple_sections",
        "section.unsupported_break_type",
        "section.columns_unsupported",
        "section.page_borders_unsupported",
        "section.different_headers_footers",
      ]),
    );
  });

  it("converts image nodes to ExportDocument image blocks", async () => {
    const result = await importFixture(pngFixturePath);
    const project = createNewProject(new Date("2026-07-17T00:00:00.000Z"));
    const exportDocument = projectToExportDocument({
      ...project,
      editorContent: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { assetId: result.assets[0]?.id, alt: "図1", width: 24, height: 24 },
          },
        ],
      },
      assets: result.assets,
    });

    expect(exportDocument.assets).toHaveLength(1);
    expect(exportDocument.blocks).toContainEqual({
      type: "image",
      assetId: result.assets[0]?.id,
      altText: "図1",
      widthPx: 24,
      heightPx: 24,
      alignment: "left",
    });
  });

  it("round-trips an imported image through project JSON and exported DOCX", async () => {
    const imported = await importFixture(pngFixturePath);
    const asset = imported.assets[0];
    const project = deserializeProject(
      serializeProject({
        ...createNewProject(new Date("2026-07-17T00:00:00.000Z")),
        editorContent: {
          type: "doc",
          content: [
            { type: "image", attrs: { assetId: asset?.id, alt: "図1", width: 24, height: 24 } },
          ],
        },
        assets: imported.assets,
      }),
    );
    const exportedBase64 = await exportDocumentToDocxBase64(projectToExportDocument(project));
    const exportedBuffer = Buffer.from(exportedBase64, "base64");
    const exportedInspection = await inspectFixture(exportedBuffer);
    const exportedBytes = new Uint8Array(exportedBuffer);
    const reimported = await convertDocxArrayBufferToImportResult({
      arrayBuffer: exportedBytes.buffer.slice(
        exportedBytes.byteOffset,
        exportedBytes.byteOffset + exportedBytes.byteLength,
      ),
      sourceInfo: sourceInfo(exportedBuffer.byteLength),
      inspection: exportedInspection,
    });

    expect(reimported.assets).toHaveLength(1);
    expect(reimported.assets[0]?.mimeType).toBe(asset?.mimeType);
    expect(reimported.assets[0]?.checksum).toBe(asset?.checksum);
    expect(reimported.document.stats.imageCount).toBeGreaterThanOrEqual(1);
  });

  it("round-trips layout settings through export, JSON save, and reimport inspection", async () => {
    const project = deserializeProject(
      serializeProject({
        ...createNewProject(new Date("2026-07-17T00:00:00.000Z")),
        pageSettings: {
          ...createNewProject().pageSettings,
          size: "A4",
          widthMm: 297,
          heightMm: 210,
          orientation: "landscape",
          margins: { topMm: 12, rightMm: 13, bottomMm: 14, leftMm: 15 },
          marginsMm: { top: 12, right: 13, bottom: 14, left: 15 },
        },
        editorContent: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: {
                textAlign: "center",
                paragraphFormatting: {
                  alignment: "center",
                  indentLeftMm: 10,
                  indentRightMm: 5,
                  firstLineIndentMm: 7,
                  spaceBeforePt: 6,
                  spaceAfterPt: 12,
                  lineSpacing: { type: "multiple", value: 1.5 },
                  pageBreakBefore: true,
                },
              },
              content: [{ type: "text", text: "first paragraph" }],
            },
            { type: "pageBreak" },
            {
              type: "paragraph",
              attrs: {
                textAlign: "right",
                paragraphFormatting: { alignment: "right", hangingIndentMm: 4 },
              },
              content: [{ type: "text", text: "second paragraph" }],
            },
          ],
        },
      }),
    );
    const exportedBase64 = await exportDocumentToDocxBase64(projectToExportDocument(project));
    const exportedBuffer = Buffer.from(exportedBase64, "base64");
    const exportedInspection = await inspectFixture(exportedBuffer);
    await attachLayoutInspection(exportedInspection, exportedBuffer);
    const exportedBytes = new Uint8Array(exportedBuffer);
    const reimported = await convertDocxArrayBufferToImportResult({
      arrayBuffer: exportedBytes.buffer.slice(
        exportedBytes.byteOffset,
        exportedBytes.byteOffset + exportedBytes.byteLength,
      ),
      sourceInfo: sourceInfo(exportedBuffer.byteLength),
      inspection: exportedInspection,
    });

    expect(reimported.pageSettings.orientation).toBe("landscape");
    expect(reimported.pageSettings.widthMm).toBeCloseTo(297, 0);
    expect(reimported.pageSettings.margins.leftMm).toBeCloseTo(15, 0);
    expect(reimported.document.sanitizedHtml).toContain("first paragraph");
    expect(reimported.document.sanitizedHtml).toContain("second paragraph");
    expect(reimported.document.sanitizedHtml).toContain("text-align: center");
    expect(reimported.document.sanitizedHtml).toContain("text-align: right");
    expect(
      (reimported.document.sanitizedHtml.match(/data-page-break="true"/g) ?? []).length,
    ).toBeGreaterThanOrEqual(1);
  });
});

function sourceInfo(sizeBytes: number): SourceFileInfo {
  return {
    name: "japanese-import-sample.docx",
    sizeBytes,
    inspectedAt: "2026-07-17T00:00:00.000Z",
  };
}

async function inspectFixture(buffer: Buffer): Promise<DocxInspection> {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).map((entry) => ({
    name: entry.name,
    compressed_size: 0,
    uncompressed_size: 0,
  }));
  const names = entries.map((entry) => entry.name);
  const imageRelationships = await imageRelationshipsFromZip(zip);
  return {
    has_document_xml: names.includes("word/document.xml"),
    has_styles_xml: names.includes("word/styles.xml"),
    has_numbering_xml: names.includes("word/numbering.xml"),
    has_settings_xml: names.includes("word/settings.xml"),
    has_headers: names.some((name) => /^word\/header.*\.xml$/.test(name)),
    has_footers: names.some((name) => /^word\/footer.*\.xml$/.test(name)),
    has_macros: names.includes("word/vbaProject.bin"),
    headers: [],
    footers: [],
    media_entries: names.filter((name) => name.startsWith("word/media/")),
    image_relationships: imageRelationships,
    image_warnings: [],
    sections: [],
    paragraphs: [],
    table_warnings: [],
    unsupported_features: [],
    entries,
    warnings: [],
  };
}

async function importFixture(path: string) {
  const buffer = await readFile(path);
  const inspection = await inspectFixture(buffer);
  const bytes = new Uint8Array(buffer);
  return convertDocxArrayBufferToImportResult({
    arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    sourceInfo: sourceInfo(buffer.byteLength),
    inspection,
  });
}

async function imageRelationshipsFromZip(
  zip: JSZip,
): Promise<DocxInspection["image_relationships"]> {
  const rels = zip.file("word/_rels/document.xml.rels");
  if (!rels) return [];
  const xml = await rels.async("string");
  const matches = [...xml.matchAll(/<Relationship\s+([^>]+)>/g)];
  const relationships: DocxInspection["image_relationships"] = [];
  for (const match of matches) {
    const attrs = attrsFromXml(match[1] ?? "");
    if (attrs.Type !== "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image")
      continue;
    const external = attrs.TargetMode === "External";
    const resolvedPart = external ? null : `word/${attrs.Target ?? ""}`;
    const file = resolvedPart ? zip.file(resolvedPart) : null;
    const bytes = file ? await file.async("uint8array") : null;
    const mimeType = bytes ? mimeTypeFromBytes(bytes) : null;
    relationships.push({
      relationship_id: attrs.Id ?? "",
      relationship_type: attrs.Type ?? "",
      target: attrs.Target ?? "",
      source_part: "word/document.xml",
      resolved_part: resolvedPart,
      mime_type: mimeType,
      byte_size: bytes?.byteLength ?? null,
      data_base64: bytes ? Buffer.from(bytes).toString("base64") : null,
      external,
      checksum: bytes ? `test:${Buffer.from(bytes).toString("base64").slice(0, 12)}` : null,
      warning_code: external ? "image.external_relationship" : file ? null : "image.missing_part",
      warning_message: external
        ? "外部画像relationshipは読み込みません。"
        : file
          ? null
          : "画像partが見つかりません。",
    });
  }
  return relationships;
}

function attrsFromXml(xml: string): Record<string, string> {
  return Object.fromEntries(
    [...xml.matchAll(/([A-Za-z]+)="([^"]*)"/g)].map((match) => [match[1] ?? "", match[2] ?? ""]),
  );
}

async function attachLayoutInspection(inspection: DocxInspection, buffer: Buffer): Promise<void> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  const sectionXml = documentXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)?.[0] ?? "";
  const pgSz = prefixedAttrs(sectionXml.match(/<w:pgSz\s+([^>]*)\/>/)?.[1] ?? "");
  const pgMar = prefixedAttrs(sectionXml.match(/<w:pgMar\s+([^>]*)\/>/)?.[1] ?? "");
  inspection.sections = [
    {
      index: 0,
      paragraph_index: null,
      page_settings: {
        width_twips: numberOrNull(pgSz.w),
        height_twips: numberOrNull(pgSz.h),
        orientation: pgSz.orient ?? null,
        margins: {
          top_twips: numberOrNull(pgMar.top),
          right_twips: numberOrNull(pgMar.right),
          bottom_twips: numberOrNull(pgMar.bottom),
          left_twips: numberOrNull(pgMar.left),
          header_twips: numberOrNull(pgMar.header),
          footer_twips: numberOrNull(pgMar.footer),
          gutter_twips: numberOrNull(pgMar.gutter),
        },
      },
      break_type: null,
      has_columns: false,
      has_page_borders: false,
      has_title_page: false,
    },
  ];
  inspection.paragraphs = [...documentXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(
    (match, index) => {
      const paragraphXml = match[0];
      const ind = prefixedAttrs(paragraphXml.match(/<w:ind\s+([^>]*)\/>/)?.[1] ?? "");
      const spacing = prefixedAttrs(paragraphXml.match(/<w:spacing\s+([^>]*)\/>/)?.[1] ?? "");
      return {
        index,
        alignment: prefixedAttrs(paragraphXml.match(/<w:jc\s+([^>]*)\/>/)?.[1] ?? "").val ?? null,
        indent_left_twips: numberOrNull(ind.left),
        indent_right_twips: numberOrNull(ind.right),
        first_line_twips: numberOrNull(ind.firstLine),
        hanging_twips: numberOrNull(ind.hanging),
        spacing_before_twips: numberOrNull(spacing.before),
        spacing_after_twips: numberOrNull(spacing.after),
        line_twips: numberOrNull(spacing.line),
        line_rule: spacing.lineRule ?? null,
        page_break_before: paragraphXml.includes("<w:pageBreakBefore"),
        keep_next: paragraphXml.includes("<w:keepNext"),
        keep_lines: paragraphXml.includes("<w:keepLines"),
        widow_control: null,
        has_page_break: paragraphXml.includes('w:type="page"'),
      };
    },
  );
}

function prefixedAttrs(xml: string): Record<string, string> {
  return Object.fromEntries(
    [...xml.matchAll(/(?:\w+:)?([A-Za-z]+)="([^"]*)"/g)].map((match) => [
      match[1] ?? "",
      match[2] ?? "",
    ]),
  );
}

function numberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mimeTypeFromBytes(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (String.fromCharCode(...bytes.slice(0, 6)) === "GIF89a") return "image/gif";
  return null;
}
