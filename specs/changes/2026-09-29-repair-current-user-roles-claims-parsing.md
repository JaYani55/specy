# 2026-09-29 — Repair `current_user_roles()` JWT-Claims Parsing (RLS Super-Admin Drift)

## Summary

The production Supabase project carried **drifted live definitions** of the
JWT-claims helper functions `public.current_user_roles()` (and
`public.is_super_admin()`): instead of parsing the `user_roles` claim as a
**JSON array** (as minted by the core auth hook,
`migrations/Auth/Access_hook*.sql`, unchanged since its introduction), the
drifted bodies parsed it as a **comma-separated string**
(`string_to_array(auth.jwt() ->> 'user_roles', ',')`).

Consequences of the drift:

- `is_super_admin()` evaluated **false for every user on every request** —
  the drift produced a one-element text array containing the literal string
  `["super-admin"]`, which never equals `'super-admin'`.
- Every claims-based RLS policy relying on the super-admin/admin branch
  silently failed. Affected users retained access only through
  tenant-membership fallback branches, which masked the breakage completely.
- The first rows **without** tenant linkage — `pluradash.sync_logs` entries
  written by system actors (`actor_type: 'agent'`, `tenant_id: null`, written
  since 2026-09-13 by the check_run webhook feedback loop) — became fully
  invisible in the dashboard, which surfaced the bug.

The drifted bodies exist **nowhere in the repository or its git history**
(`git log --all -S "string_to_array(auth.jwt()"` is empty). They are
out-of-band database state predating the repo restructure.

The drift was invisible to `public.deployment_state`:
`202605240001_multi_tenant_foundation.sql` is recorded `applied` with a
checksum that matches the current repo file exactly (verified:
`sha256(normalizeSqlEol(file)) = 81c0c917…`, recomputed locally). The state
table is **content-anchored to repo files, not to live database objects**, so
function-body drift cannot be detected by `state:recheck`. Because the
migration is recorded applied, the runner never re-executed the corrected
definitions.

**Fix:** a new, idempotent repair migration re-applies the canonical function
bodies through the normal, state-tracked migration path (manual SQL-editor
application or editing the foundation migration were rejected: the former
leaves no state record, the latter would break the recorded checksum and
re-trigger sync-state drift).

## Root Cause Analysis (evidence chain)

1. `check_run`/`webhook.sync` rows exist in `pluradash.sync_logs`
   (`tenant_id: null`) but `GET /admin/github/logs` returned only
   tenant-scoped rows — newest returned row 2026-09-24, missing rows from
   2026-09-29.
2. Endpoint authorization (`requireAnyJwtRole(['super-admin'])`,
   `api/lib/auth.ts`) passed with the same JWT → token contains
   `user_roles: ["super-admin"]` (verified by decoding the actual access
   token; ES256, `role: authenticated`).
3. Simulating the token claims via
   `set_config('request.jwt.claims', …)` **as `authenticated`** returned
   `count = 0` for `pluradash.sync_logs where tenant_id is null` → RLS rejects
   the super-admin branch at the database level.
4. `select prosrc from pg_proc …` showed the drifted CSV-string parser live in
   the database (see above).
5. Plugin claims system (specs/auth/plugin-claims.md, migrations
   `202609090001`/`202609100002`, `Access_hook_plugin_claims.sql`) was
   explicitly checked and **exonerated**: it never touches the affected
   functions, tables, or the core claim shape.

## Files Added

- `migrations/202609290001_repair_current_user_roles_json_claims.sql` —
  re-asserts canonical `current_user_roles()`, `is_super_admin()`,
  `is_content_admin()` (CREATE OR REPLACE only; idempotent; unconditional so
  correct environments are no-ops).

## Files Changed

- `scripts/lib/migration-order.mjs` — registered the repair migration at the
  end of `MIGRATION_ORDER_CORE` (after everything it replaces/relates to).
- `specs/README.md`-registered change record (this file).

## Impact Analysis

### Database

- On the **drifted production project**: repairs `current_user_roles()` /
  `is_super_admin()` / `is_content_admin()` to the canonical bodies. After
  application, the super-admin RLS branch evaluates correctly again;
  NULL-tenant `pluradash.sync_logs` rows become visible to super-admins
  (verification: the `authenticated`-role simulation flips from `count = 0`
  to the full row count).
- On **correct environments**: all three statements are no-ops (identical
  bodies re-applied).
- No data, policy, grant, or schema-object changes beyond the three function
  bodies. Fresh installs are unaffected (the foundation migration already
  installs the canonical bodies; the repair re-applies them identically).

### Runtime

- `is_super_admin()` becomes *stricter and correct*: it now recognizes
  super-admins (it previously recognized nobody). RLS policies across the
  schema that use the super-admin branch will start granting super-admins the
  intended access — this is the designed behavior of
  `202605240001`/`202609090002`, not a privilege escalation.
- No API code changes; no worker redeploy required for the fix itself.

### API Surface

- Unchanged. `GET /api/plugin/pluradash/admin/github/logs` and all other
  endpoints behave identically; only their previously-hidden rows become
  visible through existing RLS policies.

## Follow-ups (not part of this change)

1. **Tooling hardening (proposed, separate change):** extend
   `npm run state:recheck` to detect live function-body drift (compare
   `pg_proc.prosrc` of functions defined in applied migrations against the
   repo definitions). The checksum-based state is blind to this drift class.
2. **Plugin fixes (separate repos, documented there):** Cloudflare Pages
   check-run HTML-table output parsing (`preview_url` extraction) and
   terminal-state mapping for `action: created` + `status: completed` check
   runs in `plugins/pluradash/api/sync/webhookLogic.ts`.
3. **Rollout note:** apply migrations to production via the normal runner
   (`setup.mjs` / `npm run` migration path). No manual SQL-editor execution —
   that was the failure mode this change repairs.
