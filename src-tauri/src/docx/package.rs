use std::fs::File;
use std::io::Read;
use std::path::Path;

use base64::Engine;
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::Serialize;
use zip::read::ZipArchive;

const MAX_ENTRY_UNCOMPRESSED_SIZE: u64 = 25 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_SIZE: u64 = 150 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 120;
const MAX_IMAGE_UNCOMPRESSED_SIZE: u64 = 10 * 1024 * 1024;
const MAX_TOTAL_IMAGE_UNCOMPRESSED_SIZE: u64 = 40 * 1024 * 1024;
const IMAGE_RELATIONSHIP_TYPE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

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
    image_relationships: Vec<DocxImageRelationship>,
    entries: Vec<DocxEntryInfo>,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DocxImageRelationship {
    relationship_id: String,
    relationship_type: String,
    target: String,
    source_part: String,
    resolved_part: Option<String>,
    mime_type: Option<String>,
    byte_size: Option<u64>,
    data_base64: Option<String>,
    external: bool,
    checksum: Option<String>,
    warning_code: Option<String>,
    warning_message: Option<String>,
}

fn validate_zip_path(name: &str) -> Result<(), String> {
    if name.starts_with('/') || name.starts_with('\\') || name.contains("..") {
        return Err("unsafe ZIP entry path".to_string());
    }
    Ok(())
}

fn image_mime_from_path(path: &str) -> Option<&'static str> {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".png") {
        Some("image/png")
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        Some("image/jpeg")
    } else if lower.ends_with(".gif") {
        Some("image/gif")
    } else {
        None
    }
}

fn image_mime_from_magic(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else {
        None
    }
}

fn checksum_hex(bytes: &[u8]) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("fnv1a64:{hash:016x}")
}

fn source_part_from_rels(rels_part: &str) -> Option<String> {
    let marker = "/_rels/";
    let marker_index = rels_part.find(marker)?;
    let prefix = &rels_part[..marker_index];
    let file_name = rels_part[marker_index + marker.len()..].strip_suffix(".rels")?;
    Some(format!("{prefix}/{file_name}"))
}

fn resolve_relationship_target(source_part: &str, target: &str) -> Result<String, String> {
    if target.starts_with('/') || target.starts_with('\\') || target.contains("..") {
        return Err("image relationship target is unsafe".to_string());
    }
    let base = source_part
        .rsplit_once('/')
        .map(|(parent, _)| parent)
        .unwrap_or("");
    let resolved = if base.is_empty() {
        target.to_string()
    } else {
        format!("{base}/{target}")
    };
    validate_zip_path(&resolved)?;
    Ok(resolved)
}

fn parse_image_relationships(
    xml: &[u8],
    rels_part: &str,
) -> Result<Vec<DocxImageRelationship>, String> {
    let source_part =
        source_part_from_rels(rels_part).ok_or_else(|| "invalid rels part path".to_string())?;
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut relationships = Vec::new();
    let mut buffer = Vec::new();

    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Empty(event)) | Ok(Event::Start(event))
                if event.name().as_ref() == b"Relationship" =>
            {
                let mut id = String::new();
                let mut relationship_type = String::new();
                let mut target = String::new();
                let mut target_mode = String::new();

                for attribute in event.attributes() {
                    let attribute = attribute.map_err(|error| error.to_string())?;
                    let key = attribute.key.as_ref();
                    let value = attribute
                        .decode_and_unescape_value(reader.decoder())
                        .map_err(|error| error.to_string())?
                        .into_owned();
                    match key {
                        b"Id" => id = value,
                        b"Type" => relationship_type = value,
                        b"Target" => target = value,
                        b"TargetMode" => target_mode = value,
                        _ => {}
                    }
                }

                if relationship_type == IMAGE_RELATIONSHIP_TYPE {
                    let external = target_mode.eq_ignore_ascii_case("external");
                    let mut relationship = DocxImageRelationship {
                        relationship_id: id,
                        relationship_type,
                        target,
                        source_part: source_part.clone(),
                        resolved_part: None,
                        mime_type: None,
                        byte_size: None,
                        data_base64: None,
                        external,
                        checksum: None,
                        warning_code: None,
                        warning_message: None,
                    };
                    if external {
                        relationship.warning_code = Some("image.external_relationship".to_string());
                        relationship.warning_message =
                            Some("外部画像relationshipは読み込みません。".to_string());
                    } else {
                        match resolve_relationship_target(&source_part, &relationship.target) {
                            Ok(resolved) => relationship.resolved_part = Some(resolved),
                            Err(message) => {
                                relationship.warning_code =
                                    Some("image.invalid_relationship_target".to_string());
                                relationship.warning_message = Some(message);
                            }
                        }
                    }
                    relationships.push(relationship);
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(error.to_string()),
        }
        buffer.clear();
    }

    Ok(relationships)
}

