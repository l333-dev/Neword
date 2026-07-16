import { migrateDocumentProject } from "../document-model/migrations";
import type { DocumentProject } from "../document-model/schema";

export function serializeProject(project: DocumentProject): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

export function deserializeProject(text: string): DocumentProject {
  return migrateDocumentProject(JSON.parse(text) as unknown);
}

export function markProjectUpdated(project: DocumentProject, now = new Date()): DocumentProject {
  return {
    ...project,
    updatedAt: now.toISOString(),
  };
}
