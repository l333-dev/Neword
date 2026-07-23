use std::collections::BTreeMap;
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
const MAX_TABLE_WARNING_COUNT: usize = 100;
const MAX_TABLE_ROWS: usize = 200;
const MAX_TABLE_CELLS: usize = 4000;
const IMAGE_RELATIONSHIP_TYPE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const HEADER_RELATIONSHIP_TYPE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header";
const FOOTER_RELATIONSHIP_TYPE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer";

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
    headers: Vec<DocxHeaderFooter>,
    footers: Vec<DocxHeaderFooter>,
    media_entries: Vec<String>,
    image_relationships: Vec<DocxImageRelationship>,
    image_warnings: Vec<DocxImageWarning>,
    sections: Vec<DocxSection>,
    paragraphs: Vec<DocxParagraphFormatting>,
    table_warnings: Vec<DocxTableWarning>,
    unsupported_features: Vec<DocxUnsupportedFeature>,
    entries: Vec<DocxEntryInfo>,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocxHeaderFooter {
    kind: String,
    reference_type: String,
    relationship_id: Option<String>,
    source_part: Option<String>,
    text: String,
    has_page_number: bool,
    unsupported_features: Vec<String>,
}

#[derive(Debug, Clone)]
struct HeaderFooterReference {
    kind: String,
    reference_type: String,
    relationship_id: String,
}

