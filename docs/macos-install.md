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

第12段階でもコード署名と公証は必須ではありません。未署名アプリとして警告される場合があります。初回起動時はFinderでアプリを右クリックして「開く」を選び、表示された確認で起動してください。Gatekeeperなどのセキュリティ機能を恒久的に無効化する手順は案内しません。

## Desktop Integration

Tauri native menuはLinux/macOS共通のメニューIDで生成します。macOSではTauriの標準挙動に従ってアプリメニュー、About、QuitなどがOSの慣例に寄せられますが、Ubuntu環境では実機確認していません。ショートカット定義は `CmdOrCtrl` を使うため、macOSではCmd、LinuxではCtrlとして扱われます。

Tauri single-instance pluginは2回目起動時の引数を既存ウィンドウへ渡すために使用します。macOS Finderから `.neword` を開いた場合のfile-open eventは未確認で、現段階の確認済み経路は起動引数とsingle-instance eventです。

app data、recovery、backupsフォルダーはアプリ内のデータ管理から開けます。macOSでは標準の `open` コマンド経由で既知のアプリ管理ディレクトリだけを開きます。任意コマンド実行やユーザー入力パスの実行は許可していません。

## Uninstall

Applicationsフォルダから `Personal Document Editor.app` を削除します。必要に応じて、WebViewのサイトデータとTauri app dataも削除してください。ユーザーが任意の場所へ保存した `.neword` や `.json` プロジェクトはアプリ削除だけでは削除されません。

## Data Locations

- ユーザーが保存したプロジェクト: 保存ダイアログで選んだ `.neword`。従来 `.json` も読み込み可能
- ユーザー設定: WebView localStorage `neword.userPreferences.v1`
- 最近使ったファイル: WebView localStorage `neword.recentProjects.v1`
- 初回案内状態: WebView localStorage `neword.onboarding.v1`
- リカバリ: Tauri app data配下の `recovery/`
- 保存前バックアップ: Tauri app data配下の `backups/`
- 編集ロック: Tauri app data配下の `locks/`
- 移行状態: Tauri app data配下の `state/`
- 一時ファイル: atomic保存時に保存先ディレクトリへ作成される隠し `.tmp`

内部プロジェクト保存とDOCX書き出しは別操作です。読み込んだ元DOCXは直接変更しません。
