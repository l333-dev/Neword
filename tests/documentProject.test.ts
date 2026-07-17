import { describe, expect, it } from "vitest";

import { createNewProject, DocumentProjectSchema, ParagraphFormattingSchema } from "../src/document-model/schema";
import { deserializeProject, serializeProject } from "../src/project/serialization";

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
    const migrated = deserializeProject(
      JSON.stringify({
        ...project,
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

    expect(migrated.formatVersion).toBe(2);
    expect(migrated.pageSettings.widthMm).toBe(297);
    expect(migrated.pageSettings.heightMm).toBe(210);
    expect(migrated.pageSettings.margins.leftMm).toBe(13);
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
