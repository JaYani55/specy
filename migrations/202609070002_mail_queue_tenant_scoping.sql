-- ─────────────────────────────────────────────────────────────────────────────
-- Mail queue tenant scoping
--
-- Adds an explicit tenant_id to mail_delivery_jobs so tenant isolation does
-- not depend on a join through forms. Mail jobs are form-bound: the tenant is
-- backfilled from forms.tenant_id and stamped on every insert by a BEFORE
-- INSERT trigger (covering all enqueue paths — Worker, plugins, cron).
--
-- RLS: tenants see only their own mail log (active tenant members, via
-- is_tenant_member); global admin/super-admin keep full visibility. This
-- replaces the form-join policies from 202609070001_mail_queue_retry.sql.
-- Privileged deletes (manual re-dispatch cleanup, clear-all) stay server-side:
-- the Worker API verifies tenant visibility through the caller's JWT (RLS)
-- and then deletes with the admin client — no delete policy is exposed to
-- client roles.
--
-- Idempotent: safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. tenant_id column ──────────────────────────────────────────────────────

alter table public.mail_delivery_jobs
  add column if not exists tenant_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mail_delivery_jobs_tenant_id_fkey'
  ) then
    alter table public.mail_delivery_jobs
      add constraint mail_delivery_jobs_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_mail_delivery_jobs_tenant_id
  on public.mail_delivery_jobs (tenant_id, created_at desc);

-- ── 2. Backfill from the owning form ─────────────────────────────────────────

update public.mail_delivery_jobs j
  set tenant_id = f.tenant_id
  from public.forms f
  where j.form_id = f.id
    and j.tenant_id is null
    and f.tenant_id is not null;

-- ── 3. Tenant stamping on insert (derived from the form) ─────────────────────

create or replace function public.set_mail_delivery_job_tenant()
returns trigger
language plpgsql
stable
set search_path = public
as $$
begin
  if new.tenant_id is null and new.form_id is not null then
    select f.tenant_id into new.tenant_id
    from public.forms f
    where f.id = new.form_id;
  end if;
  return new;
end $$;

drop trigger if exists set_mail_delivery_job_tenant on public.mail_delivery_jobs;
create trigger set_mail_delivery_job_tenant
  before insert on public.mail_delivery_jobs
  for each row
  execute function public.set_mail_delivery_job_tenant();

-- ── 4. Tenant-scoped read access (replaces form-join policies) ───────────────
-- Active members of the owning tenant see their workspace's mail log; global
-- admin/super-admin see everything. Rows without a tenant (no linked form)
-- remain admin-only.

drop policy if exists "tenant_or_admin_select_mail_delivery_jobs" on public.mail_delivery_jobs;
drop policy if exists "mail_delivery_jobs_tenant_select" on public.mail_delivery_jobs;

create policy "mail_delivery_jobs_tenant_select"
  on public.mail_delivery_jobs
  for select
  to authenticated
  using (
    public.is_super_admin()
    or public.is_content_admin()
    or public.is_tenant_member(tenant_id)
  );

drop policy if exists "tenant_or_admin_select_mail_delivery_events" on public.mail_delivery_events;
drop policy if exists "mail_delivery_events_tenant_select" on public.mail_delivery_events;

create policy "mail_delivery_events_tenant_select"
  on public.mail_delivery_events
  for select
  to authenticated
  using (
    public.is_super_admin()
    or public.is_content_admin()
    or (
      exists (
        select 1
        from public.mail_delivery_jobs j
        where j.id = mail_delivery_events.job_id
          and public.is_tenant_member(j.tenant_id)
      )
    )
  );
