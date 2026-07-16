import { parseDocumentProject, type DocumentProject } from "./schema";

export function migrateDocumentProject(value: unknown): DocumentProject {
  return parseDocumentProject(value);
}
