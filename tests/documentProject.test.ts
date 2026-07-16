import { describe, expect, it } from "vitest";

import { createNewProject, DocumentProjectSchema } from "../src/document-model/schema";
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
