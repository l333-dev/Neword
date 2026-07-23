# Search and Replace

Search runs against the Tiptap/ProseMirror document, including headings, paragraphs, list items, table cells, header/footer preview text where stored in the document model, and normal text nodes. It does not search unsupported hidden DOCX structures.

Open search with `Ctrl/Cmd+F`, the native menu, or the editor search panel.

Options:

- Case sensitive
- Whole word for ASCII word boundaries
- Regular expression

Japanese text is searched as Unicode text. Hiragana, Katakana, Kanji, full-width ASCII, half-width ASCII, and Japanese punctuation are matched literally. The app does not claim morphological Japanese word segmentation.

## Regex

Invalid regex patterns show an error and do not stop the app. Zero-width matches are skipped to avoid loops. Capture replacement supports `$1`, `$2`, and similar references in regex mode.

## Highlight

Search highlights use ProseMirror decorations. They are not stored in `DocumentProject`, `.neword`, recovery files, backups, or DOCX export.

## Replace

Replace current and replace all run as editor transactions, so undo/redo can restore changes. Stage 13 replaces matches within individual text nodes. It does not merge across table cells, block boundaries, or separate text nodes with different marks. Read-only mode disables replacement.
