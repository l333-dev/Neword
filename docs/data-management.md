# Data Management

Stage 13 separates user-owned files from app-managed data.

Never deleted by data management:

- user-saved `.neword`
- legacy user-saved `.json`
- original imported DOCX
- exported DOCX

App-managed targets:

- localStorage user preferences
- localStorage recent projects
- localStorage onboarding state
- app data `recovery/`
- app data `backups/`
- app data `locks/`
- app-owned temporary files inside app data

## localStorage Schema

The keys remain:

- `neword.userPreferences.v1`
- `neword.recentProjects.v1`
- `neword.onboarding.v1`

Values are saved as:

```ts
type StoredEnvelope<T> = {
  schemaVersion: 1;
  updatedAt: string;
  data: T;
};
```

Old direct values are still accepted. Once the app saves successfully, the same key is rewritten as an envelope. Migration does not delete old data before a successful write.

Corrupted JSON falls back to defaults. Settings storage attempts to preserve a `.corrupted` copy. Quota errors are reported as `PREFERENCES_QUOTA_EXCEEDED`.

Development Vite storage and production Tauri storage are different WebView origins. They should not be expected to share settings.

Multiple WebViews or tabs use last-writer-wins localStorage behavior. No cross-window merge is implemented yet.

## Individual Reset

The settings panel exposes separate actions for appearance, editing, layout, toolbar, all settings, recent files, onboarding, valid recovery files, invalid recovery files, backups, temporary files, and stale locks.

Temporary cleanup only scans app data subdirectories and deletes app-owned old `.tmp`/internal work files. Symlinks and user project locations are not followed.
