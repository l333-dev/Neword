# Supported DOCX Features

Supported or partially supported:

- Japanese text
- headings 1-4
- paragraphs
- bold, italic, underline, strike
- bullet and numbered lists through Mammoth output
- tables exposed as HTML tables
- basic cell merges exposed as `colspan`/`rowspan`
- PNG, JPEG, GIF, and WebP import as internal assets
- page settings from the first section
- explicit page breaks
- basic default header/footer text
- PAGE field detection for simple page number placement

Warnings or simplifications:

- multiple sections
- section-specific headers/footers
- first/even page headers and footers
- paragraph formatting that cannot map cleanly
- unsupported image layout such as anchored/floating images
- nested or floating tables
- cell images or objects
- external image relationships
- malformed or missing relationships
- comments, footnotes, endnotes, equations, charts, SmartArt/diagram, OLE/embedded objects, tracked changes, external templates, and macros are detected and reported as ImportWarnings

Unsupported:

- comments
- tracked changes
- footnotes and endnotes
- equations
- SmartArt and charts
- macros
- complex Word style inheritance
- exact Word pagination

Current fixtures include Japanese import samples, page layout samples, explicit page breaks, multiple sections, PNG/JPEG images, duplicate images, broken/external image relationships, and image size limits. Stage 14 adds a reproducible minimal DOCX package builder and manifest for unsupported-element fixtures. Missing binary fixture areas include DOCM, intentionally high compression-ratio packages, entry count overflow, and very large images; these remain covered by synthetic package or Rust unit tests where practical.
