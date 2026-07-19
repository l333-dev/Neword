# Editing Behavior and Preferences

## Enter and Shift+Enter

In normal paragraphs, Enter creates a new paragraph. Shift+Enter creates a `hardBreak` inside the same paragraph.

The two operations are stored differently:

- Enter: separate `paragraph` nodes.
- Shift+Enter: a `hardBreak` inline node inside one `paragraph`.

The user can swap the roles of Enter and Shift+Enter in personal editing preferences. Changing that preference does not rewrite existing Tiptap JSON.

Backspace at the start of an empty normal paragraph uses Tiptap's standard join behavior and merges naturally with the previous paragraph. Lists, tables, headings, and nodes near page breaks continue to use Tiptap's structural editing behavior.

## Paragraphs, Hard Breaks, and Page Breaks

Visual spacing is not represented by automatically inserted empty paragraphs. Empty paragraphs are allowed when the user explicitly creates them, but the app does not create them to simulate paragraph spacing.

Page breaks are represented by the dedicated `pageBreak` node. They are not represented by repeated newlines or empty paragraphs.

The editor renders the body inside a paper-like page frame derived from `pageSettings`. Explicit page breaks are editable document nodes; automatic page boundaries are visual-only and are not persisted. Word pagination is not reproduced exactly.

## Personal Display Preferences

Personal editing preferences are stored outside `DocumentProject` in local app storage. They control:

- Theme: light, dark, or system.
- Accent color.
- UI font scale.
- Editor maximum width.
- Enter and Shift+Enter behavior.
- Visual line height.
- Visual paragraph, heading, list item, and blockquote spacing.
- Empty paragraph display height.
- Formatting mark visibility.
- Whether trailing empty paragraphs are trimmed when saving.

These settings are display and input preferences. Changing them does not change the document's semantic content or DOCX paragraph formatting.

The editor applies display values with CSS variables:

- `--editor-line-height`
- `--paragraph-space-before`
- `--paragraph-space-after`
- `--heading-space-before`
- `--heading-space-after`

Visual line height is only the editor display line height. Document line height is stored separately in `DocumentProject` paragraph formatting or document defaults and is the only value used for DOCX export.

Visual paragraph and heading spacing are also display-only. They are not written into paragraph node attributes, project JSON, or DOCX output unless the user explicitly applies settings to document defaults or selected paragraphs.

Built-in visual spacing presets:

- Compact: line height 1.25, paragraph after 4px, heading before 12px, heading after 4px.
- Normal: line height 1.5, paragraph after 8px, heading before 16px, heading after 8px.
- Relaxed: line height 1.75, paragraph after 12px, heading before 24px, heading after 12px.

## User Preferences Storage

User preferences are separate from document data. They are validated with Zod before use and are not stored inside `DocumentProject`.

The current user preference format is `USER_PREFERENCES_FORMAT_VERSION = 1`. This is independent from `DOCUMENT_FORMAT_VERSION`.

The current storage backend is `localStorage`, isolated behind a small storage abstraction so it can later move to a Tauri app settings file without changing React UI code.

Storage keys:

- Current key: `neword.userPreferences.v1`
- Legacy editing-only key: `neword.editingPreferences.v1`

Load order:

1. Read `neword.userPreferences.v1`.
2. If it exists and validates, use it.
3. If it is corrupted or invalid, recover safely using defaults or valid categories.
4. If the new key does not exist, read `neword.editingPreferences.v1`.
5. If the legacy value validates, copy it into `UserPreferences.editing` and save the new key.
6. The legacy key is not deleted automatically.

Corrupted JSON is backed up through the storage abstraction when possible. Unsupported future preference versions are not migrated; the app falls back to built-in defaults and reports a warning.

Saved user preferences must not include document content, `editorContent`, imported text, or DOCX data.

## Layout Preferences

Layout preferences are personal display settings. They are stored in `UserPreferences.layout` and never in `DocumentProject`.

They control:

