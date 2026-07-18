import type { SaveStatus as SaveStatusValue } from "../project/fileAccess";

type SaveStatusProps = {
  status: SaveStatusValue;
};

export function SaveStatus({ status }: SaveStatusProps) {
  return <span className={`status status-${status}`}>{saveStatusLabel(status)}</span>;
}

export function saveStatusLabel(status: SaveStatusValue): string {
  if (status === "saved") return "保存済み";
  if (status === "saving") return "保存中";
  if (status === "error") return "保存エラー";
  return "未保存";
}
