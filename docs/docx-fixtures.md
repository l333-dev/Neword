# DOCX Fixtures

Fixtures must be synthetic and must not contain real personal, school, company, or customer documents.

Current binary fixtures cover Japanese text, headings, lists, tables, images, duplicate images, external and broken image relationships, page settings, page breaks, multiple sections, and image size limits.

Stage 14 adds `tests/fixture-builders/docxPackages.ts` for reproducible minimal DOCX packages and `tests/fixtures/docx/manifest.json` to track generated fixture intent. The builder can create small packages with custom `document.xml`, relationships, and extra OOXML parts for tests.

Covered by Stage 14 generated fixture design:

- comments
- footnotes
- endnotes
- math
- charts
- SmartArt/diagram
- OLE/embedded objects
- tracked changes
- external images
- external templates

Still better suited to future binary fixtures:

- macro-enabled DOCM
- abnormal compression ratio packages
- entry count overflow packages
- very large images

Those are tested with synthetic package generation or Rust unit tests where storing large binaries would be wasteful.
