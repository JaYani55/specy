-- 202610160001_mail_queue_cron_tuning.sql
--
-- Reduces the Postgres log noise of the mail-queue cron trigger.
--
-- Problem: the `mail-queue-processor` pg_cron job runs every minute and pg_cron
-- emits a "cron job N starting" + "cron job N completed" pair for every tick —
-- 2,880 log lines per day, regardless of whether the queue has work. The
-- work-presence gate from 202609110001_mail_queue_cron_gate.sql already avoids
-- idle edge-function invocations, but the log lines themselves remain.
--
-- Changes:
--   1. Reschedules the job from every minute to every 5 minutes. Queued mail
--      now waits up to 5 minutes instead of 1 minute for its delivery attempt;
--      in exchange, idle-tick log noise drops to ~576 lines/day and each tick
--      costs a quarter of the previous scheduler overhead.
--   2. Replaces the two per-tick system_config lookups (edge_function_url,
--      edge_function_key) with a single conditional-aggregate query over the
--      same rows.
--
-- The work-presence gate (skip net.http_post when there are no due pending and
-- no stale processing jobs) is preserved verbatim from
-- 202609110001_mail_queue_cron_gate.sql.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + cron.unschedule/schedule (guarded).

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
  -- Single query for both deployment-specific settings (previously two
  -- separate SELECT ... INTO statements per tick).
  select
    max(case when key = 'edge_function_url' then value end),
    max(case when key = 'edge_function_key' then value end)
  into v_url, v_key
  from public.system_config
  where namespace = 'mail'
    and key in ('edge_function_url', 'edge_function_key');

  if v_url is null or btrim(v_url) = '' then
    raise notice 'Mail queue: system_config mail.edge_function_url is not set — skipping queue processing.';
    return;
  end if;

  -- Work-presence gate: skip the edge-function invocation entirely when the
  -- queue has neither due pending jobs nor stale processing jobs to reclaim.
  -- Mirrors the eligibility queries in functions/send_email/index.ts
  -- (processPendingJobs + reclaimStaleProcessingJobs, PROCESSING_STALE_MS = 5 min).
  if not exists (
    select 1
    from public.mail_delivery_jobs
    where status = 'pending'
      and (next_attempt_at is null or next_attempt_at <= now())
  ) and not exists (
    select 1
    from public.mail_delivery_jobs
    where status = 'processing'
      and last_attempt_at is not null
      and last_attempt_at < now() - interval '5 minutes'
  ) then
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
  -- Only reschedule when pg_cron is actually present (self-hosted installs
  -- without pg_cron keep working without the cron).
  if to_regclass('cron.job') is not null then
    begin
      perform cron.unschedule('mail-queue-processor');
    exception when others then
      null; -- job not registered yet — nothing to unschedule
    end;

    perform cron.schedule(
      'mail-queue-processor',
      '5 minutes',
      $cron$ select public.trigger_mail_queue_processing(); $cron$
    );
  else
    raise notice 'cron.job not available — mail queue cron schedule unchanged.';
  end if;
end $$;
