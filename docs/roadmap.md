# Roadmap

## MVP

- 基本編集、JSON保存/読み込み、自動保存
- DOCX読み込み確認画面
- ルールベース分類
- DOCX新規書き出し
- ZIP安全検査とatomic保存
- ImportWarningによる未対応要素、マクロ、外部リンク画像、構造不備の明示
- DOCX埋め込み画像のrelationship解析、内部asset保持、DOCX書き出し
- 第10段階: ホーム画面、新規文書作成、最近使ったプロジェクト、未保存変更保護
- 第10段階: リカバリ候補の復旧/削除/後回しUI、壊れたリカバリデータの安全表示
- 第10段階: 初回起動案内、About画面、保存とDOCX書き出しの区別、Tauriアイコン設定
- 第10段階: Linux/macOS利用手順とアプリデータ保存場所のドキュメント
- 第11段階: リカバリ保存先をTauri app data `recovery/` へ移行
- 第11段階: 旧 `std::env::temp_dir()/neword-recovery` の安全な検証付き移行
- 第11段階: `.neword` 標準保存と従来 `.json` 読み込み互換
- 第11段階: app data `backups/` の保存前バックアップ、最大5世代保持、別名復元UI
- 第11段階: 保存時の外部更新検出、保存サイズ表示、保存キューによる同時保存抑止
- 第11段階: `.neword`、`.json`、`.docx` のドラッグ＆ドロップ読み込み基盤
- 第11段階: データ管理表示、リカバリ/バックアップ件数、最近使ったファイル履歴削除
- 第12段階: Tauri single-instance pluginによる単一インスタンス化と2回目起動引数の既存ウィンドウ転送
- 第12段階: 起動引数、ネイティブメニュー、ドラッグ＆ドロップからの `.neword` / `.json` / `.docx` オープン処理統一
- 第12段階: Linux `.neword` MIME定義、desktop entry `%F`、deb/rpm同梱設定
- 第12段階: app data `locks/` の編集ロック、読み取り専用モード、外部更新競合UI
- 第12段階: Tauriネイティブメニュー、共通ショートカット定義、app data/recovery/backupsフォルダーを開く操作
- 第12段階: DOCX import/exportのdynamic importとチャンク計測。メインJSは約1,761kBから約841kBへ削減
- 第12段階: AppImage失敗原因をFUSE/libfuse/fusermount不足として特定
- 第13段階: PIDとheartbeatを組み合わせた編集ロック判定、専用競合ダイアログ、編集可能コピー
- 第13段階: localStorage envelope `schemaVersion`、旧形式読み込み、設定/履歴/初回案内の個別初期化入口
- 第13段階: app data内の一時ファイル整理、stale編集ロック整理、正常/壊れたリカバリの個別削除
- 第13段階: 文書内検索、前後移動、検索ハイライト、1件/全件置換、読み取り専用時の置換禁止
- 第13段階: position付きアウトライン移動、現在見出し強調、文書統計
- 第13段階: DOCX読み込みの段階表示、論理キャンセル、ImportWarning category/severity表示
- 第14段階: DOCXインポートの段階別パイプライン整理、Mammoth変換Web Worker化、Worker requestId/progress/cancel/error処理
- 第14段階: Rust ZIP/OOXML検査のrequestId付きキャンセル、キャンセル後の結果破棄、再インポート可能化
- 第14段階: コメント、脚注、文末脚注、数式、SmartArt/diagram、グラフ、OLE、変更履歴、外部画像、外部テンプレート検出
- 第14段階: ImportWarningの安全な集約、fixture生成基盤、round tripテスト方針ドキュメント

## 次に強化する項目

- 編集ロックのOS起動時刻取得、PID再利用のより厳密な判定、macOS/Windows PID確認
- Finder file-open、macOSアプリメニュー、Cmdショートカットの実機確認
- データ管理UIの削除前プレビュー、文書ごとのバックアップ削除、容量集計の詳細化
- localStorageの複数WebView同時更新競合解決
- ドラッグ＆ドロップ複数ファイル選択UIと本文画像ドロップとの詳細な分離
- AppImageをFUSE 2またはCI/コンテナ環境で生成する手順の確定
- DOCX Worker/Import UIチャンクのさらなる分割と、DOMPurify/classificationの重複を避けた最適化
- DOCXキャンセルのXML token単位中断と、より正確な進捗率
- DOCM、異常圧縮率、entry数超過などの追加fixtureとCI生成確認
- macOSコード署名、公証、配布用DMGの確認
- OOXMLの段落揃え、インデント、行間、余白のUI編集強化
- セクション単位のページ設定保持と書き出し
- ヘッダー/フッター本文、ページ罫線、段組みの保持
- 未使用asset整理、バイナリアセット分離保存、WebPのDOCX書き出し変換
- Word表スタイル、floating table、入れ子表など高度な表互換性の強化
- DOCX読み込み時のページ区切り検出精度向上
- 外部変更検出の強化と復旧版の別名保存導線
- 複数セクションの独立編集とWord互換ページネーションの改善
- 大きな画像と多数画像のプレビュー性能改善
- 読み込み確認画面から警告箇所へ移動するナビゲーション

## 未対応DOCX機能

- コメント、変更履歴、脚注、文末脚注の編集と再書き出し
- 数式、SmartArt、グラフの編集と再書き出し
- SVG、EMF、WMF、WebPのDOCX書き出し
- 画像crop、rotation、特殊効果、floating/anchored layoutの完全保持
- 複雑なセクション分割
- ページ罫線、段組み、セクションごとの差分ページ設定
- Word固有の高度なスタイル継承
- floating table、入れ子表、斜線付きセル、複雑な表スタイル継承
- マクロ実行または保存
