# Architecture

## 方針

このアプリは完全ローカルで動作し、AI API、外部変換サービス、外部参照の自動取得を使用しません。元DOCX、内部プロジェクト、書き出しDOCXを分離し、元DOCXを上書きしません。

## レイヤー

- `src/document-model/`: Zodで検証する `DocumentProject` とマイグレーション。
- `src/features/editor/`: Tiptap設定、編集UI、アウトライン。
- `src/features/import-docx/`: Mammoth.js、HTMLサニタイズ、変換確認。
- `src/classification/`: Wordスタイル、リスト情報、書式、文字列パターンによる決定的分類。
- `src/features/export-docx/`: UI非依存の `ExportDocument` とdocx.js変換。
- `src/project/`: JSONシリアライズ、読み込み、保存、自動保存。
- `src-tauri/src/docx/`: ZIP安全検査とOOXML補助情報抽出の入口。

## 保存形式

本文はTiptap JSONを正規形式として `DocumentProject.editorContent` に保持します。ページ設定、警告、分類結果、アセット、作成/更新/書き出し時刻も同じプロジェクトJSONに保存します。

## DOCX読み込み

ブラウザ側でMammoth.jsがDOCXからHTMLを抽出し、DOMPurifyでサニタイズしてからTiptapへ渡します。Rust側はDOCXをZIPとして検証し、path traversal、過大entry、異常な圧縮率、マクロを検出する責務を持ちます。

## DOCX書き出し

`DocumentProject -> ExportDocument -> docx.js -> DOCX bytes -> Tauri保存` の順に変換します。`ExportDocument` はReact、Tauri、docx.jsクラスへ依存しません。
