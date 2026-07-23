# DOCX Import Cancellation

DOCX import cancellation is request-id based.

Frontend responsibilities:

- create a request id for each import
- pass it to Rust inspection and Worker conversion
- set UI state to cancelling/cancelled
- ignore late results after cancellation
- keep the current document unchanged until the user applies a preview

Rust responsibilities:

- register cancellable request ids in managed state
- expose `cancel_docx_import`
- check cancellation while scanning ZIP entries
- check between document XML, header/footer, relationship, and image stages
- remove completed request ids

Worker responsibilities:

- validate input at the Worker boundary
- report progress
- accept `cancel`
- return `cancelled` or reject through a safe Error wrapper

Rust XML parsing currently checks cancellation between parser stages rather than on every XML token. Very small files may finish before the cancellation request arrives; the frontend still drops late results.
