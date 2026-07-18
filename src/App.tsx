import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Content } from "@tiptap/core";

import { AppSidebar } from "./components/AppSidebar";
import { AppTopbar } from "./components/AppTopbar";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  createNewProject,
  type DocumentAsset,
  type DocumentProject,
  type PageSettings,
  type ParagraphFormatting,
} from "./document-model/schema";
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
  openDocxWithDialog,
  openProjectWithDialog,
  saveProjectToPath,
  saveProjectWithDialog,
  writeBinaryFileWithDialog,
  type SaveStatus,
} from "./project/fileAccess";
import { markProjectUpdated } from "./project/serialization";
import {
  documentDefaultsFromEditingPreferences,
  type UserEditingPreferences,
} from "./stores/editingPreferences";
import { createPreferenceCssVariables } from "./preferences/appearance";
import {
  layoutGridColumns,
  resolveLayoutRegions,
  type LayoutRegion,
} from "./preferences/layout";
import {
  loadUserPreferences,
  saveUserPreferences,
  updateUserPreferences,
  type UserPreferences,
  type UserPreferencesUpdate,
} from "./stores/userPreferences";

const AUTO_SAVE_DELAY_MS = 1200;

export default function App() {
  const [project, setProject] = useState<DocumentProject>(() => createNewProject());
  const [userPreferences, setUserPreferences] = useState<UserPreferences>(
    () => loadUserPreferences().preferences,
  );
  const [preferenceSaveError, setPreferenceSaveError] = useState<string | null>(null);
  const editingPreferences = userPreferences.editing;
  const [showAdvancedEditingSettings, setShowAdvancedEditingSettings] = useState(false);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [onlyWarnings, setOnlyWarnings] = useState(false);
  const [onlyUncertain, setOnlyUncertain] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const shouldFocusSettingsRef = useRef(false);
  const editingPreferencesRef = useRef(editingPreferences);
  editingPreferencesRef.current = editingPreferences;
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
      setProject((current) =>
        markProjectUpdated({
          ...current,
          editorContent: currentEditor.getJSON(),
        }),
      );
      setSaveStatus("dirty");
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

  const updatePreferences = useCallback((update: UserPreferencesUpdate) => {
    setUserPreferences((current) => updateUserPreferences(current, update));
  }, []);

  const setEditingPreferences = useCallback(
    (
      updater:
        | UserEditingPreferences
        | ((current: UserEditingPreferences) => UserEditingPreferences),
    ) => {
      setUserPreferences((current) => {
        const nextEditing =
          typeof updater === "function" ? updater(current.editing) : updater;
        return updateUserPreferences(current, { editing: nextEditing });
      });
    },
    [],
  );

  const openSettingsPanel = useCallback(() => {
    shouldFocusSettingsRef.current = true;
    updatePreferences({ layout: { settingsVisible: true } });
  }, [updatePreferences]);

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

  const saveProject = useCallback(async () => {
    setSaveStatus("saving");
    const projectToSave = projectForSave(project, editingPreferences);
    try {
      if (projectPath) {
        await saveProjectToPath(projectPath, projectToSave);
      } else {
        const path = await saveProjectWithDialog(projectToSave);
        if (path) setProjectPath(path);
      }
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }, [editingPreferences, project, projectPath]);

  const saveProjectAs = useCallback(async () => {
    setSaveStatus("saving");
    const projectToSave = projectForSave(project, editingPreferences);
    try {
      const path = await saveProjectWithDialog(projectToSave);
      if (path) {
        setProjectPath(path);
        setSaveStatus("saved");
      } else {
        setSaveStatus("dirty");
      }
    } catch {
      setSaveStatus("error");
    }
  }, [editingPreferences, project]);

  const newProject = useCallback(() => {
    const next = {
      ...createNewProject(),
      documentDefaults: documentDefaultsFromEditingPreferences(editingPreferences),
    };
    setProject(next);
    setProjectPath(null);
    editor?.commands.setContent(next.editorContent as Content);
    setSaveStatus("saved");
  }, [editingPreferences, editor]);

  const openProject = useCallback(async () => {
    const loaded = await openProjectWithDialog();
    if (!loaded) return;
    setProject(loaded.project);
    setProjectPath(loaded.path);
    editor?.commands.setContent(loaded.project.editorContent as Content);
    setSaveStatus("saved");
  }, [editor]);

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
        editorContent: editor.getJSON(),
        pageSettings: preview.pageSettings,
        assets: mergeAssets(current.assets, preview.assets),
        warnings: preview.warnings,
        classifications: preview.document.blocks.map((block) => block.classification),
      }),
    );
    setPreview(null);
    setSaveStatus("dirty");
  }, [editor, preview]);

  const exportDocx = useCallback(async () => {
    const exportDocument = projectToExportDocument(project);
    const warnings = project.warnings.filter((warning) => warning.severity !== "info");
    if (warnings.length > 0 && !confirm(`${warnings.length}件の警告があります。続行しますか？`))
      return;
    try {
      const base64 = await exportDocumentToDocxBase64(exportDocument);
      await writeBinaryFileWithDialog(`${project.metadata.title || "document"}.docx`, base64);
    } catch (error) {
      alert(error instanceof Error ? error.message : "DOCX書き出しに失敗しました。");
    }
  }, [project]);

  useEffect(() => {
    if (saveStatus !== "dirty" || !projectPath) return;
    const timeout = window.setTimeout(() => {
      void saveProject();
    }, AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [projectPath, saveProject, saveStatus]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ctrl = event.ctrlKey || event.metaKey;
      if (!ctrl) return;
      if (event.key === "n") {
        event.preventDefault();
        newProject();
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
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newProject, openProject, openSettingsPanel, saveProject, saveProjectAs]);

  function replaceFirst() {
    if (!editor || !searchTerm) return;
    const html = editor.getHTML();
    const replaced = html.replace(searchTerm, replaceTerm);
    if (html !== replaced) editor.commands.setContent(replaced);
  }

  async function openDocxImport() {
    const opened = await openDocxWithDialog();
    if (!opened) return;
    const converted = await convertDocxBase64ToImportResult(
      opened.base64,
      {
        name: opened.name,
        sizeBytes: opened.inspection.entries.reduce((sum, entry) => sum + entry.compressed_size, 0),
        path: opened.path,
        inspectedAt: new Date().toISOString(),
      },
      opened.inspection,
    );
    setPreview(converted);
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
    const alt = prompt("画像の代替テキスト", file.name) ?? file.name;
    editor.chain().focus().setImage({ src: dataUrl, alt }).run();
  }

  const previewBlocks =
    preview?.document.blocks.filter((block) => {
      if (onlyWarnings && block.warnings.length === 0) return false;
      if (onlyUncertain && block.classification.certainty !== "uncertain") return false;
      return true;
    }) ?? [];
  const hasImportErrors =
    preview?.warnings.some((warning) => warning.severity === "error") ?? false;
  const toolbarPosition =
    userPreferences.layout.toolbarPosition === "bottom" ? "bottom" : "top";
  const toolbar = userPreferences.layout.toolbarVisible ? (
    <EditorToolbar
      editor={editor}
      preferences={userPreferences.toolbar}
      position={toolbarPosition}
      onInsertImage={() => imageInputRef.current?.click()}
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
          userPreferences={userPreferences}
          preferenceSaveError={preferenceSaveError}
          showAdvancedEditingSettings={showAdvancedEditingSettings}
          canApplyToSelectedBlock={Boolean(editor)}
          onUpdatePreferences={updatePreferences}
          onUpdateEditingPreferences={setEditingPreferences}
          onToggleAdvancedEditingSettings={() =>
            setShowAdvancedEditingSettings((current) => !current)
          }
          onApplyPreferencesToDocumentDefaults={applyPreferencesToDocumentDefaults}
          onApplyPreferencesToSelectedBlock={applyPreferencesToSelectedBlock}
          onUpdatePageSettings={updatePageSettings}
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
        <EditorContent editor={editor} />
        {toolbarPosition === "bottom" ? toolbar : null}
      </section>
    );
  };

  return (
    <main className="app" data-theme={resolvedColorMode} style={appVisualStyle}>
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
        onNewProject={newProject}
        onOpenProject={() => void openProject()}
        onSaveProject={() => void saveProject()}
        onSaveProjectAs={() => void saveProjectAs()}
        onImportDocx={() => void openDocxImport()}
        onExportDocx={() => void exportDocx()}
        onOpenSettings={openSettingsPanel}
        onDarkModeChange={(enabled) =>
          updatePreferences({
            appearance: { colorMode: enabled ? "dark" : "light" },
          })
        }
        onImageSelected={(file) => void onImageSelected(file)}
      />

      <div className="workspace" data-layout-regions={layoutRegions.join(" ")} style={workspaceStyle}>
        {layoutRegions.map(renderLayoutRegion)}
      </div>

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
    </main>
  );
}

function projectForSave(
  project: DocumentProject,
  preferences: UserEditingPreferences,
): DocumentProject {
  if (!preferences.trimTrailingEmptyParagraphs) return project;
  return {
    ...project,
    editorContent: trimTrailingEmptyParagraphsFromContent(project.editorContent),
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
