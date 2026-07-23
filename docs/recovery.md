# Save and Recovery

## Roles

- Normal project file: the user-selected `.neword` project path. Legacy `.json` projects remain readable.
- Autosave: automatic save to an existing normal project path. It is separate from recovery data.
- Recovery file: a recovery envelope stored under Tauri app data `recovery/`, not the normal project path.
- Temporary file: a same-directory hidden `.tmp` file used only during atomic replacement.
- Backup file: a pre-save copy stored under Tauri app data `backups/`.
- Exported DOCX: generated output only; it is never used as a project autosave, recovery file, or backup.

## App Data Layout

Rust resolves the app data directory through Tauri path APIs. OS-specific absolute paths are not hard-coded.

```text
app data/
  recovery/
  backups/
  locks/
  state/
  logs/
```

`logs/` is reserved but the app does not create document-content logs. Document text, image Base64, and DOCX XML are not written to normal logs.

The About dialog and Settings > Data Management show the resolved app data, recovery, and backup paths. Settings > Data Management can open the app data root, recovery, and backup folders through known folder identifiers.

## Project Extension

The standard project extension is `.neword`. The file contents are still versioned JSON validated with Zod and migrated through the existing `DocumentProject` migration path.

Legacy `.json` projects can be opened. Opening or saving a legacy path does not silently change the user-selected path, but save-as defaults to `.neword`.

When the native save dialog returns a path without `.neword` or `.json`, the frontend appends `.neword` before invoking the Rust write command. Spaces and non-ASCII characters in the selected file name are preserved.

## Recovery

Recovery writes `AutosaveEnvelope` JSON files. The envelope contains recovery metadata, a content hash, revision, timestamps, optional source path, and the `DocumentProject`.

New recovery file names use only internal hashes such as `recovery-path-fnv1a64-....neword` or `recovery-new-fnv1a64-....neword`. Legacy names such as `autosave-path-fnv1a64-....json` are still accepted for migration. Document titles and body text are never used in recovery file names.

Recovery writes are debounced and serialized through the frontend save queue. Recovery never writes directly to the normal project file. If a newer edit happens while recovery save is running, the completed recovery write is not treated as an explicit saved state.

## Legacy Recovery Migration

On startup the app checks `std::env::temp_dir()/neword-recovery` unless `state/recovery-migration-v1.json` already records a completed migration.

Migration rules:

- Each legacy file is read and validated as an `AutosaveEnvelope` through the existing Zod-backed recovery parser.
- Valid data is copied to app data `recovery/`.
- If the same recovery name already exists, the newer destination is preferred.
- The legacy file is not deleted after copy.
- Corrupted legacy data is not copied and is not deleted.
- Migration state records completion, migrated count, invalid count, and non-content warning identifiers.
- The process is idempotent; rerunning it does not destroy either copy.

## Backups

Explicit project save uses the backup-capable atomic command. If the target file already exists and can be read as JSON, the old content is copied to app data `backups/<source-path-hash>/backup-*.neword` before replacement. First save to a new path, such as `test.neword`, does not enter backup creation.

Backup metadata is stored in a manifest next to each backup group. It records original path, path hash, save time, formatVersion, title, byte size, and content hash. The current retention limit is 5 generations per project path hash. Duplicate content is not backed up repeatedly.

Backup cleanup failure is non-fatal for the primary save, but the manifest is best-effort updated. User project files outside app data are never deleted by backup cleanup.

Opening a backup loads it as an unsaved recovered project with no active save path. The user must use Save As before it replaces any normal project file.

## Atomic Save

The Rust file command:

1. Validates the target parent directory.
2. Validates JSON for project/recovery writes.
3. Creates a backup for explicit project saves only when the target path already exists.
4. Creates a hidden temporary file in the target directory.
5. Writes all bytes.
6. Flushes and syncs the file.
7. Renames the temporary file over the target.
8. Removes the temporary file on failure where possible.
9. Updates the UI saved state only after success.

Errors are returned as structured values with `code`, `operation`, `path`, `retryable`, a human-readable message, and a technical cause. Atomic save errors keep the failed stage in `operation`, such as `atomic_write.create_temp`, `atomic_write.write`, `atomic_write.sync`, or `atomic_write.rename`. Document text, Tiptap JSON, and image Base64 are not included in error messages.

## External Changes

When a project is opened or saved, the app stores a file snapshot with modified time, byte size, and content hash. Before overwriting the same path, it compares the current snapshot. If a change is detected, the user is warned and can reload the external version, save the current document as another `.neword`, explicitly overwrite after a stronger confirmation, or cancel.

The app does not merge conflicting document contents automatically.

## Edit Locks

Editable project sessions create lock files under app data `locks/`. The filename is based on a normalized project path hash. The lock record contains a lock id, path hash, optional display path, process id, frontend session id, app version, and timestamps. It does not store document text, image Base64, or DOCX XML.

The frontend refreshes the active lock periodically and releases it when moving to another document or closing normally. A non-stale lock triggers a conflict choice: open read-only, continue editing anyway, or cancel. Read-only mode disables editor mutation, normal save, autosave, and recovery save.

## Cleanup

Recovery cleanup is conservative:

- Files older than 14 days are eligible for deletion.
- More than 5 recovery files per project key are pruned.
- Total recovery storage above 100MB is pruned oldest-first.

Only files matching the strict recovery naming rule in the app recovery directory are deleted. Normal project files, original DOCX files, exported DOCX files, and backups are not deleted by recovery cleanup.

## Desktop Integration

Tauri single-instance plugin forwards second-launch arguments to the existing window through `neword://open-paths`. The same open pipeline handles startup args, single-instance args, native menu open actions, and drag-and-drop candidates.

Linux packages include `application/x-neword-project` MIME XML and a desktop entry with `Exec=personal-doc-editor %F`. This associates `.neword` only; `.json` and `.docx` defaults are not changed.

Native menu IDs are emitted as `neword://menu-command` and mapped to shared app commands, so menu actions use the same unsaved-change and read-only guards as toolbar and keyboard actions.

## Limitations

External update detection happens on save, not through a live filesystem watcher. Lock staleness currently uses timestamp age; PID existence checks and a custom three-button lock dialog remain future work. macOS Finder file-open behavior is designed for but not verified in the Ubuntu development environment.
