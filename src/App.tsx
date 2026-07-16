import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Content } from "@tiptap/core";

import { createNewProject, type DocumentProject, type PageSettings } from "./document-model/schema";
import { editorExtensions } from "./features/editor/editorConfig";
import { countCharacters, createOutline } from "./features/editor/outline";
import { convertDocxToPreview, type ImportPreview } from "./features/import-docx/importDocx";
import { exportDocumentToDocxBase64 } from "./features/export-docx/docxWriter";
import { projectToExportDocument } from "./features/export-docx/exportDocument";
import {
  openProjectWithDialog,
  saveProjectToPath,
  saveProjectWithDialog,
  writeBinaryFileWithDialog,
  type SaveStatus,
} from "./project/fileAccess";
import { markProjectUpdated } from "./project/serialization";

const AUTO_SAVE_DELAY_MS = 1200;

export default function App() {
  const [project, setProject] = useState<DocumentProject>(() => createNewProject());
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [darkMode, setDarkMode] = useState(true);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [onlyWarnings, setOnlyWarnings] = useState(false);
  const [onlyUncertain, setOnlyUncertain] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: editorExtensions,
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
  const characterCount = useMemo(() => countCharacters(project.editorContent), [project.editorContent]);

  const updatePageSettings = useCallback((patch: Partial<PageSettings>) => {
    setProject((current) =>
      markProjectUpdated({
        ...current,
        pageSettings: { ...current.pageSettings, ...patch },
      }),
    );
    setSaveStatus("dirty");
  }, []);

  const saveProject = useCallback(async () => {
    setSaveStatus("saving");
    try {
      if (projectPath) {
        await saveProjectToPath(projectPath, project);
      } else {
        const path = await saveProjectWithDialog(project);
        if (path) setProjectPath(path);
      }
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }, [project, projectPath]);

  const saveProjectAs = useCallback(async () => {
    setSaveStatus("saving");
    try {
      const path = await saveProjectWithDialog(project);
      if (path) {
        setProjectPath(path);
        setSaveStatus("saved");
      } else {
        setSaveStatus("dirty");
      }
    } catch {
      setSaveStatus("error");
    }
  }, [project]);

  const newProject = useCallback(() => {
    const next = createNewProject();
    setProject(next);
    setProjectPath(null);
    editor?.commands.setContent(next.editorContent as Content);
    setSaveStatus("saved");
  }, [editor]);

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
    editor.commands.setContent(preview.sanitizedHtml);
    setProject((current) =>
      markProjectUpdated({
        ...current,
        metadata: { ...current.metadata, title: preview.fileName.replace(/\.docx$/i, "") },
        editorContent: editor.getJSON(),
        warnings: preview.warnings,
        classifications: preview.blocks.map((block) => block.classification),
      }),
    );
    setPreview(null);
    setSaveStatus("dirty");
  }, [editor, preview]);

  const exportDocx = useCallback(async () => {
    const exportDocument = projectToExportDocument(project);
    const warnings = project.warnings.filter((warning) => warning.severity !== "info");
    if (warnings.length > 0 && !confirm(`${warnings.length}件の警告があります。続行しますか？`)) return;
    const base64 = await exportDocumentToDocxBase64(exportDocument);
    await writeBinaryFileWithDialog(`${project.metadata.title || "document"}.docx`, base64);
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
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newProject, openProject, saveProject, saveProjectAs]);

  function replaceFirst() {
    if (!editor || !searchTerm) return;
    const html = editor.getHTML();
    const replaced = html.replace(searchTerm, replaceTerm);
    if (html !== replaced) editor.commands.setContent(replaced);
  }

  async function onDocxSelected(file: File | undefined) {
    if (!file) return;
    const converted = await convertDocxToPreview(file);
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
    preview?.blocks.filter((block) => {
      if (onlyWarnings && block.warnings.length === 0) return false;
      if (onlyUncertain && block.classification.certainty !== "uncertain") return false;
      return true;
    }) ?? [];

  return (
    <main className={darkMode ? "app dark" : "app"}>
      <header className="topbar">
        <input
          aria-label="文書名"
          className="title-input"
          value={project.metadata.title}
          onChange={(event) => {
            setProject((current) =>
              markProjectUpdated({
                ...current,
                metadata: { ...current.metadata, title: event.target.value },
              }),
            );
            setSaveStatus("dirty");
          }}
        />
        <span className={`status status-${saveStatus}`}>{statusLabel(saveStatus)}</span>
        <span>{characterCount.toLocaleString("ja-JP")} 文字</span>
        <button type="button" onClick={newProject}>
          新規
        </button>
        <button type="button" onClick={() => void openProject()}>
          開く
        </button>
        <button type="button" onClick={() => void saveProject()}>
          保存
        </button>
        <button type="button" onClick={() => void saveProjectAs()}>
          別名保存
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          DOCX読込
        </button>
        <button type="button" onClick={() => void exportDocx()}>
          DOCX書出
        </button>
        <label className="toggle">
          <input type="checkbox" checked={darkMode} onChange={(event) => setDarkMode(event.target.checked)} />
          ダーク
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          hidden
          onChange={(event) => void onDocxSelected(event.target.files?.[0])}
        />
        <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={(event) => void onImageSelected(event.target.files?.[0])} />
      </header>

      <div className="workspace">
        <aside className="sidebar" aria-label="文書アウトライン">
          <h2>アウトライン</h2>
          {outline.length === 0 ? <p className="muted">見出しはまだありません。</p> : null}
          {outline.map((item) => (
            <div key={item.id} className={`outline-item level-${item.level}`}>
              {item.text}
            </div>
          ))}
        </aside>

        <section className="editor-shell">
          <div className="toolbar" aria-label="書式ツールバー">
            <button type="button" onClick={() => editor?.chain().focus().toggleBold().run()} aria-label="太字">
              B
            </button>
            <button type="button" onClick={() => editor?.chain().focus().toggleItalic().run()} aria-label="斜体">
              I
            </button>
            <button type="button" onClick={() => editor?.chain().focus().toggleUnderline().run()} aria-label="下線">
              U
            </button>
            <button type="button" onClick={() => editor?.chain().focus().toggleStrike().run()} aria-label="取り消し線">
              S
            </button>
            {[1, 2, 3, 4].map((level) => (
              <button key={level} type="button" onClick={() => editor?.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 | 4 }).run()}>
                H{level}
              </button>
            ))}
            <button type="button" onClick={() => editor?.chain().focus().setParagraph().run()}>
              本文
            </button>
            <button type="button" onClick={() => editor?.chain().focus().setTextAlign("left").run()} aria-label="左揃え">
              左
            </button>
            <button type="button" onClick={() => editor?.chain().focus().setTextAlign("center").run()} aria-label="中央揃え">
              中
            </button>
            <button type="button" onClick={() => editor?.chain().focus().setTextAlign("right").run()} aria-label="右揃え">
              右
            </button>
            <button type="button" onClick={() => editor?.chain().focus().toggleBulletList().run()}>
              箇条
            </button>
            <button type="button" onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
              番号
            </button>
            <button type="button" onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
              表
            </button>
            <button type="button" onClick={() => editor?.chain().focus().addRowAfter().run()}>
              行+
            </button>
            <button type="button" onClick={() => editor?.chain().focus().addColumnAfter().run()}>
              列+
            </button>
            <button type="button" onClick={() => editor?.chain().focus().deleteRow().run()}>
              行-
            </button>
            <button type="button" onClick={() => editor?.chain().focus().deleteColumn().run()}>
              列-
            </button>
            <button type="button" onClick={() => imageInputRef.current?.click()}>
              画像
            </button>
            <button type="button" onClick={() => editor?.chain().focus().insertContent("<p>図1 </p>").run()}>
              図題
            </button>
            <button type="button" onClick={() => editor?.chain().focus().insertContent("<p>表1 </p>").run()}>
              表題
            </button>
            <button type="button" onClick={() => editor?.chain().focus().setPageBreak().run()}>
              改頁
            </button>
            <button type="button" onClick={() => editor?.chain().focus().undo().run()} aria-label="元に戻す">
              戻
            </button>
            <button type="button" onClick={() => editor?.chain().focus().redo().run()} aria-label="やり直す">
              進
            </button>
          </div>
          <div className="findbar">
            <input id="search-input" aria-label="検索" placeholder="検索" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
            <input id="replace-input" aria-label="置換" placeholder="置換" value={replaceTerm} onChange={(event) => setReplaceTerm(event.target.value)} />
            <button type="button" onClick={replaceFirst}>
              置換
            </button>
          </div>
          <EditorContent editor={editor} />
        </section>

        <aside className="settings" aria-label="文書設定">
          <h2>文書設定</h2>
          <label>
            向き
            <select value={project.pageSettings.orientation} onChange={(event) => updatePageSettings({ orientation: event.target.value as "portrait" | "landscape" })}>
              <option value="portrait">縦</option>
              <option value="landscape">横</option>
            </select>
          </label>
          {(["top", "right", "bottom", "left"] as const).map((side) => (
            <label key={side}>
              余白 {side} mm
              <input
                type="number"
                min="1"
                value={project.pageSettings.marginsMm[side]}
                onChange={(event) =>
                  updatePageSettings({
                    marginsMm: {
                      ...project.pageSettings.marginsMm,
                      [side]: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
          ))}
          <label>
            本文フォント
            <input value={project.pageSettings.bodyFontFamily} onChange={(event) => updatePageSettings({ bodyFontFamily: event.target.value })} />
          </label>
          <label>
            文字サイズ pt
            <input type="number" min="6" value={project.pageSettings.bodyFontSizePt} onChange={(event) => updatePageSettings({ bodyFontSizePt: Number(event.target.value) })} />
          </label>
          <label>
            行間
            <input type="number" min="1" step="0.1" value={project.pageSettings.lineHeight} onChange={(event) => updatePageSettings({ lineHeight: Number(event.target.value) })} />
          </label>
          <label>
            ヘッダー
            <input value={project.pageSettings.header} onChange={(event) => updatePageSettings({ header: event.target.value })} />
          </label>
          <label>
            フッター
            <input value={project.pageSettings.footer} onChange={(event) => updatePageSettings({ footer: event.target.value })} />
          </label>
          <label className="toggle">
            <input type="checkbox" checked={project.pageSettings.pageNumbers} onChange={(event) => updatePageSettings({ pageNumbers: event.target.checked })} />
            ページ番号
          </label>
        </aside>
      </div>

      {preview ? (
        <section className="modal" role="dialog" aria-modal="true" aria-label="変換確認">
          <div className="modal-panel">
            <h2>変換確認: {preview.fileName}</h2>
            <div className="modal-actions">
              <label>
                <input type="checkbox" checked={onlyUncertain} onChange={(event) => setOnlyUncertain(event.target.checked)} />
                未判定のみ
              </label>
              <label>
                <input type="checkbox" checked={onlyWarnings} onChange={(event) => setOnlyWarnings(event.target.checked)} />
                警告のみ
              </label>
              <button type="button" onClick={applyPreview}>
                変換適用
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
                              blocks: current.blocks.map((item) =>
                                item.id === block.id
                                  ? {
                                      ...item,
                                      classification: {
                                        ...item.classification,
                                        blockType: blockType as typeof item.classification.blockType,
                                        ruleId: "user.override",
                                        reason: "User changed classification",
                                      },
                                    }
                                  : item,
                              ),
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
                              blocks: current.blocks.map((item) =>
                                item.id === block.id
                                  ? {
                                      ...item,
                                      classification: {
                                        ...item.classification,
                                        headingLevel: level >= 1 && level <= 4 ? level : undefined,
                                      },
                                    }
                                  : item,
                              ),
                            }
                          : current,
                      );
                    }}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setPreview((current) =>
                        current ? { ...current, blocks: current.blocks.filter((item) => item.id !== block.id) } : current,
                      )
                    }
                  >
                    削除
                  </button>
                  <p>{block.classification.reason}</p>
                  <p>{block.classification.certainty}</p>
                  {block.warnings.map((warning) => (
                    <p key={warning.id} className="warning">
                      {warning.message}
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

function statusLabel(status: SaveStatus): string {
  if (status === "saved") return "保存済み";
  if (status === "saving") return "保存中";
  if (status === "error") return "保存エラー";
  return "未保存";
}
