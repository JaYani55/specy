# Database Snapshots & Action Logs

Local database snapshots (full content dump / restore) and critical action
logging, both driven by the `npm run setup` maintenance TUI and available as
a standalone CLI (`npm run snapshots`).

- Snapshot engine: `scripts/snapshots.mjs`
- Pure logic: `scripts/lib/db-snapshot.mjs`
- `/data` workspace + logging: `scripts/lib/action-log.mjs`
- Menu integration: `scripts/setup.mjs` (menu entry `DB Snapshots` →
  delegates to `scripts/snapshots.mjs`, consistent with the launcher pattern
  in [`unified-setup-tui.md`](unified-setup-tui.md))

---

## 1. The `/data` workspace

`/data` is a **local, gitignored** workspace (dynamic — every tooling flow
creates it on demand via `ensureDataDirs()`, never committed):

```
data/
  snapshots/   JSON snapshot files written by scripts/snapshots.mjs
  logs/        one log file per critical action run
```

## 2. Snapshots — what they contain

A snapshot is a **data-only, JSON-format dump of ALL application database
content** of the connected Supabase project:

- Every base table in every schema that is not platform machinery
  (`isSnapshotSchema()` in `scripts/lib/db-snapshot.mjs`): `public`, plugin
  schemas, and the managed `auth` / `storage` schemas (public tables
  regularly FK into `auth.users`, so a full restore needs auth rows back).
- Excluded: `pg_*`, `information_schema`, `supabase_migrations`,
  `realtime`, `extensions`, `graphql*`, `net`, `vault`, `pgsodium`, `cron`,
  and similar platform schemas (see `SYSTEM_SCHEMA_BLOCKLIST`).
- **Platform-managed tables the connection cannot read** (SQLSTATE 42501,
  e.g. `storage.vector_indexes`, owned by a platform role) are **skipped**
  with a warning instead of aborting the run — they are recorded in
  `meta.skipped_tables` and counted in `meta.counts.skipped`.
- Per table: column metadata (name, `data_type`, `is_identity`), FK
  references (child → parent, from `pg_constraint`), row count and all rows
  (fetched in 500-row pages). **Generated columns are excluded** (computed).
- The schema itself is **not** part of a snapshot — it stays owned by the
  migration system. Apply migrations first, then restore.

File format (`format: 1`, validated on restore):

```json
{
  "format": 1,
  "meta": {
    "created_at": "…",
    "project_ref": "…",
    "tool": "scripts/snapshots.mjs",
    "counts": { "tables": 12, "rows": 340 }
  },
  "tables": [
    { "schema": "public", "table": "pages", "columns": [...],
      "references": [["public","tenants"]], "row_count": 8, "rows": [...] }
  ]
}
```

File name: `data/snapshots/snapshot-YYYY-MM-DD_HH-MM-SS.json`
(Windows-safe, no colons).

## 3. Create

`npm run snapshots -- --create`, or `npm run setup` → **DB Snapshots** →
**Create Snapshot**.

1. Introspect tables/columns (`information_schema`) and FKs (`pg_constraint`).
2. Dump every table page by page (`select … limit 500 offset k`).
3. Write the JSON snapshot into `data/snapshots/`.

## 4. Restore (destructive)

`npm run snapshots -- --restore <file> [--yes]`, or `npm run setup` →
**DB Snapshots** → **Restore Snapshot** (reads the locally available
snapshots from `data/snapshots/`).

1. Validate the file (`format: 1`); warn when the snapshot came from a
   different project ref.
2. Intersect with the live schema: tables/columns that no longer exist are
   skipped with a warning ("apply migrations first"). Columns added since
   the snapshot are left at their defaults.
3. **Confirmation prompt** listing how many tables/rows are affected
   (`--yes` skips it; refused without `--yes` when non-interactive).
4. **Trigger suppression probe** — the schema ships triggers with side
   effects (e.g. `create_default_tenant_for_profile_trigger` re-creates the
   default workspace tenant when `user_profile` rows are restored, which
   otherwise breaks the restore with duplicate-key errors). Restore probes
   `session_replication_role = replica` and uses the first working mode:
   - `transaction` (preferred): every clear/insert statement wrapped in
     `BEGIN; SET LOCAL session_replication_role = replica; … COMMIT;` —
     pool-safe, cannot leak into the server-side pooled connection.
   - `session`: session-scoped SET per statement, `RESET` best-effort after
     the run.
   - `null` (role not privileged enough): triggers stay active; inserts
     run with `on conflict do nothing` and post-restore row-count
     verification warns about trigger-created or skipped rows.
4. **Clear phase** — `delete from` every restored table, children first
   (reverse FK-topological order, so FK constraints allow the delete).
