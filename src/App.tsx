import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Content, Editor } from "@tiptap/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  APP_IDENTIFIER,
  APP_NAME,
  APP_VERSION,
  MAJOR_LIBRARIES,
  SUPPORTED_FEATURES,
  UNSUPPORTED_FEATURES,
} from "./app/appInfo";
import { classifyAppError, type UserFacingError } from "./app/appErrors";
import {
  dismissFirstRunGuide,
  loadOnboardingState,
  saveOnboardingState,
  type OnboardingState,
} from "./app/onboarding";
import { guardedActionResult, hasUnsavedChanges, type UnsavedChoice } from "./app/unsavedChanges";
import { AppSidebar } from "./components/AppSidebar";
import { AppTopbar } from "./components/AppTopbar";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  createNewProject,
  defaultParagraphSettings,
  type FooterContent,
  type HeaderContent,
  ParagraphSettingsSchema,
  type DocumentAsset,
  type DocumentProject,
  type PageSettings,
  type ParagraphFormatting,
  type ParagraphSettings,
} from "./document-model/schema";
import { createBlankDocumentProject } from "./document-model/newProject";
import { trimTrailingEmptyParagraphsFromContent } from "./features/editor/contentCleanup";
import { createEditorExtensions } from "./features/editor/editorConfig";
import { EditorToolbar } from "./features/editor/EditorToolbar";
import { countCharacters, createOutline } from "./features/editor/outline";
import { useResolvedColorMode } from "./features/preferences/useResolvedColorMode";
import {
  convertDocxBase64ToImportResult,
  type ImportPreview,
} from "./features/import-docx/importDocx";
import { exportDocumentToDocxBase64 } from "./features/export-docx/docxWriter";
import { projectToExportDocument } from "./features/export-docx/exportDocument";
import {
  openImageWithDialog,
  deleteRecoveryFile,
  listRecoveryFiles,
  openDocxWithDialog,
  openProjectFromPath,
  openProjectWithDialog,
  readRecoveryFile,
  recoveryDirPath,
  saveProjectToPath,
  saveProjectWithDialog,
  writeProjectAutosave,
  writeBinaryFileWithDialog,
  type SaveStatus,
} from "./project/fileAccess";
import { markProjectUpdated } from "./project/serialization";
import {
  addRecentProject,
  clearRecentProjects,
  loadRecentProjects,
  removeRecentProject,
  saveRecentProjects,
  type RecentProjectEntry,
  type RecentProjects,
} from "./project/recentProjects";
import {
  AUTOSAVE_DEBOUNCE_MS,
  autosaveFileName,
  createAutosaveEnvelope,
  createProjectKey,
  projectContentHash,
  recoveryCandidateFromAutosave,
  recoveryFilesToPrune,
  serializeAutosaveEnvelope,
  type RecoveryCandidate,
} from "./project/recovery";
import {
  documentDefaultsFromEditingPreferences,
  type UserEditingPreferences,
} from "./stores/editingPreferences";
import { createPreferenceCssVariables } from "./preferences/appearance";
import { layoutGridColumns, resolveLayoutRegions, type LayoutRegion } from "./preferences/layout";
import {
  loadUserPreferences,
  saveUserPreferences,
  updateUserPreferences,
  type UserPreferences,
  type UserPreferencesUpdate,
} from "./stores/userPreferences";

const MAX_INSERT_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_INSERT_IMAGE_DIMENSION_PX = 8000;
const MAX_INSERT_IMAGE_PIXELS = 24_000_000;
const MAX_DISPLAY_IMAGE_WIDTH_PX = 680;

type TableCellSettings = {
  backgroundColor: string | null;
  verticalAlign: "top" | "middle" | "bottom";
};

type ImageAlignment = "left" | "center" | "right";

type SelectedImageSettings = {
  assetId: string | null;
  widthPx: number;
  heightPx: number;
  originalWidthPx: number | null;
  originalHeightPx: number | null;
  keepAspectRatio: boolean;
  alignment: ImageAlignment;
  altText: string;
};

type UnsavedDialogState = {
  actionLabel: string;
  resolve: (choice: UnsavedChoice) => void;
} | null;

const defaultTableCellSettings: TableCellSettings = {
  backgroundColor: null,
  verticalAlign: "top",
};

const defaultSelectedImageSettings: SelectedImageSettings = {
  assetId: null,
  widthPx: 320,
  heightPx: 240,
  originalWidthPx: null,
  originalHeightPx: null,
  keepAspectRatio: true,
  alignment: "left",
  altText: "",
};

const HexColorPattern = /^#[0-9A-Fa-f]{6}$/;