fn read_entry_bytes(
    archive: &mut ZipArchive<File>,
    path: &str,
    limit: u64,
) -> Result<Vec<u8>, String> {
    let mut entry = archive.by_name(path).map_err(|error| error.to_string())?;
    if entry.size() > limit {
        return Err("image.size_limit_exceeded".to_string());
    }
    let mut bytes = Vec::new();
    entry
        .by_ref()
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("image.size_limit_exceeded".to_string());
    }
    Ok(bytes)
}

fn attach_image_data(
    archive: &mut ZipArchive<File>,
    relationships: &mut [DocxImageRelationship],
) -> Result<(), String> {
    let mut total_image_size = 0_u64;
    for relationship in relationships.iter_mut() {
        let Some(resolved_part) = relationship.resolved_part.clone() else {
            continue;
        };
        let Some(extension_mime) = image_mime_from_path(&resolved_part) else {
            relationship.warning_code = Some("image.unsupported_format".to_string());
            relationship.warning_message = Some("未対応の画像形式です。".to_string());
            continue;
        };
        let bytes = match read_entry_bytes(archive, &resolved_part, MAX_IMAGE_UNCOMPRESSED_SIZE) {
            Ok(bytes) => bytes,
            Err(message) if message == "image.size_limit_exceeded" => {
                relationship.warning_code = Some("image.size_limit_exceeded".to_string());
                relationship.warning_message = Some("画像サイズが上限を超えています。".to_string());
                continue;
            }
            Err(_) => {
                relationship.warning_code = Some("image.missing_part".to_string());
                relationship.warning_message = Some("画像partが見つかりません。".to_string());
                continue;
            }
        };
        total_image_size = total_image_size.saturating_add(bytes.len() as u64);
        if total_image_size > MAX_TOTAL_IMAGE_UNCOMPRESSED_SIZE {
            relationship.warning_code = Some("image.total_size_limit_exceeded".to_string());
            relationship.warning_message = Some("画像総容量が上限を超えています。".to_string());
            relationship.data_base64 = None;
            continue;
        }
        let Some(magic_mime) = image_mime_from_magic(&bytes) else {
            relationship.warning_code = Some("image.decode_failed".to_string());
            relationship.warning_message = Some("画像形式を判定できません。".to_string());
            continue;
        };
        if extension_mime != magic_mime {
            relationship.warning_code = Some("image.invalid_mime_type".to_string());
            relationship.warning_message =
                Some("画像拡張子と内容のMIMEタイプが一致しません。".to_string());
            continue;
        }
        relationship.mime_type = Some(magic_mime.to_string());
        relationship.byte_size = Some(bytes.len() as u64);
        relationship.checksum = Some(checksum_hex(&bytes));
        relationship.data_base64 = Some(base64::engine::general_purpose::STANDARD.encode(bytes));
    }
    Ok(())
}

fn extract_docx_images(
    archive: &mut ZipArchive<File>,
    rels_parts: &[String],
) -> Result<Vec<DocxImageRelationship>, String> {
    let mut relationships = Vec::new();
    for rels_part in rels_parts {
        let xml = read_entry_bytes(archive, rels_part, MAX_ENTRY_UNCOMPRESSED_SIZE)?;
        relationships.extend(parse_image_relationships(&xml, rels_part)?);
    }
    attach_image_data(archive, &mut relationships)?;
    Ok(relationships)
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
        image_relationships: Vec::new(),
        entries: Vec::new(),
        warnings: Vec::new(),
    };
    let mut rels_parts = Vec::new();

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
        if name == "word/_rels/document.xml.rels"
            || name.starts_with("word/_rels/header")
            || name.starts_with("word/_rels/footer")
        {
            if name.ends_with(".rels") {
                rels_parts.push(name.clone());
            }
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
    inspection.image_relationships = extract_docx_images(&mut archive, &rels_parts)?;

    Ok(inspection)
}

#[cfg(test)]
mod tests {
    use std::error::Error;
    use std::fs::{self, File};
    use std::io::Write;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    use super::{inspect_docx, validate_zip_path};

    const PNG_BYTES: &[u8] = &[
        0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
    ];

    fn fixture_path(name: &str) -> Result<PathBuf, Box<dyn Error>> {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        Ok(std::env::temp_dir().join(format!("neword-{name}-{}-{nanos}.docx", std::process::id())))
    }

    fn write_zip_fixture(name: &str, entries: &[(&str, &[u8])]) -> Result<PathBuf, Box<dyn Error>> {
        let path = fixture_path(name)?;
        let file = File::create(&path)?;
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);

