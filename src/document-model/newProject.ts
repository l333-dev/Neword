import { createNewProject, DOCUMENT_FORMAT_VERSION, type DocumentProject } from "./schema";
import {
  documentDefaultsFromEditingPreferences,
  type UserEditingPreferences,
} from "../stores/editingPreferences";

export type NewDocumentProject = {
  project: DocumentProject;
  projectPath: null;
  isUnsaved: true;
};

export function createBlankDocumentProject(input: {
  editingPreferences: UserEditingPreferences;
  now?: Date;
}): NewDocumentProject {
  const project = createNewProject(input.now);
  const withPreferences: DocumentProject = {
    ...project,
    formatVersion: DOCUMENT_FORMAT_VERSION,
    documentDefaults: documentDefaultsFromEditingPreferences(input.editingPreferences),
    assets: [],
    warnings: [],
    classifications: [],
    lastExportedAt: null,
    metadata: {
      title: project.metadata.title,
    },
  };
  return {
    project: withPreferences,
    projectPath: null,
    isUnsaved: true,
  };
}
