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

  it("creates an image asset from a PNG DOCX image", async () => {
    const result = await importFixture(pngFixturePath);

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]?.mimeType).toBe("image/png");
    expect(result.assets[0]?.fileName).toBe("日本語画像.png");
    expect(result.document.sanitizedHtml).toContain("data-asset-id=");
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
          content: [{ type: "image", attrs: { assetId: result.assets[0]?.id, src: "data:image/png;base64,unused" } }],
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
      relationship_type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
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

  it("converts image nodes to ExportDocument image blocks", async () => {
    const result = await importFixture(pngFixturePath);
    const project = createNewProject(new Date("2026-07-17T00:00:00.000Z"));
    const exportDocument = projectToExportDocument({
      ...project,
      editorContent: {
        type: "doc",
        content: [{ type: "image", attrs: { assetId: result.assets[0]?.id, alt: "図1", width: 24, height: 24 } }],
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
          content: [{ type: "image", attrs: { assetId: asset?.id, alt: "図1", width: 24, height: 24 } }],
        },
        assets: imported.assets,
      }),
    );
    const exportedBase64 = await exportDocumentToDocxBase64(projectToExportDocument(project));
    const exportedBuffer = Buffer.from(exportedBase64, "base64");
    const exportedInspection = await inspectFixture(exportedBuffer);
    const exportedBytes = new Uint8Array(exportedBuffer);
    const reimported = await convertDocxArrayBufferToImportResult({
      arrayBuffer: exportedBytes.buffer.slice(exportedBytes.byteOffset, exportedBytes.byteOffset + exportedBytes.byteLength),
      sourceInfo: sourceInfo(exportedBuffer.byteLength),
      inspection: exportedInspection,
    });

    expect(reimported.assets).toHaveLength(1);
    expect(reimported.assets[0]?.mimeType).toBe(asset?.mimeType);
    expect(reimported.assets[0]?.checksum).toBe(asset?.checksum);
    expect(reimported.document.stats.imageCount).toBeGreaterThanOrEqual(1);
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
    media_entries: names.filter((name) => name.startsWith("word/media/")),
    image_relationships: imageRelationships,
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

async function imageRelationshipsFromZip(zip: JSZip): Promise<DocxInspection["image_relationships"]> {
  const rels = zip.file("word/_rels/document.xml.rels");
  if (!rels) return [];
  const xml = await rels.async("string");
  const matches = [...xml.matchAll(/<Relationship\s+([^>]+)>/g)];
  const relationships: DocxInspection["image_relationships"] = [];
  for (const match of matches) {
    const attrs = attrsFromXml(match[1] ?? "");
    if (attrs.Type !== "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image") continue;
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
      warning_message: external ? "外部画像relationshipは読み込みません。" : file ? null : "画像partが見つかりません。",
    });
  }
  return relationships;
}

function attrsFromXml(xml: string): Record<string, string> {
  return Object.fromEntries(
    [...xml.matchAll(/([A-Za-z]+)="([^"]*)"/g)].map((match) => [match[1] ?? "", match[2] ?? ""]),
  );
}

function mimeTypeFromBytes(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (String.fromCharCode(...bytes.slice(0, 6)) === "GIF89a") return "image/gif";
  return null;
}
