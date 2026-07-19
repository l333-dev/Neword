import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import { createNewProject } from "../src/document-model/schema";
import { exportDocumentToDocxBase64 } from "../src/features/export-docx/docxWriter";
import { projectToExportDocument } from "../src/features/export-docx/exportDocument";

describe("DOCX export", () => {
  it("converts project page and paragraph settings into ExportDocument", () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    const exportDocument = projectToExportDocument({
      ...project,
      pageSettings: {
        ...project.pageSettings,
        size: "Letter",
        widthMm: 215.9,
        heightMm: 279.4,
      },
      paragraphSettings: {
        indentLeftMm: 8,
        indentRightMm: 2,
        firstLineIndentMm: 4,
        spaceBeforePt: 3,
        spaceAfterPt: 7,
        lineSpacing: { type: "multiple", value: 1.15 },
      },
    });

    expect(exportDocument.pageSettings.size).toBe("Letter");
    expect(exportDocument.paragraphSettings).toMatchObject({
      indentLeftMm: 8,
      indentRightMm: 2,
      firstLineIndentMm: 4,
      spaceBeforePt: 3,
      spaceAfterPt: 7,
      lineSpacing: { type: "multiple", value: 1.15 },
    });
    expect(exportDocument.header).toEqual(project.header);
    expect(exportDocument.footer).toEqual(project.footer);
  });

  it("creates a DOCX zip with required parts", async () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    const base64 = await exportDocumentToDocxBase64(projectToExportDocument(project));
    const zip = await JSZip.loadAsync(base64, { base64: true });
    expect(zip.file("[Content_Types].xml")).toBeTruthy();
    expect(zip.file("word/document.xml")).toBeTruthy();
    expect(zip.file("word/styles.xml")).toBeTruthy();
  });

  it("writes image assets into exported DOCX media parts", async () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const base64 = await exportDocumentToDocxBase64(
      projectToExportDocument({
        ...project,
        editorContent: {
          type: "doc",
          content: [
            { type: "image", attrs: { assetId: "asset-png", alt: "図1", width: 24, height: 24 } },
          ],
        },
        assets: [
          {
            id: "asset-png",
            kind: "image",
            name: "image.png",
            fileName: "image.png",
            mimeType: "image/png",
            dataBase64: pngBase64,
            byteSize: 68,
            sizeBytes: 68,
            checksum: "fixture",
          },
        ],
      }),
    );
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const mediaEntries = Object.keys(zip.files).filter(
      (name) => name.startsWith("word/media/") && !zip.files[name]?.dir,
    );
    expect(mediaEntries).toHaveLength(1);
    expect(mediaEntries[0]).toMatch(/\.png$/);
  });

  it("writes image dimensions, alt text, and alignment through ExportDocument", async () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
    const exportDocument = projectToExportDocument({
      ...project,
      editorContent: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "日本語本文" }],
          },
          {
            type: "image",
            attrs: {
              assetId: "asset-png",
              widthPx: 120,
              heightPx: 80,
              alignment: "center",
              altText: "中央画像",
            },
          },
        ],
      },
      assets: [
        {
          id: "asset-png",
          kind: "image",
          name: "image.png",
          fileName: "image.png",
          mimeType: "image/png",
          dataBase64: pngBase64,
          byteSize: 68,
          sizeBytes: 68,
          widthPx: 1,
          heightPx: 1,
        },
      ],
    });

    expect(exportDocument.blocks[1]).toMatchObject({
      type: "image",
      assetId: "asset-png",
      widthPx: 120,
      heightPx: 80,
      alignment: "center",
      altText: "中央画像",
    });

    const base64 = await exportDocumentToDocxBase64(exportDocument);
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const documentXml = await zip.file("word/document.xml")?.async("string");

    expect(documentXml).toContain("日本語本文");
    expect(documentXml).toContain("<wp:extent");
    expect(documentXml).toContain("中央画像");
    expect(documentXml).toContain('w:val="center"');
  });

  it("fails export when an image asset is missing or has unsupported MIME type", async () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    await expect(
      exportDocumentToDocxBase64(
        projectToExportDocument({
          ...project,
          editorContent: {
            type: "doc",
            content: [{ type: "image", attrs: { assetId: "missing", widthPx: 1, heightPx: 1 } }],
          },
        }),
      ),
    ).rejects.toThrow(/Image asset cannot be exported/);

    await expect(
      exportDocumentToDocxBase64(
        projectToExportDocument({
          ...project,
          editorContent: {
            type: "doc",
            content: [{ type: "image", attrs: { assetId: "asset-webp", widthPx: 1, heightPx: 1 } }],
          },
          assets: [
            {
              id: "asset-webp",
              kind: "image",
              name: "image.webp",
              fileName: "image.webp",
              mimeType: "image/webp",
              dataBase64: "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAQAcJaQAA3AA/vuUAAA=",
              byteSize: 45,
              sizeBytes: 45,
            },
          ],
        }),
      ),
    ).rejects.toThrow(/Image asset cannot be exported/);
  });

  it("writes header, footer, and page number into exported DOCX parts", async () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    const base64 = await exportDocumentToDocxBase64(
      projectToExportDocument({
        ...project,
        header: { ...project.header, plainText: "Header text" },
        footer: { ...project.footer, plainText: "Footer text", pageNumberPosition: "right" },
      }),
    );
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const documentRels = await zip.file("word/_rels/document.xml.rels")?.async("string");
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const headerXml = await zip.file("word/header1.xml")?.async("string");
    const footerXml = await zip.file("word/footer1.xml")?.async("string");

    expect(documentRels).toContain("/header");
    expect(documentRels).toContain("/footer");
    expect(documentXml).toContain("<w:headerReference");
    expect(documentXml).toContain("<w:footerReference");
    expect(headerXml).toContain("Header text");
    expect(footerXml).toContain("Footer text");
    expect(footerXml).toContain("PAGE");
    expect(footerXml).toContain('w:val="right"');
  });

  it("normalizes and writes rich table attributes", async () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    const exportDocument = projectToExportDocument({
      ...project,
      editorContent: {
        type: "doc",
        content: [
          {
            type: "table",
            attrs: { tableWidthPx: 500 },
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    attrs: {
                      colspan: 2,
                      rowspan: 1,
                      colwidth: [120, 160],
                      backgroundColor: "#DBEAFE",
                      verticalAlign: "middle",
                    },
                    content: [
                      { type: "paragraph", content: [{ type: "text", text: "見出し" }] },
                      { type: "paragraph", content: [{ type: "text", text: "二段落目" }] },
                    ],
                  },
                ],
              },
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    attrs: {
                      rowspan: 2,
                      colwidth: [120],
                      backgroundColor: "#FEE2E2",
                      verticalAlign: "bottom",
                    },
                    content: [{ type: "paragraph", content: [{ type: "text", text: "本文" }] }],
                  },
                  {
                    type: "tableCell",
                    attrs: { colwidth: [160] },
                    content: [{ type: "paragraph" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(exportDocument.blocks[0]).toMatchObject({
      type: "table",
      tableWidthPx: 500,
      rows: [
        [
          {
            header: true,
            colspan: 2,
            colwidth: [120, 160],
            backgroundColor: "#DBEAFE",
            verticalAlign: "middle",
            paragraphs: [[{ type: "text", text: "見出し" }], [{ type: "text", text: "二段落目" }]],
          },
        ],
        [
          {
            rowspan: 2,
            backgroundColor: "#FEE2E2",
            verticalAlign: "bottom",
            paragraphs: [[{ type: "text", text: "本文" }]],
          },
          { paragraphs: [[]] },
        ],
      ],
    });

    const base64 = await exportDocumentToDocxBase64(exportDocument);
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const documentXml = await zip.file("word/document.xml")?.async("string");

    expect(documentXml).toContain("<w:tbl>");
    expect(documentXml).toContain("<w:tblHeader");
    expect(documentXml).toContain("<w:gridSpan");
    expect(documentXml).toContain('w:val="2"');
    expect(documentXml).toContain("<w:vMerge");
    expect(documentXml).toContain("<w:shd");
    expect(documentXml).toContain('w:fill="DBEAFE"');
    expect(documentXml).toContain('w:fill="FEE2E2"');
    expect(documentXml).toContain("<w:vAlign");
    expect(documentXml).toContain('w:val="center"');
    expect(documentXml).toContain('w:val="bottom"');
    expect(documentXml).toContain("見出し");
    expect(documentXml).toContain("二段落目");
    expect(documentXml).toContain("本文");
  });

  it("writes page settings and paragraph formatting to document XML", async () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    const base64 = await exportDocumentToDocxBase64(
      projectToExportDocument({
        ...project,
        pageSettings: {
          ...project.pageSettings,
          size: "A4",
          widthMm: 297,
          heightMm: 210,
          orientation: "landscape",
          margins: {
            topMm: 12,
            rightMm: 13,
            bottomMm: 14,
            leftMm: 15,
            headerMm: 8,
            footerMm: 9,
            gutterMm: 2,
          },
          marginsMm: { top: 12, right: 13, bottom: 14, left: 15 },
        },
        editorContent: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: {
                textAlign: "justify",
                paragraphFormatting: {
                  alignment: "justify",
                  indentLeftMm: 10,
                  indentRightMm: 5,
                  hangingIndentMm: 3,
                  spaceBeforePt: 6,
                  spaceAfterPt: 12,
                  lineSpacing: { type: "multiple", value: 1.5 },
                  keepWithNext: true,
                  keepLinesTogether: true,
                },
              },
              content: [{ type: "text", text: "formatted" }],
            },
            { type: "pageBreak" },
          ],
        },
      }),
    );
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const documentXml = await zip.file("word/document.xml")?.async("string");

    expect(documentXml).toContain('w:orient="landscape"');
    expect(documentXml).toContain('w:w="11906"');
    expect(documentXml).toContain('w:h="16838"');
    expect(documentXml).toContain('w:top="680"');
    expect(documentXml).toContain("<w:jc");
    expect(documentXml).toContain('w:val="both"');
    expect(documentXml).toContain("<w:ind");
    expect(documentXml).toContain("<w:spacing");
    expect(documentXml).toContain('w:line="360"');
    expect(documentXml).toContain("<w:keepNext");
    expect(documentXml).toContain("<w:keepLines");
    expect(documentXml).toContain('<w:br w:type="page"');
  });

  it("writes explicit paragraph defaults when a paragraph has no local formatting", async () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    const base64 = await exportDocumentToDocxBase64(
      projectToExportDocument({
        ...project,
        documentDefaults: {
          ...project.documentDefaults,
          bodyParagraph: {
            spacingBeforePt: 2,
            spacingAfterPt: 10,
            lineHeight: 1.75,
          },
        },
        editorContent: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "defaulted" }] }],
        },
      }),
    );
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const documentXml = await zip.file("word/document.xml")?.async("string");

    expect(documentXml).toContain("<w:spacing");
    expect(documentXml).toContain('w:before="40"');
    expect(documentXml).toContain('w:after="200"');
    expect(documentXml).toContain('w:line="420"');
    expect(documentXml).toContain('w:lineRule="auto"');
    expect(documentXml).toContain("<w:ind");
    expect(documentXml).toContain("<w:jc");
  });

  it("keeps hardBreak distinct from paragraph and pageBreak", async () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    const exportDocument = projectToExportDocument({
      ...project,
      editorContent: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "line one" },
              { type: "hardBreak" },
              { type: "text", text: "line two" },
            ],
          },
          { type: "paragraph", content: [{ type: "text", text: "next paragraph" }] },
          {
            type: "pageBreak",
            attrs: {
              breakType: "sectionNextPage",
              source: "docx",
              importedFrom: "w:sectPr",
              sectionMetadata: { originalBreakType: "nextPage" },
            },
          },
        ],
      },
    });

    expect(exportDocument.blocks).toMatchObject([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "line one" },
          { type: "hard_break" },
          { type: "text", text: "line two" },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "next paragraph" }] },
      {
        type: "page_break",
        breakType: "sectionNextPage",
        source: "docx",
        importedFrom: "w:sectPr",
        sectionMetadata: { originalBreakType: "nextPage" },
      },
    ]);

    const base64 = await exportDocumentToDocxBase64(exportDocument);
    const zip = await JSZip.loadAsync(base64, { base64: true });
    const documentXml = await zip.file("word/document.xml")?.async("string");

    expect(documentXml).toContain("<w:br/>");
    expect(documentXml).toContain('<w:br w:type="page"');
  });
});
