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
sudo apt install "./src-tauri/target/release/bundle/deb/Personal Document Editor_0.1.0_amd64.deb"
```

インストール後はデスクトップ環境のアプリ一覧から「Personal Document Editor」を起動できます。

アンインストール:

```bash
sudo apt remove personal-doc-editor
```

## AppImage

現在の確認環境では `corepack pnpm tauri build --bundles appimage` が `failed to run linuxdeploy` で失敗します。`~/.cache/tauri/linuxdeploy-x86_64.AppImage --version` は `dlopen(): error loading libfuse.so.2`、`linuxdeploy-plugin-appimage.AppImage --version` は `No suitable fusermount binary found on the $PATH` とFUSE device不足を報告しました。危険なシステム変更や未検証バイナリ追加は行わず、Ubuntu向けの確認済み配布形式は `.deb` とします。

AppImageが生成できる環境では実行権限を付与して起動します。

```bash
chmod +x ./src-tauri/target/release/bundle/appimage/personal-doc-editor_0.1.0_amd64.AppImage
./src-tauri/target/release/bundle/appimage/personal-doc-editor_0.1.0_amd64.AppImage
```

AppImageのアンインストールは、配置したAppImageファイルを削除します。

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

文書本文、画像Base64、DOCX内部XMLは最近使ったファイル履歴やユーザー設定には保存しません。

## File Association

`.deb` と `.rpm` には `.neword` 用の独自MIME定義 `application/x-neword-project` とdesktop entryを同梱します。正式なIANA登録MIMEではありません。desktop entryのExec行は `personal-doc-editor %F` で、空白や日本語を含むファイルパスはデスクトップ環境から引数として渡されます。

`.json` 全体は関連付けません。従来 `.json` プロジェクトはアプリ内の「開く」または起動引数では読み込めますが、JSONファイル全般の既定アプリは変更しません。`.docx` の既定アプリも変更しません。

パッケージ内容の確認:

```bash
dpkg-deb -c "./src-tauri/target/release/bundle/deb/Personal Document Editor_0.1.0_amd64.deb" | grep -E 'mime|desktop|neword'
dpkg-deb -I "./src-tauri/target/release/bundle/deb/Personal Document Editor_0.1.0_amd64.deb"
```

インストール後の確認例:

```bash
xdg-mime query filetype "テスト.neword"
xdg-mime query default application/x-neword-project
```

第12段階ではシステム全体の既定アプリをアプリ側から無断変更する処理は実装していません。
