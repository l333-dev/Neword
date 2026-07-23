# Personal Document Editor

AIやクラウド変換を使わない、個人用のローカルDOCX文書エディタです。

## 開発

```bash
corepack pnpm install
corepack pnpm tauri dev
```

## 利用者として起動する

Ubuntuでは本番ビルド後に `src-tauri/target/release/bundle/` 以下へ `.deb` と `.rpm` が生成されます。`.deb` は次のようにインストールできます。

```bash
sudo apt install "./src-tauri/target/release/bundle/deb/Personal Document Editor_0.1.0_amd64.deb"
```

AppImageは現在の環境では `linuxdeploy` 実行に失敗するため、Ubuntu向けの正式な確認済み形式は `.deb` です。AppImageが生成できる環境では実行権限を付けて起動します。

```bash
chmod +x ./src-tauri/target/release/bundle/appimage/personal-doc-editor_0.1.0_amd64.AppImage
./src-tauri/target/release/bundle/appimage/personal-doc-editor_0.1.0_amd64.AppImage
```

macOSではmacOS上で `corepack pnpm tauri build` を実行し、生成された `.app` または `.dmg` をApplicationsへ配置します。第10段階ではコード署名と公証は必須にしていないため、未署名アプリとして警告される場合があります。その場合はFinderでアプリを右クリックして「開く」を選び、確認して起動してください。恒久的にセキュリティ機能を無効化する設定は推奨しません。

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
- `.neword`形式のプロジェクト保存/読み込み
- 従来のJSON形式プロジェクト読み込み
- 保存済み/未保存/保存中/保存エラー表示
- 保存済みプロジェクトへの自動保存
- ライト、ダーク、システム連動テーマ
- アクセントカラー、UI文字サイズ、エディタ最大幅の個人設定
- 編集画面だけに反映される表示行間、表示段落間隔、見出し間隔プリセット
- アウトライン、設定パネル、エディタツールバー、保存状態の表示切り替え
- アウトラインと設定パネルの左右配置切り替え
- ツールバーの上・下配置、ボタンサイズ、ラベル表示、ボタン単位の表示切り替え
- ツールバーボタンの上下移動による並べ替えとツールバー設定リセット
- Rust側のZIP安全検査を経由したMammoth.jsベースのDOCX読み込み確認フロー
- 未対応要素、マクロ、外部リンク画像、構造不備のImportWarning表示
- DOCX埋め込み画像の内部アセット保持とDOCX再書き出し
- `ExportDocument` 中間形式を経由したDOCX書き出し
- 起動時ホーム画面、新規文書作成、最近使ったプロジェクト
- 未保存変更の3択確認、リカバリ候補の復旧/削除/後回し
- Tauri app data配下のリカバリ保存、旧一時リカバリの安全な移行
- app data配下の保存前バックアップ、最大5世代保持、バックアップから別名復元
- 保存先ファイルの外部更新検出と無警告上書き防止
- 単一インスタンス起動、起動引数からの `.neword` / `.json` / `.docx` オープン
- Linux向け `.neword` MIME定義とdesktop entryの `%F` 引数対応
- app data配下の編集ロック、競合時の読み取り専用/強制編集/キャンセル選択
- PIDとheartbeatを組み合わせた編集ロック判定、専用競合ダイアログ、編集可能コピー
- 読み取り専用モードでの編集、通常保存、自動保存、リカバリ保存の抑止
- Tauriネイティブメニューと共通アプリコマンド
- `.neword`、従来`.json`、`.docx`のドラッグ＆ドロップ読み込み
- DOCX読み込み/書き出し処理のdynamic importによる初回JSチャンク削減
- 文書内検索、前後移動、正規表現/大文字小文字/単語単位オプション
- 1件置換、すべて置換、検索結果ハイライト
- 見出しアウトライン移動と文書統計
- DOCX読み込みの段階表示、論理キャンセル、ImportWarning分類
- DOCXインポートのMammoth変換Web Worker化、requestId付きキャンセル、Rust ZIP/OOXML検査キャンセル
- コメント、脚注、文末脚注、数式、SmartArt、グラフ、OLE、変更履歴、外部テンプレートの検出と安全なImportWarning集約
- 初回起動案内と「このアプリについて」
- Linux/macOS向けTauriアイコン参照

## 制約

DOCX互換性は限定的です。元DOCXを直接変更せず、対応できない要素は警告対象として扱います。商用フォントがインストールされていることは前提にしていません。

内部プロジェクト保存とDOCX書き出しは別操作です。「プロジェクト保存」は編集状態を標準で `.neword` に保存し、「DOCXへ書き出す」は新しいDOCXを生成します。`.neword` の中身はZod検証されるバージョン付きJSONです。従来の `.json` プロジェクトも引き続き読み込めます。読み込んだ元DOCXは上書きしません。

個人設定は現在 `localStorage` の `neword.userPreferences.v1` に保存されます。最近使ったファイルは `neword.recentProjects.v1`、初回案内の表示済み状態は `neword.onboarding.v1` に保存されます。これらには文書本文、画像Base64、DOCX内容を保存しません。テーマや表示行間などの表示設定は文書内容、プロジェクトJSON、DOCX書き出しには自動反映されません。

自動保存由来のリカバリデータと保存前バックアップはTauri標準のapp data配下に保存されます。用途別に `recovery/`、`backups/`、`state/`、`logs/` を作成しますが、通常ログへ文書本文や画像Base64は保存しません。旧 `std::env::temp_dir()/neword-recovery` に残る復旧データは起動時に検証し、正常なものだけ新しい `recovery/` へ移行します。アプリ内の「このアプリについて」と設定パネルの「データ管理」から実際のパスを確認できます。

保存済みプロジェクトを明示的に上書き保存する直前、既存ファイルが正常なJSONとして読める場合だけapp dataの `backups/` にバックアップを作成します。復元したバックアップは元ファイルへ即上書きせず、未保存の文書として開きます。

同じプロジェクトを編集可能状態で開くとapp dataの `locks/` に編集セッション情報を保存します。別セッションの有効なロックがある場合は読み取り専用で開く、危険を承知して編集する、キャンセルする、の判断を求めます。起動済みアプリへ2回目の起動引数を渡すためにTauri single-instance pluginを使います。

Linux `.deb` には `application/x-neword-project` のMIME XMLと、`Exec=personal-doc-editor %F` を含むdesktop entryを同梱します。`.json` 全体や `.docx` の既定アプリは関連付けません。

DOCX関連の重い処理は、DOCX読み込みまたはDOCX書き出し操作を開始するまで読み込みません。第12段階の計測では初回メインJSチャンクは約1,761kBから約841kBへ削減されました。第14段階ではMammoth変換をVite Web Workerへ移し、DOCX入力ArrayBufferをWorkerへtransferしてメインスレッド側の大きな複製を減らしています。Tauri IPCは現段階ではBase64受け渡しを維持します。

設定パネルを非表示にした場合は、上部の「設定」ボタンまたは `Ctrl+,` で再表示できます。狭い画面では一時的にサイドバーを折りたたみ、設定パネルをオーバーレイ表示します。この一時表示は保存済みの個人設定を書き換えません。

## 本番ビルド

```bash
corepack pnpm install
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm test
corepack pnpm build
corepack pnpm tauri build
```

Rust側は次を実行します。

```bash
cd src-tauri
cargo fmt --check
cargo check
cargo test
```

Ubuntu上でmacOS用 `.app` / `.dmg` は通常生成できません。macOS成果物はmacOS上でビルドしてください。
