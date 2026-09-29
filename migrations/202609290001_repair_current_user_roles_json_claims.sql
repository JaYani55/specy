-- ─────────────────────────────────────────────────────────────────────────────
-- 202609290001_repair_current_user_roles_json_claims.sql
--
-- Repair migration: re-asserts the canonical claims-reading helper functions
-- from 202605240001_multi_tenant_foundation.sql (lines ~43–85, unchanged
-- since creation).
--
-- Background: the production project (ttstqznkykeyohmmzfwx) carries drifted
-- versions of public.current_user_roles() (and is_super_admin()) that parse
-- the JWT `user_roles` claim as a comma-separated STRING:
--
--     string_to_array(auth.jwt() ->> 'user_roles', ',')
--
-- The core auth hook (migrations/Auth/Access_hook*.sql) has always minted the
-- claim as a JSON ARRAY, so the live drift made is_super_admin() evaluate to
-- false for every user on every request. Every claims-based RLS policy that
-- relies on the super-admin/admin branch silently failed; rows without
-- tenant linkage (e.g. pluradash.sync_logs entries written by system actors,
-- actor_type 'agent') became invisible for super-admins.
--
-- Because 202605240001 is recorded as applied with a matching file checksum
-- in public.deployment_state (bulk backfill, commit 130cb2d, deployed_at
-- null), the migration runner never re-executed the corrected definitions —
-- the drift is invisible to checksum-based state verification, which anchors
-- to repo files, not live database objects.
--
-- This migration re-applies the canonical definitions through the normal,
-- state-tracked migration path. It is intentionally unconditional: on
-- already-correct environments the statements are no-ops (CREATE OR REPLACE
-- of identical bodies); on drifted environments it repairs them.
--
-- Idempotent: CREATE OR REPLACE only — no data, no policy, no grant changes.
-- Note: the canonical is_super_admin/is_content_admin bodies also restore the
-- COALESCE(..., false) guards present in the foundation migration (the
-- drifted live bodies lack them; NULL-propagation hardening).
-- ─────────────────────────────────────────────────────────────────────────────

-- Canonical body: parse the `user_roles` JWT claim as a JSON array.
create or replace function public.current_user_roles()
returns text[]
language sql
stable
as $$
  select coalesce(
    array(
      select jsonb_array_elements_text(
        coalesce((current_setting('request.jwt.claims', true))::jsonb -> 'user_roles', '[]'::jsonb)
      )
    ),
    '{}'::text[]
  )
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select coalesce('super-admin' = any(public.current_user_roles()), false)
$$;

create or replace function public.is_content_admin()
returns boolean
language sql
stable
as $$
  select coalesce(public.current_user_roles() && array['admin', 'super-admin'], false)
$$;