5. **Insert phase** — parents-first (topological order via
   `orderTablesForRestore()`), chunked INSERTs (100 rows per Management API
   call), `OVERRIDING SYSTEM VALUE` for identity columns.
6. **Verification** — every restored table is counted
   (`select count(*)`); a mismatch against the snapshot row count is
   reported as a warning (should be zero when triggers are suppressed).
7. **Sequence re-alignment** — `setval(pg_get_serial_sequence(…), max+1)`
   for identity/serial columns so new rows continue after the restored max.
8. Fail-fast: a failed clear/insert aborts the run with a clear error; the
   restore stays partially applied (re-running the restore is safe).
8. **Platform-managed tables** (SQLSTATE 42501 during clear, e.g.
   `storage.vector_indexes`) are **skipped, not aborted**: they keep their
   current rows and are excluded from insert/sequence phases too. The
   summary and the action log record them. Because a skipped parent keeps
   its data, FKs from restored children onto skipped parents usually stay
   valid — but a skipped table's own content is NOT restored.

FK cycles cannot be ordered — those tables are restored in snapshot order
(best effort); a failure surfaces the offending table.

### 4.1 Restore safety — non-atomicity

The restore is **not atomic**: every statement runs through the Supabase
Management API as its own transaction. There is no encompassing
`BEGIN … COMMIT` around the clear + insert phases. Consequences:

- A failure mid-way (network drop, insert error, timeout) leaves the
  database in a **partially cleared / partially restored** state.
- The recommended workflow is therefore always:
  1. `npm run snapshots` → **Create snapshot** (immediately before the
     restore — this is the rollback path if the restore fails halfway).
  2. Restore.
  3. Check the row-count verification warnings; if any mismatch appears,
     restore again or roll back from the fresh snapshot.
- Re-running the restore after a failure is safe (idempotent clear +
  insert), but the interim state is visible to running workers and API
  traffic — restore during a maintenance window on production systems.
- The interactive confirm prompt prints this warning before asking for
  confirmation; `--yes` (automation) implies the operator accepts the
  non-atomicity.

## 5. CLI contract

| Invocation | Behaviour |
|---|---|
| `npm run snapshots` | interactive menu: **Create Snapshot** / **Restore Snapshot** / **List Snapshots** (this is what the setup TUI menu item launches) |
| `npm run snapshots -- --list` | list local snapshots with size/table/row counts |
| `npm run snapshots -- --create` | create a snapshot |
| `npm run snapshots -- --restore <name>` | restore a snapshot from `data/snapshots` |
| `--yes` | skip the destructive-restore confirmation |

Connection uses the shared PAT flow (`scripts/lib/remote-sql.mjs`) — the
Management API runs with project-owner privileges (RLS does not apply). No
PAT → snapshots are skipped gracefully.

## 6. Action logs (`/data/logs`)

**Every critical action run creates one log file** via
`createActionLog()` in `scripts/lib/action-log.mjs`:

| Action | Log file | Written by |
|---|---|---|
| Core migrations | `<ts>_migrations.log` | `scripts/migrate.mjs` (covers `npm run setup` → migrations, `npm run migrations`, and the update flows) |
| Snapshot create | `<ts>_snapshot-create.log` | `scripts/snapshots.mjs` |
| Snapshot restore | `<ts>_snapshot-restore.log` | `scripts/snapshots.mjs` |

`<ts>` = `YYYY-MM-DD_HH-MM-SS` (local time, no colons — Windows-safe).

Log layout: `action:` / `started:` / metadata header, append-only
timestamped `[iso] message` entries during the run (applied migrations,
per-table dump/restore counts, failures), and a final
`finished:` / `status:` block (`applied`, `created`, `restored`, `failed`,
`aborted`, `dry-run`, `nothing-to-apply`). Files are written incrementally,
so a hard crash still leaves a partial trail. **Logs never contain
secrets** (PATs, keys).

## 7. Tests & limits

- `tests/dbSnapshots.test.mjs` covers schema filtering, SQL literal
  rendering (including native Postgres array literals), insert/delete/
  sequence SQL generation, FK-topological ordering (linear chains, self
  references, FK dedup, cycles), the insufficient-privilege (42501) error
  classification, the dynamic `/data` creation, the log file contract, and
  the setup-menu/package/gitignore wiring.
- Not verified against a live database without a PAT: end-to-end dump and
  restore. The SQL is plain Postgres and runs through the same Management
  API channel as `migrate.mjs`.
- Large tables are fetched page-wise but a snapshot is still a single JSON
  file — very large datasets produce large files (no compression/streaming
  yet).
- The dump is not transactionally consistent across tables (page-wise reads
  at different moments). Take snapshots during quiet periods.
