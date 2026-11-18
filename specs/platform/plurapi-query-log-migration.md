-- ============================================================================
-- PluraPi Migration 0011 — AI Gateway query logs + Pluracon model mapping
-- (apply via Supabase SQL Editor; idempotent; down: down/0011_ai_gateway_logs.sql)
--
-- Both tables live in the dedicated `plurapi` schema (like every PluraPi
-- migration):
--
--   plurapi.ai_query_logs   — written by the plurapi-sessions Worker
--                             (service key) for every LLM request proxied
--                             through the Cloudflare AI Gateway in front of
--                             OpenRouter. One row per query.
--   plurapi.pluracon_models — super-admin setting that maps the three
--                             virtual Pluracon models (pluracon/architekt |
--                             arbeiter | kreativ) to the concrete OpenRouter
--                             model executed for that category. Read/written
--                             by the engine.
--
-- REST ACCESS (PostgREST): the Worker and the engine address both tables
-- through the Supabase REST API with `Accept-Profile: plurapi` /
-- `Content-Profile: plurapi`. This requires the `plurapi` schema to be in
-- Supabase's exposed schemas (Dashboard → Settings → API → "Exposed schemas
-- in API" → add `plurapi`) — one-time operator step.
--
-- RLS is enabled on both. There are NO insert/update/delete policies:
-- only service-role credentials (SUPABASE_SECRET_KEY) bypass RLS.
-- Super-admins may SELECT for dashboards/inspection.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ai_query_logs — one row per proxied LLM query
-- ----------------------------------------------------------------------------
create table if not exists plurapi.ai_query_logs (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),

  -- Attribution (best effort; null when the engine could not supply it)
  tenant_id         text,
  user_id           text,
  session_id        text,
  pluracon_model    text,             -- 'pluracon/architekt' | … | null

  -- Model + usage
  provider          text not null default 'openrouter',
  model             text not null,    -- concrete OpenRouter model id
  prompt_tokens     integer,
  completion_tokens integer,
  cached_tokens     integer,
  total_tokens      integer,

  -- Price
  cost_usd          numeric(14, 8),
  cost_source       text,             -- 'openrouter-usage' | 'computed-pricing' | null

  -- Request metadata
  stream            boolean not null default false,
  status_code       integer,
  latency_ms        integer,
  error             text,
  gateway_id        text              -- Cloudflare AI Gateway id
);

create index if not exists ai_query_logs_created_at_idx on plurapi.ai_query_logs (created_at desc);
create index if not exists ai_query_logs_session_idx    on plurapi.ai_query_logs (session_id);
create index if not exists ai_query_logs_user_idx       on plurapi.ai_query_logs (user_id);
create index if not exists ai_query_logs_model_idx      on plurapi.ai_query_logs (model);

alter table plurapi.ai_query_logs enable row level security;

drop policy if exists ai_query_logs_select_super_admin on plurapi.ai_query_logs;
create policy ai_query_logs_select_super_admin on plurapi.ai_query_logs
  for select to authenticated
  using (public.is_super_admin());

-- ----------------------------------------------------------------------------
-- pluracon_models — super-admin setting: Pluracon model → OpenRouter model
-- ----------------------------------------------------------------------------
create table if not exists plurapi.pluracon_models (
  model            text primary key,   -- 'pluracon/architekt' | 'pluracon/arbeiter' | 'pluracon/kreativ'
  openrouter_model text not null,      -- concrete OpenRouter model id
  updated_by       uuid,
  updated_at       timestamptz not null default now()
);

do $$
begin
  if to_regproc('public.set_current_timestamp_updated_at') is not null then
    execute $fn$
      create trigger trg_pluracon_models_updated_at before update on plurapi.pluracon_models
        for each row execute function public.set_current_timestamp_updated_at();
    $fn$;
  else
    raise notice 'public.set_current_timestamp_updated_at() missing; updated_at trigger for pluracon_models skipped';
  end if;
exception
  when duplicate_object then null; -- re-run of an idempotent migration
end $$;

-- Seed: all three categories start on z-ai/glm-5.3-flash.
insert into plurapi.pluracon_models (model, openrouter_model) values
  ('pluracon/architekt', 'z-ai/glm-5.3-flash'),
  ('pluracon/arbeiter',  'z-ai/glm-5.3-flash'),
  ('pluracon/kreativ',   'z-ai/glm-5.3-flash')
on conflict (model) do nothing;

alter table plurapi.pluracon_models enable row level security;

drop policy if exists pluracon_models_select_super_admin on plurapi.pluracon_models;
create policy pluracon_models_select_super_admin on plurapi.pluracon_models
  for select to authenticated
  using (public.is_super_admin());

-- Regular authenticated users can read the mapping (the values are not
-- secret; the engine shows them in super-admin tooling). Writes happen only
-- via the engine with SUPABASE_SECRET_KEY (bypasses RLS).
drop policy if exists pluracon_models_select_authenticated on plurapi.pluracon_models;
create policy pluracon_models_select_authenticated on plurapi.pluracon_models
  for select to authenticated
  using (plurapi.has_app_access());

