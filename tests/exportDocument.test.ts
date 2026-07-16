import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import { createNewProject } from "../src/document-model/schema";
import { exportDocumentToDocxBase64 } from "../src/features/export-docx/docxWriter";
import { projectToExportDocument } from "../src/features/export-docx/exportDocument";

describe("DOCX export", () => {
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
          content: [{ type: "image", attrs: { assetId: "asset-png", alt: "図1", width: 24, height: 24 } }],
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
    const mediaEntries = Object.keys(zip.files).filter((name) => name.startsWith("word/media/") && !zip.files[name]?.dir);
    expect(mediaEntries).toHaveLength(1);
    expect(mediaEntries[0]).toMatch(/\.png$/);
  });
});
