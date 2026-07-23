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

Measured Vite output in stage 12:

- Before: initial `index` chunk about 1,761kB.
- After: initial `index-JmDPcDu3.js` 841,310 bytes, gzip 255.42kB.
- DOCX import: `importDocx-4yvJLEOG.js` 546,209 bytes, gzip 137.85kB.
- DOCX export writer: `docxWriter-CW_tUTP2.js` 378,938 bytes, gzip 107.12kB.
- Export model conversion: `exportDocument-BEqhxTC8.js` 3,132 bytes, gzip 1.17kB.

The remaining Vite warning is the DOCX import chunk exceeding 500kB. It is no longer part of first launch.
