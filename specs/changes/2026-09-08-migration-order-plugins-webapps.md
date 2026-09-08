# 2026-09-08 — Migration Order Fix: plugins_webapps.sql Missing From the Chain

## Summary

Fresh setup runs failed at `202605240006_webapps_multi_tenant.sql`:

```
ERROR: 42703: column "kind" does not exist
HINT: Perhaps you meant to reference the column "plugins.id".
```

Root cause: `migrations/plugins_webapps.sql` (adds `plugins.kind`, `plugins.external_url`, `plugins.icon_url`, drops the `repo_url` NOT NULL constraint, adds `plugins_kind_check` and `plugins_kind_url_consistency` constraints) **existed in `migrations/` but was never registered in the migration order** — so it never ran. `202605240006` filters policies on `plugins.kind` and therefore failed.

Fix: `plugins_webapps.sql` inserted into `MIGRATION_ORDER_CORE` directly after `plugins_config_schema.sql` (it only needs `public.plugins` from `plugins.sql`), well before `202605240006`.

## Files Changed

- `scripts/lib/migration-order.mjs` — added `'plugins_webapps.sql'` after `'plugins_config_schema.sql'` with an explanatory comment.

## Impact Analysis

### Database

- No migration file changed; only application order.
- `plugins_webapps.sql` is fully idempotent (`ADD COLUMN IF NOT EXISTS`, `DO $$` constraint guards, `CREATE INDEX IF NOT EXISTS`) — safe on databases where the run aborted at `202605240006`.

### Runtime / API Surface

None.

## Known limitation

The `tests/coreMigrations.test.mjs` dependency scanner checks **table-level** dependencies (which `public.<table>` is created where). **Column-level** dependencies (a migration filtering on `plugins.kind` added by another migration) are out of its scope — that is why this regression was not caught automatically. When adding a migration that references columns introduced by another migration, place it after that migration manually; the failure mode is now a retry prompt rather than a dead end.

## Verification

- `node --test tests/coreMigrations.test.mjs` — 7/7 pass (existence + table-dependency checks confirm the new entry is valid and ordered).
- `npm test` — 113/113 pass.
- Not verified live: the re-run of the wizard's migration step on the user's Supabase project.
