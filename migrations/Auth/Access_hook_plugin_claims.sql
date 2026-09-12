-- ─────────────────────────────────────────────────────────────────────────────
-- Auth/Access_hook_plugin_claims.sql
--
-- Final extension of public.custom_access_token_hook: generic plugin-claim
-- merge (Claim Management, see specs/plans/CLAIM_MANAGEMENT.md).
--
-- The hook reads public.plugin_claims (core-owned registry, see
-- 202609090001_plugin_claims_registry.sql) and executes each plugin-declared
-- resolver function inside its own plugin schema. THIS IS THE LAST
-- PER-FEATURE EXTENSION of the hook: future claims are added by inserting
-- registry rows, never by editing this function again.
--
-- Verified properties (CLAIM_MANAGEMENT.md §3 / experiments E-001, E-002):
--   - Core claims (user_roles, is_agent, tenant_id) are untouched.
--   - A failing resolver → claim omitted + RAISE WARNING; minting continues
--     (fail-closed: an omitted claim must never grant access).
--   - Over-budget resolver output → claim omitted + warning.
--   - NULL resolver output → claim omitted (claim absent from token).
--   - Plugin uninstall (downmigration deletes the registry row) removes the
--     claim from all future tokens; existing tokens keep it until expiry.
--
-- Idempotent: CREATE OR REPLACE + re-applied grants, safe to run repeatedly.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  uid uuid;
  role_names text[];
  agent_flag boolean;
  default_tenant uuid;
  v_value jsonb;
  r record;
BEGIN
  -- Extract user_id; if missing, log a warning and return event unchanged
  IF NOT (event ? 'user_id') THEN
    RAISE WARNING 'custom_access_token_hook: No user_id found in event';
    RETURN event;
  END IF;

  -- Convert user_id to uuid (adjust if your user_id is text)
  uid := (event ->> 'user_id')::uuid;

  -- Select roles into an array
  -- NOTE: the alias must NOT be "r" — the plugin-claims loop below declares
  -- `r record`, and PL/pgSQL substitutes the loop variable into this query's
  -- `r.name` / `r.id` references ("record \"r\" is not assigned yet") — which
  -- degraded/500'd every token mint. Alias renamed to role_row.
  SELECT array_agg(role_row.name) INTO role_names
  FROM public.user_roles ur
  JOIN public.roles role_row ON ur.role_id = role_row.id
  WHERE ur.user_id = uid;

  IF role_names IS NULL THEN
    role_names := ARRAY[]::text[];
  END IF;

  -- Agent marker: user holds the 'agent' role
  agent_flag := 'agent' = ANY(role_names);

  -- Workspace binding: user's default tenant (NULL when the multi-tenant
  -- tables do not exist yet, e.g. fresh installs before 202605240001/002).
  -- WHEN OTHERS: a broken tenant lookup must degrade to 'no tenant claim',
  -- never break minting (availability-first: claims are metadata, never
  -- enforcement — RLS fails closed when the claim is absent).
  BEGIN
    default_tenant := public.default_tenant_for_user(uid);
  EXCEPTION
    WHEN OTHERS THEN
      default_tenant := NULL;
      RAISE WARNING 'custom_access_token_hook: default_tenant_for_user failed: %', SQLERRM;
  END;

  -- Ensure claims exists and inject claims
  IF NOT (event ? 'claims') THEN
    event := jsonb_set(event, '{claims}', '{}'::jsonb);
  END IF;

  event := jsonb_set(event, '{claims,user_roles}', to_jsonb(role_names), true);
  event := jsonb_set(event, '{claims,is_agent}', to_jsonb(agent_flag), true);

  IF default_tenant IS NOT NULL THEN
    event := jsonb_set(event, '{claims,tenant_id}', to_jsonb(default_tenant::text), true);
  END IF;

  -- ─── Plugin-declared custom claims (generic merge, never extend per-plugin) ───
  -- Each registry row names a resolver function owned by a plugin schema.
  -- Per-resolver isolation: failures are caught and warned, the claim is
  -- omitted, and minting continues. Path-form jsonb_set avoids a NULL merge
  -- when 'claims' is absent. Fail-closed: NULL/failed/over-budget → omitted.
  BEGIN
    FOR r IN
      SELECT claim_key, resolver_schema, resolver_function, budget_bytes
      FROM public.plugin_claims
    LOOP
      BEGIN
        EXECUTE format('SELECT %I.%I($1::uuid, $2::uuid)', r.resolver_schema, r.resolver_function)
          INTO v_value
          USING uid, default_tenant;

        IF v_value IS NOT NULL THEN
          IF octet_length(v_value::text) <= r.budget_bytes THEN
            event := jsonb_set(event, ARRAY['claims', r.claim_key], v_value, true);
          ELSE
            RAISE WARNING 'custom_access_token_hook: plugin claim % omitted (% bytes > % budget)',
              r.claim_key, octet_length(v_value::text), r.budget_bytes;
          END IF;
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE WARNING 'custom_access_token_hook: plugin claim % failed: %', r.claim_key, SQLERRM;
      END;
    END LOOP;
  EXCEPTION
    WHEN OTHERS THEN
      -- Registry unreadable/missing (fresh install edge, grant drift) — degrade
      -- to core claims only instead of breaking every mint.
      RAISE WARNING 'custom_access_token_hook: plugin claims skipped: %', SQLERRM;
  END;

  RETURN event;
EXCEPTION
  WHEN OTHERS THEN
    -- Availability-first: the hook must never hard-fail a login. Anything that
    -- reaches here (broken role tables, cast failure, grant drift) is degraded
    -- to an event WITHOUT injected claims — RLS fails closed on the missing
    -- user_roles claim, the user can still authenticate, and the warning is
    -- visible in the Postgres logs. The previous RAISE EXCEPTION turned every
    -- hook defect into a 500 on every login.
    RAISE WARNING 'custom_access_token_hook degraded to pass-through: %', SQLERRM;
    RETURN COALESCE(event, '{"claims": {}}'::jsonb);
END;
$$;

-- ─── Auth hook permissions ───────────────────────────────────────────────────
-- Re-applied after CREATE OR REPLACE to match Auth/Access_hook.sql.

grant execute on function public.custom_access_token_hook to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
