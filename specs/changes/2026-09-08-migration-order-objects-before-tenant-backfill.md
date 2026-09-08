# 2026-09-08 — Migration Order Fix: objects.sql Before Multi-Tenant Backfill

## Summary

Fresh setup runs failed during the migration step:

```
202605240002_multi_tenant_backfill_and_ownership.sql — failed:
HTTP 400: Failed to run sql query: ERROR: 42P01: relation "public.objects" does not exist
```

Root cause: `scripts/setup.mjs` listed `objects.sql` (which creates `public.objects`) **after** the multi-tenant migrations that alter that table (`202605240002`–`202605240005`), violating the dependency chain. `objects.sql` only depends on `set_current_timestamp_updated_at()` from `preamble.sql` and can run at any point after it — so it was moved to directly after `202605240001_multi_tenant_foundation.sql`, ahead of every migration referencing `public.objects`.

## Files Changed

- `scripts/setup.mjs` — `MIGRATION_ORDER`: `objects.sql` moved from its previous position (after `202609030001_tenant_storage_shared_apps_scope.sql`) to between `202605240001_multi_tenant_foundation.sql` and `202605240002_multi_tenant_backfill_and_ownership.sql`, with an explanatory comment.

## Impact Analysis

### Database

- No migration files changed; only their application order.
- All migrations remain idempotent — re-running the migration step after this fix is safe on databases where the run aborted at `202605240002` (migrations before it re-apply as no-ops).
- New dependency rule now enforced: `objects.sql` must precede `202605240002`, `202605240003`, `202605240004`, `202605240005`, `202605310001`, `202605310002` (the only migrations referencing `public.objects`).

### Runtime / API Surface

None.

## Verification

- Verified via grep that every migration referencing `public.objects` now sorts after `objects.sql` in `MIGRATION_ORDER`.
- `node --check scripts/setup.mjs` — clean.
- Not verified live against a Supabase project (would require re-running the wizard's migration step by the user); idempotency of the re-run relies on the existing `IF NOT EXISTS` / `drop policy if exists` patterns, consistent with all prior migrations.
