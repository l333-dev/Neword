# DOCX Import Worker

Stage 14 runs the heaviest JavaScript import step, Mammoth DOCX-to-HTML conversion, in a Vite module Web Worker.

Worker request messages:

- `start`: includes `requestId`, transferable `ArrayBuffer`, and source metadata.
- `cancel`: includes `requestId`.

Worker response messages:

- `progress`: reports the current Worker stage.
- `success`: returns Mammoth HTML, Mammoth messages, and stage timings.
- `cancelled`: indicates the request was cancelled.
- `error`: returns a safe error with stage and redacted message.

The client passes the DOCX `ArrayBuffer` as transferable data to avoid keeping another large copy on the main thread. The Tauri IPC boundary still uses Base64 for native file reading in this stage; the transferred Worker input reduces one JavaScript-side duplicate but does not yet remove the IPC Base64 copy.

The Worker is created per import operation and terminated after success, error, or cancellation. Late responses whose `requestId` does not match the active request are ignored by the app.
