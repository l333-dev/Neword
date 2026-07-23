use std::collections::HashSet;
use std::sync::Mutex;

use crate::docx::package::{inspect_docx, inspect_docx_with_cancel, DocxInspection};

#[derive(Default)]
pub struct DocxImportCancellationState {
    cancelled: Mutex<HashSet<String>>,
}

#[tauri::command]
pub fn inspect_docx_package(path: String) -> Result<DocxInspection, String> {
    inspect_docx(path)
}

#[tauri::command]
pub fn inspect_docx_package_cancellable(
    state: tauri::State<'_, DocxImportCancellationState>,
    path: String,
    request_id: String,
) -> Result<DocxInspection, String> {
    {
        let mut cancelled = state
            .cancelled
            .lock()
            .map_err(|_| "cancel state poisoned")?;
        cancelled.remove(&request_id);
    }
    let result = inspect_docx_with_cancel(path, || {
        state
            .cancelled
            .lock()
            .map(|cancelled| cancelled.contains(&request_id))
            .unwrap_or(false)
    });
    if let Ok(mut cancelled) = state.cancelled.lock() {
        cancelled.remove(&request_id);
    }
    result
}

#[tauri::command]
pub fn cancel_docx_import(
    state: tauri::State<'_, DocxImportCancellationState>,
    request_id: String,
) -> Result<(), String> {
    let mut cancelled = state
        .cancelled
        .lock()
        .map_err(|_| "cancel state poisoned")?;
    cancelled.insert(request_id);
    Ok(())
}
