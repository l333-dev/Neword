import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Content, Editor } from "@tiptap/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

import {
  APP_IDENTIFIER,
  APP_NAME,
  APP_VERSION,
  MAJOR_LIBRARIES,
  SUPPORTED_FEATURES,
  UNSUPPORTED_FEATURES,
} from "./app/appInfo";
import { classifyAppError, type UserFacingError } from "./app/appErrors";
import { commandFromKeyboardEvent, isAppCommand, type AppCommand } from "./app/appCommands";
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
import {
  countCharacters,
  createDocumentStatistics,
  createOutline,
  type DocumentStatistics,
  type OutlineItem,
} from "./features/editor/outline";
import {
  findSearchMatches,
  replaceMatches,
  updateSearchHighlight,
  type SearchMatch,
  type SearchOptions,
} from "./features/editor/search";
import { useResolvedColorMode } from "./features/preferences/useResolvedColorMode";
import type { ImportPreview } from "./features/import-docx/importDocx";
import {
  openImageWithDialog,
  cleanupStaleEditLocks,
  cleanupTemporaryFiles,
  deleteAllBackups,
  deleteBackupFile,
  checkProjectEditLock,
  createProjectEditLock,
  deleteRecoveryFile,
  getAppDataPaths,
  getFileSnapshot,
  inspectOpenPath,
  listRecoveryFiles,
  listBackupFiles,
  listLegacyRecoveryFiles,
  migrateLegacyRecoveryFile,
  selectDocxPath,
  openDocxFromPathCancellable,
  cancelDocxImport,
  openProjectFromPath,
  openProjectWithDialog,
  openAppDataFolder,
  readBackupFile,
  readLegacyRecoveryFile,
  readRecoveryFile,
  recoveryDirPath,
  recoveryMigrationState,
  refreshProjectEditLock,
  releaseProjectEditLock,
  selectProjectSavePath,
  saveProjectToPath,
  saveProjectWithDialog,
  startupOpenPaths,
  writeRecoveryMigrationState,
  writeProjectAutosave,
  writeBinaryFileWithDialog,
  type AppDataPaths,
  type BackupFileInfo,
  type FileSnapshot,
  type ProjectEditLock,
  type ProjectEditLockStatus,
  type OpenDocxResult,
  type SaveStatus,
} from "./project/fileAccess";
import { deserializeProject, markProjectUpdated } from "./project/serialization";
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
  classifyDroppedOrOpenedPath,
  estimateSerializedSizeBytes,
  shouldSuggestNewordExtension,
} from "./project/saveSafety";
import {
  createExternalConflictRequest,
  type ExternalConflictChoice,
  type ExternalConflictRequest,
} from "./project/externalConflict";
import {
  lockStatusMessage,
  shouldWarnAboutEditLock,
  type EditLockChoice,
} from "./project/editLocks";
import {
  documentDefaultsFromEditingPreferences,
  type UserEditingPreferences,
} from "./stores/editingPreferences";
import { createPreferenceCssVariables } from "./preferences/appearance";
import { layoutGridColumns, resolveLayoutRegions, type LayoutRegion } from "./preferences/layout";
import {
  loadUserPreferences,
  resetUserPreferenceCategory,
  resetUserPreferences,
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

type EditLockDialogState = {
  path: string;
  status: ProjectEditLockStatus;
  resolve: (choice: EditLockChoice) => void;
} | null;

type EditLockOpenDecision = "editable" | "read-only" | "copy" | "cancel";

type DocxImportStage =
  | "idle"
  | "file-check"
  | "zip-inspection"
  | "ooxml-extraction"
  | "asset-extraction"
  | "mammoth"
  | "sanitize"
  | "classification"
  | "model"
  | "preview"
  | "cancelled";

const DOCX_IMPORT_STAGE_LABELS: Record<DocxImportStage, string> = {
  idle: "待機中",
  "file-check": "ファイル確認",
  "zip-inspection": "ZIP安全検査",
  "ooxml-extraction": "OOXML情報抽出",
  "asset-extraction": "画像アセット抽出",
  mammoth: "Mammoth HTML変換",
  sanitize: "HTMLサニタイズ",
  classification: "文書分類",
  model: "内部モデル生成",
  preview: "プレビュー準備",
  cancelled: "キャンセル済み",
};

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
  const [selectionAnchor, setSelectionAnchor] = useState(0);
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
  const [warningSeverityFilter, setWarningSeverityFilter] = useState<
    "all" | "info" | "warning" | "error"
  >("all");
  const [warningCategoryFilter, setWarningCategoryFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(-1);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lastReplaceCount, setLastReplaceCount] = useState<number | null>(null);
  const [lastAutosaveAt, setLastAutosaveAt] = useState<string | null>(null);
  const [lastExplicitSaveAt, setLastExplicitSaveAt] = useState<string | null>(null);
  const [recoveryCandidates, setRecoveryCandidates] = useState<RecoveryCandidate[]>([]);
  const [appDataPaths, setAppDataPaths] = useState<AppDataPaths | null>(null);
  const [backupFiles, setBackupFiles] = useState<BackupFileInfo[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [lastFileSnapshot, setLastFileSnapshot] = useState<FileSnapshot | null>(null);
  const [savingSizeBytes, setSavingSizeBytes] = useState<number | null>(null);
  const [readOnlyReason, setReadOnlyReason] = useState<string | null>(null);
  const [activeEditLock, setActiveEditLock] = useState<ProjectEditLock | null>(null);
  const [externalConflict, setExternalConflict] = useState<ExternalConflictRequest | null>(null);
  const [editLockDialog, setEditLockDialog] = useState<EditLockDialogState>(null);
  const [resolveExternalConflict, setResolveExternalConflict] = useState<
    ((choice: ExternalConflictChoice) => void) | null
  >(null);
  const [docxModuleStatus, setDocxModuleStatus] = useState<"idle" | "loading" | "error">("idle");
  const [docxImportStage, setDocxImportStage] = useState<DocxImportStage>("idle");
  const [docxImportStartedAt, setDocxImportStartedAt] = useState<number | null>(null);
  const [docxImportCancelToken, setDocxImportCancelToken] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const shouldFocusSettingsRef = useRef(false);
  const editingPreferencesRef = useRef(editingPreferences);
  const latestProjectRef = useRef(project);
  const latestProjectPathRef = useRef(projectPath);
  const lastFileSnapshotRef = useRef<FileSnapshot | null>(null);
  const activeEditLockRef = useRef<ProjectEditLock | null>(null);
  const docxImportCancelTokenRef = useRef<string | null>(null);
  const activeImportWorkerCancelRef = useRef<(() => void) | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const closeInProgressRef = useRef(false);
  const autosaveRevisionRef = useRef(0);
  const sessionProjectKeyRef = useRef(`session-${crypto.randomUUID()}`);
  editingPreferencesRef.current = editingPreferences;
  latestProjectRef.current = project;
  latestProjectPathRef.current = projectPath;
  lastFileSnapshotRef.current = lastFileSnapshot;
  activeEditLockRef.current = activeEditLock;
  const extensions = useMemo(() => createEditorExtensions(() => editingPreferencesRef.current), []);

  const editor = useEditor({
    extensions,
    content: project.editorContent as Content,
    editable: readOnlyReason === null,
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
      setSelectionAnchor(currentEditor.state.selection.from);
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
      setSelectionAnchor(currentEditor.state.selection.from);
    },
  });

  useEffect(() => {
    const editable = readOnlyReason === null;
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, readOnlyReason]);

  const outline = useMemo<OutlineItem[]>(() => {
    if (!editor) return createOutline(project.editorContent);
    const items: OutlineItem[] = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name !== "heading") return true;
      const level = typeof node.attrs.level === "number" ? node.attrs.level : 1;
      items.push({
        id: `heading-${position}`,
        level,
        text: node.textContent.trim() || "(無題の見出し)",
        position,
      });
      return false;
    });
    return items;
  }, [editor, project.editorContent]);
  const characterCount = useMemo(
    () => countCharacters(project.editorContent),
    [project.editorContent],
  );
  const documentStatistics = useMemo<DocumentStatistics>(
    () => createDocumentStatistics(project.editorContent),
    [project.editorContent],
  );
  const activeOutlineItemId = useMemo(() => {
    let active: OutlineItem | null = null;
    for (const item of outline) {
      if (item.position === undefined || item.position > selectionAnchor) continue;
      if (!active || (item.position ?? 0) >= (active.position ?? 0)) active = item;
    }
    return active?.id ?? null;
  }, [outline, selectionAnchor]);
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
    if (!editor || !searchOpen || searchTerm.length === 0) {
      if (editor) updateSearchHighlight(editor, [], -1);
      setSearchMatches([]);
      setCurrentSearchIndex(-1);
      setSearchError(null);
      return;
    }
    const result = findSearchMatches(editor.state.doc, searchTerm, searchOptions);
    setSearchMatches(result.matches);
    setSearchError(
      result.error ?? (result.truncated ? "一致が多いため1000件まで表示します。" : null),
    );
    const nextIndex =
      result.matches.length > 0
        ? Math.min(Math.max(currentSearchIndex, 0), result.matches.length - 1)
        : -1;
    setCurrentSearchIndex(nextIndex);
    updateSearchHighlight(editor, result.matches, nextIndex);
  }, [currentSearchIndex, editor, project.editorContent, searchOpen, searchOptions, searchTerm]);

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
    getAppDataPaths()
      .then((paths) => {
        if (!cancelled) {
          setAppDataPaths(paths);
          setRecoveryDirectory(paths.recovery_dir);
        }
      })
      .catch(async () => {
        try {
          const path = await recoveryDirPath();
          if (!cancelled) setRecoveryDirectory(path);
        } catch {
          if (!cancelled) setRecoveryDirectory(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshBackupFiles = useCallback(async () => {
    try {
      setBackupFiles(await listBackupFiles());
    } catch {
      setBackupFiles([]);
    }
  }, []);

  useEffect(() => {
    void refreshBackupFiles();
  }, [refreshBackupFiles]);

  useEffect(() => {
    let cancelled = false;
    async function migrateLegacyRecovery() {
      try {
        const state = await recoveryMigrationState();
        if (state.completed) return;
        const legacyFiles = await listLegacyRecoveryFiles();
        let migratedCount = 0;
        let invalidCount = 0;
        const warnings: string[] = [];
        for (const file of legacyFiles) {
          try {
            const text = await readLegacyRecoveryFile(file.name);
            const candidate = recoveryCandidateFromAutosave(file, text, latestProjectRef.current);
            if (!candidate.valid) {
              invalidCount += 1;
              warnings.push(`invalid:${file.name}`);
              continue;
            }
            await migrateLegacyRecoveryFile(file.name);
            migratedCount += 1;
          } catch {
            invalidCount += 1;
            warnings.push(`invalid:${file.name}`);
          }
        }
        await writeRecoveryMigrationState({
          completed: true,
          checked_at: new Date().toISOString(),
          migrated_count: migratedCount,
          invalid_count: invalidCount,
          warnings,
        });
        if (!cancelled && invalidCount > 0) {
          setAppError({
            kind: "unknown",
            title: "旧リカバリ移行の一部を確認できませんでした",
            summary: `${invalidCount}件の旧リカバリデータが破損または不正な形式でした。旧ファイルは削除していません。`,
            currentContentState: "現在開いている文書は変更していません。",
            dataLossRisk: "破損候補は自動削除していないため、必要なら手動で確認できます。",
            nextActions: ["リカバリ管理を確認する", "通常保存済みプロジェクトを開く"],
            technicalDetails: warnings.join("\n"),
          });
        }
      } catch {
        if (!cancelled) {
          setAppError({
            kind: "unknown",
            title: "旧リカバリ移行を完了できませんでした",
            summary: "旧一時ディレクトリからapp dataへの移行中にエラーが発生しました。",
            currentContentState: "現在開いている文書は変更していません。",
            dataLossRisk: "旧リカバリファイルは削除していません。",
            nextActions: ["アプリを再起動して再試行する", "保存済みプロジェクトを開く"],
            technicalDetails: null,
          });
        }
      }
    }
    void migrateLegacyRecovery();
    return () => {
      cancelled = true;
    };
  }, []);

  const updatePreferences = useCallback((update: UserPreferencesUpdate) => {
    setUserPreferences((current) => updateUserPreferences(current, update));
  }, []);

  const resetPreferenceCategory = useCallback(
    (category: "appearance" | "layout" | "toolbar" | "editing") => {
      if (!confirm(`${category} 設定だけを初期化します。現在の文書内容は変更しません。`)) return;
      setUserPreferences((current) => resetUserPreferenceCategory(current, category));
    },
    [],
  );

  const resetAllPreferences = useCallback(() => {
    if (!confirm("すべてのユーザー設定を初期化します。現在の文書内容は変更しません。")) return;
    setUserPreferences(resetUserPreferences());
  }, []);

  const resetOnboarding = useCallback(() => {
    if (!confirm("初回案内の表示済み状態だけを初期化します。")) return;
    const next = {
      ...onboardingState,
      firstRunGuideDismissed: false,
      updatedAt: new Date().toISOString(),
    };
    setOnboardingState(next);
    setShowFirstRunGuide(true);
  }, [onboardingState]);

  const deleteAllValidRecovery = useCallback(async () => {
    const targets = recoveryCandidates.filter((candidate) => candidate.valid);
    if (
      !confirm(
        `正常なリカバリ ${targets.length}件を削除します。保存済みプロジェクトは削除しません。`,
      )
    )
      return;
    for (const candidate of targets)
      await deleteRecoveryFile(candidate.fileName).catch(() => undefined);
    setRecoveryCandidates((current) => current.filter((candidate) => !candidate.valid));
  }, [recoveryCandidates]);

  const deleteInvalidRecovery = useCallback(async () => {
    const targets = recoveryCandidates.filter((candidate) => !candidate.valid);
    if (!confirm(`壊れたリカバリ ${targets.length}件だけを削除します。`)) return;
    for (const candidate of targets)
      await deleteRecoveryFile(candidate.fileName).catch(() => undefined);
    setRecoveryCandidates((current) => current.filter((candidate) => candidate.valid));
  }, [recoveryCandidates]);

  const cleanupTemporaryData = useCallback(async () => {
    try {
      const result = await cleanupTemporaryFiles();
      alert(
        `一時ファイル整理: ${result.deleted_count}件 / ${result.deleted_bytes.toLocaleString("ja-JP")} bytes 削除、失敗 ${result.failed_count}件`,
      );
    } catch (error) {
      setAppError(classifyAppError(error, "一時ファイル整理"));
    }
  }, []);

  const cleanupStaleLocks = useCallback(async () => {
    try {
      const result = await cleanupStaleEditLocks();
      alert(`staleロック整理: ${result.deleted_count}件削除、失敗 ${result.failed_count}件`);
    } catch (error) {
      setAppError(classifyAppError(error, "編集ロック整理"));
    }
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

  const loadDocxExportModules = useCallback(async () => {
    try {
      setDocxModuleStatus("loading");
      const [writer, exporter] = await Promise.all([
        import("./features/export-docx/docxWriter"),
        import("./features/export-docx/exportDocument"),
      ]);
      setDocxModuleStatus("idle");
      return { writer, exporter };
    } catch (error) {
      setDocxModuleStatus("error");
      setAppError(classifyAppError(error, "DOCX書き出し準備"));
      throw error;
    }
  }, []);

  const askExternalConflictChoice = useCallback(
    (request: ExternalConflictRequest): Promise<ExternalConflictChoice> => {
      return new Promise((resolve) => {
        setExternalConflict(request);
        setResolveExternalConflict(() => resolve);
      });
    },
    [],
  );

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

  const releaseActiveEditLock = useCallback(async () => {
    const lock = activeEditLockRef.current;
    const path = latestProjectPathRef.current;
    if (!lock || !path) return;
    await releaseProjectEditLock(path, lock.lock_id).catch(() => undefined);
    setActiveEditLock(null);
  }, []);

  const askEditLockChoice = useCallback(
    (path: string, status: ProjectEditLockStatus): Promise<EditLockChoice> =>
      new Promise((resolve) => {
        setEditLockDialog({ path, status, resolve });
      }),
    [],
  );

  const acquireEditLockForPath = useCallback(
    async (path: string): Promise<EditLockOpenDecision> => {
      try {
        const status = await checkProjectEditLock(path);
        if (shouldWarnAboutEditLock(status)) {
          const choice = await askEditLockChoice(path, status);
          if (choice === "read-only") {
            setReadOnlyReason(status.reason);
            setActiveEditLock(null);
            return "read-only";
          }
          if (choice === "copy") {
            setReadOnlyReason(null);
            setActiveEditLock(null);
            return "copy";
          }
          if (choice === "cancel") return "cancel";
        }
        const lock = await createProjectEditLock({
          projectPath: path,
          sessionId: sessionProjectKeyRef.current,
          appVersion: APP_VERSION,
          keepDisplayPath: true,
        });
        setReadOnlyReason(null);
        setActiveEditLock(lock);
        return "editable";
      } catch {
        setReadOnlyReason(null);
        setActiveEditLock(null);
        return "editable";
      }
    },
    [askEditLockChoice],
  );

  const saveProject = useCallback(async (): Promise<boolean> => {
    return enqueueSave(async () => {
      if (readOnlyReason) {
        setSaveStatus("dirty");
        setAppError({
          kind: "permission_denied",
          title: "読み取り専用です",
          summary: "このプロジェクトは読み取り専用で開いているため、通常保存できません。",
          currentContentState: "現在の文書内容は画面上に残っています。",
          dataLossRisk: "元ファイルは変更していません。",
          nextActions: ["名前を付けて保存で複製を作成してください。"],
          technicalDetails: readOnlyReason,
        });
        return false;
      }
      setSaveStatus("saving");
      const projectToSave = projectForSave(latestProjectRef.current, editingPreferencesRef.current);
      const serializedSize = estimateSerializedSizeBytes(JSON.stringify(projectToSave));
      setSavingSizeBytes(serializedSize);
      const saveHash = projectContentHash(projectToSave);
      try {
        const currentPath = latestProjectPathRef.current;
        if (currentPath) {
          const currentSnapshot = await getFileSnapshot(currentPath).catch(() => null);
          const conflictRequest = createExternalConflictRequest({
            path: currentPath,
            previous: lastFileSnapshotRef.current,
            current: currentSnapshot,
          });
          if (conflictRequest) {
            const choice = await askExternalConflictChoice(conflictRequest);
            if (choice === "cancel") {
              setSaveStatus("dirty");
              return false;
            }
            if (choice === "reload") {
              const loaded = await openProjectFromPath(currentPath);
              setProject(loaded.project);
              setProjectPath(loaded.path);
              latestProjectPathRef.current = loaded.path;
              setLastExplicitSaveAt(new Date().toISOString());
              setLastAutosaveAt(null);
              setLastFileSnapshot(await getFileSnapshot(loaded.path).catch(() => null));
              editor?.commands.setContent(
                hydrateImageSources(loaded.project.editorContent, loaded.project.assets) as Content,
              );
              setDocumentOpen(true);
              setSaveStatus("saved");
              rememberRecentProject(loaded.path, loaded.project.metadata.title);
              return false;
            }
            if (choice === "save-as") {
              const path = await saveProjectWithDialog(projectToSave);
              if (!path) {
                setSaveStatus("dirty");
                return false;
              }
              setProjectPath(path);
              latestProjectPathRef.current = path;
              rememberRecentProject(path, projectToSave.metadata.title);
            } else if (choice === "overwrite") {
              const confirmed = confirm(
                "外部で変更されたファイルを上書きします。保存前バックアップを作成してから続行しますか？",
              );
              if (!confirmed) {
                setSaveStatus("dirty");
                return false;
              }
              await saveProjectToPath(currentPath, projectToSave);
            }
          } else {
            await saveProjectToPath(currentPath, projectToSave);
          }
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
          const snapshot = await getFileSnapshot(latestProjectPathRef.current).catch(() => null);
          setLastFileSnapshot(snapshot);
          await refreshBackupFiles();
        }
        if (
          latestProjectPathRef.current &&
          shouldSuggestNewordExtension(latestProjectPathRef.current)
        ) {
          setAppError({
            kind: "unknown",
            title: ".neword形式への保存を推奨します",
            summary:
              "従来のJSONプロジェクトとして保存しました。次回の名前を付けて保存では .neword を選ぶことを推奨します。",
            currentContentState: "現在の保存は完了しています。",
            dataLossRisk: "既存のJSONプロジェクト互換性は維持されています。",
            nextActions: ["名前を付けて保存で .neword を選ぶ", "このまま .json として使い続ける"],
            technicalDetails: null,
          });
        }
        return true;
      } catch (error) {
        setSaveStatus("error");
        setAppError(classifyAppError(error, "プロジェクト保存"));
        return false;
      } finally {
        setSavingSizeBytes(null);
      }
    });
  }, [
    askExternalConflictChoice,
    editor,
    enqueueSave,
    readOnlyReason,
    refreshBackupFiles,
    rememberRecentProject,
  ]);

  const saveProjectAs = useCallback(async (): Promise<boolean> => {
    return enqueueSave(async () => {
      setSaveStatus("saving");
      const projectToSave = projectForSave(latestProjectRef.current, editingPreferencesRef.current);
      setSavingSizeBytes(estimateSerializedSizeBytes(JSON.stringify(projectToSave)));
      const saveHash = projectContentHash(projectToSave);
      let newLock: ProjectEditLock | null = null;
      let newLockPath: string | null = null;
      try {
        const path = await selectProjectSavePath(projectToSave);
        if (path) {
          const currentPath = latestProjectPathRef.current;
          const isCurrentPath = currentPath === path;
          if (!isCurrentPath) {
            const status = await checkProjectEditLock(path);
            if (shouldWarnAboutEditLock(status)) {
              const choice = await askEditLockChoice(path, status);
              if (choice !== "force-edit") {
                setSaveStatus("dirty");
                return false;
              }
            }
            newLock = await createProjectEditLock({
              projectPath: path,
              sessionId: sessionProjectKeyRef.current,
              appVersion: APP_VERSION,
              keepDisplayPath: true,
            });
            newLockPath = path;
          }
          await saveProjectToPath(path, projectToSave);
          if (!isCurrentPath) {
            await releaseActiveEditLock();
            setReadOnlyReason(null);
            setActiveEditLock(newLock);
          }
          setProjectPath(path);
          latestProjectPathRef.current = path;
          const savedAt = new Date().toISOString();
          setLastExplicitSaveAt(savedAt);
          const latestHash = projectContentHash(
            projectForSave(latestProjectRef.current, editingPreferencesRef.current),
          );
          setSaveStatus(latestHash === saveHash ? "saved" : "dirty");
          rememberRecentProject(path, projectToSave.metadata.title);
          setLastFileSnapshot(await getFileSnapshot(path).catch(() => null));
          await refreshBackupFiles();
          return true;
        } else {
          setSaveStatus("dirty");
          return false;
        }
      } catch (error) {
        if (newLock && newLockPath) {
          await releaseProjectEditLock(newLockPath, newLock.lock_id).catch(() => undefined);
        }
        setSaveStatus("error");
        setAppError(classifyAppError(error, "プロジェクト別名保存"));
        return false;
      } finally {
        setSavingSizeBytes(null);
      }
    });
  }, [
    askEditLockChoice,
    enqueueSave,
    refreshBackupFiles,
    releaseActiveEditLock,
    rememberRecentProject,
  ]);

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

  const createAndOpenNewProject = useCallback(async () => {
    await releaseActiveEditLock();
    const { project: next } = createBlankDocumentProject({ editingPreferences });
    setProject(next);
    setProjectPath(null);
    latestProjectPathRef.current = null;
    setLastFileSnapshot(null);
    setReadOnlyReason(null);
    setActiveEditLock(null);
    sessionProjectKeyRef.current = `session-${crypto.randomUUID()}`;
    setLastExplicitSaveAt(null);
    setLastAutosaveAt(null);
    editor?.commands.setContent(hydrateImageSources(next.editorContent, next.assets) as Content);
    setDocumentOpen(true);
    setSaveStatus("dirty");
  }, [editingPreferences, editor, releaseActiveEditLock]);

  const newProject = useCallback(async () => {
    await runAfterUnsavedCheck("新規文書を作成", createAndOpenNewProject);
  }, [createAndOpenNewProject, runAfterUnsavedCheck]);

  const openLoadedProject = useCallback(
    async (loaded: { path: string; project: DocumentProject }) => {
      const candidate = await inspectOpenPath(loaded.path);
      if (!candidate.safe_to_read || candidate.kind !== "project") {
        throw new Error("プロジェクトファイルとして安全に開けません。");
      }
      await releaseActiveEditLock();
      const lockDecision = await acquireEditLockForPath(loaded.path);
      if (lockDecision === "cancel") return;
      const openAsCopy = lockDecision === "copy";
      setProject(loaded.project);
      setProjectPath(openAsCopy ? null : loaded.path);
      latestProjectPathRef.current = openAsCopy ? null : loaded.path;
      setLastExplicitSaveAt(openAsCopy ? null : new Date().toISOString());
      setLastAutosaveAt(null);
      setLastFileSnapshot(openAsCopy ? null : await getFileSnapshot(loaded.path).catch(() => null));
      editor?.commands.setContent(
        hydrateImageSources(loaded.project.editorContent, loaded.project.assets) as Content,
      );
      setDocumentOpen(true);
      setSaveStatus(openAsCopy ? "dirty" : "saved");
      if (!openAsCopy) rememberRecentProject(loaded.path, loaded.project.metadata.title);
    },
    [acquireEditLockForPath, editor, releaseActiveEditLock, rememberRecentProject],
  );

  const openProject = useCallback(async () => {
    await runAfterUnsavedCheck("別のプロジェクトを開く", async () => {
      try {
        const loaded = await openProjectWithDialog();
        if (!loaded) return;
        await openLoadedProject(loaded);
      } catch (error) {
        setAppError(classifyAppError(error, "プロジェクト読み込み"));
      }
    });
  }, [openLoadedProject, runAfterUnsavedCheck]);

  const openRecentProject = useCallback(
    async (entry: RecentProjectEntry) => {
      await runAfterUnsavedCheck("最近使ったプロジェクトを開く", async () => {
        try {
          await openLoadedProject(await openProjectFromPath(entry.path));
        } catch (error) {
          setAppError(classifyAppError(error, "最近使ったプロジェクトの読み込み"));
        }
      });
    },
    [openLoadedProject, runAfterUnsavedCheck],
  );

  async function convertOpenedDocxWithWorker(opened: OpenDocxResult, requestId: string) {
    const { convertOpenedDocxWithWorker: convertWithWorker } =
      await import("./features/import-docx/importWorkerPipeline");
    return convertWithWorker({
      opened,
      requestId,
      isActive: (activeRequestId) => docxImportCancelTokenRef.current === activeRequestId,
      onWorkerStage: (stage) => {
        if (stage === "mammoth-convert") setDocxImportStage("mammoth");
      },
      onCancelReady: (cancel) => {
        activeImportWorkerCancelRef.current = cancel;
      },
    });
  }

  const openPathWithUnsavedCheck = useCallback(
    async (path: string) => {
      await runAfterUnsavedCheck("ファイルを開く", async () => {
        const kind = classifyDroppedOrOpenedPath(path);
        try {
          const candidate = await inspectOpenPath(path);
          if (!candidate.safe_to_read) {
            throw new Error("指定ファイルを安全に開けません。");
          }
          if (kind === "project") {
            await openLoadedProject(await openProjectFromPath(path));
            return;
          }
          if (kind === "docx") {
            const requestId = crypto.randomUUID();
            setDocxImportCancelToken(requestId);
            docxImportCancelTokenRef.current = requestId;
            setDocxImportStartedAt(Date.now());
            setDocxImportStage("zip-inspection");
            const opened = await openDocxFromPathCancellable(path, requestId);
            if (docxImportCancelTokenRef.current !== requestId) return;
            setDocxImportStage("mammoth");
            const converted = await convertOpenedDocxWithWorker(opened, requestId);
            if (docxImportCancelTokenRef.current !== requestId || !converted) return;
            setDocxImportStage("preview");
            setPreview(converted);
            docxImportCancelTokenRef.current = null;
            activeImportWorkerCancelRef.current = null;
            setDocxImportCancelToken(null);
            setDocxImportStartedAt(null);
            setDocxImportStage("idle");
            return;
          }
          setAppError({
            kind: "unsupported_file_type",
            title: "対応していないファイルです",
            summary: ".neword、従来の .json プロジェクト、または .docx を指定してください。",
            currentContentState: "現在の文書は変更していません。",
            dataLossRisk: "ファイル内容は読み込んでいません。",
            nextActions: ["対応形式のファイルを選び直す"],
            technicalDetails: null,
          });
        } catch (error) {
          docxImportCancelTokenRef.current = null;
          activeImportWorkerCancelRef.current = null;
          setDocxImportCancelToken(null);
          setDocxImportStartedAt(null);
          setDocxImportStage("idle");
          setAppError(classifyAppError(error, "ファイル読み込み"));
        }
      });
    },
    [convertOpenedDocxWithWorker, openLoadedProject, runAfterUnsavedCheck],
  );

  const handleOpenPathArguments = useCallback(
    async (paths: string[]) => {
      const candidates = paths.filter((path) => path.trim().length > 0);
      if (candidates.length === 0) return;
      if (candidates.length > 1) {
        setAppError({
          kind: "unsupported_file_type",
          title: "複数ファイル指定には未対応です",
          summary: "安全のため、最初の対応ファイルだけを開きます。",
          currentContentState: "現在の文書は未保存変更保護の対象です。",
          dataLossRisk: "残りのファイルは読み込んでいません。",
          nextActions: ["必要なファイルを1つずつ開いてください。"],
          technicalDetails: null,
        });
      }
      await openPathWithUnsavedCheck(candidates[0] ?? "");
    },
    [openPathWithUnsavedCheck],
  );

  const restoreBackupAsUnsaved = useCallback(
    async (backup: BackupFileInfo) => {
      await runAfterUnsavedCheck("バックアップを開く", async () => {
        try {
          const projectFromBackup = deserializeProject(await readBackupFile(backup.id));
          setProject(projectFromBackup);
          setProjectPath(null);
          latestProjectPathRef.current = null;
          setLastFileSnapshot(null);
          editor?.commands.setContent(
            hydrateImageSources(
              projectFromBackup.editorContent,
              projectFromBackup.assets,
            ) as Content,
          );
          setDocumentOpen(true);
          setSaveStatus("recovered");
        } catch (error) {
          setAppError(classifyAppError(error, "バックアップ復元"));
        }
      });
    },
    [editor, runAfterUnsavedCheck],
  );

  const deleteBackup = useCallback(
    async (backup: BackupFileInfo) => {
      if (!confirm("このバックアップを削除しますか？通常のプロジェクトファイルは削除しません。")) {
        return;
      }
      try {
        await deleteBackupFile(backup.id);
        await refreshBackupFiles();
      } catch (error) {
        setAppError(classifyAppError(error, "バックアップ削除"));
      }
    },
    [refreshBackupFiles],
  );

  const deleteEveryBackup = useCallback(async () => {
    if (
      !confirm("すべてのバックアップを削除しますか？通常のプロジェクトファイルは削除しません。")
    ) {
      return;
    }
    try {
      await deleteAllBackups();
      await refreshBackupFiles();
    } catch (error) {
      setAppError(classifyAppError(error, "バックアップ全削除"));
    }
  }, [refreshBackupFiles]);

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
      setLastFileSnapshot(null);
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
    const warnings = project.warnings.filter((warning) => warning.severity !== "info");
    if (warnings.length > 0 && !confirm(`${warnings.length}件の警告があります。続行しますか？`))
      return;
    try {
      const { writer, exporter } = await loadDocxExportModules();
      const exportDocument = exporter.projectToExportDocument(project);
      const base64 = await writer.exportDocumentToDocxBase64(exportDocument);
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
  }, [loadDocxExportModules, project]);

  useEffect(() => {
    if (readOnlyReason) return;
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
  }, [enqueueSave, lastExplicitSaveAt, readOnlyReason, saveStatus]);

  const requestAppClose = useCallback(async () => {
    const canClose = await runAfterUnsavedCheck("アプリを終了", () => undefined);
    if (!canClose) return;
    closeInProgressRef.current = true;
    await releaseActiveEditLock();
    if (isTauriRuntime()) {
      await getCurrentWindow().destroy();
    }
  }, [releaseActiveEditLock, runAfterUnsavedCheck]);

  const executeAppCommand = useCallback(
    async (command: AppCommand) => {
      if (unsavedDialog || externalConflict) return;
      if (command === "file.new") await newProject();
      else if (command === "file.open") await openProject();
      else if (command === "file.save") await saveProject();
      else if (command === "file.save_as") await saveProjectAs();
      else if (command === "file.import_docx") await openDocxImport();
      else if (command === "file.export_docx") await exportDocx();
      else if (command === "file.home") await returnHome();
      else if (command === "file.close_window" || command === "file.quit") await requestAppClose();
      else if (command === "edit.undo") editor?.commands.undo();
      else if (command === "edit.redo") editor?.commands.redo();
      else if (command === "edit.find") setSearchOpen(true);
      else if (command === "view.toggle_sidebar")
        updatePreferences({ layout: { sidebarVisible: !userPreferences.layout.sidebarVisible } });
      else if (command === "view.toggle_toolbar")
        updatePreferences({ layout: { toolbarVisible: !userPreferences.layout.toolbarVisible } });
      else if (command === "view.toggle_settings")
        updatePreferences({ layout: { settingsVisible: !userPreferences.layout.settingsVisible } });
      else if (command === "view.theme_light")
        updatePreferences({ appearance: { colorMode: "light" } });
      else if (command === "view.theme_dark")
        updatePreferences({ appearance: { colorMode: "dark" } });
      else if (command === "view.theme_system")
        updatePreferences({ appearance: { colorMode: "system" } });
      else if (command === "document.insert_page_break")
        editor?.chain().focus().setPageBreak().run();
      else if (command === "document.page_settings" || command === "document.header_footer")
        openSettingsPanel();
      else if (command === "help.first_run") setShowFirstRunGuide(true);
      else if (command === "help.recovery" || command === "help.backups") setDocumentOpen(false);
      else if (command === "help.data_locations" || command === "help.about") setShowAbout(true);
    },
    [
      editor,
      externalConflict,
      exportDocx,
      newProject,
      openProject,
      openSettingsPanel,
      requestAppClose,
      returnHome,
      saveProject,
      saveProjectAs,
      unsavedDialog,
      updatePreferences,
      userPreferences.layout.settingsVisible,
      userPreferences.layout.sidebarVisible,
      userPreferences.layout.toolbarVisible,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        setSearchOpen(false);
        if (editor) updateSearchHighlight(editor, [], -1);
        return;
      }
      const command = commandFromKeyboardEvent(event);
      if (!command) return;
      event.preventDefault();
      void executeAppCommand(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editor, executeAppCommand, searchOpen]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    const unlistenMenu = listen<string>("neword://menu-command", (event) => {
      if (isAppCommand(event.payload)) void executeAppCommand(event.payload);
    });
    const unlistenOpenPaths = listen<{ paths: string[]; source: string }>(
      "neword://open-paths",
      (event) => {
        void handleOpenPathArguments(event.payload.paths);
      },
    );
    return () => {
      void unlistenMenu.then((unlisten) => unlisten());
      void unlistenOpenPaths.then((unlisten) => unlisten());
    };
  }, [executeAppCommand]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void startupOpenPaths()
      .then((paths) => handleOpenPathArguments(paths))
      .catch(() => undefined);
  }, [handleOpenPathArguments]);

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

  useEffect(() => {
    const interval = window.setInterval(() => {
      const lock = activeEditLockRef.current;
      const path = latestProjectPathRef.current;
      if (!lock || !path) return;
      void refreshProjectEditLock({ projectPath: path, lockId: lock.lock_id }).catch(
        () => undefined,
      );
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      void releaseActiveEditLock();
    };
  }, [releaseActiveEditLock]);

  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer) return;
      event.preventDefault();
      setDropActive(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (event.target === document.body || event.target === document.documentElement) {
        setDropActive(false);
      }
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      setDropActive(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length !== 1) {
        setAppError({
          kind: "unsupported_file_type",
          title: "複数ファイルのドロップには未対応です",
          summary: "安全のため、1回に1つの .neword、.json、.docx だけを開きます。",
          currentContentState: "現在の文書は変更していません。",
          dataLossRisk: "ドロップされたファイルは読み込んでいません。",
          nextActions: ["1ファイルだけをドロップする", "ファイルメニューから開く"],
          technicalDetails: null,
        });
        return;
      }
      const file = files[0];
      const path = (file as File & { path?: string }).path;
      if (!path) {
        setAppError({
          kind: "unsupported_file_type",
          title: "ファイルパスを取得できません",
          summary: "URLやブラウザ由来のデータはプロジェクトファイルとして扱いません。",
          currentContentState: "現在の文書は変更していません。",
          dataLossRisk: "ドロップされた内容は読み込んでいません。",
          nextActions: ["ファイルダイアログから開く"],
          technicalDetails: null,
        });
        return;
      }
      void openPathWithUnsavedCheck(path);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [openPathWithUnsavedCheck]);

  function moveSearch(delta: 1 | -1) {
    if (!editor || searchMatches.length === 0) return;
    const next = (currentSearchIndex + delta + searchMatches.length) % searchMatches.length;
    setCurrentSearchIndex(next);
    const match = searchMatches[next];
    if (match) {
      editor.commands.setTextSelection({ from: match.from, to: match.to });
      editor.commands.focus();
      editor.view.dom
        .querySelector(".search-match-current")
        ?.scrollIntoView({ block: "center", inline: "nearest" });
    }
  }

  function replaceCurrent() {
    if (!editor || readOnlyReason || currentSearchIndex < 0) return;
    const match = searchMatches[currentSearchIndex];
    if (!match) return;
    const count = replaceMatches(editor, [match], replaceTerm, searchOptions, 1);
    setLastReplaceCount(count);
    setSaveStatus(count > 0 ? "dirty" : saveStatus);
  }

  function replaceAll() {
    if (!editor || readOnlyReason) return;
    const count = replaceMatches(editor, searchMatches, replaceTerm, searchOptions);
    setLastReplaceCount(count);
    setSaveStatus(count > 0 ? "dirty" : saveStatus);
  }

  async function openDocxImport() {
    await runAfterUnsavedCheck("DOCXを読み込む", async () => {
      const token = crypto.randomUUID();
      setDocxImportCancelToken(token);
      docxImportCancelTokenRef.current = token;
      setDocxImportStartedAt(Date.now());
      try {
        setDocxImportStage("file-check");
        const path = await selectDocxPath();
        if (!path) {
          setDocxImportStage("idle");
          setDocxImportCancelToken(null);
          return;
        }
        if (docxImportCancelTokenRef.current !== token) return;
        setDocxImportStage("zip-inspection");
        const opened = await openDocxFromPathCancellable(path, token);
        if (docxImportCancelTokenRef.current !== token) return;
        setDocxImportStage("ooxml-extraction");
        await Promise.resolve();
        setDocxImportStage("asset-extraction");
        await Promise.resolve();
        setDocxImportStage("mammoth");
        const converted = await convertOpenedDocxWithWorker(opened, token);
        if (docxImportCancelTokenRef.current !== token) return;
        if (!converted) return;
        setDocxImportStage("sanitize");
        await Promise.resolve();
        setDocxImportStage("classification");
        await Promise.resolve();
        setDocxImportStage("model");
        await Promise.resolve();
        if (docxImportCancelTokenRef.current !== token) return;
        setDocxImportStage("preview");
        setPreview(converted);
      } catch (error) {
        if (docxImportCancelTokenRef.current === token) {
          setAppError(classifyAppError(error, "DOCX読み込み"));
        }
      } finally {
        if (docxImportCancelTokenRef.current === token) {
          docxImportCancelTokenRef.current = null;
          activeImportWorkerCancelRef.current = null;
          setDocxImportCancelToken(null);
          setDocxImportStartedAt(null);
          setDocxImportStage("idle");
        }
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
  const warningCategories = useMemo(
    () => [...new Set((preview?.warnings ?? []).map((warning) => warning.category ?? "general"))],
    [preview],
  );
  const filteredPreviewWarnings = useMemo(
    () =>
      (preview?.warnings ?? []).filter(
        (warning) =>
          (warningSeverityFilter === "all" || warning.severity === warningSeverityFilter) &&
          (warningCategoryFilter === "all" ||
            (warning.category ?? "general") === warningCategoryFilter),
      ),
    [preview, warningCategoryFilter, warningSeverityFilter],
  );
  const warningSeverityCounts = useMemo(
    () => ({
      info: (preview?.warnings ?? []).filter((warning) => warning.severity === "info").length,
      warning: (preview?.warnings ?? []).filter((warning) => warning.severity === "warning").length,
      error: (preview?.warnings ?? []).filter((warning) => warning.severity === "error").length,
    }),
    [preview],
  );
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
          activeItemId={activeOutlineItemId}
          className={`sidebar-position-${userPreferences.layout.sidebarPosition}`}
          onSelectItem={(item) => {
            if (!editor || item.position === undefined) return;
            editor.commands.setTextSelection(item.position + 1);
            editor.commands.focus();
            editor.view.dom
              .querySelector(".ProseMirror-focused")
              ?.scrollIntoView({ block: "center", inline: "nearest" });
          }}
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
          appDataPaths={appDataPaths}
          recoveryCount={recoveryCandidates.length}
          backupCount={backupFiles.length}
          recentProjectCount={recentProjects.entries.length}
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
          onClearRecentProjects={() => setRecentProjects(clearRecentProjects())}
          onResetPreferenceCategory={resetPreferenceCategory}
          onResetAllPreferences={resetAllPreferences}
          onResetOnboarding={resetOnboarding}
          onDeleteAllRecovery={() => void deleteAllValidRecovery()}
          onDeleteInvalidRecovery={() => void deleteInvalidRecovery()}
          onCleanupTemporaryFiles={() => void cleanupTemporaryData()}
          onCleanupStaleLocks={() => void cleanupStaleLocks()}
          onOpenRecoveryManager={() => setDocumentOpen(false)}
          onOpenBackupManager={() => setDocumentOpen(false)}
          onDeleteAllBackups={() => void deleteEveryBackup()}
          onOpenAppDataFolder={(folder) =>
            void openAppDataFolder(folder).catch((error: unknown) =>
              setAppError(classifyAppError(error, "フォルダーを開く")),
            )
          }
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
        {searchOpen ? (
          <div className="findbar" role="search" aria-label="文書内検索と置換">
            <input
              id="search-input"
              aria-label="検索"
              placeholder="検索"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <span>
              {searchMatches.length > 0 ? currentSearchIndex + 1 : 0} / {searchMatches.length}
            </span>
            <button
              type="button"
              onClick={() => moveSearch(-1)}
              disabled={searchMatches.length === 0}
            >
              前へ
            </button>
            <button
              type="button"
              onClick={() => moveSearch(1)}
              disabled={searchMatches.length === 0}
            >
              次へ
            </button>
            <input
              id="replace-input"
              aria-label="置換"
              placeholder="置換"
              value={replaceTerm}
              onChange={(event) => setReplaceTerm(event.target.value)}
              disabled={readOnlyReason !== null}
            />
            <button
              type="button"
              onClick={replaceCurrent}
              disabled={readOnlyReason !== null || currentSearchIndex < 0}
            >
              置換
            </button>
            <button
              type="button"
              onClick={replaceAll}
              disabled={readOnlyReason !== null || searchMatches.length === 0}
            >
              すべて置換
            </button>
            <label>
              <input
                type="checkbox"
                checked={searchOptions.caseSensitive}
                onChange={(event) =>
                  setSearchOptions((current) => ({
                    ...current,
                    caseSensitive: event.target.checked,
                  }))
                }
              />
              大文字小文字
            </label>
            <label>
              <input
                type="checkbox"
                checked={searchOptions.wholeWord}
                onChange={(event) =>
                  setSearchOptions((current) => ({ ...current, wholeWord: event.target.checked }))
                }
              />
              単語単位
            </label>
            <label>
              <input
                type="checkbox"
                checked={searchOptions.regex}
                onChange={(event) =>
                  setSearchOptions((current) => ({ ...current, regex: event.target.checked }))
                }
              />
              正規表現
            </label>
            <button
              type="button"
              onClick={() => {
                setSearchOpen(false);
                if (editor) updateSearchHighlight(editor, [], -1);
              }}
            >
              閉じる
            </button>
            {searchError ? <span className="warning warning-warning">{searchError}</span> : null}
            {lastReplaceCount !== null ? <span>{lastReplaceCount}件置換しました</span> : null}
          </div>
        ) : null}
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
        <span>
          保存サイズ:{" "}
          {savingSizeBytes ? `${savingSizeBytes.toLocaleString("ja-JP")} bytes` : "待機中"}
        </span>
        <span>{hasUnsavedChanges(saveStatus) ? "未保存の変更あり" : "未保存の変更なし"}</span>
        <span>
          統計: 空白込{documentStatistics.charactersWithSpaces.toLocaleString("ja-JP")}字 / 空白除く
          {documentStatistics.charactersWithoutSpaces.toLocaleString("ja-JP")}字
        </span>
        <span>
          英数字語{documentStatistics.asciiWordCount.toLocaleString("ja-JP")} / 日本語文字
          {documentStatistics.japaneseCharacterCount.toLocaleString("ja-JP")}
        </span>
        <span>
          段落{documentStatistics.paragraphCount} 見出し{documentStatistics.headingCount} 表
          {documentStatistics.tableCount} 画像{documentStatistics.imageCount} 読了約
          {documentStatistics.estimatedReadingMinutes}分
        </span>
        {readOnlyReason ? <span>読み取り専用: {readOnlyReason}</span> : null}
      </div>
      {docxModuleStatus === "loading" ? (
        <div className="save-timestamps" role="status">
          DOCX機能を読み込み中...
        </div>
      ) : null}
      {docxImportCancelToken ? (
        <div className="save-timestamps" role="status" aria-live="polite">
          DOCX読み込み: {DOCX_IMPORT_STAGE_LABELS[docxImportStage]}
          {docxImportStartedAt
            ? ` / 経過 ${Math.max(0, Math.round((Date.now() - docxImportStartedAt) / 1000))}秒`
            : ""}
          <button
            type="button"
            onClick={() => {
              activeImportWorkerCancelRef.current?.();
              void cancelDocxImport(docxImportCancelToken);
              docxImportCancelTokenRef.current = null;
              setDocxImportCancelToken(null);
              setDocxImportStage("cancelled");
              setDocxImportStartedAt(null);
            }}
          >
            キャンセル
          </button>
        </div>
      ) : null}
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
          backupFiles={backupFiles}
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
          onOpenBackup={(backup) => void restoreBackupAsUnsaved(backup)}
          onDeleteBackup={(backup) => void deleteBackup(backup)}
          onDeleteAllBackups={() => void deleteEveryBackup()}
        />
      )}

      {dropActive ? (
        <div className="drop-overlay" role="status" aria-live="polite">
          ファイルをドロップして開く
        </div>
      ) : null}

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
                <p>
                  info {warningSeverityCounts.info} / warning {warningSeverityCounts.warning} /
                  error {warningSeverityCounts.error}
                </p>
                <div className="button-row">
                  <select
                    aria-label="警告severity"
                    value={warningSeverityFilter}
                    onChange={(event) =>
                      setWarningSeverityFilter(event.target.value as typeof warningSeverityFilter)
                    }
                  >
                    <option value="all">全severity</option>
                    <option value="info">info</option>
                    <option value="warning">warning</option>
                    <option value="error">error</option>
                  </select>
                  <select
                    aria-label="警告category"
                    value={warningCategoryFilter}
                    onChange={(event) => setWarningCategoryFilter(event.target.value)}
                  >
                    <option value="all">全category</option>
                    {warningCategories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const safeText = JSON.stringify(
                        filteredPreviewWarnings.map((warning) => ({
                          code: warning.code,
                          category: warning.category,
                          severity: warning.severity,
                          message: warning.message,
                          affectedPart: warning.affectedPart,
                          canContinue: warning.canContinue,
                          recommendation: warning.recommendation,
                        })),
                        null,
                        2,
                      );
                      void navigator.clipboard?.writeText(safeText);
                    }}
                  >
                    警告をコピー
                  </button>
                </div>
                {filteredPreviewWarnings.map((warning, index) => (
                  <details
                    key={`${warning.code}-${warning.location ?? index}`}
                    className={`warning warning-${warning.severity}`}
                  >
                    <summary>
                      [{warning.severity}] [{warning.category ?? "general"}] {warning.code}:{" "}
                      {warning.message}
                    </summary>
                    <p>{warning.humanReadableReason ?? warning.message}</p>
                    <p>対象: {warning.affectedPart ?? warning.location ?? "不明"}</p>
                    <p>継続: {warning.canContinue === false ? "不可" : "可能"}</p>
                    <p>推奨: {warning.recommendation ?? "プレビューを確認してください。"}</p>
                  </details>
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
      {editLockDialog ? (
        <EditLockConflictDialog
          path={editLockDialog.path}
          status={editLockDialog.status}
          currentSessionId={sessionProjectKeyRef.current}
          onChoose={(choice) => {
            editLockDialog.resolve(choice);
            setEditLockDialog(null);
          }}
        />
      ) : null}
      {externalConflict && resolveExternalConflict ? (
        <ExternalConflictDialog
          request={externalConflict}
          onChoose={(choice) => {
            resolveExternalConflict(choice);
            setResolveExternalConflict(null);
            setExternalConflict(null);
          }}
        />
      ) : null}
      {appError ? <ErrorDialog error={appError} onClose={() => setAppError(null)} /> : null}
      {showFirstRunGuide ? <FirstRunGuide onClose={dismissGuide} /> : null}
      {showAbout ? (
        <AboutDialog
          projectPath={projectPath}
          recoveryDirectory={recoveryDirectory}
          appDataPaths={appDataPaths}
          backupCount={backupFiles.length}
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
  backupFiles,
  onNewProject,
  onImportDocx,
  onOpenProject,
  onOpenRecentProject,
  onRemoveRecentProject,
  onClearRecentProjects,
  onRecoverCandidate,
  onDeleteRecoveryCandidate,
  onDismissRecoveryCandidate,
  onOpenBackup,
  onDeleteBackup,
  onDeleteAllBackups,
}: {
  recentProjects: RecentProjectEntry[];
  recoveryCandidates: RecoveryCandidate[];
  backupFiles: BackupFileInfo[];
  onNewProject: () => void;
  onImportDocx: () => void;
  onOpenProject: () => void;
  onOpenRecentProject: (entry: RecentProjectEntry) => void;
  onRemoveRecentProject: (path: string) => void;
  onClearRecentProjects: () => void;
  onRecoverCandidate: (candidate: RecoveryCandidate) => void;
  onDeleteRecoveryCandidate: (candidate: RecoveryCandidate) => void;
  onDismissRecoveryCandidate: (candidate: RecoveryCandidate) => void;
  onOpenBackup: (backup: BackupFileInfo) => void;
  onDeleteBackup: (backup: BackupFileInfo) => void;
  onDeleteAllBackups: () => void;
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
      <BackupList
        backups={backupFiles}
        onOpenBackup={onOpenBackup}
        onDeleteBackup={onDeleteBackup}
        onDeleteAllBackups={onDeleteAllBackups}
      />
    </section>
  );
}

function BackupList({
  backups,
  onOpenBackup,
  onDeleteBackup,
  onDeleteAllBackups,
}: {
  backups: BackupFileInfo[];
  onOpenBackup: (backup: BackupFileInfo) => void;
  onDeleteBackup: (backup: BackupFileInfo) => void;
  onDeleteAllBackups: () => void;
}) {
  return (
    <section className="home-section backup-manager" aria-label="バックアップ管理">
      <div className="section-heading-row">
        <h2>バックアップ</h2>
        <button type="button" onClick={onDeleteAllBackups} disabled={backups.length === 0}>
          すべて削除
        </button>
      </div>
      {backups.length === 0 ? <p className="muted">保存前バックアップはまだありません。</p> : null}
      <div className="recovery-list">
        {backups.map((backup) => (
          <article
            key={backup.id}
            className={`recovery-candidate ${backup.valid_json ? "" : "recovery-invalid"}`}
          >
            <h3>{backup.title ?? backup.file_name}</h3>
            <dl>
              <div>
                <dt>元プロジェクト</dt>
                <dd>{backup.original_path}</dd>
              </div>
              <div>
                <dt>バックアップ日時</dt>
                <dd>{backup.created_at}</dd>
              </div>
              <div>
                <dt>formatVersion</dt>
                <dd>{backup.format_version ?? "不明"}</dd>
              </div>
              <div>
                <dt>サイズ</dt>
                <dd>{backup.byte_size.toLocaleString("ja-JP")} bytes</dd>
              </div>
              <div>
                <dt>元ファイル</dt>
                <dd>{backup.original_exists ? "存在します" : "見つかりません"}</dd>
              </div>
              <div>
                <dt>検証</dt>
                <dd>{backup.valid_json ? "JSONとして読み込み可能" : "破損または不正"}</dd>
              </div>
            </dl>
            <div className="button-row">
              <button
                type="button"
                disabled={!backup.valid_json}
                onClick={() => onOpenBackup(backup)}
              >
                開く
              </button>
              <button
                type="button"
                disabled={!backup.valid_json}
                onClick={() => onOpenBackup(backup)}
              >
                別名で復元
              </button>
              <button type="button" onClick={() => onDeleteBackup(backup)}>
                削除
              </button>
            </div>
          </article>
        ))}
      </div>
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

function EditLockConflictDialog({
  path,
  status,
  currentSessionId,
  onChoose,
}: {
  path: string;
  status: ProjectEditLockStatus;
  currentSessionId: string;
  onChoose: (choice: EditLockChoice) => void;
}) {
  const lock = status.lock;
  const sameSession = lock?.session_id === currentSessionId;
  return (
    <section className="modal" role="dialog" aria-modal="true" aria-label="編集競合">
      <div className="modal-panel">
        <h2>同じプロジェクトが編集中の可能性があります</h2>
        <p>{lockStatusMessage(status)}</p>
        <dl className="preview-summary">
          <div>
            <dt>対象ファイル</dt>
            <dd>{path.replaceAll("\\", "/").split("/").at(-1) ?? path}</dd>
          </div>
          <div>
            <dt>パス</dt>
            <dd>{path}</dd>
          </div>
          <div>
            <dt>ロック作成</dt>
            <dd>{lock?.created_at ?? "不明"}</dd>
          </div>
          <div>
            <dt>最終heartbeat</dt>
            <dd>{lock?.updated_at ?? "不明"}</dd>
          </div>
          <div>
            <dt>PID確認</dt>
            <dd>{status.pid_status}</dd>
          </div>
          <div>
            <dt>同一セッション</dt>
            <dd>{sameSession ? "はい" : "いいえ"}</dd>
          </div>
          <div>
            <dt>判定</dt>
            <dd>{status.lock_state}</dd>
          </div>
        </dl>
        <div className="warning-list">
          <p className="warning warning-info">読み取り専用: 元ファイルを変更せず確認します。</p>
          <p className="warning warning-info">
            編集可能なコピー: 未保存文書として開き、保存時に名前を付けて保存します。
          </p>
          <p className="warning warning-warning">
            競合を承知して編集: 外部更新検出と保存前バックアップは維持します。
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={() => onChoose("read-only")}>
            読み取り専用で開く
          </button>
          <button type="button" onClick={() => onChoose("copy")}>
            編集可能なコピーとして開く
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (confirm("競合によって変更が失われる可能性があります。続行しますか？")) {
                onChoose("force-edit");
              }
            }}
          >
            競合を承知して編集する
          </button>
          <button type="button" onClick={() => onChoose("cancel")}>
            キャンセル
          </button>
        </div>
      </div>
    </section>
  );
}

function ExternalConflictDialog({
  request,
  onChoose,
}: {
  request: ExternalConflictRequest;
  onChoose: (choice: ExternalConflictChoice) => void;
}) {
  return (
    <section className="modal" role="dialog" aria-modal="true" aria-label="外部更新の確認">
      <div className="modal-panel narrow-modal">
        <h2>保存先が外部で変更されています</h2>
        <p>{request.path}</p>
        <p>無警告では上書きしません。現在の編集内容をどう扱うか選んでください。</p>
        <div className="modal-actions">
          <button type="button" onClick={() => onChoose("reload")}>
            外部版を読み直す
          </button>
          <button type="button" onClick={() => onChoose("save-as")}>
            現在の内容を別名保存
          </button>
          <button type="button" className="danger-button" onClick={() => onChoose("overwrite")}>
            競合を承知して上書き
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
  appDataPaths,
  backupCount,
  onShowGuide,
  onClose,
}: {
  projectPath: string | null;
  recoveryDirectory: string | null;
  appDataPaths: AppDataPaths | null;
  backupCount: number;
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
          <div>
            <dt>app data</dt>
            <dd>{appDataPaths?.app_data_dir ?? "取得できませんでした"}</dd>
          </div>
          <div>
            <dt>バックアップ保存場所</dt>
            <dd>{appDataPaths?.backups_dir ?? "取得できませんでした"}</dd>
          </div>
          <div>
            <dt>バックアップ件数</dt>
            <dd>{backupCount}</dd>
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
