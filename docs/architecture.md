# Architecture

## 方針

このアプリは完全ローカルで動作し、AI API、外部変換サービス、外部参照の自動取得を使用しません。元DOCX、内部プロジェクト、書き出しDOCXを分離し、元DOCXを上書きしません。

## レイヤー

- `src/document-model/`: Zodで検証する `DocumentProject` とマイグレーション。
- `src/features/editor/`: Tiptap設定、編集UI、アウトライン。
- `src/features/import-docx/`: Mammoth.js、HTMLサニタイズ、変換確認。
- `src/classification/`: Wordスタイル、リスト情報、書式、文字列パターンによる決定的分類。
- `src/features/export-docx/`: UI非依存の `ExportDocument` とdocx.js変換。
- `src/project/`: JSONシリアライズ、読み込み、保存、自動保存、最近使ったプロジェクト。
- `src/app/`: アプリ情報、初回案内、未保存変更ガード、ユーザー向けエラー分類。
- `src/stores/`: 文書内容とは分離した個人設定。現在は編集時の改行動作、表示行間、表示段落間隔、編集記号表示を保持します。
- `src-tauri/src/docx/`: ZIP安全検査とOOXML補助情報抽出の入口。

## 保存形式

本文はTiptap JSONを正規形式として `DocumentProject.editorContent` に保持します。ページ設定、選択段落用の現在書式、ヘッダー、フッター、文書既定段落書式、警告、分類結果、アセット、作成/更新/書き出し時刻も同じプロジェクトJSONに保存します。

`DocumentProject.pageSettings` はDOCX由来の用紙幅/高さmm、向き、上下左右余白、ヘッダー/フッター/とじしろ余白を保持します。既存UI互換のため `marginsMm` も当面保持しますが、DOCX入出力では `margins` を正とします。段落と見出しのDOCX由来書式はTiptapノード属性 `paragraphFormatting` に、検証済みの既知キーだけを保存します。

`DocumentProject.paragraphSettings` は設定パネルで最後に編集した選択段落/見出しの書式を保持します。段落ごとの実データはTiptapノード属性 `paragraphFormatting` が正で、DOCX書き出しもこの属性を優先します。

`DocumentProject.header` と `DocumentProject.footer` は本文とは独立したTiptap JSON、plain text、import metadataを保持します。ページ番号は `footer.pageNumberPosition` に `none`、`left`、`center`、`right` として保存します。DOCX入出力は現時点ではヘッダー/フッターのplain textとページ番号を対象にします。

表は `DocumentProject.editorContent` 内のTiptap table JSONを正規形式とします。`table` は任意の `tableWidthPx`、`tableCell` / `tableHeader` はTiptap標準の `colspan`、`rowspan`、`colwidth` に加えて、検証済みHEX背景色 `backgroundColor` と `top` / `middle` / `bottom` の `verticalAlign` を保持します。同じ情報を別フィールドへ重複保存しません。

`DocumentProject.documentDefaults` は新規文書作成時に決定された本文段落と見出しの単純な既定書式です。個人の表示設定を変更しても既存文書の `documentDefaults` は自動変更しません。

個人設定はローカルストレージに保存し、`DocumentProject` には保存しません。行間、段落間隔、編集記号、Enter/Shift+Enterの入力動作は表示・入力設定です。設定変更はTiptap JSONやDOCX書式を直接変更しません。

最近使ったプロジェクトは `neword.recentProjects.v1` としてローカルストレージに保存します。保存するのはローカルファイルパス、表示名、最後に開いた日時のみです。文書本文、画像Base64、DOCX内容は保存しません。不正な履歴データはZod検証で無視または既定値へ戻し、アプリ起動を止めません。

初回起動案内の表示済み状態は `neword.onboarding.v1` として保存します。設定本体とは別キーにして、既存ユーザー設定の形式変更を避けています。

## 保存と復旧

