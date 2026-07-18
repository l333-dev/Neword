import {
  customEditingDisplayUpdate,
  editingDisplayUpdateFromParagraphPreset,
  paragraphSpacingPresets,
} from "../../preferences/appearance";
import type { UserPreferences, UserPreferencesUpdate } from "../../preferences/userPreferences";
import type { ParagraphSpacingPreset } from "../../stores/editingPreferences";

type AppearancePreferencesPanelProps = {
  preferences: UserPreferences;
  onChange: (update: UserPreferencesUpdate) => void;
  saveError: string | null;
};

const paragraphPresetOptions: { value: ParagraphSpacingPreset; label: string }[] = [
  { value: "compact", label: "コンパクト" },
  { value: "normal", label: "標準" },
  { value: "relaxed", label: "ゆったり" },
  { value: "custom", label: "カスタム" },
];

export function AppearancePreferencesPanel({
  preferences,
  onChange,
  saveError,
}: AppearancePreferencesPanelProps) {
  const { appearance, editing } = preferences;

  return (
    <section className="preference-section" aria-label="外観と表示設定">
      {saveError ? <p className="warning warning-warning">{saveError}</p> : null}
      <h3>外観</h3>
      <label>
        テーマ
        <select
          aria-label="テーマ"
          value={appearance.colorMode}
          onChange={(event) =>
            onChange({
              appearance: {
                colorMode: event.target.value as UserPreferences["appearance"]["colorMode"],
              },
            })
          }
        >
          <option value="system">システム</option>
          <option value="light">ライト</option>
          <option value="dark">ダーク</option>
        </select>
      </label>
      <label>
        アクセントカラー
        <input
          aria-label="アクセントカラー"
          type="color"
          value={appearance.accentColor}
          onChange={(event) => onChange({ appearance: { accentColor: event.target.value } })}
        />
      </label>
      <label>
        UI文字サイズ
        <input
          aria-label="UI文字サイズ"
          type="number"
          min="0.75"
          max="1.5"
          step="0.05"
          value={appearance.uiFontScale}
          onChange={(event) =>
            onChange({ appearance: { uiFontScale: Number(event.target.value) } })
          }
        />
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={appearance.editorMaxWidth === null}
          onChange={(event) =>
            onChange({
              appearance: {
                editorMaxWidth: event.target.checked ? null : 900,
              },
            })
          }
        />
        エディタ幅制限なし
      </label>
      {appearance.editorMaxWidth === null ? null : (
        <label>
          エディタ最大幅
          <input
            aria-label="エディタ最大幅"
            type="number"
            min="480"
            max="2000"
            step="20"
            value={appearance.editorMaxWidth}
            onChange={(event) =>
              onChange({ appearance: { editorMaxWidth: Number(event.target.value) } })
            }
          />
        </label>
      )}

      <h3>編集画面の表示</h3>
      <label>
        表示行間
        <input
          aria-label="表示行間"
          type="number"
          min="1"
          max="2.5"
          step="0.05"
          value={editing.visualLineHeight}
          onChange={(event) =>
            onChange(customEditingDisplayUpdate({ visualLineHeight: Number(event.target.value) }))
          }
        />
      </label>
      <label>
        段落間隔プリセット
        <select
          aria-label="段落間隔プリセット"
          value={editing.visualParagraphSpacingPreset}
          onChange={(event) =>
            onChange(
              editingDisplayUpdateFromParagraphPreset(
                editing,
                event.target.value as ParagraphSpacingPreset,
              ),
            )
          }
        >
          {paragraphPresetOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <dl className="preset-summary">
        {(["compact", "normal", "relaxed"] as const).map((preset) => (
          <div key={preset}>
            <dt>{paragraphSpacingPresets[preset].label}</dt>
            <dd>
              行間 {paragraphSpacingPresets[preset].lineHeight} / 段落後{" "}
              {paragraphSpacingPresets[preset].paragraphSpacingAfter}px
            </dd>
          </div>
        ))}
      </dl>
      <details className="advanced-settings">
        <summary>表示の詳細設定</summary>
        {[
          ["段落前 px", "visualParagraphSpacingBefore", 0, 96],
          ["段落後 px", "visualParagraphSpacingAfter", 0, 96],
          ["見出し前 px", "visualHeadingSpacingBefore", 0, 128],
          ["見出し後 px", "visualHeadingSpacingAfter", 0, 128],
        ].map(([label, key, min, max]) => (
          <label key={key}>
            {label}
            <input
              aria-label={label as string}
              type="number"
              min={min}
              max={max}
              value={editing[key as keyof typeof editing] as number}
              onChange={(event) =>
                onChange(customEditingDisplayUpdate({ [key]: Number(event.target.value) }))
              }
            />
          </label>
        ))}
      </details>
    </section>
  );
}
