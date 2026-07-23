# DOCX Import

DOCX import remains local and offline. The original DOCX is never modified.

Stages shown to the user:

1. File check
2. ZIP safety inspection
3. OOXML metadata extraction
4. Image asset extraction
5. Mammoth HTML conversion
6. HTML sanitization
7. Document classification
8. Internal model generation
9. Preview preparation

The progress UI is stage-based. It does not show a fake percentage.

## Pipeline

Stage 14 treats import as a typed pipeline:

1. File metadata check in the frontend/file access layer
2. Cancellable Rust ZIP safety inspection
3. Rust OOXML package metadata extraction
4. Rust relationship inspection
5. Rust image and asset extraction
6. Mammoth HTML conversion in a Vite Web Worker
7. Main-thread DOMPurify sanitization
8. HTML-to-intermediate block conversion
9. OOXML formatting/header/footer/page metadata merge
10. Rule-based classification
11. Safe ImportWarning aggregation
12. DocumentProject preview candidate generation
13. User confirmation before applying the result

Each visible stage can be reported without logging document text, XML, or image Base64.

## Cancellation

Stage 14 adds request-id based cancellation. The frontend sends the same request id to Rust inspection and the import Worker. Rust checks cancellation while scanning ZIP entries and between longer OOXML/image inspection stages. The Worker accepts `cancel` messages and the client ignores late `success` responses after cancellation. Cancellation is not shown as an error and does not modify the current document.

## ImportWarning

Warnings include:

- `code`
- `category`
- `severity`
- `message`
- `humanReadableReason`
- `affectedPart`
- `sourceReference`
- `canContinue`
- `recommendation`

Categories include unsupported elements/styles, lost formatting, approximated layout, blocked external images, macros, malformed relationships, oversized assets, numbering, table features, header/footer, section, recovery, and general warnings.

The preview shows severity counts, category filters, severity filters, details, recommendations, and a safe copy action. The copied warning data excludes document body text, image Base64, and DOCX XML.

Errors block import application. Warnings allow the user to continue after reviewing the preview.

Stage 14 adds structured detection for comments, footnotes, endnotes, math, charts, SmartArt/diagram parts, OLE/embedded objects, tracked changes, external images, external templates, and macro-enabled content. Warnings are aggregated by category, code, affected part, and reason. Aggregated entries keep counts and a few safe source references, not full XML or document text.

## Large Files

Rust keeps ZIP path traversal, entry size, compression ratio, macro, image size, and total image limits. Stage 13 does not remove or loosen those limits. Limit failures are surfaced as structured errors without document content.

## Chunking

DOCX import remains lazy-loaded outside the initial app chunk. Stage 14 moves Mammoth conversion into `importWorker.ts`, which Vite emits as a Worker chunk. DOMPurify stays on the main thread because it depends on a DOM environment in this app. The import preview and sanitizer still load only after the user starts DOCX import.