通常保存、自動保存、保存前バックアップ、atomic保存、復旧候補の判定は `src/project/` とRust file commandに分離します。自動保存は通常プロジェクトファイルを直接上書きせず、復旧用 `AutosaveEnvelope` としてアプリ専用復旧ディレクトリへ保存します。詳細なファイル役割、命名規則、保存キュー、復旧UI、整理条件は [recovery.md](./recovery.md) に記載します。

未保存変更の保護は `src/app/unsavedChanges.ts` の判定を入口にし、新規作成、別プロジェクトを開く、DOCX読み込み、ホームへ戻る、ウィンドウ終了で同じ3択確認を使います。「保存する」は既存保存先があれば上書き保存し、未保存プロジェクトでは保存先選択を開きます。保存失敗時は操作を続行しません。

エラー表示は `src/app/appErrors.ts` で分類します。ファイル未検出、権限、破損、未対応形式、DOCX安全検査、形式バージョン、保存失敗、容量不足の可能性、DOCX生成失敗、不明エラーをユーザー向け文言に変換します。長いBase64、data URL、XMLらしき詳細は通常表示前に省略します。

## DOCX読み込み

TauriのファイルダイアログでDOCXを選択し、Rust側でDOCXをZIPとして検証します。Rust側はpath traversal、過大entry、異常な圧縮率、マクロ、主要OOXML partの有無を検出します。

検査後、ローカルファイルをbase64でブラウザ側へ渡し、Mammoth.jsがDOCXからHTMLを抽出します。HTMLはDOMPurifyで許可タグ・許可属性を明示してサニタイズし、外部リンク画像の `src` は削除します。サニタイズ済みHTMLは一時的な変換入力として扱い、永続形式は `ImportDocument` とTiptap JSONに分離します。

Rust側は `word/document.xml` の `w:sectPr`、`w:pgSz`、`w:pgMar`、`w:pPr`、`w:jc`、`w:ind`、`w:spacing`、`w:pageBreakBefore`、`w:keepNext`、`w:keepLines`、`w:br w:type="page"`、header/footer referenceを補助情報として抽出します。参照された `word/header*.xml` と `word/footer*.xml` からは安全な範囲でテキストとPAGEフィールドを抽出します。フロント側は段落順でMammoth HTMLへ制御済み属性を付与し、Tiptapの段落/見出し属性として保持します。Word固有の段落間隔や行間を単純な内部書式へ変換した場合は `PARAGRAPH_SPACING_SIMPLIFIED` を記録します。

表の本文構造はMammoth HTMLをTiptap tableへ変換します。HTMLで安定して表現できる `colspan`、`rowspan`、セル幅、表幅、セル背景色、縦方向配置、ヘッダーセルはサニタイズ済み属性に正規化して保持します。Rust側OOXML inspectionは、入れ子表、floating/text wrapping、セル内画像・オブジェクト、数式、SmartArt/グラフ、structured document tag、斜線セル、過大な表など、Mammoth HTMLだけでは黙って失われやすい構造を `table.*` warning metadataとして返します。Mammoth HTMLとRust側セルindexの対応が不安定なため、Rust inspectionで得たセル書式を無理にTiptapセルへ合成しません。

複数セクションは現段階では内部セクション構造へ展開しません。最初のセクションを文書全体のページ設定として使用し、2つ目以降は `section.multiple_sections` として警告します。`w:pgBorders`、`w:cols`、先頭ページだけ異なるヘッダー/フッター設定、未対応section breakは検出と警告に留めます。

未対応のコメント、脚注、文末脚注、グラフ、SmartArt、複数種類のヘッダー/フッター、奇数偶数ページ別ヘッダー/フッター、First Pageヘッダー/フッター、マクロ、外部リンク画像、空本文などは `ImportWarning` として記録します。安全に読み込める場合は警告付きで続行し、重大なエラーは読み込み確認画面で適用を止めます。

### DOCX画像

