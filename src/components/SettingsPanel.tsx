import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Content } from "@tiptap/core";

import { AppearancePreferencesPanel } from "../features/preferences/AppearancePreferencesPanel";
import { TOOLBAR_COMMAND_DEFINITIONS } from "../features/editor/toolbarCommands";
import type {
  FooterContent,
  HeaderContent,
  PageSettings,
  ParagraphSettings,
} from "../document-model/schema";
import { createEditorExtensions } from "../features/editor/editorConfig";
import {
  DEFAULT_TOOLBAR_COMMAND_ORDER,
  moveToolbarCommand,
  normalizeHiddenToolbarCommands,
  normalizeToolbarOrder,
} from "../preferences/toolbar";
import {
  applyLineHeightPreset,
  applyParagraphSpacingPreset,
  setEnterBehavior,
  type LineHeightPreset,
  type ParagraphSpacingPreset,
  type UserEditingPreferences,
} from "../stores/editingPreferences";
import type { UserPreferences, UserPreferencesUpdate } from "../stores/userPreferences";

type SettingsPanelProps = {
  pageSettings: PageSettings;
  paragraphSettings: ParagraphSettings;
  tableCellSettings: {
    backgroundColor: string | null;
    verticalAlign: "top" | "middle" | "bottom";
  };
  imageSettings: {
    widthPx: number;
    heightPx: number;
    originalWidthPx: number | null;
    originalHeightPx: number | null;
    keepAspectRatio: boolean;
    alignment: "left" | "center" | "right";
    altText: string;
  };
  header: HeaderContent;
  footer: FooterContent;
  userPreferences: UserPreferences;
  preferenceSaveError: string | null;
  className?: string;
  showAdvancedEditingSettings: boolean;
  canApplyToSelectedBlock: boolean;
  canEditSelectedTableCell: boolean;
  canEditSelectedImage: boolean;
  imageError: string | null;
  onUpdatePreferences: (update: UserPreferencesUpdate) => void;
  onUpdateEditingPreferences: (
    updater: UserEditingPreferences | ((current: UserEditingPreferences) => UserEditingPreferences),
  ) => void;
  onToggleAdvancedEditingSettings: () => void;
  onApplyPreferencesToDocumentDefaults: () => void;
  onApplyPreferencesToSelectedBlock: () => void;
  onUpdatePageSettings: (patch: Partial<PageSettings>) => void;
  onUpdateSelectedParagraphSettings: (patch: Partial<ParagraphSettings>) => void;
  onUpdateSelectedTableCellSettings: (
    patch: Partial<SettingsPanelProps["tableCellSettings"]>,
  ) => void;
  onUpdateSelectedImageSettings: (patch: Partial<SettingsPanelProps["imageSettings"]>) => void;
  onResetSelectedImageSize: () => void;
  onDeleteSelectedImage: () => void;
  onUpdateHeader: (header: HeaderContent) => void;
  onUpdateFooter: (footer: FooterContent) => void;
};

