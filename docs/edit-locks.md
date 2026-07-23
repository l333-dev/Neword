# Edit Locks

Editable project sessions create lock files under Tauri app data `locks/`.

The lock stores:

- schema version
- lock id
- normalized project path hash
- optional display path
- process id
- frontend session id
- app version
- created timestamp
- heartbeat timestamp

It never stores document text, image Base64, search terms, replacement text, or DOCX XML.

## PID and Heartbeat

Stage 13 checks Linux PIDs through `/proc/<pid>`. macOS and Windows builds return `unknown` for now instead of guessing. PID check failure is not treated as process absence.

Lock states:

- `active`: heartbeat fresh and PID exists
- `heartbeat_stale_pid_exists`: heartbeat old but PID exists
- `pid_missing_heartbeat_fresh`: PID missing but heartbeat fresh
- `stale`: PID missing and heartbeat old
- `pid_unknown_heartbeat_fresh`: PID could not be checked and heartbeat fresh
- `heartbeat_stale_pid_unknown`: PID could not be checked and heartbeat old

Only `stale` can be cleaned automatically. All uncertain states ask the user.

## Conflict Dialog

When a non-stale or uncertain lock is detected, the app shows a dedicated conflict dialog with file name, path, lock creation time, heartbeat, PID status, session comparison, and state.

Choices:

- Open read-only: no editing, normal save, autosave, or recovery save.
- Open editable copy: open as an unsaved document. The original file is not modified and a new lock is created only after Save As.
- Edit anyway: keeps external update detection and backup-capable atomic save. It does not delete the other lock.
- Cancel: leave the current document unchanged.

Save As also checks the selected destination before writing when it differs from the current project path. If that destination has an active or uncertain edit lock, the app shows the same conflict dialog and cancels the write unless the user explicitly chooses to edit despite the conflict. This prevents Save As from overwriting another active project session before the lock warning is shown.
