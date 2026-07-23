import type { ProjectEditLockStatus } from "./fileAccess";

export type EditLockChoice = "read-only" | "copy" | "force-edit" | "cancel";

export function shouldWarnAboutEditLock(status: ProjectEditLockStatus): boolean {
  return status.lock !== null && status.lock_state !== "stale";
}

export function lockStatusMessage(status: ProjectEditLockStatus): string {
  if (!status.lock) return "ロックはありません。";
  if (status.stale) return "古いロックが残っています。編集ロックを置き換えます。";
  if (status.lock_state === "heartbeat_stale_pid_exists")
    return "heartbeatは古いですが、記録されたPIDは存在します。";
  if (status.lock_state === "pid_missing_heartbeat_fresh")
    return "PIDは存在しませんが、heartbeatが新しいため判断が必要です。";
  if (status.pid_status === "unknown") return "PID確認ができないため判断が必要です。";
  return "別のアプリセッションで編集中の可能性があります。";
}
