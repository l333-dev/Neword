import { describe, expect, it } from "vitest";

import {
  createNewProject,
  DocumentProjectSchema,
  ParagraphFormattingSchema,
} from "../src/document-model/schema";
import { deserializeProject, serializeProject } from "../src/project/serialization";

type JsonNode = {
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
};

describe("DocumentProject", () => {
  it("creates a valid empty project with Japanese title", () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    expect(DocumentProjectSchema.parse(project).metadata.title).toBe("無題の文書");
  });

  it("round-trips project JSON", () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    expect(deserializeProject(serializeProject(project))).toEqual(project);
  });

  it("rejects broken project JSON", () => {
    expect(() => deserializeProject("{}")).toThrow();
  });

  it("migrates version 1 page settings to the current format", () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    const legacyProject: Partial<typeof project> = { ...project };
    delete legacyProject.documentDefaults;
    delete legacyProject.header;
    delete legacyProject.footer;
    const migrated = deserializeProject(
      JSON.stringify({
        ...legacyProject,
        formatVersion: 1,
        pageSettings: {
          size: "A4",
          orientation: "landscape",
          marginsMm: { top: 10, right: 11, bottom: 12, left: 13 },
          bodyFontFamily: "sans-serif",
          bodyFontSizePt: 11,
          lineHeight: 1.6,
          paragraphSpacingBeforePt: 0,
          paragraphSpacingAfterPt: 6,
          header: "",
          footer: "",
          pageNumbers: true,
        },
      }),
    );

    expect(migrated.formatVersion).toBe(5);
    expect(migrated.pageSettings.widthMm).toBe(297);
    expect(migrated.pageSettings.heightMm).toBe(210);
    expect(migrated.pageSettings.margins.leftMm).toBe(13);
    expect(migrated.paragraphSettings.spaceAfterPt).toBe(6);
    expect(migrated.header.plainText).toBe("");
    expect(migrated.footer.pageNumberPosition).toBe("center");
    expect(migrated.documentDefaults.bodyParagraph.spacingAfterPt).toBe(6);
    expect(migrated.documentDefaults.bodyParagraph.lineHeight).toBe(1.6);
  });

  it("saves header, footer, and page number settings in project JSON", () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    const saved = deserializeProject(
      serializeProject({
        ...project,
        header: {
          ...project.header,
          editorContent: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Header text" }] }],
          },
          plainText: "Header text",
        },
        footer: {
          ...project.footer,
          editorContent: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Footer text" }] }],
          },
          plainText: "Footer text",
          pageNumberPosition: "right",
        },
      }),
    );

    expect(saved.header.plainText).toBe("Header text");
    expect(saved.footer.plainText).toBe("Footer text");
    expect(saved.footer.pageNumberPosition).toBe("right");
  });

  it("saves page break metadata in editor content", () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    const saved = deserializeProject(
      serializeProject({
        ...project,
        editorContent: {
          type: "doc",
          content: [
            {
              type: "pageBreak",
              attrs: {
                breakType: "sectionNextPage",
                source: "docx",
                importedFrom: "w:sectPr",
                sectionMetadata: {
                  sectionIndex: 1,
                  paragraphIndex: 0,
                  originalBreakType: "nextPage",
                },
              },
            },
            { type: "paragraph", content: [{ type: "text", text: "本文" }] },
            { type: "pageBreak", attrs: { breakType: "page", source: "user" } },
          ],
        },
      }),
    );
    const nodes = (saved.editorContent as JsonNode).content ?? [];

    expect(nodes[0]?.attrs?.breakType).toBe("sectionNextPage");
    expect(nodes[0]?.attrs?.sectionMetadata).toMatchObject({ originalBreakType: "nextPage" });
    expect(nodes[2]?.attrs?.breakType).toBe("page");
  });

  it("saves paragraph settings in project JSON", () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    const saved = deserializeProject(
      serializeProject({
        ...project,
        paragraphSettings: {
          indentLeftMm: 12,
          indentRightMm: 3,
          firstLineIndentMm: 5,
          spaceBeforePt: 6,
          spaceAfterPt: 9,
          lineSpacing: { type: "multiple", value: 1.15 },
        },
      }),
    );

    expect(saved.paragraphSettings).toMatchObject({
      indentLeftMm: 12,
      indentRightMm: 3,
      firstLineIndentMm: 5,
      spaceBeforePt: 6,
      spaceAfterPt: 9,
      lineSpacing: { type: "multiple", value: 1.15 },
    });
  });

  it("saves editable table attributes in editorContent JSON", () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    const saved = deserializeProject(
      serializeProject({
        ...project,
        editorContent: {
          type: "doc",
          content: [
            {
              type: "table",
              attrs: { tableWidthPx: 480 },
              content: [
                {
                  type: "tableRow",
                  content: [
                    {
                      type: "tableHeader",
                      attrs: {
                        colspan: 2,
                        rowspan: 1,
                        colwidth: [120, 140],
                        backgroundColor: "#DBEAFE",
                        verticalAlign: "middle",
                      },
                      content: [{ type: "paragraph", content: [{ type: "text", text: "見出し" }] }],
                    },
                  ],
                },
                {
                  type: "tableRow",
                  content: [
                    {
                      type: "tableCell",
                      attrs: {
                        colspan: 1,
                        rowspan: 2,
                        colwidth: [120],
                        backgroundColor: "#FEE2E2",
                        verticalAlign: "bottom",
                      },
                      content: [{ type: "paragraph", content: [{ type: "text", text: "セル" }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    );

    const table = (saved.editorContent as JsonNode).content?.[0];
    const firstCell = table?.content?.[0]?.content?.[0];
    const bodyCell = table?.content?.[1]?.content?.[0];
    expect(table?.attrs).toMatchObject({ tableWidthPx: 480 });
    expect(firstCell?.attrs).toMatchObject({
      colspan: 2,
      colwidth: [120, 140],
      backgroundColor: "#DBEAFE",
      verticalAlign: "middle",
    });
    expect(bodyCell?.attrs).toMatchObject({
      rowspan: 2,
      backgroundColor: "#FEE2E2",
      verticalAlign: "bottom",
    });
  });

  it("allows custom page dimensions independent from orientation", () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    const parsed = DocumentProjectSchema.parse({
      ...project,
      pageSettings: {
        ...project.pageSettings,
        size: "Custom",
        orientation: "portrait",
        widthMm: 300,
        heightMm: 200,
      },
    });

    expect(parsed.pageSettings.widthMm).toBe(300);
    expect(parsed.pageSettings.heightMm).toBe(200);
  });

  it("rejects invalid page settings and paragraph formatting", () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    expect(() =>
      DocumentProjectSchema.parse({
        ...project,
        pageSettings: { ...project.pageSettings, widthMm: 10 },
      }),
    ).toThrow();
    expect(() =>
      ParagraphFormattingSchema.parse({ firstLineIndentMm: 5, hangingIndentMm: 5 }),
    ).toThrow();
  });

  it("rejects invalid image asset base64", () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    expect(() =>
      deserializeProject(
        JSON.stringify({
          ...project,
          assets: [
            {
              id: "asset-invalid",
              kind: "image",
              name: "broken.png",
              fileName: "broken.png",
              mimeType: "image/png",
              dataBase64: "not base64!",
              byteSize: 4,
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it("saves image asset references, dimensions, alignment, aspect ratio, and alt text", () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    const saved = deserializeProject(
      serializeProject({
        ...project,
        assets: [
          {
            id: "asset-image",
            kind: "image",
            name: "image.png",
            fileName: "image.png",
            mimeType: "image/png",
            dataBase64:
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
            byteSize: 68,
            sizeBytes: 68,
            widthPx: 1,
            heightPx: 1,
            originalWidthPx: 1,
            originalHeightPx: 1,
            altText: "図",
          },
        ],
        editorContent: {
          type: "doc",
          content: [
            {
              type: "image",
              attrs: {
                assetId: "asset-image",
                widthPx: 120,
                heightPx: 80,
                keepAspectRatio: true,
                alignment: "center",
                altText: "中央の図",
              },
            },
            {
              type: "image",
              attrs: {
                assetId: "asset-image",
                widthPx: 60,
                heightPx: 40,
                keepAspectRatio: false,
                alignment: "right",
                altText: "右の図",
              },
            },
          ],
        },
      }),
    );
    const firstImage = (saved.editorContent as JsonNode).content?.[0];
    const secondImage = (saved.editorContent as JsonNode).content?.[1];

    expect(saved.assets).toHaveLength(1);
    expect(saved.assets[0]).toMatchObject({
      originalWidthPx: 1,
      originalHeightPx: 1,
      altText: "図",
    });
    expect(firstImage?.attrs).toMatchObject({
      assetId: "asset-image",
      widthPx: 120,
      heightPx: 80,
      keepAspectRatio: true,
      alignment: "center",
      altText: "中央の図",
    });
    expect(secondImage?.attrs).toMatchObject({
      assetId: "asset-image",
      alignment: "right",
      keepAspectRatio: false,
    });
  });

  it("rejects image nodes that reference missing assets", () => {
    const project = createNewProject(new Date("2026-07-15T00:00:00.000Z"));
    expect(() =>
      deserializeProject(
        JSON.stringify({
          ...project,
          editorContent: {
            type: "doc",
            content: [{ type: "image", attrs: { assetId: "missing-asset" } }],
          },
        }),
      ),
    ).toThrow(/missing image assets/);
  });
});
