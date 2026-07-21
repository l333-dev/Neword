export const APP_NAME = "Personal Document Editor";
export const APP_VERSION = "0.1.0";
export const APP_IDENTIFIER = "dev.local.personal-doc-editor";

export const MAJOR_LIBRARIES = [
  "Tauri 2",
  "React",
  "TypeScript",
  "Vite",
  "Tiptap",
  "Zod",
  "Mammoth.js",
  "docx.js",
  "Rust",
  "Vitest",
];

export const SUPPORTED_FEATURES = [
  "内部プロジェクトの保存と再読み込み",
  "DOCXのローカル読み込みと新規DOCX書き出し",
  "見出し、段落、リスト、表、画像",
  "ページ設定、ヘッダー、フッター、ページ番号、改ページ",
  "ユーザー設定、自動保存、リカバリ",
];

export const UNSUPPORTED_FEATURES = [
  "Microsoft Word完全互換",
  "マクロの実行または無警告保持",
  "外部リンク画像の自動取得",
  "クラウド変換、AI API、共同編集",
  "すべてのOOXMLレイアウト機能",
];
