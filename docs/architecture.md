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
- `src/stores/`: 文書内容とは分離した個人設定。現在は編集時の改行動作、表示行間、表示段落間隔、編集記号表示を保持します。
- `src-tauri/src/docx/`: ZIP安全検査とOOXML補助情報抽出の入口。

## 保存形式

本文はTiptap JSONを正規形式として `DocumentProject.editorContent` に保持します。ページ設定、文書既定段落書式、警告、分類結果、アセット、作成/更新/書き出し時刻も同じプロジェクトJSONに保存します。

`DocumentProject.pageSettings` はDOCX由来の用紙幅/高さmm、向き、上下左右余白、ヘッダー/フッター/とじしろ余白を保持します。既存UI互換のため `marginsMm` も当面保持しますが、DOCX入出力では `margins` を正とします。段落と見出しのDOCX由来書式はTiptapノード属性 `paragraphFormatting` に、検証済みの既知キーだけを保存します。

`DocumentProject.documentDefaults` は新規文書作成時に決定された本文段落と見出しの単純な既定書式です。個人の表示設定を変更しても既存文書の `documentDefaults` は自動変更しません。

個人設定はローカルストレージに保存し、`DocumentProject` には保存しません。行間、段落間隔、編集記号、Enter/Shift+Enterの入力動作は表示・入力設定です。設定変更はTiptap JSONやDOCX書式を直接変更しません。

## DOCX読み込み

TauriのファイルダイアログでDOCXを選択し、Rust側でDOCXをZIPとして検証します。Rust側はpath traversal、過大entry、異常な圧縮率、マクロ、主要OOXML partの有無を検出します。

検査後、ローカルファイルをbase64でブラウザ側へ渡し、Mammoth.jsがDOCXからHTMLを抽出します。HTMLはDOMPurifyで許可タグ・許可属性を明示してサニタイズし、外部リンク画像の `src` は削除します。サニタイズ済みHTMLは一時的な変換入力として扱い、永続形式は `ImportDocument` とTiptap JSONに分離します。

Rust側は `word/document.xml` の `w:sectPr`、`w:pgSz`、`w:pgMar`、`w:pPr`、`w:jc`、`w:ind`、`w:spacing`、`w:pageBreakBefore`、`w:keepNext`、`w:keepLines`、`w:br w:type="page"` を補助情報として抽出します。フロント側は段落順でMammoth HTMLへ制御済み属性を付与し、Tiptapの段落/見出し属性として保持します。Word固有の段落間隔や行間を単純な内部書式へ変換した場合は `PARAGRAPH_SPACING_SIMPLIFIED` を記録します。

複数セクションは現段階では内部セクション構造へ展開しません。最初のセクションを文書全体のページ設定として使用し、2つ目以降は `section.multiple_sections` として警告します。`w:pgBorders`、`w:cols`、先頭ページだけ異なるヘッダー/フッター設定、未対応section breakは検出と警告に留めます。

未対応のコメント、脚注、文末脚注、グラフ、SmartArt、ヘッダー、フッター、マクロ、外部リンク画像、空本文などは `ImportWarning` として記録します。安全に読み込める場合は警告付きで続行し、重大なエラーは読み込み確認画面で適用を止めます。

### DOCX画像

Rust側は `word/document.xml`、`word/_rels/document.xml.rels`、`word/media/*` を検査し、可能な範囲でヘッダー/フッターのrelationshipも検出します。内部relationshipのtargetは絶対パスと `..` を拒否し、外部relationshipは画像を取得せず `image.external_relationship` として警告します。

対応画像形式はPNG、JPEG、GIFです。画像は許可MIME、サイズ上限、総容量上限、拡張子とmagic byteの一致を確認したうえで `DocumentProject.assets` にbase64で保持します。Tiptapの画像ノードは `assetId` を持ち、表示用にdata URLも保持しますが、Blob URLや外部URLは永続化しません。

同じchecksumの画像は同一assetとして扱います。未使用assetは現時点ではプロジェクト内に保持します。JSONへ画像base64を含めるため、画像の多いプロジェクトでは保存ファイルが大きくなります。将来的にはバイナリアセットの分離保存を検討します。

## DOCX書き出し

`DocumentProject -> ExportDocument -> docx.js -> DOCX bytes -> Tauri保存` の順に変換します。`ExportDocument` はReact、Tauri、docx.jsクラスへ依存しません。画像は `assetId` から `DocumentProject.assets` を解決し、docx.jsの `ImageRun` として新しいDOCXへ書き出します。assetを解決できない場合は書き出しエラーにします。

ページ設定はdocx.jsのsection page size/marginsへ反映します。段落/見出しの揃え、インデント、段落前後間隔、行間、段落前改ページ、keepNext、keepLinesは可能な範囲でParagraph optionsへ反映します。段落に個別書式がない場合は `DocumentProject.documentDefaults` から `spacing.before`、`spacing.after`、`spacing.line`、`spacing.lineRule`、`alignment`、`indent` を明示的に生成します。個人の表示設定はDOCXへ自動出力しません。

`hardBreak` は段落内改行として、`pageBreak` は専用の改ページ要素として書き出します。`widowControl`、ページ罫線、段組み、複数セクションは現時点では書き出し対象外です。
