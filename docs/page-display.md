# Page Display and Breaks

The editor stores explicit page breaks as the dedicated Tiptap `pageBreak` node. It does not store page breaks as repeated newlines or empty paragraphs.

`pageBreak` supports these attributes:

- `breakType`: `page`, `sectionNextPage`, or `sectionContinuous`
- `source`: `user` or `docx`
- `importedFrom`: the OOXML source such as `w:br`, `w:pageBreakBefore`, or `w:sectPr`
- `sectionMetadata`: detected section information that can be preserved safely

The on-screen page view is derived from `DocumentProject.pageSettings`. Paper size, orientation, and margins are exposed as CSS variables on the page frame. This visual pagination is not stored in the project and is not expected to match Microsoft Word pagination exactly.

Header, footer, and page numbers are shown as preview-only UI around the body editor. They remain independent from `editorContent`. Footer page numbers use the saved footer page number position, but individual page numbers are not stored in the project.

DOCX import supports explicit `w:br w:type="page"` and records `w:pageBreakBefore` as a page break before the paragraph. `w:lastRenderedPageBreak` is treated as Word-rendered layout information and produces `page_break.rendered_only` instead of inserting an editable page break. Column breaks produce `page_break.column_unsupported`.

Sections are detected from `w:sectPr`. The first section is used for the document-wide page settings. Later sections are stored as page break metadata when a stable paragraph position is available, and unsupported section behavior is reported through ImportWarning.

Known limitations:

- Multiple sections are not fully editable as independent layout ranges.
- Continuous, odd page, and even page section breaks are simplified for editing/export.
- Section-specific header/footer references are detected but simplified to the default header/footer model.
- Browser page display does not implement Word's full layout engine, widow/orphan handling, floating object pagination, or table row splitting.
