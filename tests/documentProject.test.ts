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
});