- Whether the outline sidebar is visible.
- Whether the settings panel is visible.
- Whether the editor toolbar is visible.
- Whether the normal save status is visible.
- Whether the outline sidebar is placed on the left or right.
- Whether the settings panel is placed on the left or right.

Save errors are still shown even when normal save status display is disabled.

The settings panel can always be reopened from the fixed topbar settings button or with `Ctrl+,`.

When both side panels are assigned to the same side, the sidebar is the outside panel and settings is the inside panel:

- Left side: `sidebar -> settings -> editor`
- Right side: `editor -> settings -> sidebar`

This order is resolved by a pure layout function before rendering.

On narrow screens, the app temporarily hides the sidebar and shows settings as an overlay so the editor remains usable. This responsive fallback does not change saved `UserPreferences`.

## Toolbar Preferences

Toolbar preferences are stored in `UserPreferences.toolbar` and `UserPreferences.layout`.

Saved toolbar values are:

- Command order as toolbar command IDs.
- Hidden command IDs.
- Button size: small, medium, or large.
- Whether button labels are shown.
- Toolbar visibility.
- Toolbar position: top or bottom for the current implementation.

The fixed topbar settings button is not a toolbar command and cannot be hidden by toolbar preferences.

Unknown toolbar command IDs are removed when preferences are loaded or updated. Duplicate IDs are collapsed to one entry. If a future app version adds a new command and it is missing from an older saved order, the command is appended from the built-in default order so it remains available.

Saved `left` or `right` toolbar positions are kept for future compatibility, but the current renderer safely displays them as top.

Toolbar changes do not update Tiptap JSON, `DocumentProject`, DOCX import/export data, or document dirty state.

## Document Formatting

DOCX-facing paragraph formatting is stored separately in `DocumentProject`.

Per-paragraph formatting is stored on Tiptap paragraph and heading nodes as validated `paragraphFormatting` attributes. New projects also store `documentDefaults`, including body paragraph spacing and heading spacing. Existing documents are not overwritten when the user changes personal preferences.

The settings panel writes page size, orientation, and margins into `DocumentProject.pageSettings`. It writes the currently selected paragraph or heading formatting into that node's `paragraphFormatting` attribute and mirrors the latest edited values in `DocumentProject.paragraphSettings` for project persistence and UI state.

Header and footer editing uses independent Tiptap editor instances in the settings panel. They write only to `DocumentProject.header` and `DocumentProject.footer`; they do not share the body editor instance, selection, commands, or undo history. Footer page number placement is saved as document data, not as a personal preference.

Table editing uses Tiptap's table commands and stores the result only in body `editorContent`. When the cursor is inside a table, toolbar commands can add rows above/below, add columns left/right, delete the current row/column, delete the table, merge selected cells, split the current merged cell, and toggle the header row. Outside a table these commands are disabled by the editor command state.

The settings panel exposes selected-cell settings for background color and vertical alignment. Background color is stored as a normalized HEX value or `null`; invalid values are ignored. Vertical alignment is stored as `top`, `middle`, or `bottom`. When multiple cells are selected, Tiptap applies supported attribute updates to the selection; otherwise the current cell is the target.

Image editing stores binary data only in `DocumentProject.assets`. The selected image settings panel edits the image node's `assetId`, width and height in pixels, `keepAspectRatio`, left/center/right alignment, and alt text. Width and height changes use numeric input; when aspect ratio lock is enabled, changing one side recalculates the other side from the current image size. Reset uses the asset's original dimensions and fits the image within the editor page width.

Image insertion uses a local file dialog and supports PNG, JPEG, GIF, and WebP for project storage. External URL images are never fetched. Unsupported formats, oversized files, oversized dimensions, corrupted image data, and image read failures are shown to the user without including document text or base64 data.

When a new document is created, the app copies the current new-document defaults into `DocumentProject.documentDefaults`. After creation, those defaults belong to the document.

## Paragraph Gap Rule

The app uses a simple explicit rule for paragraph gaps:

