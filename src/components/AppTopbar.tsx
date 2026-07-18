import type { RefObject } from "react";

import type { SaveStatus as SaveStatusValue } from "../project/fileAccess";
import { SaveStatus } from "./SaveStatus";

type AppTopbarProps = {
  title: string;
  saveStatus: SaveStatusValue;
  characterCount: number;
  darkModeChecked: boolean;
  showSaveStatus: boolean;
  imageInputRef: RefObject<HTMLInputElement | null>;
  onTitleChange: (title: string) => void;
  onNewProject: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onSaveProjectAs: () => void;
  onImportDocx: () => void;
  onExportDocx: () => void;
  onOpenSettings: () => void;
  onDarkModeChange: (enabled: boolean) => void;
  onImageSelected: (file: File | undefined) => void;
};

export function AppTopbar({
  title,
  saveStatus,
  characterCount,
  darkModeChecked,
  showSaveStatus,
  imageInputRef,
  onTitleChange,
  onNewProject,
  onOpenProject,
  onSaveProject,
  onSaveProjectAs,
  onImportDocx,
  onExportDocx,
  onOpenSettings,
  onDarkModeChange,
  onImageSelected,
}: AppTopbarProps) {
  return (
    <header className="topbar">
      <input
        aria-label="文書名"
        className="title-input"
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
      />
      {showSaveStatus || saveStatus === "error" ? <SaveStatus status={saveStatus} /> : null}
      <span>{characterCount.toLocaleString("ja-JP")} 文字</span>
      <button type="button" onClick={onNewProject}>
        新規
      </button>
      <button type="button" onClick={onOpenProject}>
        開く
      </button>
      <button type="button" onClick={onSaveProject}>
        保存
      </button>
      <button type="button" onClick={onSaveProjectAs}>
        別名保存
      </button>
      <button type="button" onClick={onImportDocx}>
        DOCX読込
      </button>
      <button type="button" onClick={onExportDocx}>
        DOCX書出
      </button>
      <button type="button" onClick={onOpenSettings}>
        設定
      </button>
      <label className="toggle">
        <input
          type="checkbox"
          checked={darkModeChecked}
          onChange={(event) => onDarkModeChange(event.target.checked)}
        />
        ダーク
      </label>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => onImageSelected(event.target.files?.[0])}
      />
    </header>
  );
}
