# PluraDash `workspace_repos` Tenant-Admin Write RLS Fix

**Date:** 2026-08-28
**Scope:** Plugin change (`plugins/pluradash/`) — EUPL-isolated.

## Summary

Assigning a GitHub repository to a workspace owned/administered by the acting
user failed with:

```
Zuweisung fehlgeschlagen: new row violates row-level security policy
for table "workspace_repos"
```

Root cause: migration `020_create_workspace_repos.sql` only granted
`INSERT`/`UPDATE`/`DELETE` on `pluradash.workspace_repos` to **super-admins**
(`super_admins_all_workspace_repos`, `WITH CHECK public.is_super_admin()`). The
tenant-facing policy `tenant_members_select_workspace_repos` was `SELECT`-only.
Consequently the admin/owner of a workspace (e.g. the 'jay' workspace) could not
write a `workspace_repos` row for their own workspace — the `WITH CHECK` rejected
the new row.

## Files Added

- `plugins/pluradash/migrations/021_workspace_repos_tenant_admin_write_rls.sql`
  — adds the `tenant_admins_manage_workspace_repos` policy granting tenant admins
  full management access (`FOR ALL`) over `workspace_repos` rows that belong to
  their **own** workspace only (`is_tenant_admin(workspace_id, current_user_id())`).
  Super-admin access is unchanged (still OR-combined via the existing
  `super_admins_all_workspace_repos` policy).
- `plugins/pluradash/migrations/down/021_workspace_repos_tenant_admin_write_rls.sql`
  — matching downmigration (drops the new policy; leaves migration-020 policy in
  place).
- `specs/changes/2026-08-28-pluradash-workspace-repos-tenant-admin-rls-fix.md`
  (this file).

## Files Changed

- `plugins/pluradash/plugin.json` — registered
  `migrations/021_workspace_repos_tenant_admin_write_rls.sql` in the `migrations`
  array (after `020_create_workspace_repos.sql`).
- `specs/features/pluradash-github-app-integration.md` — documented the new
  `tenant_admins_manage_workspace_repos` policy and the write-authorization model.

## Impact Analysis

### Database

- New RLS policy `tenant_admins_manage_workspace_repos` on
  `pluradash.workspace_repos` (`FOR ALL TO authenticated`), `USING` and
  `WITH CHECK` both `is_super_admin() OR is_tenant_admin(workspace_id,
  current_user_id())`.
- No schema changes, no new columns, no new tables. Migration is idempotent
  (`DROP POLICY IF EXISTS` + `CREATE`).
- Downmigration cleanly removes the policy, restoring the previous
  super-admin-only write behavior.

### Runtime / API Surface

- No API endpoint signatures changed. The `/admin/github/assign` endpoint still
  requires the `super-admin` JWT role at the Hono layer (`requireAnyJwtRole`).
- The fix unblocks the workspace-assignment write path for workspace owners
  whose JWT carries the super-admin role, and establishes the RLS foundation for
  the upcoming R2 sync engine where workspace admins provision their own repos
  (tenant-admin write path).

### Security

- Writes remain tightly scoped: a tenant admin can only affect rows where
  `workspace_id` resolves to a workspace they administer
  (`is_tenant_admin` is `security definer` and checks `tenant_users.status =
  'active' AND is_tenant_admin`). Cross-workspace writes are impossible.
- Super-admin full access is preserved.