        for (entry_name, contents) in entries {
            zip.start_file(entry_name, options)?;
            zip.write_all(contents)?;
        }

        zip.finish()?;
        Ok(path)
    }

    fn image_relationship_docx(
        name: &str,
        target: &str,
        target_mode: Option<&str>,
        image_entry: Option<(&str, &[u8])>,
    ) -> Result<PathBuf, Box<dyn Error>> {
        let target_mode_attr = target_mode
            .map(|mode| format!(" TargetMode=\"{mode}\""))
            .unwrap_or_default();
        let rels = format!(
            "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rIdImage\" Type=\"{}\" Target=\"{target}\"{target_mode_attr}/></Relationships>",
            super::IMAGE_RELATIONSHIP_TYPE
        );
        let mut entries: Vec<(&str, &[u8])> = vec![
            ("word/document.xml", b"<document/>"),
            ("word/_rels/document.xml.rels", rels.as_bytes()),
        ];
        if let Some(entry) = image_entry {
            entries.push(entry);
        }
        write_zip_fixture(name, &entries)
    }

    #[test]
    fn rejects_path_traversal() {
        assert!(validate_zip_path("../word/document.xml").is_err());
        assert!(validate_zip_path("/word/document.xml").is_err());
    }

    #[test]
    fn accepts_normal_docx_path() {
        assert!(validate_zip_path("word/document.xml").is_ok());
    }

    #[test]
    fn rejects_missing_document_xml() -> Result<(), Box<dyn Error>> {
        let path = write_zip_fixture("missing-document", &[("word/styles.xml", b"<styles/>")])?;
        let result = inspect_docx(&path);
        fs::remove_file(path)?;

        assert!(matches!(
            result,
            Err(message) if message == "DOCX is missing word/document.xml"
        ));
        Ok(())
    }

    #[test]
    fn detects_macro_enabled_content() -> Result<(), Box<dyn Error>> {
        let path = write_zip_fixture(
            "macro",
            &[
                ("word/document.xml", b"<document/>"),
                ("word/vbaProject.bin", b"macro"),
            ],
        )?;
        let inspection = inspect_docx(&path)?;
        fs::remove_file(path)?;

        assert!(inspection.has_macros);
        assert!(inspection
            .warnings
            .iter()
            .any(|warning| warning == "macro-enabled content detected"));
        Ok(())
    }

    #[test]
    fn rejects_broken_docx_package() -> Result<(), Box<dyn Error>> {
        let path = fixture_path("broken")?;
        fs::write(&path, b"not a zip")?;
        let result = inspect_docx(&path);
        fs::remove_file(path)?;

        assert!(result.is_err());
        Ok(())
    }

    #[test]
    fn rejects_zip_entry_path_traversal() -> Result<(), Box<dyn Error>> {
        let path = write_zip_fixture(
            "traversal",
            &[
                ("word/document.xml", b"<document/>"),
                ("../evil.xml", b"evil"),
            ],
        )?;
        let result = inspect_docx(&path);
        fs::remove_file(path)?;

        assert!(matches!(result, Err(message) if message == "unsafe ZIP entry path"));
        Ok(())
    }

    #[test]
    fn rejects_oversized_zip_entry() -> Result<(), Box<dyn Error>> {
        let oversized = vec![b'x'; (super::MAX_ENTRY_UNCOMPRESSED_SIZE + 1) as usize];
        let path = write_zip_fixture(
            "oversized",
            &[
                ("word/document.xml", b"<document/>"),
                ("word/media/large.bin", &oversized),
            ],
        )?;
        let result = inspect_docx(&path);
        fs::remove_file(path)?;

        assert!(matches!(
            result,
            Err(message) if message == "DOCX contains an entry that is too large"
        ));
        Ok(())
    }

    #[test]
    fn accepts_minimal_empty_document_xml() -> Result<(), Box<dyn Error>> {
        let path = write_zip_fixture("empty", &[("word/document.xml", b"<document/>")])?;
        let inspection = inspect_docx(&path)?;
        fs::remove_file(path)?;

        assert!(inspection.has_document_xml);
        Ok(())
    }

    #[test]
    fn resolves_normal_image_relationship() -> Result<(), Box<dyn Error>> {
        let path = image_relationship_docx(
            "image-normal",
            "media/image.png",
            None,
            Some(("word/media/image.png", PNG_BYTES)),
        )?;
        let inspection = inspect_docx(&path)?;
        fs::remove_file(path)?;

        let image = &inspection.image_relationships[0];
        assert_eq!(image.relationship_id, "rIdImage");
        assert_eq!(image.resolved_part.as_deref(), Some("word/media/image.png"));
        assert_eq!(image.mime_type.as_deref(), Some("image/png"));
        assert_eq!(image.byte_size, Some(PNG_BYTES.len() as u64));
        assert!(image.data_base64.is_some());
        Ok(())
    }

    #[test]
    fn does_not_load_external_image_relationship() -> Result<(), Box<dyn Error>> {
        let path = image_relationship_docx(
            "image-external",
            "https://example.test/image.png",
            Some("External"),
            None,
        )?;
        let inspection = inspect_docx(&path)?;
        fs::remove_file(path)?;

        let image = &inspection.image_relationships[0];
        assert!(image.external);
        assert!(image.data_base64.is_none());
        assert_eq!(
            image.warning_code.as_deref(),
            Some("image.external_relationship")
        );
        Ok(())
    }

    #[test]
    fn rejects_relationship_target_path_traversal() -> Result<(), Box<dyn Error>> {
        let path = image_relationship_docx("image-traversal", "../media/image.png", None, None)?;
        let inspection = inspect_docx(&path)?;
        fs::remove_file(path)?;

        let image = &inspection.image_relationships[0];
        assert!(image.data_base64.is_none());
        assert_eq!(
            image.warning_code.as_deref(),
            Some("image.invalid_relationship_target")
        );
        Ok(())
    }

    #[test]
    fn handles_missing_image_part() -> Result<(), Box<dyn Error>> {
        let path = image_relationship_docx("image-missing", "media/missing.png", None, None)?;
        let inspection = inspect_docx(&path)?;
        fs::remove_file(path)?;

        let image = &inspection.image_relationships[0];
        assert!(image.data_base64.is_none());
        assert_eq!(image.warning_code.as_deref(), Some("image.missing_part"));
        Ok(())
    }

    #[test]
    fn detects_image_mime_mismatch() -> Result<(), Box<dyn Error>> {
        let path = image_relationship_docx(
            "image-mismatch",
            "media/image.jpg",
            None,
            Some(("word/media/image.jpg", PNG_BYTES)),
        )?;
        let inspection = inspect_docx(&path)?;
        fs::remove_file(path)?;

        let image = &inspection.image_relationships[0];
        assert!(image.data_base64.is_none());
        assert_eq!(
            image.warning_code.as_deref(),
            Some("image.invalid_mime_type")
        );
        Ok(())
    }

    #[test]
    fn validates_single_image_size_limit() -> Result<(), Box<dyn Error>> {
        let mut oversized = vec![0_u8; (super::MAX_IMAGE_UNCOMPRESSED_SIZE + 1) as usize];
        oversized[..8].copy_from_slice(&PNG_BYTES[..8]);
        let path = image_relationship_docx(
            "image-single-limit",
            "media/large.png",
            None,
            Some(("word/media/large.png", &oversized)),
        )?;
        let inspection = inspect_docx(&path)?;
        fs::remove_file(path)?;

        let image = &inspection.image_relationships[0];
        assert!(image.data_base64.is_none());
        assert_eq!(
            image.warning_code.as_deref(),
            Some("image.size_limit_exceeded")
        );
        Ok(())
    }

    #[test]
    fn validates_total_image_size_limit() -> Result<(), Box<dyn Error>> {
        let mut image_a = vec![0_u8; (9 * 1024 * 1024) as usize];
        let mut image_b = image_a.clone();
        let mut image_c = image_a.clone();
        let mut image_d = image_a.clone();
        let mut image_e = image_a.clone();
        for image in [
            &mut image_a,
            &mut image_b,
            &mut image_c,
            &mut image_d,
            &mut image_e,
        ] {
            image[..8].copy_from_slice(&PNG_BYTES[..8]);
        }
        let rels = format!(
            "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{}</Relationships>",
            (0..5)
                .map(|index| format!(
                    "<Relationship Id=\"rIdImage{index}\" Type=\"{}\" Target=\"media/image{index}.png\"/>",
                    super::IMAGE_RELATIONSHIP_TYPE
                ))
                .collect::<Vec<_>>()
                .join("")
        );
        let path = write_zip_fixture(
            "image-total-limit",
            &[
                ("word/document.xml", b"<document/>"),
                ("word/_rels/document.xml.rels", rels.as_bytes()),
                ("word/media/image0.png", &image_a),
                ("word/media/image1.png", &image_b),
                ("word/media/image2.png", &image_c),
                ("word/media/image3.png", &image_d),
                ("word/media/image4.png", &image_e),
            ],
        )?;
        let inspection = inspect_docx(&path)?;
        fs::remove_file(path)?;

        assert!(inspection
            .image_relationships
            .iter()
            .any(|image| image.warning_code.as_deref() == Some("image.total_size_limit_exceeded")));
        Ok(())
    }
}
