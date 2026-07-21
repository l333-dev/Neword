export type AppErrorKind =
  | "file_not_found"
  | "permission_denied"
  | "corrupt_file"
  | "unsupported_file_type"
  | "docx_safety_failed"
  | "project_too_new"
  | "invalid_project"
  | "cannot_write_destination"
  | "storage_maybe_full"
  | "docx_generation_failed"
  | "unknown";

export type UserFacingError = {
  kind: AppErrorKind;
  title: string;
  summary: string;
  dataLossRisk: string;
  currentContentState: string;
  nextActions: string[];
  technicalDetails: string | null;
};

type FileCommandErrorLike = {
  code?: unknown;
  operation?: unknown;
  path?: unknown;
  human_readable_message?: unknown;
  technical_cause?: unknown;
};

export function classifyAppError(error: unknown, context: string): UserFacingError {
  const details = technicalDetailsFromError(error);
  const code = codeFromError(error);
  const kind = kindFromCode(code, details);
  return userFacingError(kind, context, details);
}

export function sanitizeTechnicalDetails(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "[image data omitted]")
    .replace(/[A-Za-z0-9+/]{160,}={0,2}/g, "[long encoded data omitted]")
    .replace(/<\?xml[\s\S]*?<\/[a-zA-Z0-9:.-]+>/g, "[xml omitted]")
    .slice(0, 4000);
}

function kindFromCode(code: string | null, details: string | null): AppErrorKind {
  const lower = `${code ?? ""} ${details ?? ""}`.toLowerCase();
  if (lower.includes("notfound") || lower.includes("not found") || lower.includes("no such file")) {
    return "file_not_found";
  }
  if (lower.includes("permission") || lower.includes("denied")) return "permission_denied";
  if (lower.includes("unsupported") || lower.includes("format")) return "unsupported_file_type";
  if (lower.includes("docx") && lower.includes("safety")) return "docx_safety_failed";
  if (lower.includes("future") || lower.includes("too new") || lower.includes("version")) {
    return "project_too_new";
  }
  if (lower.includes("parse") || lower.includes("invalid") || lower.includes("corrupt")) {
    return "corrupt_file";
  }
  if (lower.includes("write") || lower.includes("atomic") || lower.includes("readonly")) {
    return "cannot_write_destination";
  }
  if (lower.includes("space") || lower.includes("quota") || lower.includes("storage")) {
    return "storage_maybe_full";
  }
  if (lower.includes("docx") && lower.includes("generate")) return "docx_generation_failed";
  return "unknown";
}

function userFacingError(
  kind: AppErrorKind,
  context: string,
  technicalDetails: string | null,
): UserFacingError {
  const base = {
    kind,
    dataLossRisk: "現在の編集内容は画面上に残っています。別操作で閉じる前に保存してください。",
    currentContentState: "このエラーだけでは元DOCXや保存済みプロジェクトは変更されません。",
    technicalDetails,
  };
  if (kind === "file_not_found") {
    return {
      ...base,
      title: `${context}に失敗しました`,
      summary: "指定されたファイルが見つかりません。",
      nextActions: [
        "ファイルが移動または削除されていないか確認してください。",
        "最近使ったファイル履歴から不要な項目を削除できます。",
      ],
    };
  }
  if (kind === "permission_denied") {
    return {
      ...base,
      title: `${context}に失敗しました`,
      summary: "ファイルまたは保存先へのアクセス権限がありません。",
      nextActions: ["別の保存先を選んでください。", "ファイルの権限を確認してください。"],
    };
  }
  if (kind === "corrupt_file" || kind === "invalid_project") {
    return {
      ...base,
      title: `${context}に失敗しました`,
      summary: "ファイルが壊れているか、内部プロジェクト形式が不正です。",
      nextActions: [
        "別のバックアップまたはリカバリ候補を試してください。",
        "元DOCXがある場合は再読み込みしてください。",
      ],
    };
  }
  if (kind === "project_too_new") {
    return {
      ...base,
      title: `${context}に失敗しました`,
      summary: "このアプリより新しい形式のプロジェクトです。",
      nextActions: [
        "新しいバージョンのアプリで開いてください。",
        "既存ファイルは変更されていません。",
      ],
    };
  }
  if (kind === "cannot_write_destination" || kind === "storage_maybe_full") {
    return {
      ...base,
      title: `${context}に失敗しました`,
      summary: "保存先へ書き込めませんでした。空き容量不足の可能性もあります。",
      nextActions: ["別の保存先を選んでください。", "ディスク容量と権限を確認してください。"],
    };
  }
  if (kind === "docx_safety_failed") {
    return {
      ...base,
      title: `${context}に失敗しました`,
      summary: "DOCX安全検査で問題が見つかりました。",
      nextActions: ["別のDOCXで試してください。", "未対応要素は警告付きで扱う必要があります。"],
    };
  }
  if (kind === "docx_generation_failed") {
    return {
      ...base,
      title: `${context}に失敗しました`,
      summary: "DOCX生成に失敗しました。",
      nextActions: [
        "プロジェクトを保存してから再試行してください。",
        "問題が続く場合は未対応要素を減らしてください。",
      ],
    };
  }
  return {
    ...base,
    title: `${context}に失敗しました`,
    summary: "不明なエラーが発生しました。",
    nextActions: [
      "現在のプロジェクトを別名保存してください。",
      "技術詳細を確認して原因を切り分けてください。",
    ],
  };
}

function codeFromError(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as FileCommandErrorLike;
  return typeof candidate.code === "string" ? candidate.code : null;
}

function technicalDetailsFromError(error: unknown): string | null {
  if (error instanceof Error) return sanitizeTechnicalDetails(error.message);
  if (typeof error === "string") return sanitizeTechnicalDetails(error);
  if (typeof error === "object" && error !== null) {
    const candidate = error as FileCommandErrorLike;
    const parts = [
      candidate.code,
      candidate.operation,
      candidate.path,
      candidate.human_readable_message,
      candidate.technical_cause,
    ].filter((part): part is string => typeof part === "string" && part.length > 0);
    return sanitizeTechnicalDetails(parts.join("\n"));
  }
  return null;
}
