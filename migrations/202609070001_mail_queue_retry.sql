-- ─────────────────────────────────────────────────────────────────────────────
-- Mail queue retry & rate-limit protection
--
-- Extends the existing mail_delivery_jobs table with scheduling columns so the
-- send_email edge function can requeue failed deliveries (e.g. provider 429
-- rate limits) with an exponential backoff, and adds a pg_cron schedule that
-- processes due queue entries once per minute via pg_net.
--
-- Retry contract (see specs/platform/email-delivery-queue.md):
--   - A delivery attempt never dead-ends: failures are requeued as `pending`
--     with next_attempt_at in the future, at most max_attempts (default 3).
--   - After the final failed attempt the job is parked as terminal `failed`
--     and is NEVER deleted — it stays in the delivery log for auditing and
--     manual re-dispatch from the /admin/mail page.
--
-- Idempotent: safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Scheduling columns on mail_delivery_jobs ─────────────────────────────

alter table public.mail_delivery_jobs
  add column if not exists next_attempt_at timestamp with time zone null;

alter table public.mail_delivery_jobs
  add column if not exists max_attempts integer not null default 3;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mail_delivery_jobs_max_attempts_check'
  ) then
    alter table public.mail_delivery_jobs
      add constraint mail_delivery_jobs_max_attempts_check check (max_attempts > 0);
  end if;
end $$;

-- Scheduler lookup: due pending jobs, oldest first.
create index if not exists idx_mail_delivery_jobs_due
  on public.mail_delivery_jobs (status, next_attempt_at)
  where status = 'pending';

-- Tenant-scoped scheduler/index support for event history joins.
create index if not exists idx_mail_delivery_jobs_form_id_status
  on public.mail_delivery_jobs (form_id, status);

-- Backfill: pending jobs that predate this migration become immediately due.
update public.mail_delivery_jobs
  set next_attempt_at = now()
  where status = 'pending'
    and next_attempt_at is null;

-- ── 2. Extend mail_delivery_events with a `requeued` event type ─────────────

alter table public.mail_delivery_events
  drop constraint if exists mail_delivery_events_event_type_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mail_delivery_events_event_type_check'
  ) then
    alter table public.mail_delivery_events
      add constraint mail_delivery_events_event_type_check check (
        (event_type)::text = any (
          array[
            'queued'::text,
            'testing'::text,
            'sending'::text,
            'sent'::text,
            'requeued'::text,
            'failed'::text
          ]
        )
      );
  end if;
end $$;

-- ── 3. Tenant-scoped read access (replaces admin-only policy) ────────────────
-- All tenant members who may access the owning form (via
-- can_access_owned_row) can read its delivery jobs/events; global admins and
-- super-admins keep full visibility. Affects the /admin/mail page.

drop policy if exists "admin_select_mail_delivery_jobs" on public.mail_delivery_jobs;
drop policy if exists "tenant_or_admin_select_mail_delivery_jobs" on public.mail_delivery_jobs;

create policy "tenant_or_admin_select_mail_delivery_jobs"
  on public.mail_delivery_jobs
  for select
  to authenticated
  using (
    (current_setting('request.jwt.claims', true))::jsonb -> 'user_roles' ?| array['admin', 'super-admin']
    or (
      form_id is not null
      and exists (
        select 1
        from public.forms f
        where f.id = mail_delivery_jobs.form_id
          and public.can_access_owned_row(f.tenant_id, f.owner_user_id)
      )
    )
  );

drop policy if exists "admin_select_mail_delivery_events" on public.mail_delivery_events;
drop policy if exists "tenant_or_admin_select_mail_delivery_events" on public.mail_delivery_events;

create policy "tenant_or_admin_select_mail_delivery_events"
  on public.mail_delivery_events
  for select
  to authenticated
  using (
    (current_setting('request.jwt.claims', true))::jsonb -> 'user_roles' ?| array['admin', 'super-admin']
    or (
      exists (
        select 1
        from public.mail_delivery_jobs j
        where j.id = mail_delivery_events.job_id
          and j.form_id is not null
          and exists (
            select 1
            from public.forms f
            where f.id = j.form_id
              and public.can_access_owned_row(f.tenant_id, f.owner_user_id)
          )
      )
    )
  );

-- ── 4. Cron trigger: fire the send_email queue processor every minute ───────
-- Uses pg_cron (scheduler) + pg_net (HTTP from SQL). The target URL and an
-- optional API key are read from system_config (namespace `mail`, keys
-- `edge_function_url` and `edge_function_key`) — they are deployment-specific
-- and written by scripts/setup.mjs. Without a configured URL the trigger is a
-- no-op, so installing this migration is always safe.

do $$
begin
  begin
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_cron/pg_net not available (%); mail queue cron disabled.', SQLERRM;
  end;
end $$;

create or replace function public.trigger_mail_queue_processing()
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
  select value into v_url from public.system_config where namespace = 'mail' and key = 'edge_function_url';
  select value into v_key from public.system_config where namespace = 'mail' and key = 'edge_function_key';

  if v_url is null or btrim(v_url) = '' then
    raise notice 'Mail queue: system_config mail.edge_function_url is not set — skipping queue processing.';
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
  -- Only schedule when both extensions are actually present (self-hosted
  -- installs without pg_cron/pg_net keep working without the cron).
  if to_regclass('cron.job') is not null and to_regnamespace('net') is not null then
    begin
      perform cron.unschedule('mail-queue-processor');
    exception when others then
      null; -- job not registered yet — nothing to unschedule
    end;

    perform cron.schedule(
      'mail-queue-processor',
      '* * * * *',
      $cron$ select public.trigger_mail_queue_processing(); $cron$
    );
  else
    raise notice 'cron.job/net not available — mail queue cron not scheduled. Queue entries are still retried on manual re-dispatch.';
  end if;
end $$;