```ts
resolveParagraphGap(previousAfter, nextBefore) === Math.max(previousAfter, nextBefore);
```

The implementation does not rely on browser margin collapsing or Word-style spacing suppression rules.

## DOCX Import Simplification

Mammoth.js provides semantic DOCX-to-HTML conversion. Safe OOXML inspection supplements page settings, paragraph settings, relationships, images, and page breaks.

Supported paragraph settings are normalized into the app's simple `ParagraphFormatting` model where practical:

- Alignment.
- Indents.
- Paragraph spacing before and after.
- Single or multiple line spacing.
- Exact or at-least line spacing.
- Page break before.
- Keep with next and keep lines together.

When Word-specific paragraph spacing or line spacing is simplified, the import records `PARAGRAPH_SPACING_SIMPLIFIED`. Unsupported or lossy settings such as `widowControl`, unsupported alignments, unsupported line rules, section columns, page borders, comments, notes, headers, footers, charts, SmartArt, macros, and external image downloads are recorded as `ImportWarning` entries.

Imported DOCX paragraph settings never change Enter or Shift+Enter behavior. Editing behavior always follows personal preferences.

Header and footer import is intentionally limited to referenced default header/footer plain text and PAGE fields. First-page, odd/even, multiple header/footer variants, drawings, tables, structured document tags, and non-PAGE fields generate `ImportWarning` entries.

Table import supports normal tables, header cells/rows when represented in HTML, horizontal and vertical merges when Mammoth exposes `colspan` / `rowspan`, column and cell widths when represented as HTML width or colgroup data, cell background color, cell vertical alignment, and basic paragraphs inside cells. Nested tables, floating/text-wrapped tables, diagonal cells, complex table style inheritance, cell images/objects, equations, SmartArt, charts, structured document tags, oversized tables, and unrecoverable table structures generate `ImportWarning` entries and may be simplified.

Image import supports embedded PNG, JPEG, GIF, and WebP assets, relationship IDs, source parts, MIME type, checksums, base64 data, and intrinsic image dimensions when the format header exposes them. Inline images are treated as normal editable images. Anchored/floating images, text wrapping, crop, rotation, effects, grouped shapes, drawing canvas, missing media parts, broken relationships, external links, unsupported MIME types, MIME mismatches, and image size limits generate `ImportWarning` entries. Anchored layout is simplified to basic left/center/right paragraph placement where possible.

## DOCX Export Defaults

DOCX export generates a new DOCX from `ExportDocument`; it does not patch the original DOCX.

Paragraphs and headings explicitly emit:

- `spacing.before`
- `spacing.after`
- `spacing.line`
- `spacing.lineRule`
- `alignment`
- `indent`

If a paragraph has no local `paragraphFormatting`, export uses `DocumentProject.documentDefaults`. Personal visual settings are not exported unless they were explicitly copied into document defaults when creating a new document.

`hardBreak`, `paragraph`, and `pageBreak` remain distinct during export.

Header/footer export writes plain text paragraphs and optional footer PAGE fields through `ExportDocument`. It does not patch or preserve the original header/footer XML.

Table export writes a newly generated DOCX table through `ExportDocument`. It supports rows, cells, header rows, merged cells, column widths, table width, cell background color, vertical alignment, Japanese text, multiple paragraphs, and empty cells. It does not preserve original Word table styles, floating layout, text wrapping, diagonal borders, nested table semantics, or unsupported objects inside cells.

Image export writes a newly generated DOCX image through `ExportDocument`. It supports PNG, JPEG, GIF, width, height, alt text, and left/center/right paragraph alignment. WebP, missing assets, missing base64 data, and unsupported MIME types fail export explicitly instead of pretending to be another format.

## Save Recovery Behavior

Document editing changes mark the project dirty and schedule an autosave recovery file. Autosave status is separate from explicit save status: the app can show autosave pending, autosaving, autosaved, autosave error, or recovered editing. Explicit save creates a backup before replacing the normal project file. Recovery candidates are shown to the user and are never written back to the normal project file without an explicit save.
