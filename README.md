# Personal Document Editor

AIやクラウド変換を使わない、個人用のローカルDOCX文書エディタです。

## 開発

```bash
corepack pnpm install
corepack pnpm tauri dev
```

## 検査

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
cd src-tauri && cargo fmt --check && cargo check && cargo test
```

## 現在の対応

- Tauri 2 + React + TypeScript + Vite
- Tiptapによる本文編集
- 見出し1〜4、本文、太字、斜体、下線、取り消し線、リスト、表、画像、ページ区切り
- JSON形式のプロジェクト保存/読み込み
- 保存済み/未保存/保存中/保存エラー表示
- 保存済みプロジェクトへの自動保存
- Mammoth.jsベースのDOCX読み込み確認フロー
- `ExportDocument` 中間形式を経由したDOCX書き出し

## 制約

DOCX互換性は限定的です。元DOCXを直接変更せず、対応できない要素は警告対象として扱います。商用フォントがインストールされていることは前提にしていません。
