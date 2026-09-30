# 2026-09-30 — Plugin Update: State-Aware Migration Application

## Summary

`npm run plugin:update` / `npm run update` (plugin phase, `scripts/update-plugins.mjs`) previously **re-applied every plugin migration file on every update** and never wrote anything to `public.deployment_state` — recorded migration state for plugins was only ever produced by `npm run state:recheck -- --sync`, and a failed migration aborted the whole plugin update as a thrown error.

The update flow now mirrors the core `migrate.mjs` doctrine:

- **Drift-aware planning** — each plugin migration is classified against its recorded `deployment_state` row (`owner_kind='plugin'`, `component='migrations'`, EOL-normalized SHA-256 checksum, identical formula to `state:recheck`):
  - *pending* (never recorded) → applied
  - *drifted* (checksum changed) → re-applied after confirmation (migrations are idempotent by doctrine) or non-interactively via `--force`
  - *converged* (checksum match) → skipped
- **Write-after-confirm state recording** — each migration's `deployment_state` row is written **only after** the SQL was applied successfully (`ON CONFLICT DO UPDATE`, no secrets, owner tagged `plugin:<slug>`). A failed application records nothing.
- **Graceful failure handling** — a failed migration no longer throws through the whole run: it stops the remaining migrations of that plugin, keeps the state rows of everything already applied, surfaces the failure in the result/summary, and the run continues with the next plugin. The DB `plugins.status/version` refresh still runs.
- **Missing-state resilience** — if `deployment_state` is unreadable (e.g. table not yet migrated), all migrations are treated as pending; if a state write fails after a successful application, it is a warning (converged later by `state:recheck --sync`), never a silent loss of the applied checksum.

## Files Added

- `tests/updatePluginMigrations.test.mjs` — pure tests for `planPluginMigrations` (pending/drifted/converged classification, checksum-less recorded rows treated as converged, EOL-independent drift detection) and a source-level contract locking write-after-confirm (no `status: 'error'` state writes).

## Files Changed

- `scripts/update-plugins.mjs`
  - New exported pure helper `planPluginMigrations(files, recordedRows)`.
  - `applyPluginMigrations(item, db, { force })` rewritten: reads recorded `deployment_state` rows, applies the plan, writes state rows write-after-confirm, returns `{ applied, skipped, drifted, failed, converged }` instead of throwing on failure.
  - `updatePlugin(item, db, { force })` accepts options, carries `migrationDetails`, reports failures as warnings.
  - CLI: `--force` flag; summary shows applied / drifted-skipped / FAILED / already-current counts.
- `scripts/update.mjs`
  - New `--force-migrations` flag forwarded to the plugin phase (filtered out of the core `cf-update.mjs` args); failed migrations surfaced via `p.log.error`.

## Impact Analysis

- **Database**: no schema change. New writes to the existing `public.deployment_state` table (`component='migrations'`, `owner_kind='plugin'`) via the established `buildPluginUpsertSql` conflict target `(plugin_id, component, key) where plugin_id is not null`. Writes remain idempotent.
- **Runtime**: no Worker/frontend changes. Only the maintenance scripts.
- **API surface**: none. Plugin hook/API contracts untouched.
- **Behavioral**: plugin updates no longer blind-replay all migrations on every run; drift is now detected and (after confirmation) reconciled, so the recorded state and the live schema converge without a separate `state:recheck --sync` pass.
