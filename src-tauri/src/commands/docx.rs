use crate::docx::package::{inspect_docx, DocxInspection};

#[tauri::command]
pub fn inspect_docx_package(path: String) -> Result<DocxInspection, String> {
    inspect_docx(path)
}
