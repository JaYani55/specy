# 2026-09-08 — Migration Step Retry Prompt + coreMigrations Order Test

## Summary

Two related improvements to the setup wizard's migration step, following the `public.objects` ordering regression (see `2026-09-08-migration-order-objects-before-tenant-backfill.md`):

1. **Retry prompt on migration failure.** A failing migration no longer offers only "continue / abort" (abort meant re-running the whole setup wizard). The wizard now asks: **Retry this migration** (default — fix the cause externally, e.g. in the Supabase SQL editor, then press Enter; the loop re-runs the migration until it succeeds), **Skip and continue**, or **Abort**. Retrying is safe because the SQL is already loaded and all migrations are idempotent.
2. **Migration order regression test.** `MIGRATION_ORDER` was extracted from `scripts/setup.mjs` into `scripts/lib/migration-order.mjs` so it can be unit-tested. The new `tests/coreMigrations.test.mjs` verifies existence, uniqueness, preamble-first, `storage.sql` placement, and — most importantly — **derived dependency ordering**: every migration referencing `public.<table>` must have that table created in the same or an earlier migration. Verified that this test reproduces the `objects.sql` ordering bug (4 violations under the old order).

The `.pi` test skill (`.pi/skills/tests/SKILL.md`) now documents the migration-order gate (gate 4) so agents/humans adding migrations know the contract.

## Files Added

- `scripts/lib/migration-order.mjs` — `MIGRATION_ORDER_CORE` (ordered list, with the `objects.sql` placement comment) and `getMigrationOrder(storageProvider)` (appends `storage.sql` only for the `supabase` provider).
- `tests/coreMigrations.test.mjs` — 7 tests:
  - storage.sql last / only for supabase provider
  - no duplicates
  - preamble.sql first
  - every ordered file exists in `migrations/` (`storage.sql` → `storage.default.sql` template)
  - generic public-table dependency check (creators derived via `CREATE TABLE` / `ALTER TABLE … RENAME TO`, e.g. `pages.sql` renaming `products` → `pages`; references derived via `ALTER TABLE`/`FROM`/`JOIN`/`INTO`/`UPDATE`/`REFERENCES`/`ON` patterns; SQL comments stripped to avoid false positives)
  - explicit `objects.sql`-before-referencing-migrations regression guard
  - core list excludes storage.sql

## Files Changed

- `scripts/setup.mjs`
  - `stepMigrations()` uses `getMigrationOrder(storageProvider)` from the new lib; the inline list and dependency comment block were removed (the contract now lives in the test).
  - Failure handling in the migration loop replaced with a retry/skip/abort `select` loop (retry re-runs `runSqlQuery` with the already-loaded SQL; skip warns about possible downstream dependency failures; abort keeps the previous behavior — applied migrations persist).
- `.pi/skills/tests/SKILL.md` — new gate 4 "Migration order — when touching migrations" and a "When to add tests" bullet pointing at `tests/coreMigrations.test.mjs`.
- `specs/platform/supabase-cloudflare-setup.md` — wizard step-diagram note about the retry/skip/abort prompt on migration failure (this change).

## Impact Analysis

### Database

None — no migration files or SQL changed; only their ordering source moved to a lib module (order itself unchanged from the previous fix).

### Runtime / API Surface

None — setup tooling only.

### Behavior change

- Migration failure prompt: "Continue with remaining migrations?" (yes/no) → three-option select with **Retry** as default. An abort now explicitly tells the user that applied migrations persist and re-running `npm run setup` continues (all migrations are idempotent).

## Verification

- `npm test` — 113/113 pass (7 new coreMigrations tests).
- The dependency test was validated against the **previous broken order** (objects.sql in its old position): it reports exactly the 4 `public.objects` violations that caused the original HTTP 400 — i.e. it reproduces the regression it guards against.
- `node --check scripts/setup.mjs` — clean.
- Not verified live: the interactive retry loop against a real failing migration (requires a failing Supabase run); the retry path reuses the identical `runSqlQuery` call as the initial attempt.
