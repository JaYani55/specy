-- Page domains (TLD registry): tenant ownership + arbitrary display names.
--
-- The Pages feature groups schemas by their registered frontend origin
-- (page_schemas.frontend_url — a "TLD"). Until now a TLD was purely derived:
-- it had no owner and no name of its own. This migration introduces a
-- first-class registry row per frontend origin so that super-admins (custom
-- claim user_roles) can — mirroring the PluraDash GitHub-Apps assignment
-- model —
--   1. change the ownership of a TLD to a different tenant (the move cascades
--      to every schema registered on the domain, its pages, frontend targets,
--      content templates, tenant-locked aggregates and the companies assigned
--      to the moved events), and
--   2. give the TLD an arbitrary display name that is independent of the
--      domain URL itself (the domain URL stays the default assigned name and
--      is never rewritten).
--
-- Idempotent: safe to run repeatedly.

create table if not exists public.page_domains (
  id uuid primary key default gen_random_uuid(),
  domain_url text not null unique,
  tenant_id uuid null references public.tenants(id) on update cascade on delete set null,
  display_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint page_domains_display_name_length check (char_length(display_name) <= 120)
);

drop trigger if exists on_page_domains_updated on public.page_domains;
create trigger on_page_domains_updated
  before update on public.page_domains
  for each row
  execute function set_current_timestamp_updated_at();

-- ─── Row Level Security ─────────────────────────────────────────────────────
alter table public.page_domains enable row level security;

drop policy if exists "authenticated_select_page_domains" on public.page_domains;
create policy "authenticated_select_page_domains"
  on public.page_domains
  for select
  to authenticated
  using (
    public.is_super_admin()
    or tenant_id is null
    or public.is_tenant_member(tenant_id)
  );

drop policy if exists "super_admin_insert_page_domains" on public.page_domains;
create policy "super_admin_insert_page_domains"
  on public.page_domains
  for insert
  to authenticated
  with check (public.is_super_admin());

drop policy if exists "super_admin_update_page_domains" on public.page_domains;
create policy "super_admin_update_page_domains"
  on public.page_domains
  for update
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists "super_admin_delete_page_domains" on public.page_domains;
create policy "super_admin_delete_page_domains"
  on public.page_domains
  for delete
  to authenticated
  using (public.is_super_admin());