#[derive(Debug, Clone)]
struct RelationshipTarget {
    relationship_type: String,
    target: String,
    external: bool,
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

#[derive(Debug, Clone, Serialize)]
pub struct DocxImageWarning {
    code: String,
    message: String,
    severity: String,
    relationship_id: Option<String>,
    part: Option<String>,
    position: Option<usize>,
    simplified: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocxPageMargins {
    top_twips: Option<i32>,
    right_twips: Option<i32>,
    bottom_twips: Option<i32>,
    left_twips: Option<i32>,
    header_twips: Option<i32>,
    footer_twips: Option<i32>,
    gutter_twips: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocxPageSettings {
    width_twips: Option<i32>,
    height_twips: Option<i32>,
    orientation: Option<String>,
    margins: Option<DocxPageMargins>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocxSection {
    index: usize,
    paragraph_index: Option<usize>,
    page_settings: Option<DocxPageSettings>,
    break_type: Option<String>,
    has_columns: bool,
    has_page_borders: bool,
    has_title_page: bool,
    header_references: Vec<String>,
    footer_references: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocxParagraphFormatting {
    index: usize,
    alignment: Option<String>,
    indent_left_twips: Option<i32>,
    indent_right_twips: Option<i32>,
    first_line_twips: Option<i32>,
    hanging_twips: Option<i32>,
    spacing_before_twips: Option<i32>,
    spacing_after_twips: Option<i32>,
    line_twips: Option<i32>,
    line_rule: Option<String>,
    page_break_before: bool,
    keep_next: bool,
    keep_lines: bool,
    widow_control: Option<bool>,
    has_page_break: bool,
    has_rendered_page_break: bool,
    has_column_break: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocxTableWarning {
    code: String,
    message: String,
    severity: String,
    table_index: usize,
    row_index: Option<usize>,
    cell_index: Option<usize>,
    simplified: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocxUnsupportedFeature {
    code: String,
    category: String,
    severity: String,
    count: usize,
    affected_part: String,
    can_continue: bool,
    recommendation: String,
}

impl DocxParagraphFormatting {
    fn new(index: usize) -> Self {
        Self {
            index,
            alignment: None,
            indent_left_twips: None,
            indent_right_twips: None,
            first_line_twips: None,
            hanging_twips: None,
            spacing_before_twips: None,
            spacing_after_twips: None,
            line_twips: None,
            line_rule: None,
            page_break_before: false,
            keep_next: false,
            keep_lines: false,
            widow_control: None,
            has_page_break: false,
            has_rendered_page_break: false,
            has_column_break: false,
        }
    }
}

impl DocxSection {
    fn new(index: usize, paragraph_index: Option<usize>) -> Self {
        Self {
            index,
            paragraph_index,
            page_settings: None,
            break_type: None,
            has_columns: false,
            has_page_borders: false,
            has_title_page: false,
            header_references: Vec::new(),
            footer_references: Vec::new(),
        }
    }
}

fn validate_zip_path(name: &str) -> Result<(), String> {
    if name.starts_with('/') || name.starts_with('\\') || name.contains("..") {
        return Err("unsafe ZIP entry path".to_string());
    }
    Ok(())
}

fn push_unsupported_feature(
    features: &mut Vec<DocxUnsupportedFeature>,
    code: &str,
    category: &str,
    severity: &str,
    affected_part: &str,
    count: usize,
    recommendation: &str,
) {
    if count == 0 {
        return;
    }
    if let Some(existing) = features.iter_mut().find(|feature| {
        feature.code == code
            && feature.category == category
            && feature.severity == severity
            && feature.affected_part == affected_part
    }) {
        existing.count = existing.count.saturating_add(count);
        return;
    }
    features.push(DocxUnsupportedFeature {
        code: code.to_string(),
        category: category.to_string(),
        severity: severity.to_string(),
        count,
        affected_part: affected_part.to_string(),
        can_continue: severity != "error",
        recommendation: recommendation.to_string(),
    });
}

fn unsupported_feature_from_entry(name: &str, features: &mut Vec<DocxUnsupportedFeature>) {
    if name == "word/comments.xml" {
        push_unsupported_feature(
            features,
            "docx.unsupported_comments",
            "unsupported-element",
            "warning",
            name,
            1,
            "コメントは元DOCXに残りますが、再書き出しでは保持されません。",
        );
    } else if name == "word/footnotes.xml" {
        push_unsupported_feature(
            features,
            "docx.unsupported_footnotes",
            "unsupported-element",
            "warning",
            name,
            1,
            "脚注は未対応です。必要な内容は元DOCXで確認してください。",
        );
    } else if name == "word/endnotes.xml" {
        push_unsupported_feature(
            features,
            "docx.unsupported_endnotes",
            "unsupported-element",
            "warning",
            name,
            1,
            "文末脚注は未対応です。必要な内容は元DOCXで確認してください。",
        );
    } else if name.starts_with("word/charts/") {
        push_unsupported_feature(
            features,
            "docx.unsupported_chart",
            "unsupported-element",
            "warning",
            name,
            1,
            "グラフは画像化または未対応要素として扱われる可能性があります。",
        );
    } else if name.starts_with("word/diagrams/") || name.starts_with("word/diagrams") {
        push_unsupported_feature(
            features,
            "docx.unsupported_smart_art",
            "unsupported-element",
            "warning",
            name,
            1,
            "SmartArt/diagramは編集可能な構造として保持されません。",
        );
    } else if name.starts_with("word/embeddings/") || name.contains("oleObject") {
        push_unsupported_feature(
            features,
            "docx.unsupported_embedded_object",
            "unsupported-element",
            "warning",
            name,
            1,
            "埋め込みオブジェクトやOLEは実行せず、再書き出しでは保持しません。",
        );
    }
}

fn image_mime_from_path(path: &str) -> Option<&'static str> {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".png") {
        Some("image/png")
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        Some("image/jpeg")
    } else if lower.ends_with(".gif") {
        Some("image/gif")
    } else if lower.ends_with(".webp") {
        Some("image/webp")
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
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
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

fn parse_relationship_targets(xml: &[u8]) -> Result<Vec<(String, RelationshipTarget)>, String> {
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

                if !id.is_empty() {
                    relationships.push((
                        id,
                        RelationshipTarget {
                            relationship_type,
                            target,
                            external: target_mode.eq_ignore_ascii_case("external"),
                        },
                    ));
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

fn inspect_relationship_unsupported_features(
    xml: &[u8],
    rels_part: &str,
) -> Result<Vec<DocxUnsupportedFeature>, String> {
    let relationships = parse_relationship_targets(xml)?;
    let mut features = Vec::new();
    for (_, relationship) in relationships {
        let relationship_type = relationship.relationship_type.to_ascii_lowercase();
        if relationship.external && relationship_type.contains("/image") {
            push_unsupported_feature(
                &mut features,
                "relationship.external_image",
                "external-image-blocked",
                "warning",
                rels_part,
                1,
                "外部画像は自動取得しません。必要に応じて元DOCXを確認してください。",
            );
        } else if relationship.external && relationship_type.contains("/hyperlink") {
            push_unsupported_feature(
                &mut features,
                "relationship.external_hyperlink",
                "general",
                "info",
                rels_part,
                1,
                "外部ハイパーリンクはリンク先を取得せず、参照として扱います。",
            );
        } else if relationship.external && relationship_type.contains("attachedtemplate") {
            push_unsupported_feature(
                &mut features,
                "relationship.external_template",
                "unsupported-element",
                "warning",
                rels_part,
                1,
                "外部テンプレートは取得せず、文書には適用しません。",
            );
        } else if relationship.external {
            push_unsupported_feature(
                &mut features,
                "relationship.external_reference",
                "unsupported-element",
                "warning",
                rels_part,
                1,
                "外部relationshipは自動取得しません。",
            );
        }

        if relationship_type.contains("/chart") {
            push_unsupported_feature(
                &mut features,
                "docx.unsupported_chart",
                "unsupported-element",
                "warning",
                rels_part,
                1,
                "グラフは編集可能な構造として保持されません。",
            );
        } else if relationship_type.contains("/diagram") {
            push_unsupported_feature(
                &mut features,
                "docx.unsupported_smart_art",
                "unsupported-element",
                "warning",
                rels_part,
                1,
                "SmartArt/diagramは編集可能な構造として保持されません。",
            );
        } else if relationship_type.contains("/oleobject")
            || relationship_type.contains("/package")
            || relationship_type.contains("/embeddings")
        {
            push_unsupported_feature(
                &mut features,
                "docx.unsupported_embedded_object",
                "unsupported-element",
                "warning",
                rels_part,
                1,
                "埋め込みオブジェクトやOLEは実行せず、再書き出しでは保持しません。",
            );
        }
    }
    Ok(features)
}

fn inspect_unsupported_document_features(
    xml: &[u8],
) -> Result<Vec<DocxUnsupportedFeature>, String> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    let mut counts: BTreeMap<&'static str, usize> = BTreeMap::new();

    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => {
                let raw_name = event.name();
                let name = local_name(raw_name.as_ref());
                let key = match name {
                    b"commentRangeStart" | b"commentRangeEnd" | b"commentReference" => {
                        Some("comments")
                    }
                    b"footnoteReference" => Some("footnotes"),
                    b"endnoteReference" => Some("endnotes"),
                    b"oMath" | b"oMathPara" => Some("math"),
                    b"chart" => Some("chart"),
                    b"relIds" | b"dataModel" => Some("smart_art"),
                    b"object" | b"oleObject" => Some("embedded_object"),
                    b"pict" => Some("vml"),
                    b"txbxContent" => Some("text_box"),
                    b"ins" | b"del" | b"moveFrom" | b"moveTo" | b"pPrChange" | b"rPrChange"
                    | b"tblPrChange" | b"trPrChange" | b"tcPrChange" => Some("tracked_changes"),
                    _ => None,
                };
                if let Some(key) = key {
                    counts
                        .entry(key)
                        .and_modify(|count| *count += 1)
                        .or_insert(1);
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(error.to_string()),
        }
        buffer.clear();
    }

    let mut features = Vec::new();
    for (key, count) in counts {
        match key {
            "comments" => push_unsupported_feature(
                &mut features,
                "docx.unsupported_comments",
                "unsupported-element",
                "warning",
                "word/document.xml",
                count,
                "コメントは取り込まず、再書き出しでも保持しません。",
            ),
            "footnotes" => push_unsupported_feature(
                &mut features,
                "docx.unsupported_footnotes",
                "unsupported-element",
                "warning",
                "word/document.xml",
                count,
                "脚注本文は取り込みません。元DOCXで確認してください。",
            ),
            "endnotes" => push_unsupported_feature(
                &mut features,
                "docx.unsupported_endnotes",
                "unsupported-element",
                "warning",
                "word/document.xml",
                count,
                "文末脚注本文は取り込みません。元DOCXで確認してください。",
            ),
            "math" => push_unsupported_feature(
                &mut features,
                "docx.unsupported_math",
                "unsupported-element",
                "warning",
                "word/document.xml",
                count,
                "数式は編集可能な数式として保持されません。",
            ),
            "chart" => push_unsupported_feature(
                &mut features,
                "docx.unsupported_chart",
                "unsupported-element",
                "warning",
                "word/document.xml",
                count,
                "グラフは編集可能な構造として保持されません。",
            ),
            "smart_art" => push_unsupported_feature(
                &mut features,
                "docx.unsupported_smart_art",
                "unsupported-element",
                "warning",
                "word/document.xml",
                count,
                "SmartArt/diagramは編集可能な構造として保持されません。",
            ),
            "embedded_object" => push_unsupported_feature(
                &mut features,
                "docx.unsupported_embedded_object",
                "unsupported-element",
                "warning",
                "word/document.xml",
                count,
                "埋め込みオブジェクトやOLEは実行せず、再書き出しでは保持しません。",
            ),
            "vml" => push_unsupported_feature(
                &mut features,
                "docx.unsupported_vml",
                "unsupported-element",
                "warning",
                "word/document.xml",
                count,
                "VML描画は近似または省略される可能性があります。",
            ),
            "text_box" => push_unsupported_feature(
                &mut features,
                "docx.unsupported_text_box",
                "unsupported-element",
                "warning",
                "word/document.xml",
                count,
                "テキストボックスは通常本文へ近似される可能性があります。",
            ),
            "tracked_changes" => push_unsupported_feature(
                &mut features,
                "docx.tracked_changes_detected",
                "import-recovery",
                "warning",
                "word/document.xml",
                count,
                "変更履歴は確定済み表示に近い形で取り込みます。元DOCXで確認してください。",
            ),
            _ => {}
        }
    }
    Ok(features)
}

fn local_name(name: &[u8]) -> &[u8] {
    name.rsplit(|byte| *byte == b':').next().unwrap_or(name)
}

fn attr_value(
    reader: &Reader<&[u8]>,
    event: &quick_xml::events::BytesStart<'_>,
    wanted: &[u8],
) -> Result<Option<String>, String> {
    for attribute in event.attributes() {
        let attribute = attribute.map_err(|error| error.to_string())?;
        if local_name(attribute.key.as_ref()) == wanted {
            return Ok(Some(
                attribute
                    .decode_and_unescape_value(reader.decoder())
                    .map_err(|error| error.to_string())?
                    .into_owned(),
            ));
        }
    }
    Ok(None)
}

fn attr_i32(
    reader: &Reader<&[u8]>,
    event: &quick_xml::events::BytesStart<'_>,
    wanted: &[u8],
) -> Result<Option<i32>, String> {
    let Some(value) = attr_value(reader, event, wanted)? else {
        return Ok(None);
    };
    value
        .parse::<i32>()
        .map(Some)
        .map_err(|_| format!("invalid numeric OOXML attribute: {value}"))
}

fn attr_bool(
    reader: &Reader<&[u8]>,
    event: &quick_xml::events::BytesStart<'_>,
) -> Result<bool, String> {
    Ok(match attr_value(reader, event, b"val")?.as_deref() {
        Some("0") | Some("false") | Some("off") => false,
        _ => true,
    })
}

fn parse_header_footer_references(xml: &[u8]) -> Result<Vec<HeaderFooterReference>, String> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut references = Vec::new();
    let mut in_section_properties = false;

    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => {
                let raw_name = event.name();
                let name = local_name(raw_name.as_ref());
                match name {
                    b"sectPr" => in_section_properties = true,
                    b"headerReference" | b"footerReference" if in_section_properties => {
                        if let Some(relationship_id) = attr_value(&reader, &event, b"id")? {
                            references.push(HeaderFooterReference {
                                kind: if name == b"headerReference" {
                                    "header".to_string()
                                } else {
                                    "footer".to_string()
                                },
                                reference_type: attr_value(&reader, &event, b"type")?
                                    .unwrap_or_else(|| "default".to_string()),
                                relationship_id,
                            });
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(event)) => {
                if local_name(event.name().as_ref()) == b"sectPr" {
                    in_section_properties = false;
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(error.to_string()),
        }
        buffer.clear();
    }

    Ok(references)
}

fn parse_header_footer_xml(xml: &[u8]) -> Result<(String, bool, Vec<String>), String> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut paragraphs: Vec<String> = Vec::new();
    let mut current_paragraph = String::new();
    let mut in_paragraph = false;
    let mut in_text = false;
    let mut in_instruction_text = false;
    let mut has_page_number = false;
    let mut unsupported_features: Vec<String> = Vec::new();

    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) => {
                let raw_name = event.name();
                let name = local_name(raw_name.as_ref());
                match name {
                    b"p" => {
                        in_paragraph = true;
                        current_paragraph.clear();
                    }
                    b"t" => in_text = true,
                    b"instrText" => in_instruction_text = true,
                    b"fldSimple" => {
                        let instruction =
                            attr_value(&reader, &event, b"instr")?.unwrap_or_default();
                        if instruction.to_ascii_uppercase().contains("PAGE") {
                            has_page_number = true;
                        } else {
                            push_unique(&mut unsupported_features, "field");
                        }
                    }
                    b"drawing" | b"pict" | b"tbl" | b"sdt" => {
                        push_unique(
                            &mut unsupported_features,
                            std::str::from_utf8(name).unwrap_or("unknown"),
                        );
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(event)) => {
                let raw_name = event.name();
                let name = local_name(raw_name.as_ref());
                match name {
                    b"fldSimple" => {
                        let instruction =
                            attr_value(&reader, &event, b"instr")?.unwrap_or_default();
                        if instruction.to_ascii_uppercase().contains("PAGE") {
                            has_page_number = true;
                        } else {
                            push_unique(&mut unsupported_features, "field");
                        }
                    }
                    b"tab" if in_paragraph => current_paragraph.push('\t'),
                    b"br" if in_paragraph => current_paragraph.push('\n'),
                    b"fldChar" => push_unique(&mut unsupported_features, "complex_field"),
                    b"drawing" | b"pict" | b"tbl" | b"sdt" => {
                        push_unique(
                            &mut unsupported_features,
                            std::str::from_utf8(name).unwrap_or("unknown"),
                        );
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(event)) => {
                if in_text && in_paragraph {
                    current_paragraph
                        .push_str(&event.xml10_content().map_err(|error| error.to_string())?);
                }
                if in_instruction_text {
                    let instruction = event.xml10_content().map_err(|error| error.to_string())?;
                    if instruction.to_ascii_uppercase().contains("PAGE") {
                        has_page_number = true;
                    } else {
                        push_unique(&mut unsupported_features, "field");
                    }
                }
            }
            Ok(Event::End(event)) => {
                let raw_name = event.name();
                let name = local_name(raw_name.as_ref());
                match name {
                    b"p" => {
                        in_paragraph = false;
                        paragraphs.push(current_paragraph.clone());
                        current_paragraph.clear();
                    }
                    b"t" => in_text = false,
                    b"instrText" => in_instruction_text = false,
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(error.to_string()),
        }
        buffer.clear();
    }

    let text = paragraphs
        .into_iter()
        .map(|paragraph| paragraph.trim().to_string())
        .filter(|paragraph| !paragraph.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    Ok((text, has_page_number, unsupported_features))
}

fn push_unique(values: &mut Vec<String>, value: &str) {
    if !values.iter().any(|candidate| candidate == value) {
        values.push(value.to_string());
    }
}

fn push_image_warning(
    warnings: &mut Vec<DocxImageWarning>,
    code: &str,
    message: &str,
    relationship_id: Option<String>,
    position: Option<usize>,
    simplified: Option<&str>,
) {
    if warnings.iter().any(|warning| {
        warning.code == code
            && warning.relationship_id == relationship_id
            && warning.position == position
    }) {
        return;
    }
    warnings.push(DocxImageWarning {
        code: code.to_string(),
        message: message.to_string(),
        severity: "warning".to_string(),
        relationship_id,
        part: Some("word/document.xml".to_string()),
        position,
        simplified: simplified.map(str::to_string),
    });
}

fn inspect_image_warnings(xml: &[u8]) -> Result<Vec<DocxImageWarning>, String> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut warnings = Vec::new();
    let mut drawing_index = 0_usize;
    let mut current_position: Option<usize> = None;
    let mut current_relationship_id: Option<String> = None;

    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => {
                let raw_name = event.name();
                let name = local_name(raw_name.as_ref());
                match name {
                    b"drawing" => {
                        current_position = Some(drawing_index);
                        drawing_index += 1;
                    }
                    b"anchor" => push_image_warning(
                        &mut warnings,
                        "image.anchored_unsupported",
                        "anchored imageは通常の画像配置へ単純化します。",
                        current_relationship_id.clone(),
                        current_position,
                        Some("anchor positioning and wrapping are ignored"),
                    ),
                    b"wrapSquare" | b"wrapTight" | b"wrapThrough" | b"wrapTopAndBottom"
                    | b"wrapNone" => push_image_warning(
                        &mut warnings,
                        "image.text_wrapping_unsupported",
                        "画像のtext wrappingは保持しません。",
                        current_relationship_id.clone(),
                        current_position,
                        Some("text wrapping is ignored"),
                    ),
                    b"srcRect" => push_image_warning(
                        &mut warnings,
                        "image.crop_unsupported",
                        "画像cropは保持しません。",
                        current_relationship_id.clone(),
                        current_position,
                        Some("crop is ignored"),
                    ),
                    b"graphicFrameLocks" | b"effectLst" | b"effectDag" | b"alphaModFix" => {
                        push_image_warning(
                            &mut warnings,
                            "image.effects_unsupported",
                            "画像の特殊効果は保持しません。",
                            current_relationship_id.clone(),
                            current_position,
                            Some("effects are ignored"),
                        );
                    }
                    b"grpSp" => push_image_warning(
                        &mut warnings,
                        "image.grouped_shape_unsupported",
                        "grouped shapeは未対応です。",
                        current_relationship_id.clone(),
                        current_position,
                        Some("grouped shape is not preserved"),
                    ),
                    b"wgp" | b"wpc" => push_image_warning(
                        &mut warnings,
                        "image.drawing_canvas_unsupported",
                        "drawing canvasは未対応です。",
                        current_relationship_id.clone(),
                        current_position,
                        Some("drawing canvas is not preserved"),
                    ),
                    b"blip" => {
                        if let Some(relationship_id) = attr_value(&reader, &event, b"embed")? {
                            current_relationship_id = Some(relationship_id);
                        }
                    }
                    b"xfrm" => {
                        if let Some(rotation) = attr_value(&reader, &event, b"rot")? {
                            if rotation != "0" {
                                push_image_warning(
                                    &mut warnings,
                                    "image.rotation_unsupported",
                                    "画像rotationは保持しません。",
                                    current_relationship_id.clone(),
                                    current_position,
                                    Some("rotation is ignored"),
                                );
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(event)) => {
                if local_name(event.name().as_ref()) == b"drawing" {
                    current_position = None;
                    current_relationship_id = None;
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(error.to_string()),
        }
        buffer.clear();
    }

    Ok(warnings)
}

fn push_table_warning(
    warnings: &mut Vec<DocxTableWarning>,
    code: &str,
    message: &str,
    table_index: usize,
    row_index: Option<usize>,
    cell_index: Option<usize>,
    simplified: Option<&str>,
) {
    if warnings.len() >= MAX_TABLE_WARNING_COUNT {
        return;
    }
    if warnings.iter().any(|warning| {
        warning.code == code
            && warning.table_index == table_index
            && warning.row_index == row_index
            && warning.cell_index == cell_index
    }) {
        return;
    }
    warnings.push(DocxTableWarning {
        code: code.to_string(),
        message: message.to_string(),
        severity: "warning".to_string(),
        table_index,
        row_index,
        cell_index,
        simplified: simplified.map(str::to_string),
    });
}

fn inspect_table_warnings(xml: &[u8]) -> Result<Vec<DocxTableWarning>, String> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut warnings = Vec::new();
    let mut table_depth = 0_usize;
    let mut table_count = 0_usize;
    let mut active_table_index: Option<usize> = None;
    let mut row_index: Option<usize> = None;
    let mut cell_index: Option<usize> = None;
    let mut row_count = 0_usize;
    let mut cell_count = 0_usize;
    let mut cell_depth = 0_usize;

    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => {
                let raw_name = event.name();
                let name = local_name(raw_name.as_ref());
                match name {
                    b"tbl" => {
                        if table_depth == 0 {
                            active_table_index = Some(table_count);
                            table_count += 1;
                            row_index = None;
                            cell_index = None;
                            row_count = 0;
                            cell_count = 0;
                        } else {
                            push_table_warning(
                                &mut warnings,
                                "table.nested_unsupported",
                                "入れ子になった表は単純化されます。",
                                active_table_index.unwrap_or(table_count),
                                row_index,
                                cell_index,
                                Some("nested table structure is not preserved as a nested editable table"),
                            );
                        }
                        table_depth = table_depth.saturating_add(1);
                    }
                    b"tblpPr" if table_depth > 0 => push_table_warning(
                        &mut warnings,
                        "table.floating_unsupported",
                        "floating tableまたはtext wrapping付き表は通常の表として読み込みます。",
                        active_table_index.unwrap_or(0),
                        row_index,
                        cell_index,
                        Some("floating/wrapping layout is ignored"),
                    ),
                    b"tr" if table_depth == 1 => {
                        row_count += 1;
                        row_index = Some(row_count - 1);
                        cell_index = None;
                    }
                    b"tc" if table_depth == 1 => {
                        cell_count += 1;
                        cell_index = Some(cell_index.map_or(0, |index| index + 1));
                        cell_depth += 1;
                    }
                    b"drawing" | b"pict" | b"object" if cell_depth > 0 => push_table_warning(
                        &mut warnings,
                        "table.cell_object_unsupported",
                        "セル内の画像またはオブジェクトは完全には保持されません。",
                        active_table_index.unwrap_or(0),
                        row_index,
                        cell_index,
                        Some("cell object content is simplified"),
                    ),
                    b"oMath" if cell_depth > 0 => push_table_warning(
                        &mut warnings,
                        "table.cell_math_unsupported",
                        "セル内の数式は未対応です。",
                        active_table_index.unwrap_or(0),
                        row_index,
                        cell_index,
                        Some("math object is not preserved"),
                    ),
                    b"sdt" if cell_depth > 0 => push_table_warning(
                        &mut warnings,
                        "table.cell_sdt_unsupported",
                        "セル内のstructured document tagは未対応です。",
                        active_table_index.unwrap_or(0),
                        row_index,
                        cell_index,
                        Some("structured document tag is simplified"),
                    ),
                    b"chart" | b"diagram" if cell_depth > 0 => push_table_warning(
                        &mut warnings,
                        "table.cell_drawing_unsupported",
                        "セル内のグラフまたはSmartArtは未対応です。",
                        active_table_index.unwrap_or(0),
                        row_index,
                        cell_index,
                        Some("chart or SmartArt is not preserved"),
                    ),
                    b"tl2br" | b"tr2bl" if cell_depth > 0 => push_table_warning(
                        &mut warnings,
                        "table.cell_diagonal_border_unsupported",
                        "斜線付きセルは斜線を保持しません。",
                        active_table_index.unwrap_or(0),
                        row_index,
                        cell_index,
                        Some("diagonal cell border is ignored"),
                    ),
                    _ => {}
                }
            }
            Ok(Event::End(event)) => {
                let raw_name = event.name();
                let name = local_name(raw_name.as_ref());
                match name {
                    b"tc" if cell_depth > 0 => cell_depth -= 1,
                    b"tbl" if table_depth > 0 => {
                        table_depth -= 1;
                        if table_depth == 0 {
                            let table_index = active_table_index.unwrap_or(0);
                            if row_count > MAX_TABLE_ROWS || cell_count > MAX_TABLE_CELLS {
                                push_table_warning(
                                    &mut warnings,
                                    "table.size_limited",
                                    "大きすぎる表を検出しました。編集性能に影響する可能性があります。",
                                    table_index,
                                    None,
                                    None,
                                    Some("large table may be simplified by the frontend importer"),
                                );
                            }
                            active_table_index = None;
                            row_index = None;
                            cell_index = None;
                            row_count = 0;
                            cell_count = 0;
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(error.to_string()),
        }
        buffer.clear();
    }

    Ok(warnings)
}

fn parse_page_settings(
    reader: &Reader<&[u8]>,
    event: &quick_xml::events::BytesStart<'_>,
    section: &mut DocxSection,
) -> Result<(), String> {
    let mut page_settings = section.page_settings.clone().unwrap_or(DocxPageSettings {
        width_twips: None,
        height_twips: None,
        orientation: None,
        margins: None,
    });
    page_settings.width_twips = attr_i32(reader, event, b"w")?;
    page_settings.height_twips = attr_i32(reader, event, b"h")?;
    page_settings.orientation = attr_value(reader, event, b"orient")?;
    section.page_settings = Some(page_settings);
    Ok(())
}

fn parse_page_margins(
    reader: &Reader<&[u8]>,
    event: &quick_xml::events::BytesStart<'_>,
    section: &mut DocxSection,
) -> Result<(), String> {
    let mut page_settings = section.page_settings.clone().unwrap_or(DocxPageSettings {
        width_twips: None,
        height_twips: None,
        orientation: None,
        margins: None,
    });
    page_settings.margins = Some(DocxPageMargins {
        top_twips: attr_i32(reader, event, b"top")?,
        right_twips: attr_i32(reader, event, b"right")?,
        bottom_twips: attr_i32(reader, event, b"bottom")?,
        left_twips: attr_i32(reader, event, b"left")?,
        header_twips: attr_i32(reader, event, b"header")?,
        footer_twips: attr_i32(reader, event, b"footer")?,
        gutter_twips: attr_i32(reader, event, b"gutter")?,
    });
    section.page_settings = Some(page_settings);
    Ok(())
}

fn inspect_document_xml(
    xml: &[u8],
) -> Result<(Vec<DocxSection>, Vec<DocxParagraphFormatting>), String> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut paragraphs = Vec::new();
    let mut sections = Vec::new();
    let mut current_paragraph: Option<DocxParagraphFormatting> = None;
    let mut current_section: Option<DocxSection> = None;
    let mut in_paragraph_properties = false;
    let mut in_section_properties = false;
    let mut paragraph_index = 0_usize;
    let mut section_index = 0_usize;

    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) => {
                let raw_name = event.name();
                let name = local_name(raw_name.as_ref());
                match name {
                    b"p" => {
                        current_paragraph = Some(DocxParagraphFormatting::new(paragraph_index));
                        paragraph_index += 1;
                    }
                    b"pPr" => in_paragraph_properties = true,
                    b"sectPr" => {
                        in_section_properties = true;
                        current_section = Some(DocxSection::new(
                            section_index,
                            current_paragraph.as_ref().map(|paragraph| paragraph.index),
                        ));
                        section_index += 1;
                    }
                    b"pgSz" if in_section_properties => {
                        if let Some(section) = current_section.as_mut() {
                            parse_page_settings(&reader, &event, section)?;
                        }
                    }
                    b"pgMar" if in_section_properties => {
                        if let Some(section) = current_section.as_mut() {
                            parse_page_margins(&reader, &event, section)?;
                        }
                    }
                    b"type" if in_section_properties => {
                        if let Some(section) = current_section.as_mut() {
                            section.break_type = attr_value(&reader, &event, b"val")?;
                        }
                    }
                    b"cols" if in_section_properties => {
                        if let Some(section) = current_section.as_mut() {
                            section.has_columns = true;
                        }
                    }
                    b"pgBorders" if in_section_properties => {
                        if let Some(section) = current_section.as_mut() {
                            section.has_page_borders = true;
                        }
                    }
                    b"titlePg" if in_section_properties => {
                        if let Some(section) = current_section.as_mut() {
                            section.has_title_page = true;
                        }
                    }
                    b"headerReference" if in_section_properties => {
                        if let Some(section) = current_section.as_mut() {
                            if let Some(reference_type) = attr_value(&reader, &event, b"type")? {
                                section.header_references.push(reference_type);
                            }
                        }
                    }
                    b"footerReference" if in_section_properties => {
                        if let Some(section) = current_section.as_mut() {
                            if let Some(reference_type) = attr_value(&reader, &event, b"type")? {
                                section.footer_references.push(reference_type);
                            }
                        }
                    }
                    b"jc" if in_paragraph_properties => {
                        if let Some(paragraph) = current_paragraph.as_mut() {
                            paragraph.alignment = attr_value(&reader, &event, b"val")?;
                        }
                    }
                    b"ind" if in_paragraph_properties => {
                        if let Some(paragraph) = current_paragraph.as_mut() {
                            paragraph.indent_left_twips = attr_i32(&reader, &event, b"left")?;
                            paragraph.indent_right_twips = attr_i32(&reader, &event, b"right")?;
                            paragraph.first_line_twips = attr_i32(&reader, &event, b"firstLine")?;
                            paragraph.hanging_twips = attr_i32(&reader, &event, b"hanging")?;
                        }
                    }
                    b"spacing" if in_paragraph_properties => {
                        if let Some(paragraph) = current_paragraph.as_mut() {
                            paragraph.spacing_before_twips = attr_i32(&reader, &event, b"before")?;
                            paragraph.spacing_after_twips = attr_i32(&reader, &event, b"after")?;
                            paragraph.line_twips = attr_i32(&reader, &event, b"line")?;
                            paragraph.line_rule = attr_value(&reader, &event, b"lineRule")?;
                        }
                    }
                    b"pageBreakBefore" if in_paragraph_properties => {
                        if let Some(paragraph) = current_paragraph.as_mut() {
                            paragraph.page_break_before = attr_bool(&reader, &event)?;
                        }
                    }
                    b"keepNext" if in_paragraph_properties => {
                        if let Some(paragraph) = current_paragraph.as_mut() {
                            paragraph.keep_next = attr_bool(&reader, &event)?;
                        }
                    }
                    b"keepLines" if in_paragraph_properties => {
                        if let Some(paragraph) = current_paragraph.as_mut() {
                            paragraph.keep_lines = attr_bool(&reader, &event)?;
                        }
                    }
                    b"widowControl" if in_paragraph_properties => {
                        if let Some(paragraph) = current_paragraph.as_mut() {
                            paragraph.widow_control = Some(attr_bool(&reader, &event)?);
                        }
                    }
                    b"br" => {
                        if let Some(paragraph) = current_paragraph.as_mut() {
                            match attr_value(&reader, &event, b"type")?.as_deref() {
                                Some("page") => paragraph.has_page_break = true,
                                Some("column") => paragraph.has_column_break = true,
                                _ => {}
                            }
                        }
                    }
                    b"lastRenderedPageBreak" => {
                        if let Some(paragraph) = current_paragraph.as_mut() {
                            paragraph.has_rendered_page_break = true;
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(event)) => {
                let raw_name = event.name();
                let name = local_name(raw_name.as_ref());
                match name {
                    b"pgSz" if in_section_properties => {
                        if let Some(section) = current_section.as_mut() {
                            parse_page_settings(&reader, &event, section)?;
                        }
                    }
                    b"pgMar" if in_section_properties => {
                        if let Some(section) = current_section.as_mut() {
                            parse_page_margins(&reader, &event, section)?;
                        }
                    }
                    b"type" if in_section_properties => {
                        if let Some(section) = current_section.as_mut() {
                            section.break_type = attr_value(&reader, &event, b"val")?;
                        }
                    }
                    b"cols" if in_section_properties => {
                        if let Some(section) = current_section.as_mut() {
                            section.has_columns = true;
                        }
                    }
                    b"pgBorders" if in_section_properties => {
                        if let Some(section) = current_section.as_mut() {
                            section.has_page_borders = true;
                        }
                    }
                    b"titlePg" if in_section_properties => {
                        if let Some(section) = current_section.as_mut() {
                            section.has_title_page = true;
                        }
                    }
                    b"headerReference" if in_section_properties => {
                        if let Some(section) = current_section.as_mut() {
                            if let Some(reference_type) = attr_value(&reader, &event, b"type")? {
                                section.header_references.push(reference_type);
                            }
                        }
                    }
                    b"footerReference" if in_section_properties => {
                        if let Some(section) = current_section.as_mut() {
                            if let Some(reference_type) = attr_value(&reader, &event, b"type")? {
                                section.footer_references.push(reference_type);
                            }
                        }
                    }
                    b"jc" if in_paragraph_properties => {
                        if let Some(paragraph) = current_paragraph.as_mut() {
                            paragraph.alignment = attr_value(&reader, &event, b"val")?;
                        }
                    }
                    b"ind" if in_paragraph_properties => {
                        if let Some(paragraph) = current_paragraph.as_mut() {
                            paragraph.indent_left_twips = attr_i32(&reader, &event, b"left")?;
                            paragraph.indent_right_twips = attr_i32(&reader, &event, b"right")?;
                            paragraph.first_line_twips = attr_i32(&reader, &event, b"firstLine")?;
                            paragraph.hanging_twips = attr_i32(&reader, &event, b"hanging")?;
                        }
                    }
                    b"spacing" if in_paragraph_properties => {
                        if let Some(paragraph) = current_paragraph.as_mut() {
                            paragraph.spacing_before_twips = attr_i32(&reader, &event, b"before")?;
                            paragraph.spacing_after_twips = attr_i32(&reader, &event, b"after")?;
                            paragraph.line_twips = attr_i32(&reader, &event, b"line")?;
                            paragraph.line_rule = attr_value(&reader, &event, b"lineRule")?;
                        }
                    }
                    b"pageBreakBefore" if in_paragraph_properties => {
                        if let Some(paragraph) = current_paragraph.as_mut() {
                            paragraph.page_break_before = attr_bool(&reader, &event)?;
                        }
                    }
                    b"keepNext" if in_paragraph_properties => {
                        if let Some(paragraph) = current_paragraph.as_mut() {
                            paragraph.keep_next = attr_bool(&reader, &event)?;
                        }
                    }
                    b"keepLines" if in_paragraph_properties => {
                        if let Some(paragraph) = current_paragraph.as_mut() {
                            paragraph.keep_lines = attr_bool(&reader, &event)?;
                        }
                    }
                    b"widowControl" if in_paragraph_properties => {
                        if let Some(paragraph) = current_paragraph.as_mut() {
                            paragraph.widow_control = Some(attr_bool(&reader, &event)?);
                        }
                    }
                    b"br" => {
                        if let Some(paragraph) = current_paragraph.as_mut() {
                            match attr_value(&reader, &event, b"type")?.as_deref() {
                                Some("page") => paragraph.has_page_break = true,
                                Some("column") => paragraph.has_column_break = true,
                                _ => {}
                            }
                        }
                    }
                    b"lastRenderedPageBreak" => {
                        if let Some(paragraph) = current_paragraph.as_mut() {
                            paragraph.has_rendered_page_break = true;
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(event)) => {
                let raw_name = event.name();
                let name = local_name(raw_name.as_ref());
                match name {
                    b"pPr" => in_paragraph_properties = false,
                    b"sectPr" => {
                        in_section_properties = false;
                        if let Some(section) = current_section.take() {
                            sections.push(section);
                        }
                    }
                    b"p" => {
                        if let Some(paragraph) = current_paragraph.take() {
                            paragraphs.push(paragraph);
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(error.to_string()),
        }
        buffer.clear();
    }

    Ok((sections, paragraphs))
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

fn extract_header_footers(
    archive: &mut ZipArchive<File>,
    document_xml: &[u8],
) -> Result<(Vec<DocxHeaderFooter>, Vec<DocxHeaderFooter>), String> {
    let references = parse_header_footer_references(document_xml)?;
    if references.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }
    let rels_xml = read_entry_bytes(
        archive,
        "word/_rels/document.xml.rels",
        MAX_ENTRY_UNCOMPRESSED_SIZE,
    )
    .unwrap_or_default();
    let relationships = parse_relationship_targets(&rels_xml)?;
    let mut headers = Vec::new();
    let mut footers = Vec::new();

    for reference in references {
        let relationship = relationships
            .iter()
            .find(|(id, _)| id == &reference.relationship_id)
            .map(|(_, relationship)| relationship);
        let mut item = DocxHeaderFooter {
            kind: reference.kind.clone(),
            reference_type: reference.reference_type,
            relationship_id: Some(reference.relationship_id),
            source_part: None,
            text: String::new(),
            has_page_number: false,
            unsupported_features: Vec::new(),
        };

        let Some(relationship) = relationship else {
            item.unsupported_features
                .push("missing_relationship".to_string());
            push_header_footer_item(&mut headers, &mut footers, item);
            continue;
        };
        if relationship.external {
            item.unsupported_features
                .push("external_relationship".to_string());
            push_header_footer_item(&mut headers, &mut footers, item);
            continue;
        }
        let expected_type = if reference.kind == "header" {
            HEADER_RELATIONSHIP_TYPE
        } else {
            FOOTER_RELATIONSHIP_TYPE
        };
        if relationship.relationship_type != expected_type {
            item.unsupported_features
                .push("invalid_relationship_type".to_string());
            push_header_footer_item(&mut headers, &mut footers, item);
            continue;
        }
        let resolved_part =
            match resolve_relationship_target("word/document.xml", &relationship.target) {
                Ok(part) => part,
                Err(_) => {
                    item.unsupported_features
                        .push("invalid_relationship_target".to_string());
                    push_header_footer_item(&mut headers, &mut footers, item);
                    continue;
                }
            };
        item.source_part = Some(resolved_part.clone());
        match read_entry_bytes(archive, &resolved_part, MAX_ENTRY_UNCOMPRESSED_SIZE)
            .and_then(|xml| parse_header_footer_xml(&xml))
        {
            Ok((text, has_page_number, unsupported_features)) => {
                item.text = text;
                item.has_page_number = has_page_number;
                item.unsupported_features = unsupported_features;
            }
            Err(_) => item
                .unsupported_features
                .push("unreadable_part".to_string()),
        }
        push_header_footer_item(&mut headers, &mut footers, item);
    }

    Ok((headers, footers))
}

fn push_header_footer_item(
    headers: &mut Vec<DocxHeaderFooter>,
    footers: &mut Vec<DocxHeaderFooter>,
    item: DocxHeaderFooter,
) {
    if item.kind == "header" {
        headers.push(item);
    } else {
        footers.push(item);
    }
}

pub fn inspect_docx<P: AsRef<Path>>(path: P) -> Result<DocxInspection, String> {
    inspect_docx_with_cancel(path, || false)
}

pub fn inspect_docx_with_cancel<P, F>(path: P, is_cancelled: F) -> Result<DocxInspection, String>
where
    P: AsRef<Path>,
    F: Fn() -> bool,
{
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
        headers: Vec::new(),
        footers: Vec::new(),
        media_entries: Vec::new(),
        image_relationships: Vec::new(),
        image_warnings: Vec::new(),
        sections: Vec::new(),
        paragraphs: Vec::new(),
        table_warnings: Vec::new(),
        unsupported_features: Vec::new(),
        entries: Vec::new(),
        warnings: Vec::new(),
    };
    let mut rels_parts = Vec::new();

    for index in 0..archive.len() {
        if is_cancelled() {
            return Err("DOCX import cancelled".to_string());
        }
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
            push_unsupported_feature(
                &mut inspection.unsupported_features,
                "docx.macros_detected",
                "unsupported-element",
                "warning",
                &name,
                1,
                "マクロは実行せず、再書き出しでも保持しません。",
            );
            inspection
                .warnings
                .push("macro-enabled content detected".to_string());
        }
        unsupported_feature_from_entry(&name, &mut inspection.unsupported_features);
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
    if is_cancelled() {
        return Err("DOCX import cancelled".to_string());
    }
    let document_xml = read_entry_bytes(
        &mut archive,
        "word/document.xml",
        MAX_ENTRY_UNCOMPRESSED_SIZE,
    )?;
    if is_cancelled() {
        return Err("DOCX import cancelled".to_string());
    }
    let (sections, paragraphs) = inspect_document_xml(&document_xml)?;
    inspection.sections = sections;
    inspection.paragraphs = paragraphs;
    inspection
        .unsupported_features
        .extend(inspect_unsupported_document_features(&document_xml)?);
    inspection.image_warnings = inspect_image_warnings(&document_xml)?;
    inspection.table_warnings = inspect_table_warnings(&document_xml)?;
    if is_cancelled() {
        return Err("DOCX import cancelled".to_string());
    }
    let (headers, footers) = extract_header_footers(&mut archive, &document_xml)?;
    inspection.headers = headers;
    inspection.footers = footers;
    if is_cancelled() {
        return Err("DOCX import cancelled".to_string());
    }
    inspection.image_relationships = extract_docx_images(&mut archive, &rels_parts)?;
    for rels_part in &rels_parts {
        let rels_xml = read_entry_bytes(&mut archive, rels_part, MAX_ENTRY_UNCOMPRESSED_SIZE)?;
        inspection
            .unsupported_features
            .extend(inspect_relationship_unsupported_features(
                &rels_xml, rels_part,
            )?);
    }

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
    fn cancellable_inspection_reports_cancelled_separately() -> Result<(), Box<dyn Error>> {
        let path = write_zip_fixture("cancelled", &[("word/document.xml", b"<document/>")])?;
        let result = super::inspect_docx_with_cancel(&path, || true);
        fs::remove_file(path)?;

        assert!(matches!(result, Err(message) if message == "DOCX import cancelled"));
        Ok(())
    }

    #[test]
    fn detects_unsupported_table_structures() -> Result<(), Box<dyn Error>> {
        let xml =
            br#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:tbl>
              <w:tblPr><w:tblpPr/></w:tblPr>
              <w:tr>
                <w:tc>
                  <w:tcPr><w:tcBorders><w:tl2br/></w:tcBorders></w:tcPr>
                  <w:p><w:r><w:drawing/></w:r></w:p>
                  <w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>
                </w:tc>
              </w:tr>
            </w:tbl>
          </w:body>
        </w:document>"#;
        let path = write_zip_fixture("unsupported-table", &[("word/document.xml", xml)])?;
        let inspection = inspect_docx(&path)?;
        fs::remove_file(path)?;
        let codes = inspection
            .table_warnings
            .iter()
            .map(|warning| warning.code.as_str())
            .collect::<Vec<_>>();

        assert!(codes.contains(&"table.floating_unsupported"));
        assert!(codes.contains(&"table.cell_diagonal_border_unsupported"));
        assert!(codes.contains(&"table.cell_object_unsupported"));
        assert!(codes.contains(&"table.nested_unsupported"));
        Ok(())
    }

    #[test]
    fn detects_unsupported_image_layout() -> Result<(), Box<dyn Error>> {
        let xml = br#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <w:body>
            <w:p>
              <w:r>
                <w:drawing>
                  <wp:anchor>
                    <wp:wrapSquare/>
                    <a:blip r:embed="rIdImage"/>
                    <a:srcRect l="1000"/>
                  </wp:anchor>
                </w:drawing>
              </w:r>
            </w:p>
          </w:body>
        </w:document>"#;
        let warnings = super::inspect_image_warnings(xml)?;
        let codes = warnings
            .iter()
            .map(|warning| warning.code.as_str())
            .collect::<Vec<_>>();

        assert!(codes.contains(&"image.anchored_unsupported"));
        assert!(codes.contains(&"image.text_wrapping_unsupported"));
        assert!(codes.contains(&"image.crop_unsupported"));
        Ok(())
    }

    #[test]
    fn detects_unsupported_docx_elements_without_storing_content() -> Result<(), Box<dyn Error>> {
        let xml = br#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <w:body>
            <w:p><w:commentRangeStart w:id="1"/><w:r><w:t>secret comment target</w:t></w:r><w:commentReference w:id="1"/></w:p>
            <w:p><w:r><w:footnoteReference w:id="2"/><w:endnoteReference w:id="3"/></w:r></w:p>
            <w:p><m:oMath><m:r><m:t>x+y</m:t></m:r></m:oMath></w:p>
            <w:p><w:ins><w:r><w:t>inserted</w:t></w:r></w:ins><w:del><w:r><w:t>deleted</w:t></w:r></w:del></w:p>
            <w:p><c:chart/></w:p>
          </w:body>
        </w:document>"#;
        let rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/image.png" TargetMode="External"/>
          <Relationship Id="rIdTemplate" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="https://example.invalid/template.dotx" TargetMode="External"/>
          <Relationship Id="rIdOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/oleObject1.bin"/>
        </Relationships>"#;
        let path = write_zip_fixture(
            "unsupported-elements",
            &[
                ("word/document.xml", xml),
                ("word/comments.xml", b"<w:comments/>"),
                ("word/footnotes.xml", b"<w:footnotes/>"),
                ("word/endnotes.xml", b"<w:endnotes/>"),
                ("word/_rels/document.xml.rels", rels),
                ("word/charts/chart1.xml", b"<c:chartSpace/>"),
                ("word/embeddings/oleObject1.bin", b"not executed"),
            ],
        )?;
        let inspection = inspect_docx(&path)?;
        fs::remove_file(path)?;
        let codes = inspection
            .unsupported_features
            .iter()
            .map(|feature| feature.code.as_str())
            .collect::<Vec<_>>();

        assert!(codes.contains(&"docx.unsupported_comments"));
        assert!(codes.contains(&"docx.unsupported_footnotes"));
        assert!(codes.contains(&"docx.unsupported_endnotes"));
        assert!(codes.contains(&"docx.unsupported_math"));
        assert!(codes.contains(&"docx.tracked_changes_detected"));
        assert!(codes.contains(&"docx.unsupported_chart"));
        assert!(codes.contains(&"docx.unsupported_embedded_object"));
        assert!(codes.contains(&"relationship.external_image"));
        assert!(codes.contains(&"relationship.external_template"));
        assert!(!format!("{:?}", inspection.unsupported_features).contains("secret comment target"));
        Ok(())
    }

    #[test]
    fn parses_page_section_and_paragraph_properties() -> Result<(), Box<dyn Error>> {
        let xml = br#"<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <w:body>
            <w:p>
              <w:pPr>
                <w:jc w:val="both"/>
                <w:ind w:left="720" w:right="360" w:hanging="180"/>
                <w:spacing w:before="120" w:after="240" w:line="360" w:lineRule="auto"/>
                <w:pageBreakBefore/>
                <w:keepNext/>
                <w:keepLines/>
                <w:widowControl w:val="0"/>
              </w:pPr>
              <w:r><w:t>body</w:t><w:br w:type="page"/><w:lastRenderedPageBreak/><w:br w:type="column"/></w:r>
            </w:p>
            <w:sectPr>
              <w:headerReference w:type="default" r:id="rIdHeader"/>
              <w:footerReference w:type="default" r:id="rIdFooter"/>
              <w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>
              <w:pgMar w:top="680" w:right="737" w:bottom="794" w:left="850" w:header="454" w:footer="510" w:gutter="113"/>
              <w:pgBorders/>
              <w:cols w:num="2"/>
              <w:titlePg/>
            </w:sectPr>
          </w:body>
        </w:document>"#;
        let (sections, paragraphs) = super::inspect_document_xml(xml)?;

        assert_eq!(paragraphs.len(), 1);
        assert_eq!(paragraphs[0].alignment.as_deref(), Some("both"));
        assert_eq!(paragraphs[0].indent_left_twips, Some(720));
        assert_eq!(paragraphs[0].hanging_twips, Some(180));
        assert_eq!(paragraphs[0].spacing_after_twips, Some(240));
        assert_eq!(paragraphs[0].line_rule.as_deref(), Some("auto"));
        assert!(paragraphs[0].page_break_before);
        assert!(paragraphs[0].keep_next);
        assert!(paragraphs[0].keep_lines);
        assert_eq!(paragraphs[0].widow_control, Some(false));
        assert!(paragraphs[0].has_page_break);
        assert!(paragraphs[0].has_rendered_page_break);
        assert!(paragraphs[0].has_column_break);
        assert_eq!(sections.len(), 1);
        assert_eq!(
            sections[0]
                .page_settings
                .as_ref()
                .and_then(|page| page.width_twips),
            Some(16838)
        );
        assert_eq!(
            sections[0]
                .page_settings
                .as_ref()
                .and_then(|page| page.orientation.as_deref()),
            Some("landscape")
        );
        assert!(sections[0].has_columns);
        assert!(sections[0].has_page_borders);
        assert!(sections[0].has_title_page);
        assert_eq!(sections[0].header_references, vec!["default".to_string()]);
        assert_eq!(sections[0].footer_references, vec!["default".to_string()]);
        Ok(())
    }

    #[test]
    fn detects_multiple_sections() -> Result<(), Box<dyn Error>> {
        let xml = br#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:sectPr><w:type w:val="continuous"/></w:sectPr></w:pPr></w:p><w:sectPr><w:type w:val="nextPage"/></w:sectPr></w:body></w:document>"#;
        let (sections, paragraphs) = super::inspect_document_xml(xml)?;

        assert_eq!(paragraphs.len(), 1);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].paragraph_index, Some(0));
        assert_eq!(sections[1].break_type.as_deref(), Some("nextPage"));
        Ok(())
    }

    #[test]
    fn extracts_header_footer_text_and_page_number() -> Result<(), Box<dyn Error>> {
        let document_xml = br#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>body</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr></w:body></w:document>"#;
        let rels = format!(
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdHeader" Type="{}" Target="header1.xml"/><Relationship Id="rIdFooter" Type="{}" Target="footer1.xml"/></Relationships>"#,
            super::HEADER_RELATIONSHIP_TYPE,
            super::FOOTER_RELATIONSHIP_TYPE
        );
        let header_xml = br#"<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header text</w:t></w:r></w:p></w:hdr>"#;
        let footer_xml = br#"<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Footer text</w:t></w:r><w:fldSimple w:instr="PAGE"/></w:p></w:ftr>"#;
        let path = write_zip_fixture(
            "header-footer",
            &[
                ("word/document.xml", document_xml),
                ("word/_rels/document.xml.rels", rels.as_bytes()),
                ("word/header1.xml", header_xml),
                ("word/footer1.xml", footer_xml),
            ],
        )?;
        let inspection = inspect_docx(&path)?;
        fs::remove_file(path)?;

        assert_eq!(inspection.headers.len(), 1);
        assert_eq!(inspection.headers[0].text, "Header text");
        assert_eq!(inspection.footers.len(), 1);
        assert_eq!(inspection.footers[0].text, "Footer text");
        assert!(inspection.footers[0].has_page_number);
        Ok(())
    }

    #[test]
    fn rejects_invalid_ooxml_numbers() {
        let xml = br#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:ind w:left="NaN"/></w:pPr></w:p></w:body></w:document>"#;

        assert!(super::inspect_document_xml(xml).is_err());
    }

    #[test]
    fn rejects_malformed_document_xml() {
        let xml = br#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p></w:body></w:document>"#;

        assert!(super::inspect_document_xml(xml).is_err());
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
