# Page Schema Visibility Fix

Date: 2026-06-20

## Summary

Restores visibility of system-owned `page_schemas` rows to all authenticated users after the console visibility hardening in `migrations/202605240005_console_visibility_hardening.sql` made the seeded default schemas (`service-product`, `blog`, etc.) only visible to `super-admin`.

Without this fix, the Pages console resolves zero schemas for regular authenticated users and falls back to the tutorial introduction — masking the regression as a "no frontends connected yet" message even though the underlying data is fine.

The change is also accompanied by a small defensive adjustment in `src/pages/Pages.tsx` so that a future tenant-name resolution failure cannot take the whole schema list down with it.

## Root Cause

Two independent changes interacted:

1. **Auth-gated route rendering** in `src/App.tsx` (documented in `specs/Architecture.md`) now blocks route mounting on `loading` from `useAuth()`.
2. **Console visibility hardening** in `202605240005_console_visibility_hardening.sql` restricted `authenticated_select_page_schemas` so that rows with `owner_user_id IS NULL` were only visible when `public.is_super_admin()` returned true.

The Pages console runs `getSchemas()` from `src/services/pageService.ts` after auth hydration. For a non-super-admin user, that query now returns `[]`, so the empty-state branch in `src/pages/Pages.tsx` renders the onboarding tutorial.

## Files Added

- `migrations/202606200001_page_schema_visibility_fix.sql`

## Files Changed

- `scripts/setup.mjs` (registers the new migration in `MIGRATION_ORDER` directly after `202605240006_webapps_multi_tenant.sql`)
- `src/pages/Pages.tsx` (wraps `getVisibleTenantNameMap` in a `try/catch` so a tenant-name lookup failure cannot blank the entire schema list)
- `specs/multi-tenancy.md` (documents the new migration, its purpose, and links to the residual risk entry that tracks the regression)
- `specs/Architecture.md` (already had the `loading`-from-`useAuth()` note; no further change)

## Database Impact

### `page_schemas`

The `authenticated_select_page_schemas` policy is replaced with:

```sql
using (
  owner_user_id is null
  or public.can_access_owned_row(tenant_id, owner_user_id)
);
```

`owner_user_id IS NULL` rows are now visible to every authenticated user. Tenant-owned rows continue to flow through `can_access_owned_row`, which already grants access to the row owner, tenant admins of the matching tenant, `is_super_admin()`, and `is_content_admin()`.

Mutating policies in `202605240004_tenant_assignment_rls_fix.sql` are intentionally untouched — inserting or updating a row with `owner_user_id IS NULL` still requires `super-admin`. This is a SELECT-only relaxation.

### `page_schema_specs`

The `authenticated_select_page_schema_specs` policy is updated symmetrically so the spec endpoint chain remains reachable for non-super-admin viewers when the linked `page_schemas` row is system-owned. The `llm_specs` side of the join still uses `can_access_owned_row` unchanged.

## Frontend Impact

### `src/pages/Pages.tsx`

`getVisibleTenantNameMap` is now wrapped in `try/catch`. Tenant name resolution is best-effort: a failure logs a warning and continues with an empty tenant-name map instead of preventing the schema list from rendering. This is a defense-in-depth change so that future auth or RLS surprises in the tenant service cannot take down the whole console.

## Manifest Changes

`scripts/setup.mjs` now applies `202606200001_page_schema_visibility_fix.sql` directly after `202605240006_webapps_multi_tenant.sql`. Update environments should pick this up automatically through `scripts/lib/core-update.mjs` once the new file is added there as well (see "Recommended Update Procedure" below).

`specs/multi-tenancy.md` is updated to:

- list the new migration in "Migration Files Introduced"
- list the new migration under "Quick Reference → New Core Migration Files"
- list the new migration in the "Production Deployment Guidance" pre-deployment checklist
- add a dedicated "Migration 7: Page Schema Visibility Fix" section explaining the problem, the fix, and why the fix is delivered as a new migration instead of editing Migration 5 in place
- add a new "Known Residual Risks" entry (`#6`) that documents the regression and how it was resolved
- add a new future follow-up item (`#8`) to audit the other console surfaces for the same class of regression

## Security Considerations

- This change re-opens the SELECT path for system-owned schemas only. It does not relax any mutating policy.
- `page_schema_specs` is updated symmetrically for the same reason; no other spec table is affected.
- Anonymous (`anon`) access to system-owned `page_schemas` is governed by `anon_select_page_schemas` in `202605240003_multi_tenant_rls_hardening.sql` and remains unchanged.
- The fix is conservative: it restores the pre-Migration-5 SELECT behavior for system-owned rows, which is the documented model elsewhere in this codebase (e.g. `Architecture.md` describes default schemas as global resources).

## Recommended Update Procedure

1. Pull the updated code.
2. Add `202606200001_page_schema_visibility_fix.sql` to the `MIGRATION_ORDER` array in `scripts/lib/core-update.mjs` (in addition to `scripts/setup.mjs`).
3. Re-run `npm run setup` (fresh setup) or apply the migration through the updater (existing deployments).
4. Confirm `page_schemas` rows with `owner_user_id IS NULL` are now returned by `getSchemas()` for non-super-admin users by signing in as a regular user and visiting `/pages`.

## Related Documents

- [`specs/multi-tenancy.md`](../multi-tenancy.md) — overall tenancy model, including the new Migration 7 section
- [`specs/Architecture.md`](../Architecture.md) — frontend architecture note for the auth-gated route rendering change that exposed the regression
- `migrations/202605240005_console_visibility_hardening.sql` — the migration that introduced the regression
- `migrations/202605240004_tenant_assignment_rls_fix.sql` — provides the mutating policies that this fix intentionally leaves in place
