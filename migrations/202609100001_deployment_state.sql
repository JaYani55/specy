-- ─────────────────────────────────────────────────────────────────────────────
-- 202609100001_deployment_state.sql
--
-- Deployment State Registry — one typed, queryable store for "what is deployed,
-- by whom (core or plugin), at which version/commit, and is it still valid?"
-- Design: specs/plans/DEPLOYMENT-STATE-TRACKING.md (implemented).
--
-- Replaces the `core_update` namespace of public.system_config (an EAV
-- key/value store) for *state*: deployment/installation facts now live here with
-- an ownership discriminator (owner_kind) and a real FK from plugin state →
-- public.plugins(id). public.system_config stays for genuine configuration.
--
-- Row-level security mirrors the plugin_claims pattern (202609090001):
--   - Reads:  admin/super-admin dashboard tooling.
--   - Writes: platform-only — Management API SQL / migrations (table owner) /
--             service role bypass RLS; no user-facing write policies are issued.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP/CREATE POLICY/INDEX/TRIGGER,
-- ON CONFLICT DO NOTHING backfill — safe to run repeatedly.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.deployment_state (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind  text NOT NULL CHECK (owner_kind IN ('core', 'plugin')),
  plugin_id   uuid NULL REFERENCES public.plugins(id) ON DELETE CASCADE,
  component   text NOT NULL,          -- 'worker' | 'migrations' | 'edge_functions'
                                      -- | 'auth_hook' | 'bindings' | 'claims' | 'code' | 'config'
  key         text NOT NULL,          -- e.g. 'objects.sql', 'worker', 'sms-notifications'
  value       jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- Ownership must be self-consistent: core rows have no plugin id, plugin rows do.
  CONSTRAINT deployment_state_owner_check CHECK (
    (owner_kind = 'core'   AND plugin_id IS NULL) OR
    (owner_kind = 'plugin' AND plugin_id IS NOT NULL)
  )
);

-- Auto-update updated_at on every write (same helper as plugins/system_config).
DROP TRIGGER IF EXISTS trg_deployment_state_updated_at ON public.deployment_state;
CREATE TRIGGER trg_deployment_state_updated_at
  BEFORE UPDATE ON public.deployment_state
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- core rows: unique per (component, key)
DROP INDEX IF EXISTS deployment_state_core_uniq;
CREATE UNIQUE INDEX deployment_state_core_uniq
  ON public.deployment_state (component, key) WHERE plugin_id IS NULL;

-- plugin rows: unique per plugin per (component, key)
DROP INDEX IF EXISTS deployment_state_plugin_uniq;
CREATE UNIQUE INDEX deployment_state_plugin_uniq
  ON public.deployment_state (plugin_id, component, key) WHERE plugin_id IS NOT NULL;

-- Fast lookups by owner.
DROP INDEX IF EXISTS deployment_state_owner_idx;
CREATE INDEX deployment_state_owner_idx
  ON public.deployment_state (owner_kind, plugin_id);

-- ─── Row-level security ──────────────────────────────────────────────────────
ALTER TABLE public.deployment_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins can read deployment state" ON public.deployment_state;
CREATE POLICY "admins can read deployment state"
  ON public.deployment_state
  FOR SELECT
  TO authenticated
  USING (
    (current_setting('request.jwt.claims', true))::jsonb -> 'user_roles'
      ?| array['admin', 'super-admin']
  );

-- No INSERT/UPDATE/DELETE policies: platform writes bypass RLS as table
-- owner/service role; user-facing roles are fully denied. anon has nothing;
-- authenticated keeps SELECT only (the policy above gates the rows).
REVOKE ALL ON public.deployment_state FROM anon, authenticated;
GRANT SELECT ON public.deployment_state TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill — one-time catch-up for deployments that predate this table.
-- Idempotent (ON CONFLICT DO NOTHING): safe to run repeatedly.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Core rows — map the legacy `core_update` namespace onto the typed table.
WITH parsed AS (
  SELECT sc.key AS legacy_key,
         CASE WHEN left(trim(sc.value), 1) IN ('{', '[') THEN sc.value::jsonb
              ELSE jsonb_build_object('raw', sc.value) END AS v
  FROM public.system_config sc
  WHERE sc.namespace = 'core_update'
)
INSERT INTO public.deployment_state (owner_kind, plugin_id, component, key, value)
SELECT
  'core', NULL,
  CASE
    WHEN parsed.legacy_key LIKE 'migration:%' THEN 'migrations'
    WHEN parsed.legacy_key LIKE 'function:%'  THEN 'edge_functions'
    WHEN parsed.legacy_key IN ('deployment:worker', 'deployment:core_commit') THEN 'worker'
    WHEN parsed.legacy_key = 'deployment:functions' THEN 'edge_functions'
    ELSE 'config'
  END,
  CASE
    WHEN parsed.legacy_key LIKE 'migration:%' THEN substring(parsed.legacy_key from 11)
    WHEN parsed.legacy_key LIKE 'function:%'  THEN substring(parsed.legacy_key from 10)
    ELSE parsed.legacy_key
  END,
  jsonb_build_object(
    'status', CASE WHEN parsed.legacy_key = 'deployment:worker' THEN 'deployed' ELSE 'applied' END,
    'version', parsed.v ->> 'version',
    'commit', parsed.v ->> 'commit',
    'checksum', parsed.v ->> 'checksum',
    'provider', 'supabase',
    'deployed_at', COALESCE(parsed.v ->> 'deployedAt', parsed.v ->> 'updatedAt', parsed.v ->> 'deployed_at'),
    'meta', parsed.v
  )
FROM parsed
ON CONFLICT DO NOTHING;

-- 2. Plugin `code` rows — one per installed plugin (registry truth).
INSERT INTO public.deployment_state (owner_kind, plugin_id, component, key, value)
SELECT 'plugin', p.id, 'code', 'code',
  jsonb_build_object(
    'status', 'installed',
    'version', p.version,
    'commit', NULL,
    'checksum', NULL,
    'provider', NULL,
    'deployed_at', p.installed_at,
    'meta', jsonb_build_object('slug', p.slug, 'name', p.name)
  )
FROM public.plugins p
WHERE COALESCE(p.kind, 'plugin') = 'plugin' AND p.status = 'installed'
ON CONFLICT DO NOTHING;

-- 3. Plugin `claims` rows — one per registered claim (reconstructed from the
--    claims registry; plugin migration/binding rows cannot be reconstructed
--    from today's data and are left for `npm run state:recheck --sync`).
INSERT INTO public.deployment_state (owner_kind, plugin_id, component, key, value)
SELECT 'plugin', p.id, 'claims', pc.claim_key,
  jsonb_build_object(
    'status', 'applied',
    'provider', 'supabase',
    'meta', jsonb_build_object(
      'resolver_schema', pc.resolver_schema,
      'resolver_function', pc.resolver_function,
      'value_type', pc.value_type,
      'budget_bytes', pc.budget_bytes
    )
  )
FROM public.plugin_claims pc
JOIN public.plugins p ON p.slug = pc.plugin_id
ON CONFLICT DO NOTHING;
