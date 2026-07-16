use std::fs::File;
use std::io::Read;
use std::path::Path;

use serde::Serialize;
use zip::read::ZipArchive;

const MAX_ENTRY_UNCOMPRESSED_SIZE: u64 = 25 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_SIZE: u64 = 150 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 120;

#[derive(Debug, Serialize)]
pub struct DocxEntryInfo {
    name: String,
    compressed_size: u64,
    uncompressed_size: u64,
}

#[derive(Debug, Serialize)]
pub struct DocxInspection {
    has_document_xml: bool,
    has_styles_xml: bool,
    has_numbering_xml: bool,
    has_settings_xml: bool,
    has_headers: bool,
    has_footers: bool,
    has_macros: bool,
    media_entries: Vec<String>,
    entries: Vec<DocxEntryInfo>,
    warnings: Vec<String>,
}

fn validate_zip_path(name: &str) -> Result<(), String> {
    if name.starts_with('/') || name.starts_with('\\') || name.contains("..") {
        return Err("unsafe ZIP entry path".to_string());
    }
    Ok(())
}

pub fn inspect_docx<P: AsRef<Path>>(path: P) -> Result<DocxInspection, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let mut total_uncompressed = 0_u64;
    let mut inspection = DocxInspection {
        has_document_xml: false,
        has_styles_xml: false,
        has_numbering_xml: false,
        has_settings_xml: false,
        has_headers: false,
        has_footers: false,
        has_macros: false,
        media_entries: Vec::new(),
        entries: Vec::new(),
        warnings: Vec::new(),
    };

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let name = entry.name().to_string();
        validate_zip_path(&name)?;

        let compressed = entry.compressed_size();
        let uncompressed = entry.size();
        if uncompressed > MAX_ENTRY_UNCOMPRESSED_SIZE {
            return Err("DOCX contains an entry that is too large".to_string());
        }
        if compressed > 0 && uncompressed / compressed > MAX_COMPRESSION_RATIO {
            return Err("DOCX compression ratio is suspicious".to_string());
        }
        total_uncompressed = total_uncompressed.saturating_add(uncompressed);
        if total_uncompressed > MAX_TOTAL_UNCOMPRESSED_SIZE {
            return Err("DOCX uncompressed size is too large".to_string());
        }

        match name.as_str() {
            "word/document.xml" => inspection.has_document_xml = true,
            "word/styles.xml" => inspection.has_styles_xml = true,
            "word/numbering.xml" => inspection.has_numbering_xml = true,
            "word/settings.xml" => inspection.has_settings_xml = true,
            _ => {}
        }
        if name.starts_with("word/header") && name.ends_with(".xml") {
            inspection.has_headers = true;
        }
        if name.starts_with("word/footer") && name.ends_with(".xml") {
            inspection.has_footers = true;
        }
        if name == "word/vbaProject.bin" || name.ends_with(".bin") && name.contains("vba") {
            inspection.has_macros = true;
            inspection
                .warnings
                .push("macro-enabled content detected".to_string());
        }
        if name.starts_with("word/media/") {
            inspection.media_entries.push(name.clone());
        }
        if matches!(
            name.as_str(),
            "word/document.xml"
                | "word/styles.xml"
                | "word/numbering.xml"
                | "word/settings.xml"
                | "word/_rels/document.xml.rels"
        ) {
            let mut scratch = Vec::new();
            entry
                .by_ref()
                .take(MAX_ENTRY_UNCOMPRESSED_SIZE)
                .read_to_end(&mut scratch)
                .map_err(|error| error.to_string())?;
        }

        inspection.entries.push(DocxEntryInfo {
            name,
            compressed_size: compressed,
            uncompressed_size: uncompressed,
        });
    }

    if !inspection.has_document_xml {
        return Err("DOCX is missing word/document.xml".to_string());
    }

    Ok(inspection)
}

#[cfg(test)]
mod tests {
    use super::validate_zip_path;

    #[test]
    fn rejects_path_traversal() {
        assert!(validate_zip_path("../word/document.xml").is_err());
        assert!(validate_zip_path("/word/document.xml").is_err());
    }

    #[test]
    fn accepts_normal_docx_path() {
        assert!(validate_zip_path("word/document.xml").is_ok());
    }
}
