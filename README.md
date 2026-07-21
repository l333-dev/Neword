# Personal Document Editor

AIやクラウド変換を使わない、個人用のローカルDOCX文書エディタです。

## 開発

```bash
corepack pnpm install
corepack pnpm tauri dev
```

## 利用者として起動する

Ubuntuでは本番ビルド後に `src-tauri/target/release/bundle/` 以下へ `.deb` や AppImage が生成されます。`.deb` は次のようにインストールできます。

```bash
sudo apt install ./src-tauri/target/release/bundle/deb/personal-doc-editor_0.1.0_amd64.deb
```

AppImageが生成された場合は実行権限を付けて起動します。

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
- JSON形式のプロジェクト保存/読み込み
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
- 初回起動案内と「このアプリについて」
- Linux/macOS向けTauriアイコン参照

## 制約

DOCX互換性は限定的です。元DOCXを直接変更せず、対応できない要素は警告対象として扱います。商用フォントがインストールされていることは前提にしていません。

内部プロジェクト保存とDOCX書き出しは別操作です。「プロジェクト保存」は編集状態を `.json` に保存し、「DOCXへ書き出す」は新しいDOCXを生成します。読み込んだ元DOCXは上書きしません。

個人設定は現在 `localStorage` の `neword.userPreferences.v1` に保存されます。最近使ったファイルは `neword.recentProjects.v1`、初回案内の表示済み状態は `neword.onboarding.v1` に保存されます。これらには文書本文、画像Base64、DOCX内容を保存しません。テーマや表示行間などの表示設定は文書内容、プロジェクトJSON、DOCX書き出しには自動反映されません。

自動保存とリカバリデータはTauri/Rust側の復旧ディレクトリに保存されます。現在の実装では `std::env::temp_dir()/neword-recovery` です。アプリ内の「このアプリについて」から実際のパスを確認できます。

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
