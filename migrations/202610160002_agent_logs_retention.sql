-- 202610160002_agent_logs_retention.sql
--
-- Automated retention for public.agent_logs.
--
-- Problem: agent_logs had no automated cleanup — only the manual super-admin
-- DELETE /api/schemas/logs endpoint. Combined with the per-request logging
-- volume the table grew unboundedly, which inflates storage and makes every
-- retention-relevant index maintenance more expensive over time.
--
-- Changes:
--   1. public.cleanup_old_agent_logs(p_retention_days, p_batch_size) — deletes
--      rows older than the retention window in bounded batches so a single
--      call never holds long transactions or huge dead-tuple spikes.
--   2. Daily pg_cron job `agent-logs-retention` calling the cleanup with the
--      default 14-day window. Runs once per day, so its own Postgres log
--      footprint is two lines per day.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + cron.unschedule/schedule (guarded).

create or replace function public.cleanup_old_agent_logs(
  p_retention_days integer default 14,
  p_batch_size integer default 1000
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_cutoff timestamptz;
  v_deleted_batch integer := 0;
  v_deleted_total bigint := 0;
begin
  if p_retention_days is null or p_retention_days < 1 then
    raise exception 'retention_days must be a positive integer';
  end if;
  if p_batch_size is null or p_batch_size < 1 then
    raise exception 'batch_size must be a positive integer';
  end if;

  v_cutoff := now() - make_interval(days => p_retention_days);

  loop
    delete from public.agent_logs a
    using (
      select id
      from public.agent_logs
      where created_at < v_cutoff
      order by created_at
      limit p_batch_size
    ) oldest
    where a.id = oldest.id;

    get diagnostics v_deleted_batch = row_count;
    v_deleted_total := v_deleted_total + v_deleted_batch;

    exit when v_deleted_batch < p_batch_size;
  end loop;

  return v_deleted_total;
end $$;

do $$
begin
  -- Only schedule when pg_cron is actually present (self-hosted installs
  -- without pg_cron keep working; retention can be invoked manually).
  if to_regclass('cron.job') is not null then
    begin
      perform cron.unschedule('agent-logs-retention');
    exception when others then
      null; -- job not registered yet — nothing to unschedule
    end;

    perform cron.schedule(
      'agent-logs-retention',
      '30 2 * * *',
      $cron$ select public.cleanup_old_agent_logs(); $cron$
    );
  else
    raise notice 'cron.job not available — agent_logs retention cron not scheduled. Run public.cleanup_old_agent_logs() manually.';
  end if;
end $$;
