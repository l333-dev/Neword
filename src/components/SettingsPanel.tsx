import { AppearancePreferencesPanel } from "../features/preferences/AppearancePreferencesPanel";
import { TOOLBAR_COMMAND_DEFINITIONS } from "../features/editor/toolbarCommands";
import type { PageSettings } from "../document-model/schema";
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
  userPreferences: UserPreferences;
  preferenceSaveError: string | null;
  className?: string;
  showAdvancedEditingSettings: boolean;
  canApplyToSelectedBlock: boolean;
  onUpdatePreferences: (update: UserPreferencesUpdate) => void;
  onUpdateEditingPreferences: (
    updater: UserEditingPreferences | ((current: UserEditingPreferences) => UserEditingPreferences),
  ) => void;
  onToggleAdvancedEditingSettings: () => void;
  onApplyPreferencesToDocumentDefaults: () => void;
  onApplyPreferencesToSelectedBlock: () => void;
  onUpdatePageSettings: (patch: Partial<PageSettings>) => void;
};

export function SettingsPanel({
  pageSettings,
  userPreferences,
  preferenceSaveError,
  className,
  showAdvancedEditingSettings,
  canApplyToSelectedBlock,
  onUpdatePreferences,
  onUpdateEditingPreferences,
  onToggleAdvancedEditingSettings,
  onApplyPreferencesToDocumentDefaults,
  onApplyPreferencesToSelectedBlock,
  onUpdatePageSettings,
}: SettingsPanelProps) {
  const editingPreferences = userPreferences.editing;
  const layoutPreferences = userPreferences.layout;
  const toolbarOrder = normalizeToolbarOrder(userPreferences.toolbar.buttonOrder);
  const hiddenButtons = new Set(normalizeHiddenToolbarCommands(userPreferences.toolbar.hiddenButtons));
  const commandDefinitions = toolbarOrder
    .map((id) => TOOLBAR_COMMAND_DEFINITIONS.find((definition) => definition.id === id))
    .filter((definition) => definition !== undefined);

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
    <aside className={["settings", className].filter(Boolean).join(" ")} aria-label="文書設定" tabIndex={-1}>
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
                      buttonOrder: moveToolbarCommand(
                        toolbarOrder,
                        definition.id,
                        "up",
                      ),
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
                      buttonOrder: moveToolbarCommand(
                        toolbarOrder,
                        definition.id,
                        "down",
                      ),
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
      <label>
        向き
        <select
          value={pageSettings.orientation}
          onChange={(event) =>
            onUpdatePageSettings({ orientation: event.target.value as "portrait" | "landscape" })
          }
        >
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
            value={pageSettings.marginsMm[side]}
            onChange={(event) =>
              onUpdatePageSettings({
                marginsMm: {
                  ...pageSettings.marginsMm,
                  [side]: Number(event.target.value),
                },
              })
            }
          />
        </label>
      ))}
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
      <label>
        ヘッダー
        <input
          value={pageSettings.header}
          onChange={(event) => onUpdatePageSettings({ header: event.target.value })}
        />
      </label>
      <label>
        フッター
        <input
          value={pageSettings.footer}
          onChange={(event) => onUpdatePageSettings({ footer: event.target.value })}
        />
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={pageSettings.pageNumbers}
          onChange={(event) => onUpdatePageSettings({ pageNumbers: event.target.checked })}
        />
        ページ番号
      </label>
    </aside>
  );
}