export function SettingsPanel({
  pageSettings,
  paragraphSettings,
  tableCellSettings,
  imageSettings,
  header,
  footer,
  userPreferences,
  preferenceSaveError,
  className,
  showAdvancedEditingSettings,
  canApplyToSelectedBlock,
  canEditSelectedTableCell,
  canEditSelectedImage,
  imageError,
  onUpdatePreferences,
  onUpdateEditingPreferences,
  onToggleAdvancedEditingSettings,
  onApplyPreferencesToDocumentDefaults,
  onApplyPreferencesToSelectedBlock,
  onUpdatePageSettings,
  onUpdateSelectedParagraphSettings,
  onUpdateSelectedTableCellSettings,
  onUpdateSelectedImageSettings,
  onResetSelectedImageSize,
  onDeleteSelectedImage,
  onUpdateHeader,
  onUpdateFooter,
}: SettingsPanelProps) {
  const headerRef = useRef(header);
  const footerRef = useRef(footer);
  headerRef.current = header;
  footerRef.current = footer;
  const editingPreferences = userPreferences.editing;
  const layoutPreferences = userPreferences.layout;
  const toolbarOrder = normalizeToolbarOrder(userPreferences.toolbar.buttonOrder);
  const hiddenButtons = new Set(
    normalizeHiddenToolbarCommands(userPreferences.toolbar.hiddenButtons),
  );
  const commandDefinitions = toolbarOrder
    .map((id) => TOOLBAR_COMMAND_DEFINITIONS.find((definition) => definition.id === id))
    .filter((definition) => definition !== undefined);
  const lineSpacingPreset = lineSpacingPresetFromSettings(paragraphSettings);
  const cellBackgroundPreset = cellBackgroundPresetFromSettings(tableCellSettings.backgroundColor);
  const headerEditor = useEditor({
    extensions: createEditorExtensions(),
    content: header.editorContent as Content,
    editorProps: {
      attributes: {
        "aria-label": "Header editor",
        class: "header-footer-editor",
      },
    },
    onUpdate: ({ editor }) => {
      onUpdateHeader({
        ...headerRef.current,
        editorContent: editor.getJSON(),
        plainText: editor.getText(),
      });
    },
  });
  const footerEditor = useEditor({
    extensions: createEditorExtensions(),
    content: footer.editorContent as Content,
    editorProps: {
      attributes: {
        "aria-label": "Footer editor",
        class: "header-footer-editor",
      },
    },
    onUpdate: ({ editor }) => {
      onUpdateFooter({
        ...footerRef.current,
        editorContent: editor.getJSON(),
        plainText: editor.getText(),
      });
    },
  });

  useEffect(() => {
    if (!headerEditor) return;
    if (JSON.stringify(headerEditor.getJSON()) === JSON.stringify(header.editorContent)) return;
    headerEditor.commands.setContent(header.editorContent as Content, { emitUpdate: false });
  }, [header.editorContent, headerEditor]);

  useEffect(() => {
    if (!footerEditor) return;
    if (JSON.stringify(footerEditor.getJSON()) === JSON.stringify(footer.editorContent)) return;
    footerEditor.commands.setContent(footer.editorContent as Content, { emitUpdate: false });
  }, [footer.editorContent, footerEditor]);

  const resetToolbarPreferences = () => {
    onUpdatePreferences({
      layout: {
        toolbarVisible: true,
        toolbarPosition: "top",
      },
      toolbar: {
        buttonOrder: DEFAULT_TOOLBAR_COMMAND_ORDER,
        hiddenButtons: [],
        buttonSize: "medium",
        showLabels: false,
      },
    });
  };

  return (
    <aside
      className={["settings", className].filter(Boolean).join(" ")}
      aria-label="文書設定"
      tabIndex={-1}
    >
      <h2>個人設定</h2>
      <section className="preference-section" aria-label="レイアウト設定">
        <h3>レイアウト</h3>
        <label className="toggle">
          <input
            type="checkbox"
            checked={layoutPreferences.sidebarVisible}
            onChange={(event) =>
              onUpdatePreferences({ layout: { sidebarVisible: event.target.checked } })
            }
          />
          アウトラインを表示
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={layoutPreferences.settingsVisible}
            onChange={(event) =>
              onUpdatePreferences({ layout: { settingsVisible: event.target.checked } })
            }
          />
          設定パネルを表示
        </label>
        <p className="muted">非表示後は上部の設定ボタンまたはCtrl+,で再表示できます。</p>
        <label className="toggle">
          <input
            type="checkbox"
            checked={layoutPreferences.statusBarVisible}
            onChange={(event) =>
              onUpdatePreferences({ layout: { statusBarVisible: event.target.checked } })
            }
          />
          保存状態を表示
        </label>
        <label>
          アウトライン位置
          <select
            aria-label="アウトライン位置"
            value={layoutPreferences.sidebarPosition}
            onChange={(event) =>
              onUpdatePreferences({
                layout: { sidebarPosition: event.target.value as "left" | "right" },
              })
            }
          >
            <option value="left">左</option>
            <option value="right">右</option>
          </select>
        </label>
        <label>
          設定パネル位置
          <select
            aria-label="設定パネル位置"
            value={layoutPreferences.settingsPosition}
            onChange={(event) =>
              onUpdatePreferences({
                layout: { settingsPosition: event.target.value as "left" | "right" },
              })
            }
          >
            <option value="left">左</option>
            <option value="right">右</option>
          </select>
        </label>
      </section>
      <AppearancePreferencesPanel
        preferences={userPreferences}
        onChange={onUpdatePreferences}
        saveError={preferenceSaveError}
      />
      <section className="preference-section" aria-label="ツールバー設定">
        <h3>ツールバー</h3>
        <label>
          ツールバー位置
          <select
            aria-label="ツールバー位置"
            value={layoutPreferences.toolbarPosition === "bottom" ? "bottom" : "top"}
            onChange={(event) =>
              onUpdatePreferences({
                layout: { toolbarPosition: event.target.value as "top" | "bottom" },
              })
            }
          >
            <option value="top">上</option>
            <option value="bottom">下</option>
          </select>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={layoutPreferences.toolbarVisible}
            onChange={(event) =>
              onUpdatePreferences({ layout: { toolbarVisible: event.target.checked } })
            }
          />
          ツールバーを表示
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={userPreferences.toolbar.showLabels}
            onChange={(event) =>
              onUpdatePreferences({ toolbar: { showLabels: event.target.checked } })
            }
          />
          ボタンのラベルを表示
        </label>
        <label>
          ボタンサイズ
          <select
            aria-label="ボタンサイズ"
            value={userPreferences.toolbar.buttonSize}
            onChange={(event) =>
              onUpdatePreferences({
                toolbar: {
                  buttonSize: event.target.value as UserPreferences["toolbar"]["buttonSize"],
                },
              })
            }
          >
            <option value="small">小</option>
            <option value="medium">中</option>
            <option value="large">大</option>
          </select>
        </label>
        <div className="toolbar-command-list" aria-label="ツールバーボタン一覧">
          {commandDefinitions.map((definition, index) => (
            <div key={definition.id} className="toolbar-command-row">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={!hiddenButtons.has(definition.id)}
                  onChange={(event) => {
                    const nextHidden = event.target.checked
                      ? [...hiddenButtons].filter((id) => id !== definition.id)
                      : [...hiddenButtons, definition.id];
                    onUpdatePreferences({ toolbar: { hiddenButtons: nextHidden } });
                  }}
                />
                {definition.label}
              </label>
              <button
                type="button"
                aria-label={`${definition.label}を上へ移動`}
                disabled={index === 0}
                onClick={() =>
                  onUpdatePreferences({
                    toolbar: {
                      buttonOrder: moveToolbarCommand(toolbarOrder, definition.id, "up"),
                    },
                  })
                }
              >
                上
              </button>
              <button
                type="button"
                aria-label={`${definition.label}を下へ移動`}
                disabled={index === commandDefinitions.length - 1}
                onClick={() =>
                  onUpdatePreferences({
                    toolbar: {
                      buttonOrder: moveToolbarCommand(toolbarOrder, definition.id, "down"),
                    },
                  })
                }
              >
                下
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={resetToolbarPreferences}>
          ツールバー設定を初期値に戻す
        </button>
      </section>
      <label>
        改行方法
        <select
          value={editingPreferences.enterBehavior}
          onChange={(event) =>
            onUpdateEditingPreferences((current) =>
              setEnterBehavior(
                current,
                event.target.value as UserEditingPreferences["enterBehavior"],
              ),
            )
          }
        >
          <option value="newParagraph">Enter: 新しい段落 / Shift+Enter: 段落内改行</option>
          <option value="hardBreak">Enter: 段落内改行 / Shift+Enter: 新しい段落</option>
        </select>
      </label>
      <label>
        行間
        <select
          value={editingPreferences.visualLineHeightPreset}
          onChange={(event) =>
            onUpdateEditingPreferences((current) =>
              applyLineHeightPreset(current, event.target.value as LineHeightPreset),
            )
          }
        >
          <option value="compact">狭い</option>
          <option value="normal">標準</option>
          <option value="relaxed">広い</option>
          <option value="custom">数値指定</option>
        </select>
      </label>
      {editingPreferences.visualLineHeightPreset === "custom" ? (
        <label>
          行間 数値
          <input
            type="number"
            min="1"
            max="2.5"
            step="0.05"
            value={editingPreferences.visualLineHeight}
            onChange={(event) =>
              onUpdateEditingPreferences((current) => ({
                ...current,
                visualLineHeightPreset: "custom",
                visualLineHeight: Number(event.target.value),
              }))
            }
          />
        </label>
      ) : null}
      <label>
        段落間隔
        <select
          value={editingPreferences.visualParagraphSpacingPreset}
          onChange={(event) =>
            onUpdateEditingPreferences((current) =>
              applyParagraphSpacingPreset(current, event.target.value as ParagraphSpacingPreset),
            )
          }
        >
          <option value="compact">コンパクト</option>
          <option value="normal">標準</option>
          <option value="relaxed">ゆったり</option>
          <option value="custom">カスタム</option>
        </select>
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={editingPreferences.showParagraphMarks}
          onChange={(event) =>
            onUpdateEditingPreferences((current) => ({
              ...current,
              showParagraphMarks: event.target.checked,
            }))
          }
        />
        段落記号
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={editingPreferences.showHardBreakMarks}
          onChange={(event) =>
            onUpdateEditingPreferences((current) => ({
              ...current,
              showHardBreakMarks: event.target.checked,
            }))
          }
        />
        段落内改行記号
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={editingPreferences.showPageBreakMarks}
          onChange={(event) =>
            onUpdateEditingPreferences((current) => ({
              ...current,
              showPageBreakMarks: event.target.checked,
            }))
          }
        />
        改ページ記号
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={editingPreferences.trimTrailingEmptyParagraphs}
          onChange={(event) =>
            onUpdateEditingPreferences((current) => ({
              ...current,
              trimTrailingEmptyParagraphs: event.target.checked,
            }))
          }
        />
        保存時に文末の余分な空段落を整理
      </label>
      <button type="button" onClick={onToggleAdvancedEditingSettings}>
        {showAdvancedEditingSettings ? "詳細設定を閉じる" : "詳細設定"}
      </button>
      {showAdvancedEditingSettings ? (
        <div className="advanced-settings">
          {[
            ["段落前 px", "visualParagraphSpacingBefore", 0, 96],
            ["段落後 px", "visualParagraphSpacingAfter", 0, 96],
            ["見出し前 px", "visualHeadingSpacingBefore", 0, 128],
            ["見出し後 px", "visualHeadingSpacingAfter", 0, 128],
            ["リスト項目間 px", "visualListItemSpacing", 0, 64],
            ["引用前後 px", "visualBlockquoteSpacing", 0, 96],
          ].map(([label, key, min, max]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                min={min}
                max={max}
                value={editingPreferences[key as keyof UserEditingPreferences] as number}
                onChange={(event) =>
                  onUpdateEditingPreferences((current) => ({
                    ...current,
                    visualParagraphSpacingPreset: "custom",
                    [key]: Number(event.target.value),
                  }))
                }
              />
            </label>
          ))}
          <label>
            空段落の高さ
            <select
              value={editingPreferences.emptyParagraphHeight}
              onChange={(event) =>
                onUpdateEditingPreferences((current) => ({
                  ...current,
                  emptyParagraphHeight: event.target
                    .value as UserEditingPreferences["emptyParagraphHeight"],
                }))
              }
            >
              <option value="singleLine">1行</option>
              <option value="collapsed">最小</option>
              <option value="doubleLine">2行</option>
            </select>
          </label>
        </div>
      ) : null}
      <div className="preference-actions">
        <button type="button" onClick={onApplyPreferencesToDocumentDefaults}>
          現在の文書既定値へ適用
        </button>
        <button
          type="button"
          onClick={onApplyPreferencesToSelectedBlock}
          disabled={!canApplyToSelectedBlock}
        >
          選択段落へ適用
        </button>
      </div>

      <h2>文書設定</h2>
      <section className="preference-section" aria-label="ページ設定">
        <h3>ページ設定</h3>
        <label>
          用紙サイズ
          <select
            aria-label="用紙サイズ"
            value={pageSettings.size}
            onChange={(event) =>
              onUpdatePageSettings({
                size: event.target.value as PageSettings["size"],
              })
            }
          >
            <option value="A4">A4</option>
            <option value="Letter">Letter</option>
            <option value="Custom">Custom</option>
          </select>
        </label>
        {pageSettings.size === "Custom" ? (
          <>
            <label>
              幅 mm
              <input
                aria-label="用紙幅 mm"
                type="number"
                min="25"
                max="2000"
                step="0.1"
                value={pageSettings.widthMm}
                onChange={(event) => onUpdatePageSettings({ widthMm: Number(event.target.value) })}
              />
            </label>
            <label>
              高さ mm
              <input
                aria-label="用紙高さ mm"
                type="number"
                min="25"
                max="2000"
                step="0.1"
                value={pageSettings.heightMm}
                onChange={(event) => onUpdatePageSettings({ heightMm: Number(event.target.value) })}
              />
            </label>
          </>
        ) : null}
        <label>
          向き
          <select
            aria-label="用紙の向き"
            value={pageSettings.orientation}
            onChange={(event) =>
              onUpdatePageSettings({ orientation: event.target.value as "portrait" | "landscape" })
            }
          >
            <option value="portrait">Portrait（縦）</option>
            <option value="landscape">Landscape（横）</option>
          </select>
        </label>
        {[
          ["上余白", "topMm"],
          ["下余白", "bottomMm"],
          ["左余白", "leftMm"],
          ["右余白", "rightMm"],
        ].map(([label, key]) => (
          <label key={key}>
            {label} mm
            <input
              aria-label={`${label} mm`}
              type="number"
              min="0"
              max="1000"
              step="0.1"
              value={pageSettings.margins[key as keyof PageSettings["margins"]]}
              onChange={(event) =>
                onUpdatePageSettings({
                  margins: {
                    ...pageSettings.margins,
                    [key]: Number(event.target.value),
                  },
                })
              }
            />
          </label>
        ))}
      </section>
      <section className="preference-section" aria-label="段落設定">
        <h3>段落</h3>
        {[
          ["左インデント", "indentLeftMm"],
          ["右インデント", "indentRightMm"],
          ["最初の行インデント", "firstLineIndentMm"],
        ].map(([label, key]) => (
          <label key={key}>
            {label} mm
            <input
              aria-label={`${label} mm`}
              type="number"
              min={key === "firstLineIndentMm" ? "0" : "-250"}
              max="250"
              step="0.1"
              value={paragraphSettings[key as keyof ParagraphSettings] as number}
              disabled={!canApplyToSelectedBlock}
              onChange={(event) =>
                onUpdateSelectedParagraphSettings({
                  [key]: Number(event.target.value),
                })
              }
            />
          </label>
        ))}
        {[
          ["Before", "spaceBeforePt"],
          ["After", "spaceAfterPt"],
        ].map(([label, key]) => (
          <label key={key}>
            段落間隔 {label} pt
            <input
              aria-label={`段落間隔 ${label}`}
              type="number"
              min="0"
              max="1000"
              step="0.5"
              value={paragraphSettings[key as keyof ParagraphSettings] as number}
              disabled={!canApplyToSelectedBlock}
              onChange={(event) =>
                onUpdateSelectedParagraphSettings({
                  [key]: Number(event.target.value),
                })
              }
            />
          </label>
        ))}
        <label>
          段落行間
          <select
            aria-label="段落行間"
            value={lineSpacingPreset}
            disabled={!canApplyToSelectedBlock}
            onChange={(event) => {
              const value = event.target.value;
              onUpdateSelectedParagraphSettings({
                lineSpacing: {
                  type: "multiple",
                  value:
                    value === "custom"
                      ? (paragraphSettings.lineSpacing?.value ?? 1.5)
                      : Number(value),
                },
              });
            }}
          >
            <option value="1">1.0</option>
            <option value="1.15">1.15</option>
            <option value="1.5">1.5</option>
            <option value="2">2.0</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {lineSpacingPreset === "custom" ? (
          <label>
            Custom 行間
            <input
              aria-label="Custom 行間"
              type="number"
              min="0.1"
              max="10"
              step="0.05"
              value={paragraphSettings.lineSpacing?.value ?? 1.5}
              disabled={!canApplyToSelectedBlock}
              onChange={(event) =>
                onUpdateSelectedParagraphSettings({
                  lineSpacing: { type: "multiple", value: Number(event.target.value) },
                })
              }
            />
          </label>
        ) : null}
      </section>
      <section className="preference-section" aria-label="表セル設定">
        <h3>表セル</h3>
        <label>
          背景色
          <select
            aria-label="セル背景色"
            value={cellBackgroundPreset}
            disabled={!canEditSelectedTableCell}
            onChange={(event) => {
              const value = event.target.value;
              onUpdateSelectedTableCellSettings({
                backgroundColor:
                  value === "none"
                    ? null
                    : value === "custom"
                      ? (tableCellSettings.backgroundColor ?? "#FFFFFF")
                      : value,
              });
            }}
          >
            <option value="none">背景色なし</option>
            <option value="#F8FAFC">薄いグレー</option>
            <option value="#FEF3C7">薄い黄</option>
            <option value="#DBEAFE">薄い青</option>
            <option value="#DCFCE7">薄い緑</option>
            <option value="#FEE2E2">薄い赤</option>
            <option value="custom">Customカラー</option>
          </select>
        </label>
        {cellBackgroundPreset === "custom" ? (
          <label>
            Custom 背景色
            <input
              aria-label="Custom 背景色"
              type="color"
              value={tableCellSettings.backgroundColor ?? "#FFFFFF"}
              disabled={!canEditSelectedTableCell}
              onChange={(event) =>
                onUpdateSelectedTableCellSettings({ backgroundColor: event.target.value })
              }
            />
          </label>
        ) : null}
        <label>
          縦方向配置
          <select
            aria-label="セル縦方向配置"
            value={tableCellSettings.verticalAlign}
            disabled={!canEditSelectedTableCell}
            onChange={(event) =>
              onUpdateSelectedTableCellSettings({
                verticalAlign: event.target
                  .value as SettingsPanelProps["tableCellSettings"]["verticalAlign"],
              })
            }
          >
            <option value="top">上</option>
            <option value="middle">中央</option>
            <option value="bottom">下</option>
          </select>
        </label>
        <p className="muted">表外では無効です。複数セル選択時はエディタの選択範囲に適用します。</p>
      </section>
      <section className="preference-section" aria-label="画像設定">
        <h3>画像</h3>
        {imageError ? <p className="warning warning-warning">{imageError}</p> : null}
        <div className="settings-grid two">
          <label>
            幅 px
            <input
              aria-label="画像幅 px"
              type="number"
              min="1"
              max="8000"
              step="1"
              value={imageSettings.widthPx}
              disabled={!canEditSelectedImage}
              onChange={(event) =>
                onUpdateSelectedImageSettings({ widthPx: Number(event.target.value) })
              }
            />
          </label>
          <label>
            高さ px
            <input
              aria-label="画像高さ px"
              type="number"
              min="1"
              max="8000"
              step="1"
              value={imageSettings.heightPx}
              disabled={!canEditSelectedImage}
              onChange={(event) =>
                onUpdateSelectedImageSettings({ heightPx: Number(event.target.value) })
              }
            />
          </label>
        </div>
        <label className="toggle">
          <input
            aria-label="画像の縦横比を維持"
            type="checkbox"
            checked={imageSettings.keepAspectRatio}
            disabled={!canEditSelectedImage}
            onChange={(event) =>
              onUpdateSelectedImageSettings({ keepAspectRatio: event.target.checked })
            }
          />
          縦横比を維持
        </label>
        <label>
          配置
          <select
            aria-label="画像配置"
            value={imageSettings.alignment}
            disabled={!canEditSelectedImage}
            onChange={(event) =>
              onUpdateSelectedImageSettings({
                alignment: event.target.value as SettingsPanelProps["imageSettings"]["alignment"],
              })
            }
          >
            <option value="left">左</option>
            <option value="center">中央</option>
            <option value="right">右</option>
          </select>
        </label>
        <label>
          代替テキスト
          <input
            aria-label="画像代替テキスト"
            type="text"
            value={imageSettings.altText}
            disabled={!canEditSelectedImage}
            onChange={(event) => onUpdateSelectedImageSettings({ altText: event.target.value })}
          />
        </label>
        <div className="button-row">
          <button type="button" disabled={!canEditSelectedImage} onClick={onResetSelectedImageSize}>
            元のサイズに戻す
          </button>
          <button type="button" disabled={!canEditSelectedImage} onClick={onDeleteSelectedImage}>
            画像を削除
          </button>
        </div>
        <p className="muted">画像を選択すると編集できます。サイズはpxで保存します。</p>
      </section>
      <section className="preference-section" aria-label="ヘッダー・フッター">
        <h3>ヘッダー・フッター</h3>
        <label>
          Header
          <div className="header-footer-editor-frame">
            <EditorContent editor={headerEditor} />
          </div>
        </label>
        <label>
          Footer
          <div className="header-footer-editor-frame">
            <EditorContent editor={footerEditor} />
          </div>
        </label>
        <label>
          ページ番号
          <select
            aria-label="ページ番号"
            value={footer.pageNumberPosition}
            onChange={(event) =>
              onUpdateFooter({
                ...footer,
                pageNumberPosition: event.target.value as FooterContent["pageNumberPosition"],
              })
            }
          >
            <option value="none">なし</option>
            <option value="left">左</option>
            <option value="center">中央</option>
            <option value="right">右</option>
          </select>
        </label>
      </section>
      <label>
        本文フォント
        <input
          value={pageSettings.bodyFontFamily}
          onChange={(event) => onUpdatePageSettings({ bodyFontFamily: event.target.value })}
        />
      </label>
      <label>
        文字サイズ pt
        <input
          type="number"
          min="6"
          value={pageSettings.bodyFontSizePt}
          onChange={(event) => onUpdatePageSettings({ bodyFontSizePt: Number(event.target.value) })}
        />
      </label>
      <label>
        行間
        <input
          type="number"
          min="1"
          step="0.1"
          value={pageSettings.lineHeight}
          onChange={(event) => onUpdatePageSettings({ lineHeight: Number(event.target.value) })}
        />
      </label>
    </aside>
  );
}

function lineSpacingPresetFromSettings(settings: ParagraphSettings): string {
  if (settings.lineSpacing?.type !== "multiple") return "custom";
  const value = settings.lineSpacing.value;
  if (value === 1 || value === 1.15 || value === 1.5 || value === 2) return String(value);
  return "custom";
}

function cellBackgroundPresetFromSettings(value: string | null): string {
  if (value === null) return "none";
  if (["#F8FAFC", "#FEF3C7", "#DBEAFE", "#DCFCE7", "#FEE2E2"].includes(value)) return value;
  return "custom";
}
