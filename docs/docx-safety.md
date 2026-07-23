# DOCX Safety

DOCX import is local and offline. The app never executes macros, OLE objects, embedded packages, or external templates, and it never downloads external images.

Rust validates ZIP entry paths, absolute paths, Windows traversal forms, individual entry size, total uncompressed size, compression ratio, image size, total image size, and malformed package structure before the frontend applies any import result.

Stage 14 keeps the existing limits and adds cancellable inspection checkpoints during ZIP entry scanning, document XML inspection, header/footer extraction, relationship inspection, and image extraction. Cancellation returns a distinct `DOCX import cancelled` result instead of a generic parse failure.

Import warnings store only safe metadata: code, category, severity, affected part, count, and recommendation. They do not store document body text, comment text, footnote text, full XML, Base64 image data, or external URL contents.
