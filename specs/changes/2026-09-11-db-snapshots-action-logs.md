# 2026-09-11 — DB Snapshots & Critical Action Logs

## Summary

Adds a local database snapshot system and critical action logging to the
setup tooling:

- **`npm run setup` → `DB Snapshots`** menu item opening a submenu with
  **Create Snapshot**, **Restore Snapshot** (reads the locally available
  snapshots) and **List Snapshots**. The menu action delegates to the new
  `scripts/snapshots.mjs`, consistent with the launcher pattern of the
  maintenance TUI (no engine duplication).
- **`npm run snapshots`** — the same engine as a standalone CLI
  (`--create`, `--restore <file>`, `--list`, `--yes`).
- **Snapshots** dump ALL application database content (every base table in
  every non-platform schema: `public`, plugin schemas, `auth`, `storage`;
  rows fetched page-wise, generated columns excluded, FK graph recorded)
  as a JSON file into `/data/snapshots`. Restore is a full content restore:
  confirmation → clear tables children-first → parents-first chunked
  re-inserts (identity-aware) → sequence re-alignment. Snapshots are
  data-only; the schema stays owned by the migration system.
- **`/data` workspace** (`snapshots/`, `logs/`) is created dynamically by
  the tooling when first needed and is gitignored.
- **Action logs**: every critical action run — core migrations, snapshot
  create, snapshot restore — writes an append-only log file into
  `/data/logs` (`<ts>_<action>.log`, Windows-safe names) with a metadata
  header, timestamped entries during the run and a final status block.
  Logs never contain secrets.
- **Platform-managed tables** (SQLSTATE 42501 — e.g. `storage.vector_indexes`,
  found in live restore testing) are skipped with a warning on dump and
  restore instead of aborting; they are recorded in `meta.skipped_tables`.

Follow-up 1: first live restore surfaced `storage.vector_indexes` as not
writable by the Management API role — the skip behaviour was added in this
change.

Follow-up 2: the first full live restore failed on `public.tenants` with a
duplicate slug — the `create_default_tenant_for_profile_trigger` on
`user_profile` re-creates the default workspace tenant while auth/user rows
are being restored. Restore now probes and applies trigger/FK suppression
(`session_replication_role = replica`, transaction-local `SET LOCAL`
wrapping preferred, session-scoped fallback with RESET, conflict-tolerant
last resort) and verifies per-table row counts after the run.

Full contract: [`specs/platform/db-snapshots.md`](../platform/db-snapshots.md).

## Files Added

- `scripts/snapshots.mjs` — snapshot engine + interactive submenu
- `scripts/lib/db-snapshot.mjs` — pure snapshot logic (schema filter, SQL
  rendering, FK-topological ordering, SQLSTATE classification; no I/O)
- `scripts/lib/action-log.mjs` — dynamic `/data` workspace + action logs
- `tests/dbSnapshots.test.mjs` — 36 unit tests for the logic and wiring
- `specs/platform/db-snapshots.md` — system documentation

## Files Changed

- `scripts/setup.mjs` — `DB Snapshots` menu entry → `nodeScript('snapshots.mjs')`
- `scripts/migrate.mjs` — critical action logging on every migrations run
  (project, plan, per-migration applied/failed entries, final status)
- `scripts/lib/remote-sql.mjs` — export the shared `fail` console helper
- `.gitignore` — add `/data/`
- `package.json` — add `snapshots` script
- `specs/platform/README.md`, `specs/platform/unified-setup-tui.md` — register the new system, menu row and modules

## Impact Analysis

### Database

- **No migration added.** Snapshots read via `information_schema`,
  `pg_constraint` and plain `select * from … limit/offset` and restore via
  `delete from` / `insert into … [OVERRIDING SYSTEM VALUE] values …` /
  `setval(pg_get_serial_sequence(…))` — all runtime DML through the
  existing Supabase Management API channel (same as `migrate.mjs`). No
  schema objects are created or altered by this feature; restore is
  destructive to **data only** and gated behind a confirmation prompt
  (`--yes` to bypass, refused non-interactively without it).

### Runtime

- Tooling-only (Node CLI scripts); no Worker/API/frontend code touched.
  `/data` is local-only and gitignored.

### API surface

- No HTTP/API changes. New npm scripts: `snapshots`. New setup menu action:
  `snapshots`. New local CLI flags on `scripts/snapshots.mjs`.
- Restoring a snapshot captured from a different project ref prints a
  warning; snapshots restore only tables/columns that still exist in the
  live schema (missing ones are listed with "apply migrations first").

## Verification

- `npm run typecheck` → exit 0
- `npm test` → 253/253 pass (incl. 36 new `dbSnapshots` tests)
- `npm run build` → succeeds
- `node scripts/snapshots.mjs --list` smoke test: `/data` tree created
  dynamically, empty-state message, no DB connection needed.
- Graceful no-PAT failure path exercised (`--create` exits 1 with a clear
  message; no snapshot/log written before the action starts).
- Not verifiable in this environment: a live end-to-end dump/restore
  against a real Supabase project (requires a PAT). The generated SQL is
  plain Postgres through the same Management API channel used by
  `migrate.mjs`; the destructive-restore confirmation and fail-fast
  behaviour are covered by the logic tests.
- Live restore feedback: `storage.vector_indexes` (platform-owned) rejects
  writes from the Management API role with SQLSTATE 42501 — handled by the
  skip-instead-of-abort behaviour described above (38 `dbSnapshots` tests
  after this follow-up).
