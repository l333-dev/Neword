# Save and Recovery

## Roles

- Normal project file: the user-selected `.json` project path.
- Autosave file: a recovery envelope stored under the app recovery directory, not the normal project path.
- Temporary file: a same-directory hidden `.tmp` file used only during atomic replacement.
- Backup file: a pre-save copy next to the normal project file, named `<project-file>.<timestamp>.bak`.
- Exported DOCX: generated output only; it is never used as a project autosave or backup.

## Autosave

Autosave writes `AutosaveEnvelope` JSON files. The envelope contains recovery metadata, a content hash, revision, timestamps, optional source path, and the `DocumentProject`.

Autosave file names use only safe hashes such as `autosave-path-fnv1a64-....json` or `autosave-new-fnv1a64-....json`. Document titles and body text are never used in recovery file names.

Autosave is debounced and serialized through the same frontend save queue as explicit saves. Autosave never writes directly to the normal project file. If a newer edit happens while autosave is running, the completed autosave is not treated as an explicit saved state.

New unsaved projects also autosave through a temporary session project key. When the project is explicitly saved, later autosaves are associated with the saved path hash.

## Backups

Explicit project save uses a backup-capable atomic command. If the target file exists, it is copied to `<project-file>.<timestamp>.bak` before replacement. The current rotation limit is 5 generations. Backup rotation failures are intentionally non-fatal after a successful save.

Backups live next to the user project file so they can be found if the current file is corrupted. Temporary files use `.tmp` and are separate from `.bak` files.

## Atomic Save

The Rust file command:

1. Validates the parent directory.
2. Creates a hidden temporary file in the target directory.
3. Writes all bytes.
4. Flushes and syncs the file.
5. Creates a backup for explicit project saves.
6. Renames the temporary file over the target.
7. Removes the temporary file on failure where possible.

Errors are returned as structured values with `code`, `operation`, `path`, `retryable`, a human-readable message, and a technical cause. Document text, Tiptap JSON, and image base64 are not included in error messages.

## Recovery Candidates

On startup the app lists autosave recovery files, validates each envelope, and compares the content hash and timestamps with the currently loaded project. Candidates are classified as newer, same content, older, or corrupted. Corrupted candidates are shown but cannot be opened.

The home screen and the in-editor recovery panel show valid and corrupted recovery candidates. Each candidate displays the document title when available, autosave time, original project path, recovery file path, byte size, and validation state.

The recovery UI never overwrites the normal project file automatically. Opening a recovery candidate loads it into the editor as a recovered, unsaved project with no active save path. The user must explicitly save or save as before the recovered content replaces any normal project file.

Corrupted recovery files are still listed with their file path. They can be deleted from the UI, but their document contents are not logged or displayed as raw JSON.

## Cleanup

Recovery cleanup is conservative:

- Files older than 14 days are eligible for deletion.
- More than 5 recovery files per project key are pruned.
- Total recovery storage above 100MB is pruned oldest-first.

Only files matching the strict recovery naming rule in the app recovery directory are deleted. Normal project files, original DOCX files, exported DOCX files, and backups next to project files are not deleted by recovery cleanup.

## Limitations

The app does not currently run a filesystem watcher. External modification detection is limited to safe save sequencing and backups. Disk-full and OS-specific rename failures are reported through the structured file error but not exhaustively classified by platform-specific error code.

The recovery directory path is available from the About dialog. Current Rust code uses `std::env::temp_dir()/neword-recovery`, so the exact location can differ by OS and user session. User-selected project files remain wherever the user saved them.
