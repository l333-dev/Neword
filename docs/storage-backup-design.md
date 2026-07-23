# Storage and Backup Design

## Normal Save

The normal project file is the user-owned `.neword` file selected through the save dialog. The file is versioned JSON and is validated with the same `DocumentProject` schema and migrations used for legacy `.json` projects.

The app never overwrites an imported DOCX in place. DOCX export always creates a new DOCX output chosen by the user.

## Recovery vs Autosave

Recovery data is for crash and forced-exit recovery. It lives in app data `recovery/` and uses internal hash-based names. It is not the user's official project file.

Autosave, when expanded later, should mean saving to an already selected normal project path. It must not be used as a synonym for recovery data.

## Backups

Before an explicit overwrite save, the Rust command reads the existing target project. If it can be parsed as JSON, a copy is written to app data `backups/<path-hash>/`. The manifest records:

- backup id
- original project path
- original path hash
- backup timestamp
- formatVersion
- document title
- byte size
- content hash

The default retention limit is 5 generations per project path hash. Duplicate content is not backed up repeatedly.

## Restore

Opening a backup loads it as a recovered unsaved project. It has no active save path until the user chooses Save As. This prevents an old backup from silently replacing a newer normal project.

## Edit Locks and Read-only Mode

Editable project sessions create a lock file in app data `locks/`. The lock filename is derived from a normalized project path hash, not from the document title or raw user input. The lock record contains a lock id, path hash, optional display path, process id, app session id, app version, and created/updated timestamps. It never stores document text, image Base64, or DOCX XML.

When another non-stale lock is found, the app asks whether to open read-only, continue editing anyway, or cancel. Read-only mode disables Tiptap editing, normal save, autosave, and recovery save. Save As remains available so the user can create an editable copy without modifying the locked project.

The current stale-lock heuristic is conservative and based on `updatedAt` age. PID is recorded for future diagnostics but is not yet used as the sole source of truth.

## External Update Conflicts

Saved projects keep the last known modified time, size, and hash. If those values differ before an overwrite save, the app displays a conflict prompt. The user can reload the external version, save the current state as a new `.neword`, explicitly overwrite after a stronger confirmation, or cancel. Forced overwrite still goes through the backup-capable atomic save command so the external version is protected before replacement.

## App Data Folders

The data management UI can open the app data root, `recovery/`, and `backups/` through a Rust command that only accepts known folder identifiers. It does not expose arbitrary command execution or shell execution from user-provided paths.

## Data Reset

Settings can clear recent-project history and delete app-managed backups. These operations do not delete user-owned `.neword` or `.json` files outside app data.

Full app data deletion should remain split into explicit categories: settings, onboarding state, recent files, recovery data, backups, corrupted recovery files, and temporary files. Stage 12 provides recent-project clearing, backup deletion, and opening app data/recovery/backups folders. More granular actions such as resetting only settings and deleting only corrupted recovery files remain future work.

## LocalStorage

The current WebView localStorage data is limited to settings, recent-project metadata, and onboarding state. These values are Zod-validated, wrapped in a `schemaVersion` envelope, and do not contain document text, image Base64, search terms, replacement text, or DOCX XML.

Development `localhost` storage and production Tauri storage are separate WebView origins, so settings may not appear shared between dev and packaged builds.

Current keys:

- `neword.userPreferences.v1`
- `neword.recentProjects.v1`
- `neword.onboarding.v1`

The stored objects are validated before use and invalid values fall back to defaults or an empty list. Old direct values remain readable and are rewritten as envelopes only after a successful save. Quota and parse errors are surfaced as user-facing storage failures where the caller can recover.

See [data-management.md](./data-management.md) for reset scopes and cleanup rules.

## DOCX Lazy Loading and Chunks

DOCX import/export code is split out of the initial application chunk. Mammoth.js, JSZip-backed import helpers, docx.js, and export writer code are loaded only when the user starts DOCX import or export.

Measured Vite output in stage 15:

- Initial app: `index-FYoeS3kG.js` 148.30kB, gzip 42.19kB.
- React vendor: `vendor-react-D1jnLztF.js` 189.63kB, gzip 59.66kB.
- Tiptap vendor: `vendor-tiptap-BJRjEndB.js` 435.12kB, gzip 136.18kB.
- Validation vendor: `vendor-validation-Cr3_Bknf.js` 96.07kB, gzip 28.63kB.
- DOCX import model: `importDocx-D09aH4FY.js` 30.39kB, gzip 9.64kB.
- DOCX export writer: `docxWriter-EN6tWgab.js` 378.98kB, gzip 107.15kB.
- Mammoth browser chunk: `mammoth.browser-jIKWjR9m.js` 491.70kB, gzip 118.73kB.
- Import Worker: `importWorker-DWynHG8w.js` 559.98kB.

The production frontend build currently completes without Vite chunk-size warnings. The import Worker remains larger than 500kB because Mammoth conversion runs off the UI thread, but Vite reports it as a worker asset rather than an initial application chunk. The warning was fixed by real code splitting through `build.rolldownOptions.output.codeSplitting`, not by raising `chunkSizeWarningLimit`.
