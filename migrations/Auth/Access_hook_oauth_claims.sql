-- ─── OAuth 2.1 agent claims for the custom access token hook ───────────────
-- Extends the JWT claim contract for OAuth 2.1 / MCP agent authentication:
--   user_roles  (unchanged)  — role names from public.user_roles
--   is_agent    (new)        — true when the user holds the 'agent' role
--   tenant_id   (new)        — the user's default tenant (workspace binding)
--
-- The hook runs at token mint time for ALL Supabase-issued tokens, including
-- tokens issued through the Supabase OAuth 2.1 authorization server. OAuth
-- access tokens therefore carry the same claims as password-grant sessions.
--
-- This migration is idempotent and safe to re-run. It replaces the hook via
-- CREATE OR REPLACE (the original lives in Auth/Access_hook.sql and must not
-- be edited in place) and seeds the 'agent' role.

-- ─── Agent role ─────────────────────────────────────────────────────────────
-- The 'agent' role marks dedicated agent/machine accounts. It is NOT part of
-- the hierarchical AppRole ladder (user < admin < super-admin); it is an
-- exact-match JWT role like plugin-introduced roles (e.g. 'support').

insert into public.roles (name, description)
values ('agent', 'Machine/agent account for OAuth 2.1 MCP access')
on conflict (name) do update
set description = excluded.description;

-- ─── Hook replacement ───────────────────────────────────────────────────────

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
BEGIN
  -- Extract user_id; if missing, log a warning and return event unchanged
  IF NOT (event ? 'user_id') THEN
    RAISE WARNING 'custom_access_token_hook: No user_id found in event';
    RETURN event;
  END IF;

  -- Convert user_id to uuid (adjust if your user_id is text)
  uid := (event ->> 'user_id')::uuid;

  -- Select roles into an array
  SELECT array_agg(r.name) INTO role_names
  FROM public.user_roles ur
  JOIN public.roles r ON ur.role_id = r.id
  WHERE ur.user_id = uid;

  IF role_names IS NULL THEN
    role_names := ARRAY[]::text[];
  END IF;

  -- Agent marker: user holds the 'agent' role
  agent_flag := 'agent' = ANY(role_names);

  -- Workspace binding: user's default tenant (NULL when the multi-tenant
  -- tables do not exist yet, e.g. fresh installs before 202605240001/002)
  BEGIN
    default_tenant := public.default_tenant_for_user(uid);
  EXCEPTION
    WHEN undefined_function THEN
      default_tenant := NULL;
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

  RETURN event;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'custom_access_token_hook error: %', SQLERRM;
END;
$$;

-- ─── Auth hook permissions ───────────────────────────────────────────────────
-- Re-applied after CREATE OR REPLACE to match Auth/Access_hook.sql.

-- Allow supabase_auth_admin to call this function
grant execute on function public.custom_access_token_hook to supabase_auth_admin;

-- Allow supabase_auth_admin to see the public schema
grant usage on schema public to supabase_auth_admin;

-- Prevent regular roles from calling the hook directly
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
