-- 202609110001_mail_queue_cron_gate.sql
--
-- Work-presence gate for the mail queue cron trigger.
--
-- The `mail-queue-processor` pg_cron job fires `send_email` every minute
-- (60 × 24 = 1,440 invocations/day), even when the queue is completely idle.
-- Each idle invocation is an edge-function boot that finds zero pending jobs
-- and returns `reclaimedOnly: true`.
--
-- This migration replaces `public.trigger_mail_queue_processing()` (created by
-- 202609070001_mail_queue_retry.sql) with a gated version: the HTTP POST to
-- send_email only happens when there is actually work:
--   1. due pending jobs (status = 'pending' and next_attempt_at due), or
--   2. stale processing jobs (status = 'processing' whose last_attempt_at is
--      older than the 5-minute reclaim window — mirrors
--      PROCESSING_STALE_MS in functions/send_email/index.ts).
-- Idle ticks then cost a cheap indexed SELECT instead of an edge-function
-- invocation, while real deliveries keep their 1-minute latency.
--
-- Idempotent: CREATE OR REPLACE FUNCTION only; the cron schedule itself is
-- unchanged and still owned by 202609070001_mail_queue_retry.sql.

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