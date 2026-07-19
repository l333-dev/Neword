import type { SaveStatus as SaveStatusValue } from "../project/fileAccess";

type SaveStatusProps = {
  status: SaveStatusValue;
};

export function SaveStatus({ status }: SaveStatusProps) {
  return <span className={`status status-${status}`}>{saveStatusLabel(status)}</span>;
}

export function saveStatusLabel(status: SaveStatusValue): string {
  if (status === "saved") return "保存済み";
  if (status === "dirty") return "未保存";
  if (status === "saving") return "保存中";
  if (status === "error") return "保存エラー";
  if (status === "autosave-pending") return "自動保存待機中";
  if (status === "autosaving") return "自動保存中";
  if (status === "autosaved") return "自動保存済み";
  if (status === "autosave-error") return "自動保存エラー";
  if (status === "recovered") return "復旧版を編集中";
  return "未保存";
}
