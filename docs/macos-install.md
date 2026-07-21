# macOS Install

## Build

macOS上で次を実行します。

```bash
corepack pnpm install
corepack pnpm tauri build
```

`.app` または `.dmg` は `src-tauri/target/release/bundle/` 以下に生成されます。Ubuntu上ではmacOS用アプリは通常生成できません。

## Install

`.dmg` が生成された場合は開いて、`Personal Document Editor.app` をApplicationsフォルダへ移動します。`.app` のみが生成された場合もApplicationsフォルダへ配置できます。

第10段階ではコード署名と公証は必須ではありません。未署名アプリとして警告される場合があります。初回起動時はFinderでアプリを右クリックして「開く」を選び、表示された確認で起動してください。Gatekeeperなどのセキュリティ機能を恒久的に無効化する手順は案内しません。

## Uninstall

Applicationsフォルダから `Personal Document Editor.app` を削除します。必要に応じて、WebViewのサイトデータと復旧ディレクトリも削除してください。

## Data Locations

- ユーザーが保存したプロジェクト: 保存ダイアログで選んだ `.json`
- ユーザー設定: WebView localStorage `neword.userPreferences.v1`
- 最近使ったファイル: WebView localStorage `neword.recentProjects.v1`
- 初回案内状態: WebView localStorage `neword.onboarding.v1`
- 自動保存/リカバリ: About画面に表示される復旧ディレクトリ。現在はRustの `std::env::temp_dir()/neword-recovery`
- 一時ファイル: atomic保存時に保存先ディレクトリへ作成される隠し `.tmp`

内部プロジェクト保存とDOCX書き出しは別操作です。読み込んだ元DOCXは直接変更しません。
