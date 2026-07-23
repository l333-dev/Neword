export const APP_COMMANDS = [
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
] as const;

export type AppCommand = (typeof APP_COMMANDS)[number];

const commandSet = new Set<string>(APP_COMMANDS);

export function isAppCommand(value: unknown): value is AppCommand {
  return typeof value === "string" && commandSet.has(value);
}

export function commandFromKeyboardEvent(event: KeyboardEvent): AppCommand | null {
  const ctrl = event.ctrlKey || event.metaKey;
  if (!ctrl || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "n") return "file.new";
  if (key === "o") return "file.open";
  if (key === "s" && event.shiftKey) return "file.save_as";
  if (key === "s") return "file.save";
  if (key === "," || key === "<") return "view.toggle_settings";
  if (key === "q") return "file.quit";
  if (key === "f") return "edit.find";
  if (key === "z" && event.shiftKey) return "edit.redo";
  if (key === "z") return "edit.undo";
  return null;
}
