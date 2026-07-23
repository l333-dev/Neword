# Import Warnings

ImportWarning entries classify DOCX information that is unsupported, approximated, blocked, or unsafe to preserve.

Stage 14 detects these unsupported or risky features:

- comments
- footnotes
- endnotes
- math
- charts
- SmartArt or diagram parts
- OLE and embedded objects
- VML and text boxes
- tracked changes
- external image relationships
- external templates
- macros

Warnings are aggregated by category, code, affected part, and recommendation. Aggregated warnings keep a count and a small list of safe source references such as `word/document.xml`; they do not keep full XML, document text, comment text, footnote text, image Base64, or external URL contents.

Warnings with severity `error` block applying an import preview. `warning` and `info` entries allow the user to continue after reviewing the preview.