-- ─── Tenant reassignment RPC ────────────────────────────────────────────────
-- SECURITY DEFINER (owned by the migration role) so the cascade can cross RLS
-- boundaries; the invoker must hold the super-admin role, which is re-checked
-- from the JWT inside the function. The whole move is one transaction: any
-- trigger-locked aggregate that cannot follow (e.g. an event whose company
-- stays in the old workspace) aborts the entire reassignment, and the
-- temporary trigger disable below rolls back with it.
create or replace function public.reassign_page_domain_tenant(
  p_domain_id uuid,
  p_target_tenant_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domain_url text;
  v_old_tenant_id uuid;
  v_schema_ids uuid[] := '{}'::uuid[];
  v_page_ids uuid[] := '{}'::uuid[];
  v_company_id uuid;
  v_company_name text;
begin
  if not public.is_super_admin() then
    raise exception 'Only super-admins may reassign page domains.' using errcode = '42501';
  end if;

  if p_target_tenant_id is null then
    raise exception 'A target tenant is required; page domains cannot be unassigned.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.tenants where id = p_target_tenant_id) then
    raise exception 'Target tenant not found.' using errcode = '22023';
  end if;

  select domain_url, tenant_id
    into v_domain_url, v_old_tenant_id
    from public.page_domains
    where id = p_domain_id
    for update;
  if not found then
    raise exception 'Page domain not found.' using errcode = '22023';
  end if;

  -- No-op when the domain is already owned by the target tenant.
  if v_old_tenant_id is not distinct from p_target_tenant_id then
    return;
  end if;

  select coalesce(array_agg(id) filter (where id is not null), '{}'::uuid[])
    into v_schema_ids
    from public.page_schemas
    where frontend_url = v_domain_url;

  select coalesce(array_agg(id) filter (where id is not null), '{}'::uuid[])
    into v_page_ids
    from public.pages
    where schema_id = any(v_schema_ids)
       or (schema_id is null and domain_url = v_domain_url);

  -- 0. Pre-check: companies referenced by the moved events must be free to
  --    follow. A company that is ALSO referenced by events which are not
  --    part of this domain move (e.g. events on another domain that stays in
  --    the old workspace, or events without a public page) would be left
  --    inconsistent — block the whole move with an actionable message.
  for v_company_id, v_company_name in
    select distinct c.id, c.name
    from public.companies c
    join public.mentorbooking_events e on e.company_id = c.id
    where e.page_id is not null
      and e.page_id = any(v_page_ids)
      and c.tenant_id is distinct from p_target_tenant_id
  loop
    if exists (
      select 1 from public.mentorbooking_events other
      where other.company_id = v_company_id
        and (other.page_id is null or other.page_id <> all(v_page_ids))
    ) then
      raise exception
        'Company "%" is also referenced by events outside this domain; move those events (or their domain) to the target workspace first.',
        v_company_name
        using errcode = '22023';
    end if;
  end loop;

  -- 1. Schemas and their derived rows follow the domain.
  update public.page_schemas
    set tenant_id = p_target_tenant_id
    where id = any(v_schema_ids);

  update public.schema_frontend_targets
    set tenant_id = p_target_tenant_id
    where schema_id = any(v_schema_ids);

  update public.page_content_templates
    set tenant_id = p_target_tenant_id
    where schema_id = any(v_schema_ids);

  -- 2. Pages (schema-bound + legacy domain-bound). The AFTER constraint
  --    trigger enforce_event_page_link on pages requires the event aggregate
  --    row to exist under the NEW tenant before it fires, while the event
  --    BEFORE trigger requires the page to already carry the NEW tenant — a
  --    strict ordering paradox. The constraint trigger is therefore disabled
  --    for the duration of this atomic move; ALTER TABLE is transactional, so
  --    a rollback re-enables it automatically.
  -- The catalogue guard triggers reject direct writes to event pages (and
  -- controlled product-page operations) unless the aggregate-service escape
  -- hatch is on. The domain reassignment IS an authorized aggregate-level
  -- operation (super-admin gated), so enable both for this transaction — the
  -- same pattern the event/product aggregate RPCs use.
  perform set_config('specy.event_page_write', 'on', true);
  perform set_config('specy.product_schema_reassignment', 'on', true);

  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.pages'::regclass
      and tgname = 'enforce_event_page_link'
      and tgenabled <> 'D'  -- 'D' = disabled
  ) then
    execute 'alter table public.pages disable trigger enforce_event_page_link';
  end if;

  update public.pages
    set tenant_id = p_target_tenant_id
    where id = any(v_page_ids);

  -- 3. Aggregates whose tenant is trigger-locked to the owning page. Their
  --    own validation triggers now find the page under the target tenant.
  update public.mentorbooking_products
    set tenant_id = p_target_tenant_id
    where product_page_id = any(v_page_ids);

  -- 4. Companies assigned to the moved events follow their events. This must
  --    happen BEFORE the event move: validate_event_company_tenant requires
  --    the company to already sit in the target workspace when the event row
  --    is updated. The pre-check above guarantees no other event references
  --    these companies.
  update public.companies
    set tenant_id = p_target_tenant_id
    where id in (
      select distinct e.company_id
      from public.mentorbooking_events e
      where e.company_id is not null
        and e.page_id is not null
        and e.page_id = any(v_page_ids)
    )
    and tenant_id is distinct from p_target_tenant_id;

  -- 5. Events: page and company are now both in the target workspace, so the
  --    event validation triggers pass.
  update public.mentorbooking_events
    set tenant_id = p_target_tenant_id
    where page_id = any(v_page_ids);

  execute 'alter table public.pages enable trigger enforce_event_page_link';

  -- 6. Domain ownership moves last.
  update public.page_domains
    set tenant_id = p_target_tenant_id
    where id = p_domain_id;
end;
$$;

grant execute on function public.reassign_page_domain_tenant(uuid, uuid) to authenticated;

-- ─── Backfill ───────────────────────────────────────────────────────────────
-- Register every domain that already has registered schemas so the
-- super-admin panel covers pre-existing TLDs. Display names stay null (the
-- domain URL remains the shown name until a super-admin renames it).
insert into public.page_domains (domain_url, tenant_id)
  select frontend_url,
    -- uuid has no min()/max() aggregate: pick the first non-null tenant id
    -- deterministically instead.
    (array_agg(tenant_id) filter (where tenant_id is not null))[1]
  from public.page_schemas
  where frontend_url is not null
  group by frontend_url
  on conflict (domain_url) do nothing;