export default function App() {
  const isTestEnvironment = import.meta.env.MODE === "test";
  const [project, setProject] = useState<DocumentProject>(() => createNewProject());
  const [documentOpen, setDocumentOpen] = useState(isTestEnvironment);
  const [userPreferences, setUserPreferences] = useState<UserPreferences>(
    () => loadUserPreferences().preferences,
  );
  const [onboardingState, setOnboardingState] = useState<OnboardingState>(() =>
    loadOnboardingState(),
  );
  const [showFirstRunGuide, setShowFirstRunGuide] = useState(
    () => !isTestEnvironment && !loadOnboardingState().firstRunGuideDismissed,
  );
  const [recentProjects, setRecentProjects] = useState<RecentProjects>(() => loadRecentProjects());
  const [appError, setAppError] = useState<UserFacingError | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [unsavedDialog, setUnsavedDialog] = useState<UnsavedDialogState>(null);
  const [recoveryDirectory, setRecoveryDirectory] = useState<string | null>(null);
  const [preferenceSaveError, setPreferenceSaveError] = useState<string | null>(null);
  const editingPreferences = userPreferences.editing;
  const [showAdvancedEditingSettings, setShowAdvancedEditingSettings] = useState(false);
  const [selectedParagraphSettings, setSelectedParagraphSettings] =
    useState<ParagraphSettings>(defaultParagraphSettings);
  const [selectedParagraphEditable, setSelectedParagraphEditable] = useState(false);
  const [selectedTableCellSettings, setSelectedTableCellSettings] =
    useState<TableCellSettings>(defaultTableCellSettings);
  const [selectedTableCellEditable, setSelectedTableCellEditable] = useState(false);
  const [selectedImageSettings, setSelectedImageSettings] = useState<SelectedImageSettings>(
    defaultSelectedImageSettings,
  );
  const [selectedImageEditable, setSelectedImageEditable] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [onlyWarnings, setOnlyWarnings] = useState(false);
  const [onlyUncertain, setOnlyUncertain] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [lastAutosaveAt, setLastAutosaveAt] = useState<string | null>(null);
  const [lastExplicitSaveAt, setLastExplicitSaveAt] = useState<string | null>(null);
  const [recoveryCandidates, setRecoveryCandidates] = useState<RecoveryCandidate[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const shouldFocusSettingsRef = useRef(false);
  const editingPreferencesRef = useRef(editingPreferences);
  const latestProjectRef = useRef(project);
  const latestProjectPathRef = useRef(projectPath);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const closeInProgressRef = useRef(false);
  const autosaveRevisionRef = useRef(0);
  const sessionProjectKeyRef = useRef(`session-${crypto.randomUUID()}`);
  editingPreferencesRef.current = editingPreferences;
  latestProjectRef.current = project;
  latestProjectPathRef.current = projectPath;
  const extensions = useMemo(() => createEditorExtensions(() => editingPreferencesRef.current), []);

  const editor = useEditor({
    extensions,
    content: project.editorContent as Content,
    editorProps: {
      attributes: {
        "aria-label": "文書本文",
        class: "editor-canvas",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      setSelectedParagraphSettings(paragraphFormattingFromEditor(currentEditor));
      setSelectedParagraphEditable(isParagraphFormattingEditable(currentEditor));
      setSelectedTableCellSettings(tableCellSettingsFromEditor(currentEditor));
      setSelectedTableCellEditable(isTableCellEditable(currentEditor));
      setSelectedImageSettings(imageSettingsFromEditor(currentEditor, project.assets));
      setSelectedImageEditable(currentEditor.isActive("image"));
      setProject((current) =>
        markProjectUpdated({
          ...current,
          editorContent: stripRuntimeImageSources(currentEditor.getJSON()),
        }),
      );
      setSaveStatus("dirty");
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      setSelectedParagraphSettings(paragraphFormattingFromEditor(currentEditor));
      setSelectedParagraphEditable(isParagraphFormattingEditable(currentEditor));
      setSelectedTableCellSettings(tableCellSettingsFromEditor(currentEditor));
      setSelectedTableCellEditable(isTableCellEditable(currentEditor));
      setSelectedImageSettings(imageSettingsFromEditor(currentEditor, project.assets));
      setSelectedImageEditable(currentEditor.isActive("image"));
    },
  });

  const outline = useMemo(() => createOutline(project.editorContent), [project.editorContent]);
  const characterCount = useMemo(
    () => countCharacters(project.editorContent),
    [project.editorContent],
  );
  const resolvedColorMode = useResolvedColorMode(userPreferences.appearance.colorMode);
  const appVisualStyle = useMemo(
    () => createPreferenceCssVariables(userPreferences, resolvedColorMode) as CSSProperties,
    [resolvedColorMode, userPreferences],
  );
  const layoutRegions = useMemo(
    () => resolveLayoutRegions(userPreferences.layout),
    [userPreferences.layout],
  );
  const workspaceStyle = useMemo(
    (): CSSProperties => ({
      gridTemplateColumns: layoutGridColumns(layoutRegions),
    }),
    [layoutRegions],
  );
  const pagePreviewStyle = useMemo(
    () => createPagePreviewStyle(project.pageSettings),
    [project.pageSettings],
  );
  const previewPageCount = useMemo(
    () => Math.max(1, countExplicitPages(project.editorContent)),
    [project.editorContent],
  );

  useEffect(() => {
    const result = saveUserPreferences(userPreferences);
    if (!result.ok) {
      setPreferenceSaveError("個人設定の保存に失敗しました。");
      console.warn(
        "User preferences were not saved.",
        result.warnings.map((warning) => warning.code).join(", "),
      );
      return;
    }
    setPreferenceSaveError(null);
  }, [userPreferences]);

  useEffect(() => {
    saveRecentProjects(recentProjects);
  }, [recentProjects]);

  useEffect(() => {
    saveOnboardingState(onboardingState);
  }, [onboardingState]);

  useEffect(() => {
    let cancelled = false;
    recoveryDirPath()
      .then((path) => {
        if (!cancelled) setRecoveryDirectory(path);
      })
      .catch(() => {
        if (!cancelled) setRecoveryDirectory(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updatePreferences = useCallback((update: UserPreferencesUpdate) => {
    setUserPreferences((current) => updateUserPreferences(current, update));
  }, []);

  const setEditingPreferences = useCallback(
    (
      updater:
        UserEditingPreferences | ((current: UserEditingPreferences) => UserEditingPreferences),
    ) => {
      setUserPreferences((current) => {
        const nextEditing = typeof updater === "function" ? updater(current.editing) : updater;
        return updateUserPreferences(current, { editing: nextEditing });
      });
    },
    [],
  );

  const openSettingsPanel = useCallback(() => {
    shouldFocusSettingsRef.current = true;
    updatePreferences({ layout: { settingsVisible: true } });
  }, [updatePreferences]);

  const enqueueSave = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const next = saveQueueRef.current.then(operation, operation);
    saveQueueRef.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadRecoveryCandidates() {
      try {
        const files = await listRecoveryFiles();
        await Promise.all(
          recoveryFilesToPrune(files).map((file) =>
            deleteRecoveryFile(file.name).catch(() => undefined),
          ),
        );
        const activeFiles = files.filter(
          (file) => !recoveryFilesToPrune(files).some((prune) => prune.name === file.name),
        );
        const candidates = await Promise.all(
          activeFiles.map(async (file) => {
            try {
              const text = await readRecoveryFile(file.name);
              return recoveryCandidateFromAutosave(file, text, latestProjectRef.current);
            } catch {
              return {
                kind: "autosave" as const,
                fileName: file.name,
                path: file.path,
                modifiedAt:
                  file.modified_millis === null
                    ? null
                    : new Date(file.modified_millis).toISOString(),
                byteSize: file.byte_size,
                valid: false,
                newerThanCurrent: false,
                sameAsCurrent: false,
                reason: "復旧ファイルを読み込めません。",
              };
            }
          }),
        );
        if (!cancelled) {
          setRecoveryCandidates(
            candidates.filter((candidate) => !candidate.sameAsCurrent || !candidate.valid),
          );
        }
      } catch {
        if (!cancelled) setRecoveryCandidates([]);
      }
    }
    void loadRecoveryCandidates();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!userPreferences.layout.settingsVisible || !shouldFocusSettingsRef.current) return;
    shouldFocusSettingsRef.current = false;
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".settings")?.focus();
    });
  }, [userPreferences.layout.settingsVisible]);

  const updatePageSettings = useCallback((patch: Partial<PageSettings>) => {
    setProject((current) =>
      markProjectUpdated({
        ...current,
        pageSettings: normalizePageSettingsPatch(current.pageSettings, patch),
      }),
    );
    setSaveStatus("dirty");
  }, []);

  const updateHeader = useCallback((header: HeaderContent) => {
    setProject((current) =>
      markProjectUpdated({
        ...current,
        header: {
          ...header,
          importMetadata: {
            ...header.importMetadata,
            source: "user_edit",
          },
        },
      }),
    );
    setSaveStatus("dirty");
  }, []);

  const updateFooter = useCallback((footer: FooterContent) => {
    setProject((current) =>
      markProjectUpdated({
        ...current,
        footer: {
          ...footer,
          importMetadata: {
            ...footer.importMetadata,
            source: "user_edit",
          },
        },
      }),
    );
    setSaveStatus("dirty");
  }, []);

  const updateSelectedParagraphSettings = useCallback(
    (patch: Partial<ParagraphSettings>) => {
      if (!editor || !isParagraphFormattingEditable(editor)) return;
      const next = normalizeParagraphSettingsPatch(paragraphFormattingFromEditor(editor), patch);
      const nodeType = editor.isActive("heading") ? "heading" : "paragraph";
      editor.chain().focus().updateAttributes(nodeType, { paragraphFormatting: next }).run();
      setSelectedParagraphSettings(next);
      setProject((current) =>
        markProjectUpdated({
          ...current,
          paragraphSettings: next,
          editorContent: stripRuntimeImageSources(editor.getJSON()),
        }),
      );
      setSaveStatus("dirty");
    },
    [editor],
  );

  const updateSelectedTableCellSettings = useCallback(
    (patch: Partial<TableCellSettings>) => {
      if (!editor || !isTableCellEditable(editor)) return;
      const next = normalizeTableCellSettingsPatch(tableCellSettingsFromEditor(editor), patch);
      const nodeType = editor.isActive("tableHeader") ? "tableHeader" : "tableCell";
      editor
        .chain()
        .focus()
        .updateAttributes(nodeType, {
          backgroundColor: next.backgroundColor,
          verticalAlign: next.verticalAlign,
        })
        .run();
      setSelectedTableCellSettings(next);
      setProject((current) =>
        markProjectUpdated({
          ...current,
          editorContent: stripRuntimeImageSources(editor.getJSON()),
        }),
      );
      setSaveStatus("dirty");
    },
    [editor],
  );

  const updateSelectedImageSettings = useCallback(
    (patch: Partial<SelectedImageSettings>) => {
      if (!editor || !editor.isActive("image")) return;
      const current = imageSettingsFromEditor(editor, project.assets);
      const next = normalizeImageSettingsPatch(current, patch);
      editor
        .chain()
        .focus()
        .updateAttributes("image", {
          widthPx: next.widthPx,
          heightPx: next.heightPx,
          width: next.widthPx,
          height: next.heightPx,
          keepAspectRatio: next.keepAspectRatio,
          alignment: next.alignment,
          altText: next.altText,
          alt: next.altText,
        })
        .run();
      setSelectedImageSettings(next);
      setProject((currentProject) =>
        markProjectUpdated({
          ...currentProject,
          editorContent: stripRuntimeImageSources(editor.getJSON()),
        }),
      );
      setSaveStatus("dirty");
    },
    [editor, project.assets],
  );

  const resetSelectedImageSize = useCallback(() => {
    if (!selectedImageSettings.originalWidthPx || !selectedImageSettings.originalHeightPx) return;
    const nextSize = fitImageSizeToPage(
      selectedImageSettings.originalWidthPx,
      selectedImageSettings.originalHeightPx,
    );
    updateSelectedImageSettings(nextSize);
  }, [selectedImageSettings, updateSelectedImageSettings]);

  const deleteSelectedImage = useCallback(() => {
    if (!editor || !editor.isActive("image")) return;
    editor.chain().focus().deleteSelection().run();
    setSelectedImageEditable(false);
    setSelectedImageSettings(defaultSelectedImageSettings);
    setProject((current) =>
      markProjectUpdated({
        ...current,
        editorContent: stripRuntimeImageSources(editor.getJSON()),
      }),
    );
    setSaveStatus("dirty");
  }, [editor]);

  const applyPreferencesToDocumentDefaults = useCallback(() => {
    setProject((current) =>
      markProjectUpdated({
        ...current,
        documentDefaults: documentDefaultsFromEditingPreferences(editingPreferences),
      }),
    );
    setSaveStatus("dirty");
  }, [editingPreferences]);

  const applyPreferencesToSelectedBlock = useCallback(() => {
    if (!editor) return;
    const isHeading = editor.isActive("heading");
    const formatting = paragraphFormattingFromEditingPreferences(editingPreferences, isHeading);
    const nodeType = isHeading ? "heading" : "paragraph";
    editor.chain().focus().updateAttributes(nodeType, { paragraphFormatting: formatting }).run();
  }, [editingPreferences, editor]);

  const rememberRecentProject = useCallback((path: string, displayName: string) => {
    setRecentProjects((current) => addRecentProject(current, { path, displayName }));
  }, []);

  const saveProject = useCallback(async (): Promise<boolean> => {
    return enqueueSave(async () => {
      setSaveStatus("saving");
      const projectToSave = projectForSave(latestProjectRef.current, editingPreferencesRef.current);
      const saveHash = projectContentHash(projectToSave);
      try {
        const currentPath = latestProjectPathRef.current;
        if (currentPath) {
          await saveProjectToPath(currentPath, projectToSave);
        } else {
          const path = await saveProjectWithDialog(projectToSave);
          if (!path) {
            setSaveStatus("dirty");
            return false;
          }
          setProjectPath(path);
          latestProjectPathRef.current = path;
          rememberRecentProject(path, projectToSave.metadata.title);
        }
        const latestHash = projectContentHash(
          projectForSave(latestProjectRef.current, editingPreferencesRef.current),
        );
        const savedAt = new Date().toISOString();
        setLastExplicitSaveAt(savedAt);
        setSaveStatus(latestHash === saveHash ? "saved" : "dirty");
        if (latestProjectPathRef.current) {
          rememberRecentProject(latestProjectPathRef.current, projectToSave.metadata.title);
        }
        return true;
      } catch (error) {
        setSaveStatus("error");
        setAppError(classifyAppError(error, "プロジェクト保存"));
        return false;
      }
    });
  }, [enqueueSave, rememberRecentProject]);

  const saveProjectAs = useCallback(async (): Promise<boolean> => {
    return enqueueSave(async () => {
      setSaveStatus("saving");
      const projectToSave = projectForSave(latestProjectRef.current, editingPreferencesRef.current);
      const saveHash = projectContentHash(projectToSave);
      try {
        const path = await saveProjectWithDialog(projectToSave);
        if (path) {
          setProjectPath(path);
          latestProjectPathRef.current = path;
          const savedAt = new Date().toISOString();
          setLastExplicitSaveAt(savedAt);
          const latestHash = projectContentHash(
            projectForSave(latestProjectRef.current, editingPreferencesRef.current),
          );
          setSaveStatus(latestHash === saveHash ? "saved" : "dirty");
          rememberRecentProject(path, projectToSave.metadata.title);
          return true;
        } else {
          setSaveStatus("dirty");
          return false;
        }
      } catch (error) {
        setSaveStatus("error");
        setAppError(classifyAppError(error, "プロジェクト別名保存"));
        return false;
      }
    });
  }, [enqueueSave, rememberRecentProject]);

  const askUnsavedChoice = useCallback((actionLabel: string): Promise<UnsavedChoice> => {
    return new Promise((resolve) => {
      setUnsavedDialog({ actionLabel, resolve });
    });
  }, []);

  const runAfterUnsavedCheck = useCallback(
    async (actionLabel: string, operation: () => Promise<void> | void): Promise<boolean> => {
      if (documentOpen && hasUnsavedChanges(saveStatus)) {
        const choice = await askUnsavedChoice(actionLabel);
        const saveSucceeded = choice === "save" ? await saveProject() : undefined;
        if (guardedActionResult({ choice, saveSucceeded }) === "stay") return false;
      }
      await operation();
      return true;
    },
    [askUnsavedChoice, documentOpen, saveProject, saveStatus],
  );

  const createAndOpenNewProject = useCallback(() => {
    const { project: next } = createBlankDocumentProject({ editingPreferences });
    setProject(next);
    setProjectPath(null);
    latestProjectPathRef.current = null;
    sessionProjectKeyRef.current = `session-${crypto.randomUUID()}`;
    setLastExplicitSaveAt(null);
    setLastAutosaveAt(null);
    editor?.commands.setContent(hydrateImageSources(next.editorContent, next.assets) as Content);
    setDocumentOpen(true);
    setSaveStatus("dirty");
  }, [editingPreferences, editor]);

  const newProject = useCallback(async () => {
    await runAfterUnsavedCheck("新規文書を作成", createAndOpenNewProject);
  }, [createAndOpenNewProject, runAfterUnsavedCheck]);

  const openLoadedProject = useCallback(
    (loaded: { path: string; project: DocumentProject }) => {
      setProject(loaded.project);
      setProjectPath(loaded.path);
      latestProjectPathRef.current = loaded.path;
      setLastExplicitSaveAt(new Date().toISOString());
      setLastAutosaveAt(null);
      editor?.commands.setContent(
        hydrateImageSources(loaded.project.editorContent, loaded.project.assets) as Content,
      );
      setDocumentOpen(true);
      setSaveStatus("saved");
      rememberRecentProject(loaded.path, loaded.project.metadata.title);
    },
    [editor, rememberRecentProject],
  );

  const openProject = useCallback(async () => {
    await runAfterUnsavedCheck("別のプロジェクトを開く", async () => {
      try {
        const loaded = await openProjectWithDialog();
        if (!loaded) return;
        openLoadedProject(loaded);
      } catch (error) {
        setAppError(classifyAppError(error, "プロジェクト読み込み"));
      }
    });
  }, [openLoadedProject, runAfterUnsavedCheck]);

  const openRecentProject = useCallback(
    async (entry: RecentProjectEntry) => {
      await runAfterUnsavedCheck("最近使ったプロジェクトを開く", async () => {
        try {
          openLoadedProject(await openProjectFromPath(entry.path));
        } catch (error) {
          setAppError(classifyAppError(error, "最近使ったプロジェクトの読み込み"));
        }
      });
    },
    [openLoadedProject, runAfterUnsavedCheck],
  );

  const returnHome = useCallback(async () => {
    await runAfterUnsavedCheck("ホーム画面へ戻る", () => {
      setDocumentOpen(false);
      setPreview(null);
    });
  }, [runAfterUnsavedCheck]);

  const recoverCandidate = useCallback(
    (candidate: RecoveryCandidate) => {
      if (!candidate.valid || !candidate.project) return;
      setProject(candidate.project);
      setProjectPath(null);
      latestProjectPathRef.current = null;
      editor?.commands.setContent(
        hydrateImageSources(candidate.project.editorContent, candidate.project.assets) as Content,
      );
      setDocumentOpen(true);
      setSaveStatus("recovered");
      setRecoveryCandidates((current) =>
        current.filter((item) => item.fileName !== candidate.fileName),
      );
    },
    [editor],
  );

  const dismissRecoveryCandidate = useCallback((candidate: RecoveryCandidate) => {
    setRecoveryCandidates((current) =>
      current.filter((item) => item.fileName !== candidate.fileName),
    );
  }, []);

  const deleteRecoveryCandidate = useCallback(async (candidate: RecoveryCandidate) => {
    await deleteRecoveryFile(candidate.fileName).catch(() => undefined);
    setRecoveryCandidates((current) =>
      current.filter((item) => item.fileName !== candidate.fileName),
    );
  }, []);

  const applyPreview = useCallback(() => {
    if (!preview || !editor) return;
    if (preview.warnings.some((warning) => warning.severity === "error")) return;
    editor.commands.setContent(preview.document.sanitizedHtml);
    setProject((current) =>
      markProjectUpdated({
        ...current,
        metadata: {
          ...current.metadata,
          title: preview.sourceInfo.name.replace(/\.docx$/i, ""),
          sourceFileName: preview.sourceInfo.name,
          importedAt: preview.sourceInfo.inspectedAt,
        },
        editorContent: stripRuntimeImageSources(editor.getJSON()),
        pageSettings: preview.pageSettings,
        paragraphSettings: preview.paragraphSettings,
        header: preview.header,
        footer: preview.footer,
        assets: mergeAssets(current.assets, preview.assets),
        warnings: preview.warnings,
        classifications: preview.document.blocks.map((block) => block.classification),
      }),
    );
    setPreview(null);
    setDocumentOpen(true);
    setSaveStatus("dirty");
  }, [editor, preview]);

  const exportDocx = useCallback(async () => {
    const exportDocument = projectToExportDocument(project);
    const warnings = project.warnings.filter((warning) => warning.severity !== "info");
    if (warnings.length > 0 && !confirm(`${warnings.length}件の警告があります。続行しますか？`))
      return;
    try {
      const base64 = await exportDocumentToDocxBase64(exportDocument);
      const path = await writeBinaryFileWithDialog(
        `${project.metadata.title || "document"}.docx`,
        base64,
      );
      if (path) {
        setProject((current) => ({ ...current, lastExportedAt: new Date().toISOString() }));
      }
    } catch (error) {
      setAppError(classifyAppError(error, "DOCX書き出し"));
    }
  }, [project]);

  useEffect(() => {
    if (saveStatus !== "dirty" && saveStatus !== "autosave-pending") return;
    setSaveStatus("autosave-pending");
    const timeout = window.setTimeout(() => {
      void enqueueSave(async () => {
        const projectToSave = projectForSave(
          latestProjectRef.current,
          editingPreferencesRef.current,
        );
        const revision = autosaveRevisionRef.current + 1;
        autosaveRevisionRef.current = revision;
        const projectKey = createProjectKey(
          latestProjectPathRef.current,
          sessionProjectKeyRef.current,
        );
        const envelope = createAutosaveEnvelope({
          project: projectToSave,
          projectKey,
          projectPath: latestProjectPathRef.current,
          revision,
          lastExplicitSaveAt,
        });
        const fileName = autosaveFileName(projectKey);
        const autosaveHash = envelope.contentHash;
        try {
          setSaveStatus("autosaving");
          await writeProjectAutosave(fileName, serializeAutosaveEnvelope(envelope));
          setLastAutosaveAt(envelope.autosavedAt);
          const latestHash = projectContentHash(
            projectForSave(latestProjectRef.current, editingPreferencesRef.current),
          );
          setSaveStatus(latestHash === autosaveHash ? "autosaved" : "dirty");
        } catch {
          setSaveStatus("autosave-error");
        }
      });
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [enqueueSave, lastExplicitSaveAt, saveStatus]);

  const requestAppClose = useCallback(async () => {
    const canClose = await runAfterUnsavedCheck("アプリを終了", () => undefined);
    if (!canClose) return;
    closeInProgressRef.current = true;
    if (isTauriRuntime()) {
      await getCurrentWindow().destroy();
    }
  }, [runAfterUnsavedCheck]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ctrl = event.ctrlKey || event.metaKey;
      if (!ctrl) return;
      if (event.key === "n") {
        event.preventDefault();
        void newProject();
      } else if (event.key === "o") {
        event.preventDefault();
        void openProject();
      } else if (event.key === "s" && event.shiftKey) {
        event.preventDefault();
        void saveProjectAs();
      } else if (event.key === "s") {
        event.preventDefault();
        void saveProject();
      } else if (event.key === "f") {
        event.preventDefault();
        document.getElementById("search-input")?.focus();
      } else if (event.key === "h") {
        event.preventDefault();
        document.getElementById("replace-input")?.focus();
      } else if (event.key === ",") {
        event.preventDefault();
        openSettingsPanel();
      } else if (event.key === "q") {
        event.preventDefault();
        void requestAppClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newProject, openProject, openSettingsPanel, requestAppClose, saveProject, saveProjectAs]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    const appWindow = getCurrentWindow();
    const unlistenPromise = appWindow.onCloseRequested(async (event) => {
      if (closeInProgressRef.current) return;
      event.preventDefault();
      await requestAppClose();
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [requestAppClose]);

  function replaceFirst() {
    if (!editor || !searchTerm) return;
    const html = editor.getHTML();
    const replaced = html.replace(searchTerm, replaceTerm);
    if (html !== replaced) editor.commands.setContent(replaced);
  }

  async function openDocxImport() {
    await runAfterUnsavedCheck("DOCXを読み込む", async () => {
      try {
        const opened = await openDocxWithDialog();
        if (!opened) return;
        const converted = await convertDocxBase64ToImportResult(
          opened.base64,
          {
            name: opened.name,
            sizeBytes: opened.inspection.entries.reduce(
              (sum, entry) => sum + entry.compressed_size,
              0,
            ),
            path: opened.path,
            inspectedAt: new Date().toISOString(),
          },
          opened.inspection,
        );
        setPreview(converted);
      } catch (error) {
        setAppError(classifyAppError(error, "DOCX読み込み"));
      }
    });
  }

  async function insertImageFromPayload(payload: {
    name: string;
    base64: string;
    path?: string;
    mimeType?: string;
  }) {
    if (!editor) return;
    try {
      const asset = await imageAssetFromPayload(payload);
      const displaySize = fitImageSizeToPage(
        asset.originalWidthPx ?? asset.widthPx ?? 320,
        asset.originalHeightPx ?? asset.heightPx ?? 240,
      );
      const dataUrl = `data:${asset.mimeType};base64,${asset.dataBase64}`;
      editor
        .chain()
        .focus()
        .insertContent({
          type: "image",
          attrs: {
            src: dataUrl,
            assetId: asset.id,
            width: displaySize.widthPx,
            height: displaySize.heightPx,
            widthPx: displaySize.widthPx,
            heightPx: displaySize.heightPx,
            keepAspectRatio: true,
            alignment: "left",
            alt: asset.altText ?? asset.fileName ?? asset.name ?? "image",
            altText: asset.altText ?? asset.fileName ?? asset.name ?? "image",
          },
        })
        .run();
      setProject((current) =>
        markProjectUpdated({
          ...current,
          assets: mergeAssets(current.assets, [asset]),
          editorContent: stripRuntimeImageSources(editor.getJSON()),
        }),
      );
      setImageError(null);
      setSaveStatus("dirty");
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "画像の挿入に失敗しました。");
    }
  }

  async function insertImageWithDialog() {
    try {
      const opened = await openImageWithDialog();
      if (!opened) return;
      await insertImageFromPayload(opened);
    } catch {
      setImageError("画像ファイルを開けませんでした。");
    }
  }

  async function onImageSelected(file: File | undefined) {
    if (!file || !editor) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }
        reject(new Error("画像の読み込み結果が不正です"));
      };
      reader.onerror = () => {
        reject(reader.error ?? new Error("画像の読み込みに失敗しました"));
      };
      reader.readAsDataURL(file);
    });
    const [prefix, base64] = dataUrl.split(",", 2);
    await insertImageFromPayload({
      name: file.name,
      base64: base64 ?? "",
      mimeType: prefix?.match(/^data:([^;]+);base64$/)?.[1] ?? file.type,
    });
  }

  const previewBlocks =
    preview?.document.blocks.filter((block) => {
      if (onlyWarnings && block.warnings.length === 0) return false;
      if (onlyUncertain && block.classification.certainty !== "uncertain") return false;
      return true;
    }) ?? [];
  const hasImportErrors =
    preview?.warnings.some((warning) => warning.severity === "error") ?? false;
  const toolbarPosition = userPreferences.layout.toolbarPosition === "bottom" ? "bottom" : "top";
  const toolbar = userPreferences.layout.toolbarVisible ? (
    <EditorToolbar
      editor={editor}
      preferences={userPreferences.toolbar}
      position={toolbarPosition}
      onInsertImage={() => void insertImageWithDialog()}
      onInsertPageBreak={() => editor?.chain().focus().setPageBreak().run()}
    />
  ) : null;

  const renderLayoutRegion = (region: LayoutRegion) => {
    if (region === "sidebar") {
      return (
        <AppSidebar
          key="sidebar"
          items={outline}
          className={`sidebar-position-${userPreferences.layout.sidebarPosition}`}
        />
      );
    }
    if (region === "settings") {
      return (
        <SettingsPanel
          key="settings"
          className={`settings-position-${userPreferences.layout.settingsPosition}`}
          pageSettings={project.pageSettings}
          paragraphSettings={selectedParagraphSettings}
          tableCellSettings={selectedTableCellSettings}
          imageSettings={selectedImageSettings}
          header={project.header}
          footer={project.footer}
          userPreferences={userPreferences}
          preferenceSaveError={preferenceSaveError}
          showAdvancedEditingSettings={showAdvancedEditingSettings}
          canApplyToSelectedBlock={selectedParagraphEditable}
          canEditSelectedTableCell={selectedTableCellEditable}
          canEditSelectedImage={selectedImageEditable}
          imageError={imageError}
          onUpdatePreferences={updatePreferences}
          onUpdateEditingPreferences={setEditingPreferences}
          onToggleAdvancedEditingSettings={() =>
            setShowAdvancedEditingSettings((current) => !current)
          }
          onApplyPreferencesToDocumentDefaults={applyPreferencesToDocumentDefaults}
          onApplyPreferencesToSelectedBlock={applyPreferencesToSelectedBlock}
          onUpdatePageSettings={updatePageSettings}
          onUpdateSelectedParagraphSettings={updateSelectedParagraphSettings}
          onUpdateSelectedTableCellSettings={updateSelectedTableCellSettings}
          onUpdateSelectedImageSettings={updateSelectedImageSettings}
          onResetSelectedImageSize={resetSelectedImageSize}
          onDeleteSelectedImage={deleteSelectedImage}
          onUpdateHeader={updateHeader}
          onUpdateFooter={updateFooter}
        />
      );
    }
    return (
      <section
        key="editor"
        className={[
          "editor-shell",
          editingPreferences.showParagraphMarks ? "show-paragraph-marks" : "",
          editingPreferences.showHardBreakMarks ? "show-hard-break-marks" : "",
          editingPreferences.showPageBreakMarks ? "show-page-break-marks" : "",
          `empty-paragraph-${editingPreferences.emptyParagraphHeight}`,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {toolbarPosition === "top" ? toolbar : null}
        <div className="findbar">
          <input
            id="search-input"
            aria-label="検索"
            placeholder="検索"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          <input
            id="replace-input"
            aria-label="置換"
            placeholder="置換"
            value={replaceTerm}
            onChange={(event) => setReplaceTerm(event.target.value)}
          />
          <button type="button" onClick={replaceFirst}>
            置換
          </button>
        </div>
        <div
          className="editor-page-frame"
          style={pagePreviewStyle}
          data-orientation={project.pageSettings.orientation}
          aria-label="ページ表示"
        >
          {project.header.plainText.trim().length > 0 ? (
            <div className="page-header-preview" aria-label="Header preview">
              {project.header.plainText}
            </div>
          ) : null}
          <EditorContent editor={editor} />
          <div
            className={`page-footer-preview page-number-${project.footer.pageNumberPosition}`}
            aria-label="Footer preview"
          >
            {project.footer.plainText.trim().length > 0 ? (
              <span>{project.footer.plainText}</span>
            ) : null}
            {project.footer.pageNumberPosition !== "none" ? (
              <span className="page-number-preview">1 / {previewPageCount}</span>
            ) : null}
          </div>
        </div>
        {toolbarPosition === "bottom" ? toolbar : null}
      </section>
    );
  };

  const dismissGuide = () => {
    const next = dismissFirstRunGuide(onboardingState);
    setOnboardingState(next);
    setShowFirstRunGuide(false);
  };

  return (
    <main className="app" data-theme={resolvedColorMode} style={appVisualStyle}>
      {documentOpen && recoveryCandidates.length > 0 ? (
        <section className="recovery-panel" aria-label="復旧候補">
          <h2>復旧候補</h2>
          <p>
            自動保存または破損した復旧ファイルが見つかりました。通常保存ファイルは上書きしません。
          </p>
          <div className="recovery-list">
            {recoveryCandidates.map((candidate) => (
              <article
                key={`${candidate.kind}-${candidate.fileName}`}
                className={`recovery-candidate ${candidate.valid ? "" : "recovery-invalid"}`}
              >
                <h3>{candidate.kind === "autosave" ? "自動保存版" : "バックアップ版"}</h3>
                <dl>
                  <div>
                    <dt>ファイル</dt>
                    <dd>{candidate.fileName}</dd>
                  </div>
                  <div>
                    <dt>更新日時</dt>
                    <dd>{candidate.modifiedAt ?? candidate.envelope?.autosavedAt ?? "不明"}</dd>
                  </div>
                  <div>
                    <dt>サイズ</dt>
                    <dd>{candidate.byteSize.toLocaleString("ja-JP")} bytes</dd>
                  </div>
                  <div>
                    <dt>状態</dt>
                    <dd>{candidate.reason}</dd>
                  </div>
                </dl>
                <div className="button-row">
                  <button
                    type="button"
                    disabled={!candidate.valid}
                    onClick={() => recoverCandidate(candidate)}
                  >
                    自動保存版を復旧
                  </button>
                  <button type="button" onClick={() => dismissRecoveryCandidate(candidate)}>
                    通常保存版を開く
                  </button>
                  <button
                    type="button"
                    disabled={!candidate.valid}
                    onClick={() => recoverCandidate(candidate)}
                  >
                    バックアップ版を開く
                  </button>
                  <button type="button" onClick={() => void deleteRecoveryCandidate(candidate)}>
                    復旧候補を削除
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <AppTopbar
        title={project.metadata.title}
        saveStatus={saveStatus}
        characterCount={characterCount}
        darkModeChecked={userPreferences.appearance.colorMode === "dark"}
        showSaveStatus={userPreferences.layout.statusBarVisible}
        imageInputRef={imageInputRef}
        onTitleChange={(title) => {
          setProject((current) =>
            markProjectUpdated({
              ...current,
              metadata: { ...current.metadata, title },
            }),
          );
          setSaveStatus("dirty");
        }}
        onNewProject={() => void newProject()}
        onOpenProject={() => void openProject()}
        onSaveProject={() => void saveProject()}
        onSaveProjectAs={() => void saveProjectAs()}
        onImportDocx={() => void openDocxImport()}
        onExportDocx={() => void exportDocx()}
        onReturnHome={() => void returnHome()}
        onOpenSettings={openSettingsPanel}
        onOpenAbout={() => setShowAbout(true)}
        onQuit={() => void requestAppClose()}
        onDarkModeChange={(enabled) =>
          updatePreferences({
            appearance: { colorMode: enabled ? "dark" : "light" },
          })
        }
        onImageSelected={(file) => void onImageSelected(file)}
      />
      <div className="project-state-bar" aria-label="プロジェクト状態">
        <span>編集中: 内部プロジェクト</span>
        <span>現在の保存先: {projectPath ?? "未保存の新規文書"}</span>
        <span>元DOCX: {project.metadata.sourceFileName ?? "なし。元DOCXは直接変更しません。"}</span>
        <span>最終DOCX書き出し: {project.lastExportedAt ?? "未実行"}</span>
        <span>{hasUnsavedChanges(saveStatus) ? "未保存の変更あり" : "未保存の変更なし"}</span>
      </div>
      {lastAutosaveAt || lastExplicitSaveAt ? (
        <div className="save-timestamps" aria-label="保存日時">
          {lastExplicitSaveAt ? <span>明示保存: {lastExplicitSaveAt}</span> : null}
          {lastAutosaveAt ? <span>自動保存: {lastAutosaveAt}</span> : null}
        </div>
      ) : null}

      {documentOpen ? (
        <div
          className="workspace"
          data-layout-regions={layoutRegions.join(" ")}
          style={workspaceStyle}
        >
          {layoutRegions.map(renderLayoutRegion)}
        </div>
      ) : (
        <HomeScreen
          recentProjects={recentProjects.entries}
          recoveryCandidates={recoveryCandidates}
          onNewProject={() => void newProject()}
          onImportDocx={() => void openDocxImport()}
          onOpenProject={() => void openProject()}
          onOpenRecentProject={(entry) => void openRecentProject(entry)}
          onRemoveRecentProject={(path) =>
            setRecentProjects((current) => removeRecentProject(current, path))
          }
          onClearRecentProjects={() => setRecentProjects(clearRecentProjects())}
          onRecoverCandidate={recoverCandidate}
          onDeleteRecoveryCandidate={(candidate) => void deleteRecoveryCandidate(candidate)}
          onDismissRecoveryCandidate={dismissRecoveryCandidate}
        />
      )}

      {preview ? (
        <section className="modal" role="dialog" aria-modal="true" aria-label="変換確認">
          <div className="modal-panel">
            <h2>変換確認: {preview.sourceInfo.name}</h2>
            <dl className="preview-summary">
              <div>
                <dt>ファイルサイズ</dt>
                <dd>{preview.sourceInfo.sizeBytes.toLocaleString("ja-JP")} bytes</dd>
              </div>
              <div>
                <dt>見出し</dt>
                <dd>{preview.document.stats.headingCount}</dd>
              </div>
              <div>
                <dt>段落</dt>
                <dd>{preview.document.stats.paragraphCount}</dd>
              </div>
              <div>
                <dt>表</dt>
                <dd>{preview.document.stats.tableCount}</dd>
              </div>
              <div>
                <dt>画像</dt>
                <dd>{preview.document.stats.imageCount}</dd>
              </div>
              <div>
                <dt>保持画像</dt>
                <dd>{preview.document.stats.retainedImageCount}</dd>
              </div>
              <div>
                <dt>警告画像</dt>
                <dd>{preview.document.stats.warningImageCount}</dd>
              </div>
              <div>
                <dt>未対応形式</dt>
                <dd>
                  {preview.document.stats.unsupportedImageFormats.length > 0
                    ? preview.document.stats.unsupportedImageFormats.join(", ")
                    : "なし"}
                </dd>
              </div>
            </dl>
            {preview.warnings.length > 0 ? (
              <div className="warning-list" aria-label="ImportWarning一覧">
                {preview.warnings.map((warning, index) => (
                  <p
                    key={`${warning.code}-${warning.location ?? index}`}
                    className={`warning warning-${warning.severity}`}
                  >
                    [{warning.severity}] {warning.code}: {warning.message}
                    {warning.location ? ` (${warning.location})` : ""}
                  </p>
                ))}
              </div>
            ) : null}
            <div className="modal-actions">
              <label>
                <input
                  type="checkbox"
                  checked={onlyUncertain}
                  onChange={(event) => setOnlyUncertain(event.target.checked)}
                />
                未判定のみ
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={onlyWarnings}
                  onChange={(event) => setOnlyWarnings(event.target.checked)}
                />
                警告のみ
              </label>
              <button type="button" onClick={applyPreview} disabled={hasImportErrors}>
                読み込む
              </button>
              <button type="button" onClick={() => setPreview(null)}>
                キャンセル
              </button>
            </div>
            <div className="preview-list">
              {previewBlocks.map((block) => (
                <article key={block.id} className="preview-block">
                  <textarea value={block.text} onChange={() => undefined} aria-label="内容" />
                  <select
                    value={block.classification.blockType}
                    onChange={(event) => {
                      const blockType = event.target.value;
                      setPreview((current) =>
                        current
                          ? {
                              ...current,
                              document: {
                                ...current.document,
                                blocks: current.document.blocks.map((item) =>
                                  item.id === block.id
                                    ? {
                                        ...item,
                                        classification: {
                                          ...item.classification,
                                          blockType:
                                            blockType as typeof item.classification.blockType,
                                          ruleId: "user.override",
                                          reason: "User changed classification",
                                        },
                                      }
                                    : item,
                                ),
                              },
                            }
                          : current,
                      );
                    }}
                  >
                    {[
                      "document_title",
                      "subtitle",
                      "heading",
                      "paragraph",
                      "bullet_list",
                      "ordered_list",
                      "table",
                      "image",
                      "figure_caption",
                      "table_caption",
                      "reference",
                      "note",
                      "page_break",
                      "unknown",
                    ].map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="見出しレベル"
                    type="number"
                    min="1"
                    max="4"
                    value={block.classification.headingLevel ?? 1}
                    onChange={(event) => {
                      const level = Number(event.target.value);
                      setPreview((current) =>
                        current
                          ? {
                              ...current,
                              document: {
                                ...current.document,
                                blocks: current.document.blocks.map((item) =>
                                  item.id === block.id
                                    ? {
                                        ...item,
                                        classification: {
                                          ...item.classification,
                                          headingLevel:
                                            level >= 1 && level <= 4 ? level : undefined,
                                        },
                                      }
                                    : item,
                                ),
                              },
                            }
                          : current,
                      );
                    }}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setPreview((current) =>
                        current
                          ? {
                              ...current,
                              document: {
                                ...current.document,
                                blocks: current.document.blocks.filter(
                                  (item) => item.id !== block.id,
                                ),
                              },
                            }
                          : current,
                      )
                    }
                  >
                    削除
                  </button>
                  <p>{block.classification.reason}</p>
                  <p>{block.classification.certainty}</p>
                  {block.warnings.map((warning) => (
                    <p
                      key={`${warning.code}-${warning.location ?? warning.message}`}
                      className={`warning warning-${warning.severity}`}
                    >
                      {warning.code}: {warning.message}
                    </p>
                  ))}
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}
      {unsavedDialog ? (
        <UnsavedChangesDialog
          actionLabel={unsavedDialog.actionLabel}
          onChoose={(choice) => {
            unsavedDialog.resolve(choice);
            setUnsavedDialog(null);
          }}
        />
      ) : null}
      {appError ? <ErrorDialog error={appError} onClose={() => setAppError(null)} /> : null}
      {showFirstRunGuide ? <FirstRunGuide onClose={dismissGuide} /> : null}
      {showAbout ? (
        <AboutDialog
          projectPath={projectPath}
          recoveryDirectory={recoveryDirectory}
          onShowGuide={() => setShowFirstRunGuide(true)}
          onClose={() => setShowAbout(false)}
        />
      ) : null}
    </main>
  );
}

function HomeScreen({
  recentProjects,
  recoveryCandidates,
  onNewProject,
  onImportDocx,
  onOpenProject,
  onOpenRecentProject,
  onRemoveRecentProject,
  onClearRecentProjects,
  onRecoverCandidate,
  onDeleteRecoveryCandidate,
  onDismissRecoveryCandidate,
}: {
  recentProjects: RecentProjectEntry[];
  recoveryCandidates: RecoveryCandidate[];
  onNewProject: () => void;
  onImportDocx: () => void;
  onOpenProject: () => void;
  onOpenRecentProject: (entry: RecentProjectEntry) => void;
  onRemoveRecentProject: (path: string) => void;
  onClearRecentProjects: () => void;
  onRecoverCandidate: (candidate: RecoveryCandidate) => void;
  onDeleteRecoveryCandidate: (candidate: RecoveryCandidate) => void;
  onDismissRecoveryCandidate: (candidate: RecoveryCandidate) => void;
}) {
  return (
    <section className="home-screen" aria-label="ホーム">
      <div className="home-main">
        <h1>{APP_NAME}</h1>
        <p>
          内部プロジェクトを編集し、必要な時だけ新しいDOCXを書き出します。読み込んだ元DOCXは直接変更しません。
        </p>
        <div className="home-actions">
          <button type="button" onClick={onNewProject}>
            新規文書を作成
          </button>
          <button type="button" onClick={onImportDocx}>
            DOCXを読み込む
          </button>
          <button type="button" onClick={onOpenProject}>
            保存済みプロジェクトを開く
          </button>
        </div>
      </div>
      <section className="home-section" aria-label="最近使用したプロジェクト">
        <div className="section-heading-row">
          <h2>最近使用したプロジェクト</h2>
          <button
            type="button"
            onClick={onClearRecentProjects}
            disabled={recentProjects.length === 0}
          >
            履歴をすべて消去
          </button>
        </div>
        {recentProjects.length === 0 ? <p className="muted">履歴はまだありません。</p> : null}
        <div className="recent-list">
          {recentProjects.map((entry) => (
            <article key={entry.path} className="recent-entry">
              <div>
                <h3>{entry.displayName}</h3>
                <p>{entry.path}</p>
                <p>最後に開いた日時: {entry.lastOpenedAt}</p>
              </div>
              <div className="button-row">
                <button type="button" onClick={() => onOpenRecentProject(entry)}>
                  開く
                </button>
                <button type="button" onClick={() => onRemoveRecentProject(entry.path)}>
                  履歴から削除
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <RecoveryList
        candidates={recoveryCandidates}
        onRecoverCandidate={onRecoverCandidate}
        onDeleteRecoveryCandidate={onDeleteRecoveryCandidate}
        onDismissRecoveryCandidate={onDismissRecoveryCandidate}
      />
    </section>
  );
}

function RecoveryList({
  candidates,
  onRecoverCandidate,
  onDeleteRecoveryCandidate,
  onDismissRecoveryCandidate,
}: {
  candidates: RecoveryCandidate[];
  onRecoverCandidate: (candidate: RecoveryCandidate) => void;
  onDeleteRecoveryCandidate: (candidate: RecoveryCandidate) => void;
  onDismissRecoveryCandidate: (candidate: RecoveryCandidate) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <section className="home-section recovery-manager" aria-label="リカバリ管理">
      <h2>リカバリ可能な文書</h2>
      <p>復旧しても元のプロジェクトファイルへ即座には上書きしません。</p>
      <div className="recovery-list">
        {candidates.map((candidate) => (
          <article
            key={`${candidate.kind}-${candidate.fileName}`}
            className={`recovery-candidate ${candidate.valid ? "" : "recovery-invalid"}`}
          >
            <h3>{candidate.project?.metadata.title ?? candidate.fileName}</h3>
            <dl>
              <div>
                <dt>リカバリ保存日時</dt>
                <dd>{candidate.envelope?.autosavedAt ?? candidate.modifiedAt ?? "不明"}</dd>
              </div>
              <div>
                <dt>元のプロジェクトパス</dt>
                <dd>{candidate.envelope?.sourcePath ?? "未保存または不明"}</dd>
              </div>
              <div>
                <dt>リカバリファイル</dt>
                <dd>{candidate.path}</dd>
              </div>
              <div>
                <dt>検証状態</dt>
                <dd>{candidate.valid ? candidate.reason : "読み込み不能: " + candidate.reason}</dd>
              </div>
            </dl>
            <div className="button-row">
              <button
                type="button"
                disabled={!candidate.valid}
                onClick={() => onRecoverCandidate(candidate)}
              >
                復旧して開く
              </button>
              <button type="button" onClick={() => onDeleteRecoveryCandidate(candidate)}>
                内容を確認せず削除
              </button>
              <button type="button" onClick={() => onDismissRecoveryCandidate(candidate)}>
                後で判断する
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function UnsavedChangesDialog({
  actionLabel,
  onChoose,
}: {
  actionLabel: string;
  onChoose: (choice: UnsavedChoice) => void;
}) {
  return (
    <section className="modal" role="dialog" aria-modal="true" aria-label="未保存変更の確認">
      <div className="modal-panel narrow-modal">
        <h2>未保存の変更があります</h2>
        <p>{actionLabel} の前に、現在の内部プロジェクトを保存するか選んでください。</p>
        <p>「保存せず続行」は現在の編集内容を破棄します。</p>
        <div className="modal-actions">
          <button type="button" onClick={() => onChoose("save")}>
            保存する
          </button>
          <button type="button" className="danger-button" onClick={() => onChoose("discard")}>
            保存せず続行
          </button>
          <button type="button" onClick={() => onChoose("cancel")}>
            キャンセル
          </button>
        </div>
      </div>
    </section>
  );
}

function ErrorDialog({ error, onClose }: { error: UserFacingError; onClose: () => void }) {
  return (
    <section className="modal" role="dialog" aria-modal="true" aria-label="エラー">
      <div className="modal-panel narrow-modal">
        <h2>{error.title}</h2>
        <p>{error.summary}</p>
        <p>{error.currentContentState}</p>
        <p>{error.dataLossRisk}</p>
        <h3>次に試せる操作</h3>
        <ul>
          {error.nextActions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
        {error.technicalDetails ? (
          <details>
            <summary>技術的な詳細</summary>
            <textarea readOnly value={error.technicalDetails} />
          </details>
        ) : null}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </section>
  );
}

function FirstRunGuide({ onClose }: { onClose: () => void }) {
  return (
    <section className="modal" role="dialog" aria-modal="true" aria-label="初回起動案内">
      <div className="modal-panel narrow-modal">
        <h2>初回起動案内</h2>
        <ul>
          <li>このアプリはローカルで動作し、文書内容を外部送信しません。</li>
          <li>AI APIやクラウド変換サービスは使用しません。</li>
          <li>読み込んだ元DOCXは直接変更せず、新しいDOCXを書き出します。</li>
          <li>DOCX互換性は限定的で、未対応要素は警告として表示します。</li>
          <li>編集中の内部プロジェクトと書き出しDOCXは別物です。</li>
          <li>重要な文書では、書き出し後に内容を確認してください。</li>
        </ul>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            理解しました
          </button>
        </div>
      </div>
    </section>
  );
}

function AboutDialog({
  projectPath,
  recoveryDirectory,
  onShowGuide,
  onClose,
}: {
  projectPath: string | null;
  recoveryDirectory: string | null;
  onShowGuide: () => void;
  onClose: () => void;
}) {
  return (
    <section className="modal" role="dialog" aria-modal="true" aria-label="このアプリについて">
      <div className="modal-panel">
        <h2>{APP_NAME}</h2>
        <dl className="preview-summary">
          <div>
            <dt>バージョン</dt>
            <dd>{APP_VERSION}</dd>
          </div>
          <div>
            <dt>識別子</dt>
            <dd>{APP_IDENTIFIER}</dd>
          </div>
          <div>
            <dt>現在のプロジェクト</dt>
            <dd>{projectPath ?? "未保存"}</dd>
          </div>
          <div>
            <dt>リカバリ保存場所</dt>
            <dd>{recoveryDirectory ?? "取得できませんでした"}</dd>
          </div>
        </dl>
        <p>Personal Document Editorは完全ローカルで動作し、AI APIやクラウド変換を使用しません。</p>
        <h3>対応している主要機能</h3>
        <ul>
          {SUPPORTED_FEATURES.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
        <h3>主な未対応機能</h3>
        <ul>
          {UNSUPPORTED_FEATURES.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
        <h3>主要ライブラリ</h3>
        <p>{MAJOR_LIBRARIES.join(", ")}</p>
        <p>ライセンス情報は `package.json` と `src-tauri/Cargo.toml` から確認できます。</p>
        <div className="modal-actions">
          <button type="button" onClick={onShowGuide}>
            初回起動案内を再表示
          </button>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </section>
  );
}

function projectForSave(
  project: DocumentProject,
  preferences: UserEditingPreferences,
): DocumentProject {
  const editorContent = stripRuntimeImageSources(
    preferences.trimTrailingEmptyParagraphs
      ? trimTrailingEmptyParagraphsFromContent(project.editorContent)
      : project.editorContent,
  );
  return { ...project, editorContent };
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type JsonNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  text?: string;
  marks?: unknown;
};

function cloneNode(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => cloneNode(item));
  const node = value as JsonNode;
  return {
    ...node,
    attrs: node.attrs ? { ...node.attrs } : undefined,
    content: node.content?.map((child) => cloneNode(child) as JsonNode),
  };
}

function stripRuntimeImageSources(value: unknown): unknown {
  const cloned = cloneNode(value);
  stripRuntimeImageSourcesInPlace(cloned);
  return cloned;
}

function stripRuntimeImageSourcesInPlace(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(stripRuntimeImageSourcesInPlace);
    return;
  }
  const node = value as JsonNode;
  if (node.type === "image" && node.attrs) {
    const src = node.attrs.src;
    if (typeof src === "string" && src.startsWith("data:")) delete node.attrs.src;
  }
  node.content?.forEach(stripRuntimeImageSourcesInPlace);
}

function hydrateImageSources(value: unknown, assets: DocumentAsset[]): unknown {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const cloned = cloneNode(value);
  hydrateImageSourcesInPlace(cloned, assetById);
  return cloned;
}

function hydrateImageSourcesInPlace(value: unknown, assetById: Map<string, DocumentAsset>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => hydrateImageSourcesInPlace(item, assetById));
    return;
  }
  const node = value as JsonNode;
  if (node.type === "image" && node.attrs && typeof node.attrs.assetId === "string") {
    const asset = assetById.get(node.attrs.assetId);
    if (asset?.dataBase64) node.attrs.src = `data:${asset.mimeType};base64,${asset.dataBase64}`;
  }
  node.content?.forEach((child) => hydrateImageSourcesInPlace(child, assetById));
}

async function imageAssetFromPayload(payload: {
  name: string;
  base64: string;
  path?: string;
  mimeType?: string;
}): Promise<DocumentAsset> {
  const mimeType = supportedImageMimeType(payload.mimeType, payload.name, payload.base64);
  if (!mimeType) throw new Error("対応していない画像形式です。");
  const byteLength = base64ByteLength(payload.base64);
  if (byteLength <= 0) throw new Error("画像データが破損しています。");
  if (byteLength > MAX_INSERT_IMAGE_BYTES)
    throw new Error("画像ファイルサイズが上限を超えています。");
  const dimensions = await imageDimensionsFromDataUrl(`data:${mimeType};base64,${payload.base64}`);
  if (
    dimensions.widthPx > MAX_INSERT_IMAGE_DIMENSION_PX ||
    dimensions.heightPx > MAX_INSERT_IMAGE_DIMENSION_PX ||
    dimensions.widthPx * dimensions.heightPx > MAX_INSERT_IMAGE_PIXELS
  ) {
    throw new Error("画像寸法が上限を超えています。");
  }
  const checksum = checksumBase64(payload.base64);
  return {
    id: `asset-${checksum.replace(/[^a-zA-Z0-9]/g, "-")}`,
    kind: "image",
    name: payload.name,
    fileName: payload.name,
    mimeType,
    dataBase64: payload.base64,
    sizeBytes: byteLength,
    byteSize: byteLength,
    widthPx: dimensions.widthPx,
    heightPx: dimensions.heightPx,
    originalWidthPx: dimensions.widthPx,
    originalHeightPx: dimensions.heightPx,
    altText: payload.name,
    path: payload.path,
    checksum,
  };
}

function base64ByteLength(value: string): number {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return 0;
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
}

function supportedImageMimeType(
  explicitMimeType: string | undefined,
  fileName: string,
  base64: string,
): DocumentAsset["mimeType"] | null {
  const lowerName = fileName.toLowerCase();
  const fromExtension = lowerName.endsWith(".png")
    ? "image/png"
    : lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")
      ? "image/jpeg"
      : lowerName.endsWith(".gif")
        ? "image/gif"
        : lowerName.endsWith(".webp")
          ? "image/webp"
          : null;
  const fromMagic = imageMimeTypeFromMagic(base64);
  const candidate = explicitMimeType || fromExtension || fromMagic;
  if (
    candidate === "image/png" ||
    candidate === "image/jpeg" ||
    candidate === "image/gif" ||
    candidate === "image/webp"
  ) {
    if (fromMagic && fromMagic !== candidate) return null;
    return candidate;
  }
  return null;
}

function imageMimeTypeFromMagic(base64: string): DocumentAsset["mimeType"] | null {
  let bytes: string;
  try {
    bytes = atob(base64.slice(0, 32));
  } catch {
    return null;
  }
  if (bytes.startsWith("\x89PNG\r\n\x1A\n")) return "image/png";
  if (bytes.charCodeAt(0) === 0xff && bytes.charCodeAt(1) === 0xd8) return "image/jpeg";
  if (bytes.startsWith("GIF87a") || bytes.startsWith("GIF89a")) return "image/gif";
  if (bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

function imageDimensionsFromDataUrl(
  dataUrl: string,
): Promise<{ widthPx: number; heightPx: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve({ widthPx: image.naturalWidth, heightPx: image.naturalHeight });
    };
    image.onerror = () => reject(new Error("画像読み込みに失敗しました。"));
    image.src = dataUrl;
  });
}

function checksumBase64(base64: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < base64.length; index += 1) {
    hash ^= BigInt(base64.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function fitImageSizeToPage(
  widthPx: number,
  heightPx: number,
): { widthPx: number; heightPx: number } {
  const width = safeImageDimension(widthPx) ?? 320;
  const height = safeImageDimension(heightPx) ?? 240;
  if (width <= MAX_DISPLAY_IMAGE_WIDTH_PX) return { widthPx: width, heightPx: height };
  const ratio = height / width;
  return {
    widthPx: MAX_DISPLAY_IMAGE_WIDTH_PX,
    heightPx: Math.max(1, Math.round(MAX_DISPLAY_IMAGE_WIDTH_PX * ratio)),
  };
}

function createPagePreviewStyle(pageSettings: PageSettings): CSSProperties {
  const pxPerMm = 3.2;
  return {
    "--page-width": `${Math.round(pageSettings.widthMm * pxPerMm)}px`,
    "--page-min-height": `${Math.round(pageSettings.heightMm * pxPerMm)}px`,
    "--page-margin-top": `${pageSettings.margins.topMm}mm`,
    "--page-margin-right": `${pageSettings.margins.rightMm}mm`,
    "--page-margin-bottom": `${pageSettings.margins.bottomMm}mm`,
    "--page-margin-left": `${pageSettings.margins.leftMm}mm`,
  } as CSSProperties;
}

function countExplicitPages(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce<number>((count, child) => count + countExplicitPages(child), 0);
  }
  if (typeof value !== "object" || value === null) return 0;
  const node = value as { type?: unknown; content?: unknown };
  const self = node.type === "pageBreak" ? 1 : 0;
  return self + countExplicitPages(node.content);
}

function safeImageDimension(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 && rounded <= MAX_INSERT_IMAGE_DIMENSION_PX ? rounded : null;
}

function imageSettingsFromEditor(editor: Editor, assets: DocumentAsset[]): SelectedImageSettings {
  if (!editor.isActive("image")) return defaultSelectedImageSettings;
  const attrs = editor.getAttributes("image") as Record<string, unknown>;
  const assetId = typeof attrs.assetId === "string" ? attrs.assetId : null;
  const asset = assetId ? assets.find((candidate) => candidate.id === assetId) : undefined;
  const widthPx =
    safeImageDimension(attrs.widthPx) ??
    safeImageDimension(attrs.width) ??
    asset?.widthPx ??
    asset?.originalWidthPx ??
    320;
  const heightPx =
    safeImageDimension(attrs.heightPx) ??
    safeImageDimension(attrs.height) ??
    asset?.heightPx ??
    asset?.originalHeightPx ??
    240;
  const alignment =
    attrs.alignment === "center" || attrs.alignment === "right" || attrs.alignment === "left"
      ? attrs.alignment
      : "left";
  return {
    assetId,
    widthPx,
    heightPx,
    originalWidthPx: asset?.originalWidthPx ?? asset?.widthPx ?? null,
    originalHeightPx: asset?.originalHeightPx ?? asset?.heightPx ?? null,
    keepAspectRatio: attrs.keepAspectRatio !== false,
    alignment,
    altText:
      typeof attrs.altText === "string"
        ? attrs.altText
        : typeof attrs.alt === "string"
          ? attrs.alt
          : (asset?.altText ?? ""),
  };
}

function normalizeImageSettingsPatch(
  current: SelectedImageSettings,
  patch: Partial<SelectedImageSettings>,
): SelectedImageSettings {
  let widthPx = safeImageDimension(patch.widthPx) ?? current.widthPx;
  let heightPx = safeImageDimension(patch.heightPx) ?? current.heightPx;
  const keepAspectRatio = patch.keepAspectRatio ?? current.keepAspectRatio;
  if (keepAspectRatio && current.widthPx > 0 && current.heightPx > 0) {
    if (patch.widthPx !== undefined && patch.heightPx === undefined) {
      heightPx = Math.max(1, Math.round(widthPx * (current.heightPx / current.widthPx)));
    }
    if (patch.heightPx !== undefined && patch.widthPx === undefined) {
      widthPx = Math.max(1, Math.round(heightPx * (current.widthPx / current.heightPx)));
    }
  }
  return {
    ...current,
    ...patch,
    widthPx,
    heightPx,
    keepAspectRatio,
    alignment:
      patch.alignment === "left" || patch.alignment === "center" || patch.alignment === "right"
        ? patch.alignment
        : current.alignment,
    altText: typeof patch.altText === "string" ? patch.altText : current.altText,
  };
}

function paragraphFormattingFromEditingPreferences(
  preferences: UserEditingPreferences,
  isHeading: boolean,
): ParagraphFormatting {
  const defaults = documentDefaultsFromEditingPreferences(preferences);
  const source = isHeading ? defaults.heading1 : defaults.bodyParagraph;
  return {
    spaceBeforePt: source.spacingBeforePt,
    spaceAfterPt: source.spacingAfterPt,
    lineSpacing: {
      type: "multiple",
      value: source.lineHeight ?? defaults.bodyParagraph.lineHeight,
    },
  };
}

function isParagraphFormattingEditable(editor: Editor): boolean {
  return editor.isActive("paragraph") || editor.isActive("heading");
}

function isTableCellEditable(editor: Editor): boolean {
  return editor.isActive("tableCell") || editor.isActive("tableHeader");
}

function paragraphFormattingFromEditor(editor: Editor): ParagraphSettings {
  const nodeType = editor.isActive("heading") ? "heading" : "paragraph";
  const attrs = editor.getAttributes(nodeType);
  const parsed = ParagraphSettingsSchema.safeParse(attrs.paragraphFormatting as unknown);
  return parsed.success
    ? normalizeParagraphSettingsPatch(defaultParagraphSettings, parsed.data)
    : defaultParagraphSettings;
}

function tableCellSettingsFromEditor(editor: Editor): TableCellSettings {
  const attrs = (
    editor.isActive("tableHeader")
      ? editor.getAttributes("tableHeader")
      : editor.getAttributes("tableCell")
  ) as Record<string, unknown>;
  const verticalAlignValue = attrs.verticalAlign;
  const backgroundColor =
    typeof attrs.backgroundColor === "string" && HexColorPattern.test(attrs.backgroundColor)
      ? attrs.backgroundColor.toUpperCase()
      : null;
  const verticalAlign =
    verticalAlignValue === "middle" || verticalAlignValue === "bottom" ? verticalAlignValue : "top";
  return { backgroundColor, verticalAlign };
}

function mergeAssets(current: DocumentAsset[], next: DocumentAsset[]): DocumentAsset[] {
  const assets = new Map(current.map((asset) => [asset.id, asset]));
  for (const asset of next) {
    assets.set(asset.id, asset);
  }
  return [...assets.values()];
}

function normalizePageSettingsPatch(
  current: PageSettings,
  patch: Partial<PageSettings>,
): PageSettings {
  const next: PageSettings = { ...current, ...patch };
  if (patch.size === "A4" || patch.size === "Letter") {
    const dimensions =
      patch.size === "A4" ? { widthMm: 210, heightMm: 297 } : { widthMm: 215.9, heightMm: 279.4 };
    next.widthMm = next.orientation === "landscape" ? dimensions.heightMm : dimensions.widthMm;
    next.heightMm = next.orientation === "landscape" ? dimensions.widthMm : dimensions.heightMm;
  }
  if (patch.marginsMm) {
    next.margins = {
      ...next.margins,
      topMm: patch.marginsMm.top,
      rightMm: patch.marginsMm.right,
      bottomMm: patch.marginsMm.bottom,
      leftMm: patch.marginsMm.left,
    };
  }
  if (patch.margins) {
    next.marginsMm = {
      top: patch.margins.topMm,
      right: patch.margins.rightMm,
      bottom: patch.margins.bottomMm,
      left: patch.margins.leftMm,
    };
  }
  if (patch.orientation) {
    const shortSide = Math.min(next.widthMm, next.heightMm);
    const longSide = Math.max(next.widthMm, next.heightMm);
    next.widthMm = patch.orientation === "landscape" ? longSide : shortSide;
    next.heightMm = patch.orientation === "landscape" ? shortSide : longSide;
  }
  return next;
}

function normalizeParagraphSettingsPatch(
  current: ParagraphSettings,
  patch: Partial<ParagraphSettings>,
): ParagraphSettings {
  const next: ParagraphSettings = { ...current, ...patch };
  if (next.hangingIndentMm !== undefined) delete next.firstLineIndentMm;
  if (next.firstLineIndentMm !== undefined) delete next.hangingIndentMm;
  if (next.lineSpacing === undefined) {
    next.lineSpacing = defaultParagraphSettings.lineSpacing;
  }
  return next;
}

function normalizeTableCellSettingsPatch(
  current: TableCellSettings,
  patch: Partial<TableCellSettings>,
): TableCellSettings {
  const backgroundColor =
    patch.backgroundColor === null
      ? null
      : typeof patch.backgroundColor === "string" && HexColorPattern.test(patch.backgroundColor)
        ? patch.backgroundColor.toUpperCase()
        : current.backgroundColor;
  const verticalAlign =
    patch.verticalAlign === "middle" ||
    patch.verticalAlign === "bottom" ||
    patch.verticalAlign === "top"
      ? patch.verticalAlign
      : current.verticalAlign;
  return { backgroundColor, verticalAlign };
}