Rust側は `word/document.xml`、`word/_rels/document.xml.rels`、`word/media/*` を検査し、可能な範囲でヘッダー/フッターのrelationshipも検出します。内部relationshipのtargetは絶対パスと `..` を拒否し、外部relationshipは画像を取得せず `image.external_relationship` として警告します。

対応画像形式はPNG、JPEG、GIF、WebPです。画像は許可MIME、サイズ上限、総容量上限、拡張子とmagic byteの一致を確認したうえで `DocumentProject.assets` にbase64で保持します。Tiptapの画像ノードは `assetId`、表示幅/高さpx、縦横比維持、左/中央/右配置、代替テキストを保持します。画像nodeへbase64本文は保存せず、保存時にruntime用data URLを取り除き、エディタ表示時だけ `DocumentProject.assets` から復元します。

ローカル画像挿入はTauriファイルダイアログとローカルbinary read commandを使います。1枚あたり10MB、最大8000px、最大2400万pixelを上限とし、初期表示は680px幅以内へ縮小します。これらはJSON保存時のbase64増加とプレビュー負荷を抑えるための安全上限です。WebPは保存と表示の対象ですが、現在のDOCX exportではdocx.jsへ渡さず未対応MIMEとしてエラーにします。

同じchecksumの画像は同一assetとして扱います。未使用assetは現時点ではプロジェクト内に保持します。JSONへ画像base64を含めるため、画像の多いプロジェクトでは保存ファイルが大きくなります。将来的にはバイナリアセットの分離保存を検討します。

## DOCX書き出し

`DocumentProject -> ExportDocument -> docx.js -> DOCX bytes -> Tauri保存` の順に変換します。`ExportDocument` はReact、Tauri、docx.jsクラスへ依存しません。画像は `assetId` から `DocumentProject.assets` を解決し、docx.jsの `ImageRun` として新しいDOCXへ書き出します。assetを解決できない場合は書き出しエラーにします。

ページ設定はdocx.jsのsection page size/marginsへ反映します。ヘッダー/フッターはplain textをdocx.jsの `Header` / `Footer` へ出力し、ページ番号はfooter内のPAGEフィールドとして出力します。段落/見出しの揃え、インデント、段落前後間隔、行間、段落前改ページ、keepNext、keepLinesは可能な範囲でParagraph optionsへ反映します。段落に個別書式がない場合は `DocumentProject.documentDefaults` から `spacing.before`、`spacing.after`、`spacing.line`、`spacing.lineRule`、`alignment`、`indent` を明示的に生成します。個人の表示設定はDOCXへ自動出力しません。

画像は `ExportDocument` の image blockへ変換し、`assetId` で `DocumentProject.assets` を解決してからdocx.js `ImageRun` を生成します。対応する出力はPNG/JPEG/GIFの画像データ、幅/高さ、代替テキスト、左/中央/右の段落配置です。asset欠落、base64欠落、未対応MIMEは書き出しエラーにします。元DOCXのfloating/anchor配置、crop、rotation、特殊効果はpatchせず、新規DOCXの通常画像へ単純化します。

表は `ExportDocument` の正規化済み table modelへ変換してからdocx.jsの `Table`、`TableRow`、`TableCell` を生成します。対応する出力は行、セル、ヘッダー行、`gridSpan`、`vMerge`、列幅、表幅、セル背景色、セル内縦方向配置、セル内の複数段落、空セル、基本テキスト装飾です。列幅・表幅はpxを既存のunit conversion moduleでtwipsへ変換します。幅が不明、負数、NaN、Infinityの場合は自動幅として扱います。

`hardBreak` は段落内改行として、`pageBreak` は専用の改ページ要素として書き出します。`widowControl`、ページ罫線、段組み、複数セクションは現時点では書き出し対象外です。

ページ表示と明示的改ページの詳細は [page-display.md](./page-display.md) に記載します。画面上のページ境界は `pageSettings` から派生した表示であり、DocumentProjectへ自動ページ分割結果は保存しません。