-- ============================================================================
-- PluraPi Migration 0013 — ai_query_logs attribution → uuid + specy FKs
-- (apply via Supabase SQL Editor; idempotent; down: down/0013_ai_query_log_identity_fks.sql)
--
-- WHY: 0011 declared plurapi.ai_query_logs.tenant_id / user_id as `text` with
-- no foreign keys. The engine/Worker only ever put a Specy tenant UUID or a
-- Supabase user `sub` (= public.user_profile.user_id) in there — plus the
-- literal sentinel 'personal' for sessions without workspace membership.
-- `text` gave no referential integrity and no joinability. This migration
-- aligns the log table with the sanctioned Specy plugin convention
-- (tenant_id → public.tenants(id); user → public.user_profile(user_id), see
-- knowledgebase-core/05_Specy/database-integration.md §3.2/§3.3).
--
-- WHAT:
--   * 'personal' and any other non-UUID value → NULL (attribution is best
--     effort; the log row itself is never dropped).
--   * tenant_id / user_id become uuid.
--   * FK tenant_id → public.tenants(id)         ON DELETE SET NULL
--   * FK user_id   → public.user_profile(user_id) ON DELETE SET NULL
--     (falls back to auth.users(id) when public.user_profile is absent)
--   * rows whose (valid UUID) value has no matching parent are NULLed before
--     the FK is added, so a deleted tenant/user never blocks the migration.
--
-- ON DELETE SET NULL is deliberate: a query log is an append-only audit
-- record; deleting a tenant/user must neither delete nor block its history.
--
-- COMPANION CHANGE: plurapi-sessions/src/ai-proxy.ts (logQueryRow) now
-- normalizes attribution to a UUID or NULL and retries once with attribution
-- stripped if PostgREST still rejects the insert — so a non-UUID path segment
-- ('personal', dev values, manual tests) or a stale tenant/user claim can no
-- longer lose a log row against the stricter column type.
--
-- Prerequisite: public.tenants (Specy core). public.user_profile is used when
-- present; auth.users is the fallback parent for user_id.
-- ============================================================================

do $$
declare
  uuid_re     constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  coltype     text;
  bad_count   int;
  user_parent text;
begin
  if to_regclass('plurapi.ai_query_logs') is null then
    raise notice 'plurapi.ai_query_logs missing; migration 0013 skipped';
    return;
  end if;

  -- ------------------------------------------------------------ tenant_id
  select data_type into coltype
  from information_schema.columns
  where table_schema = 'plurapi'
    and table_name   = 'ai_query_logs'
    and column_name  = 'tenant_id';

  if coltype = 'text' then
    select count(*) into bad_count
    from plurapi.ai_query_logs
    where tenant_id is not null
      and tenant_id <> 'personal'
      and tenant_id !~* uuid_re;

    update plurapi.ai_query_logs
       set tenant_id = null
     where tenant_id = 'personal'
        or (tenant_id is not null and tenant_id !~* uuid_re);

    if bad_count > 0 then
      raise notice 'ai_query_logs.tenant_id: % non-UUID value(s) (excluding ''personal'') set to NULL', bad_count;
    end if;

    alter table plurapi.ai_query_logs
      alter column tenant_id type uuid using tenant_id::uuid;
    raise notice 'ai_query_logs.tenant_id: text -> uuid (''personal'' sentinel now NULL)';
  end if;

  -- -------------------------------------------------------------- user_id
  select data_type into coltype
  from information_schema.columns
  where table_schema = 'plurapi'
    and table_name   = 'ai_query_logs'
    and column_name  = 'user_id';

  if coltype = 'text' then
    select count(*) into bad_count
    from plurapi.ai_query_logs
    where user_id is not null
      and user_id !~* uuid_re;

    update plurapi.ai_query_logs
       set user_id = null
     where user_id is not null and user_id !~* uuid_re;

    if bad_count > 0 then
      raise notice 'ai_query_logs.user_id: % non-UUID value(s) set to NULL', bad_count;
    end if;

    alter table plurapi.ai_query_logs
      alter column user_id type uuid using user_id::uuid;
    raise notice 'ai_query_logs.user_id: text -> uuid';
  end if;

  -- ------------------------------------------- tenant index (FK + filtering)
  create index if not exists ai_query_logs_tenant_idx
    on plurapi.ai_query_logs (tenant_id);

  -- ------------------------------------------------------------- FK: tenant
  if to_regclass('public.tenants') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'plurapi.ai_query_logs'::regclass
         and conname  = 'ai_query_logs_tenant_id_fkey'
     ) then
    update plurapi.ai_query_logs l
       set tenant_id = null
     where l.tenant_id is not null
       and not exists (select 1 from public.tenants t where t.id = l.tenant_id);

    alter table plurapi.ai_query_logs
      add constraint ai_query_logs_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(id) on delete set null;
    raise notice 'added FK ai_query_logs.tenant_id -> public.tenants(id)';
  end if;

  -- --------------------------------------------------------------- FK: user
  if to_regclass('public.user_profile') is not null then
    user_parent := 'public.user_profile';
  elsif to_regclass('auth.users') is not null then
    user_parent := 'auth.users';
  end if;

  if user_parent is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'plurapi.ai_query_logs'::regclass
         and conname  = 'ai_query_logs_user_id_fkey'
     ) then
    if user_parent = 'public.user_profile' then
      update plurapi.ai_query_logs l
         set user_id = null
       where l.user_id is not null
         and not exists (select 1 from public.user_profile p where p.user_id = l.user_id);

      alter table plurapi.ai_query_logs
        add constraint ai_query_logs_user_id_fkey
        foreign key (user_id) references public.user_profile(user_id) on delete set null;
    else
      update plurapi.ai_query_logs l
         set user_id = null
       where l.user_id is not null
         and not exists (select 1 from auth.users u where u.id = l.user_id);

      alter table plurapi.ai_query_logs
        add constraint ai_query_logs_user_id_fkey
        foreign key (user_id) references auth.users(id) on delete set null;
    end if;
    raise notice 'added FK ai_query_logs.user_id -> %', user_parent;
  end if;
end $$;

insert into plurapi.schema_migrations (version) values ('0013_ai_query_log_identity_fks')
  on conflict (version) do nothing;
