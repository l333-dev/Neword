# DOCX Round Trip

Round trip testing uses semantic comparison rather than byte equality.

Target flow:

```text
DOCX -> import -> DocumentProject -> save .neword -> load .neword -> ExportDocument -> export DOCX -> re-import
```

Comparison ignores generated ids and timestamps. It checks document meaning where the app claims support:

- Japanese body text
- headings
- bold, italic, underline, strike
- bullet and numbered lists
- nested list structure where Mammoth and OOXML metadata expose it
- tables
- basic cell merge attributes
- images
- explicit page breaks
- page size, orientation, and margins
- default header/footer text and PAGE field detection

Known unsupported elements are expected as warnings rather than silent preservation: comments, footnotes, endnotes, equations, SmartArt, charts, OLE, tracked changes, macros, and external objects.
