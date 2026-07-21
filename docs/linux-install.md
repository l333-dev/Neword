# Linux Install

## Build

Ubuntu上で次を実行します。

```bash
corepack pnpm install
corepack pnpm tauri build
```

成果物は `src-tauri/target/release/bundle/` 以下に生成されます。実際に生成される形式はTauri bundlerとOS環境に依存します。

## `.deb`

`.deb` が生成された場合は次の形式でインストールします。

```bash
sudo apt install ./src-tauri/target/release/bundle/deb/personal-doc-editor_0.1.0_amd64.deb
```

インストール後はデスクトップ環境のアプリ一覧から「Personal Document Editor」を起動できます。

アンインストール:

```bash
sudo apt remove personal-doc-editor
```

## AppImage

AppImageが生成された場合は実行権限を付与して起動します。

```bash
chmod +x ./src-tauri/target/release/bundle/appimage/personal-doc-editor_0.1.0_amd64.AppImage
./src-tauri/target/release/bundle/appimage/personal-doc-editor_0.1.0_amd64.AppImage
```

AppImageのアンインストールは、配置したAppImageファイルを削除します。

## Data Locations

- ユーザーが保存したプロジェクト: 保存ダイアログで選んだ `.json`
- ユーザー設定: WebView localStorage `neword.userPreferences.v1`
- 最近使ったファイル: WebView localStorage `neword.recentProjects.v1`
- 初回案内状態: WebView localStorage `neword.onboarding.v1`
- 自動保存/リカバリ: About画面に表示される復旧ディレクトリ。現在はRustの `std::env::temp_dir()/neword-recovery`
- 一時ファイル: atomic保存時に保存先ディレクトリへ作成される隠し `.tmp`

文書本文、画像Base64、DOCX内部XMLは最近使ったファイル履歴やユーザー設定には保存しません。
