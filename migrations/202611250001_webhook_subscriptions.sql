-- Outbound webhook subsystem (specs/platform/webhooks.md).
--
-- Tenant-scoped webhook subscriptions: each subscription registers an
-- HTTPS URL plus the event types it wants, and carries a per-subscription
-- HMAC-SHA256 signing secret (stored AES-GCM encrypted in managed_secrets,
-- namespace 'webhooks' — never in this table, never returned after creation).
--
-- Delivery mirrors the mail queue (specs/platform/email-delivery-queue.md):
-- events insert rows into webhook_delivery_jobs; the deliver_webhooks edge
-- function processes pending jobs every minute via pg_cron + pg_net with the
-- same retry contract (60s / 120s backoff, terminal failed after 3 attempts,
-- jobs never deleted).

-- ── 1. Subscriptions ─────────────────────────────────────────────────────────
create table if not exists public.webhook_subscriptions (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name character varying(100) not null,
  url text not null,
  events text[] not null default '{}',
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint webhook_subscriptions_pkey primary key (id),
  constraint webhook_subscriptions_tenant_id_fkey foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint webhook_subscriptions_events_not_empty_check check (array_length(events, 1) is not null),
  constraint webhook_subscriptions_url_format_check check (url ~ '^https?://'),
  constraint webhook_subscriptions_name_length_check check (char_length(name) between 1 and 100)
);

create index if not exists idx_webhook_subscriptions_tenant
  on public.webhook_subscriptions (tenant_id)
  where active;

do $$ begin
  create trigger set_current_timestamp_updated_at
    before update on public.webhook_subscriptions
    for each row
    execute function public.set_current_timestamp_updated_at();
exception when duplicate_object then null; end $$;

-- ── 2. Delivery jobs ─────────────────────────────────────────────────────────
create table if not exists public.webhook_delivery_jobs (
  id uuid not null default gen_random_uuid(),
  subscription_id uuid not null references public.webhook_subscriptions (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  event text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  next_attempt_at timestamp with time zone not null default now(),
  last_response_status integer null,
  last_error text null,
  delivered_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  constraint webhook_delivery_jobs_pkey primary key (id),
  constraint webhook_delivery_jobs_subscription_id_fkey foreign key (subscription_id) references public.webhook_subscriptions (id) on delete cascade,
  constraint webhook_delivery_jobs_tenant_id_fkey foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint webhook_delivery_jobs_status_check check ((status)::text = any (array['pending'::text, 'delivered'::text, 'failed'::text])),
  constraint webhook_delivery_jobs_max_attempts_check check (max_attempts > 0)
);

create index if not exists idx_webhook_delivery_jobs_due
  on public.webhook_delivery_jobs (status, next_attempt_at)
  where status = 'pending';

-- ── 3. RLS ───────────────────────────────────────────────────────────────────
-- Canonical helper pattern (202605240001_multi_tenant_foundation.sql,
-- 202609090002_support_role_core_rls.sql): workspace members manage their
-- own workspace's webhooks; super-admin and support have cross-tenant
-- visibility (support agents administer webhooks for any workspace).
alter table public.webhook_subscriptions enable row level security;
alter table public.webhook_delivery_jobs enable row level security;

drop policy if exists webhook_subscriptions_select on public.webhook_subscriptions;
create policy webhook_subscriptions_select
  on public.webhook_subscriptions for select
  to authenticated
  using (
    public.is_super_admin()
    or public.is_support()
    or public.is_tenant_member(tenant_id)
  );

drop policy if exists webhook_subscriptions_insert on public.webhook_subscriptions;
create policy webhook_subscriptions_insert
  on public.webhook_subscriptions for insert
  to authenticated
  with check (
    public.is_super_admin()
    or public.is_support()
    or public.is_tenant_member(tenant_id)
  );

drop policy if exists webhook_subscriptions_update on public.webhook_subscriptions;
create policy webhook_subscriptions_update
  on public.webhook_subscriptions for update
  to authenticated
  using (
    public.is_super_admin()
    or public.is_support()
    or public.is_tenant_member(tenant_id)
  );

drop policy if exists webhook_subscriptions_delete on public.webhook_subscriptions;
create policy webhook_subscriptions_delete
  on public.webhook_subscriptions for delete
  to authenticated
  using (
    public.is_super_admin()
    or public.is_support()
    or public.is_tenant_member(tenant_id)
  );

-- Delivery jobs: read-only for workspace members (the edge function uses
-- the service-role key and bypasses RLS). Rows are written only by the Worker.
drop policy if exists webhook_delivery_jobs_select on public.webhook_delivery_jobs;
create policy webhook_delivery_jobs_select
  on public.webhook_delivery_jobs for select
  to authenticated
  using (
    public.is_super_admin()
    or public.is_support()
    or public.is_tenant_member(tenant_id)
  );

-- ── 4. Cron scheduler (mirror of the mail queue processor) ──────────────────
create or replace function public.trigger_webhook_queue_processing()
returns void
language plpgsql
security definer
set search_path = public, net, pg_catalog
as $$
declare
  v_url text;
  v_key text;
  v_headers jsonb;
begin
  select value into v_url from public.system_config where namespace = 'webhooks' and key = 'edge_function_url';
  select value into v_key from public.system_config where namespace = 'webhooks' and key = 'edge_function_key';

  if v_url is null or btrim(v_url) = '' then
    raise notice 'Webhook queue: system_config webhooks.edge_function_url is not set — skipping queue processing.';
    return;
  end if;

  v_headers := jsonb_build_object('Content-Type', 'application/json');
  if v_key is not null and btrim(v_key) <> '' then
    v_headers := v_headers
      || jsonb_build_object('apikey', btrim(v_key))
      || jsonb_build_object('Authorization', 'Bearer ' || btrim(v_key));
  end if;

  perform net.http_post(
    url := btrim(v_url),
    headers := v_headers,
    body := jsonb_build_object('mode', 'process-pending', 'limit', 10)
  );
end $$;

do $$
begin
  if to_regclass('cron.job') is not null and to_regnamespace('net') is not null then
    begin
      perform cron.unschedule('webhook-queue-processor');
    exception when others then
      null;
    end;

    perform cron.schedule(
      'webhook-queue-processor',
      '* * * * *',
      $cron$ select public.trigger_webhook_queue_processing(); $cron$
    );
  else
    raise notice 'cron.job/net not available — webhook queue cron not scheduled. Deliveries are retried on manual dispatch.';
  end if;
end $$;
