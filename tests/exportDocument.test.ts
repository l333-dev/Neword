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
});
