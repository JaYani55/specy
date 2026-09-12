-- ─────────────────────────────────────────────────────────────────────────────
-- 202609090001_plugin_claims_registry.sql
--
-- Core-owned registry for plugin-declared custom JWT claims (Claim Management,
-- see specs/plans/CLAIM_MANAGEMENT.md).
--
-- Design principle: core owns the mechanism, plugins own the semantics.
-- The custom_access_token_hook (Auth/Access_hook_plugin_claims.sql, written
-- once) reads this registry generically at token-mint time and executes each
-- plugin-provided resolver function. Plugins never edit the hook itself.
--
-- Writes: platform-only (installer via Management API SQL / super-admin).
-- The table owner (postgres) bypasses RLS; dashboard admins get read access
-- through the SELECT policy below. authenticated/anon can neither read nor
-- write (revokes mirror Auth/Access_hook.sql for the hook function).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP/CREATE POLICY, DROP/CREATE
-- INDEX — safe to run repeatedly.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.plugin_claims (
  claim_key         text PRIMARY KEY,          -- top-level JWT key, i.e. the plugin id
  plugin_id         text NOT NULL,
  value_type        text NOT NULL
                      CHECK (value_type IN ('bool', 'string', 'uuid', 'string[]', 'json')),
  resolver_schema   text NOT NULL,             -- plugin-owned schema, e.g. 'pluradash'
  resolver_function text NOT NULL,             -- function name inside resolver_schema
  budget_bytes      int  NOT NULL DEFAULT 512 CHECK (budget_bytes > 0),
  description       text,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Row-level security ──────────────────────────────────────────────────────
-- Reads: admin/super-admin dashboard tooling (token claims inspection).
-- Writes: platform-only — Management API SQL / migrations (table owner),
-- authenticated and anon roles have no INSERT/UPDATE/DELETE grants path:
-- RLS denies them and no grants are issued.

ALTER TABLE public.plugin_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins can read plugin claims" ON public.plugin_claims;
CREATE POLICY "admins can read plugin claims"
  ON public.plugin_claims
  FOR SELECT
  TO authenticated
  USING (
    (current_setting('request.jwt.claims', true))::jsonb -> 'user_roles'
      ?| array['admin', 'super-admin']
  );

-- No INSERT/UPDATE/DELETE policies: platform writes bypass RLS as table
-- owner/service role; user-facing roles are fully denied.

GRANT SELECT ON public.plugin_claims TO supabase_auth_admin;
REVOKE ALL ON public.plugin_claims FROM anon, authenticated;
