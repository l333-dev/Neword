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
  onReturnHome: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  onQuit: () => void;
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
  onReturnHome,
  onOpenSettings,
  onOpenAbout,
  onQuit,
  onDarkModeChange,
  onImageSelected,
}: AppTopbarProps) {
  const forceShowStatus =
    saveStatus === "error" || saveStatus === "autosave-error" || saveStatus === "recovered";
  return (
    <header className="topbar">
      <input
        aria-label="文書名"
        className="title-input"
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
      />
      {showSaveStatus || forceShowStatus ? <SaveStatus status={saveStatus} /> : null}
      <span>{characterCount.toLocaleString("ja-JP")} 文字</span>
      <button type="button" onClick={onNewProject}>
        新規
      </button>
      <button type="button" onClick={onReturnHome}>
        ホーム
      </button>
      <button type="button" onClick={onOpenProject}>
        プロジェクトを開く
      </button>
      <button type="button" onClick={onSaveProject}>
        プロジェクト保存
      </button>
      <button type="button" onClick={onSaveProjectAs}>
        名前を付けて保存
      </button>
      <button type="button" onClick={onImportDocx}>
        DOCXを読み込む
      </button>
      <button type="button" onClick={onExportDocx}>
        DOCXへ書き出す
      </button>
      <button type="button" onClick={onOpenSettings}>
        設定
      </button>
      <button type="button" onClick={onOpenAbout}>
        このアプリについて
      </button>
      <button type="button" onClick={onQuit}>
        終了
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
