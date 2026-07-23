use tauri::menu::{Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const MENU_EVENT: &str = "neword://menu-command";

pub const MENU_COMMANDS: &[&str] = &[
    "file.new",
    "file.open",
    "file.open_recent",
    "file.save",
    "file.save_as",
    "file.import_docx",
    "file.export_docx",
    "file.home",
    "file.close_window",
    "file.quit",
    "edit.undo",
    "edit.redo",
    "edit.find",
    "edit.cut",
    "edit.copy",
    "edit.paste",
    "edit.select_all",
    "view.toggle_sidebar",
    "view.toggle_toolbar",
    "view.toggle_settings",
    "view.theme_light",
    "view.theme_dark",
    "view.theme_system",
    "document.page_settings",
    "document.header_footer",
    "document.page_numbers",
    "document.insert_page_break",
    "document.info",
    "document.import_warnings",
    "help.first_run",
    "help.recovery",
    "help.backups",
    "help.data_locations",
    "help.about",
];

pub fn install_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = Menu::with_items(
        app,
        &[
            &file_menu(app)?,
            &edit_menu(app)?,
            &view_menu(app)?,
            &document_menu(app)?,
            &help_menu(app)?,
        ],
    )?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref().to_string();
        if MENU_COMMANDS.contains(&id.as_str()) {
            let _ = app.emit(MENU_EVENT, id);
        }
    });
    Ok(())
}

fn item<R: Runtime, M: Manager<R>>(
    manager: &M,
    id: &str,
    text: &str,
    accelerator: Option<&str>,
) -> tauri::Result<tauri::menu::MenuItem<R>> {
    let builder = MenuItemBuilder::with_id(id, text);
    let builder = if let Some(accelerator) = accelerator {
        builder.accelerator(accelerator)
    } else {
        builder
    };
    builder.build(manager)
}

fn file_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    SubmenuBuilder::new(app, "ファイル")
        .item(&item(app, "file.new", "新規文書", Some("CmdOrCtrl+N"))?)
        .item(&item(
            app,
            "file.open",
            "プロジェクトを開く",
            Some("CmdOrCtrl+O"),
        )?)
        .item(&item(
            app,
            "file.open_recent",
            "最近使ったプロジェクト",
            None,
        )?)
        .separator()
        .item(&item(
            app,
            "file.save",
            "プロジェクトを保存",
            Some("CmdOrCtrl+S"),
        )?)
        .item(&item(
            app,
            "file.save_as",
            "名前を付けてプロジェクトを保存",
            Some("CmdOrCtrl+Shift+S"),
        )?)
        .separator()
        .item(&item(app, "file.import_docx", "DOCXを読み込む", None)?)
        .item(&item(app, "file.export_docx", "DOCXへ書き出す", None)?)
        .separator()
        .item(&item(app, "file.home", "ホームへ戻る", None)?)
        .item(&item(app, "file.close_window", "ウィンドウを閉じる", None)?)
        .item(&item(
            app,
            "file.quit",
            "アプリを終了",
            Some("CmdOrCtrl+Q"),
        )?)
        .build()
}

fn edit_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    SubmenuBuilder::new(app, "編集")
        .undo()
        .redo()
        .item(&item(app, "edit.find", "検索と置換", Some("CmdOrCtrl+F"))?)
        .separator()
        .cut()
        .copy()
        .paste()
        .separator()
        .select_all()
        .build()
}

fn view_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    SubmenuBuilder::new(app, "表示")
        .item(&item(
            app,
            "view.toggle_sidebar",
            "サイドバー表示切り替え",
            None,
        )?)
        .item(&item(
            app,
            "view.toggle_toolbar",
            "ツールバー表示切り替え",
            None,
        )?)
        .item(&item(
            app,
            "view.toggle_settings",
            "設定パネル表示切り替え",
            Some("CmdOrCtrl+,"),
        )?)
        .separator()
        .item(&item(app, "view.theme_light", "ライトモード", None)?)
        .item(&item(app, "view.theme_dark", "ダークモード", None)?)
        .item(&item(app, "view.theme_system", "システム設定に従う", None)?)
        .build()
}

fn document_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    SubmenuBuilder::new(app, "文書")
        .item(&item(app, "document.page_settings", "ページ設定", None)?)
        .item(&item(
            app,
            "document.header_footer",
            "ヘッダー・フッター",
            None,
        )?)
        .item(&item(app, "document.page_numbers", "ページ番号", None)?)
        .item(&item(
            app,
            "document.insert_page_break",
            "改ページを挿入",
            None,
        )?)
        .separator()
        .item(&item(app, "document.info", "文書情報", None)?)
        .item(&item(
            app,
            "document.import_warnings",
            "ImportWarningを表示",
            None,
        )?)
        .build()
}

fn help_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    SubmenuBuilder::new(app, "ヘルプ")
        .item(&item(app, "help.first_run", "初回起動案内", None)?)
        .item(&item(app, "help.recovery", "リカバリ管理", None)?)
        .item(&item(app, "help.backups", "バックアップ管理", None)?)
        .item(&item(app, "help.data_locations", "データ保存場所", None)?)
        .item(&item(app, "help.about", "このアプリについて", None)?)
        .build()
}
