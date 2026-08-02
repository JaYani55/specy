-- Schema frontend targets
--
-- This migration is metadata-only. It must not rewrite page_schemas.schema,
-- page_schemas.integration_requirements, or any pages.content value.

create table if not exists public.schema_frontend_targets (
  id uuid not null default gen_random_uuid(),
  schema_id uuid not null references public.page_schemas(id) on delete cascade,
  tenant_id uuid null references public.tenants(id) on delete cascade,
  target_key varchar(100) not null,
  kind varchar(32) not null,
  host_path text not null,
  placement_key varchar(100) null,
  supports_preview boolean not null default false,
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint schema_frontend_targets_pkey primary key (id),
  constraint schema_frontend_targets_key_unique unique (schema_id, target_key),
  constraint schema_frontend_targets_kind_check check (kind in ('collection-slot', 'detail-page')),
  constraint schema_frontend_targets_path_check check (
    host_path like '/%'
    and host_path not like '//%'
    and host_path not like '%?%'
    and host_path not like '%#%'
    and host_path not like '%\\%'
    and host_path not like '%..%'
  ),
  constraint schema_frontend_targets_shape_check check (
    (kind = 'detail-page'
      and host_path like '%:slug%'
      and host_path not like '%:slug%:slug%'
      and placement_key is null)
    or
    (kind = 'collection-slot'
      and host_path not like '%:slug%'
      and placement_key ~ '^[a-z][a-z0-9_.-]{0,99}$')
  )
);

create index if not exists idx_schema_frontend_targets_schema_enabled
  on public.schema_frontend_targets (schema_id, enabled, sort_order);

create index if not exists idx_schema_frontend_targets_tenant_enabled
  on public.schema_frontend_targets (tenant_id, enabled);

create unique index if not exists schema_frontend_targets_primary_unique
  on public.schema_frontend_targets (schema_id)
  where enabled and is_primary;

create unique index if not exists schema_frontend_targets_detail_unique
  on public.schema_frontend_targets (schema_id)
  where enabled and kind = 'detail-page';

drop trigger if exists set_schema_frontend_targets_updated_at on public.schema_frontend_targets;
create trigger set_schema_frontend_targets_updated_at
  before update on public.schema_frontend_targets
  for each row
  execute function public.set_current_timestamp_updated_at();

create or replace function public.validate_schema_frontend_target_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  schema_tenant_id uuid;
begin
  select ps.tenant_id into schema_tenant_id
  from public.page_schemas ps
  where ps.id = new.schema_id;

  if schema_tenant_id is distinct from new.tenant_id then
    raise exception 'schema_frontend_targets.tenant_id must match page_schemas.tenant_id';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_schema_frontend_target_tenant on public.schema_frontend_targets;
create trigger validate_schema_frontend_target_tenant
  before insert or update on public.schema_frontend_targets
  for each row
  execute function public.validate_schema_frontend_target_tenant();

alter table public.schema_frontend_targets enable row level security;

drop policy if exists schema_frontend_targets_select on public.schema_frontend_targets;
create policy schema_frontend_targets_select
  on public.schema_frontend_targets
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.page_schemas ps
      where ps.id = schema_frontend_targets.schema_id
        and (ps.owner_user_id is null or public.can_access_owned_row(ps.tenant_id, ps.owner_user_id))
    )
  );

drop policy if exists schema_frontend_targets_insert on public.schema_frontend_targets;
create policy schema_frontend_targets_insert
  on public.schema_frontend_targets
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.page_schemas ps
      where ps.id = schema_frontend_targets.schema_id
        and ((ps.owner_user_id is null and public.is_super_admin())
          or public.can_access_owned_row(ps.tenant_id, ps.owner_user_id))
    )
  );

drop policy if exists schema_frontend_targets_update on public.schema_frontend_targets;
create policy schema_frontend_targets_update
  on public.schema_frontend_targets
  for update
  to authenticated
  using (
    exists (
      select 1 from public.page_schemas ps
      where ps.id = schema_frontend_targets.schema_id
        and ((ps.owner_user_id is null and public.is_super_admin())
          or public.can_access_owned_row(ps.tenant_id, ps.owner_user_id))
    )
  )
  with check (
    exists (
      select 1 from public.page_schemas ps
      where ps.id = schema_frontend_targets.schema_id
        and ((ps.owner_user_id is null and public.is_super_admin())
          or public.can_access_owned_row(ps.tenant_id, ps.owner_user_id))
    )
  );

drop policy if exists schema_frontend_targets_delete on public.schema_frontend_targets;
create policy schema_frontend_targets_delete
  on public.schema_frontend_targets
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.page_schemas ps
      where ps.id = schema_frontend_targets.schema_id
        and ((ps.owner_user_id is null and public.is_super_admin())
          or public.can_access_owned_row(ps.tenant_id, ps.owner_user_id))
    )
  );

-- Backfill only the new registry. Existing schema and page JSON is untouched.
insert into public.schema_frontend_targets (
  schema_id, tenant_id, target_key, kind, host_path, supports_preview, is_primary
)
select
  ps.id,
  ps.tenant_id,
  'default',
  'detail-page',
  ps.slug_structure,
  true,
  true
from public.page_schemas ps
where ps.slug_structure like '%:slug%'
  and (length(ps.slug_structure) - length(replace(ps.slug_structure, ':slug', ''))) = 5
on conflict (schema_id, target_key) do nothing;

insert into public.schema_frontend_targets (
  schema_id, tenant_id, target_key, kind, host_path, placement_key, supports_preview, is_primary
)
select
  ps.id,
  ps.tenant_id,
  'home.' || ps.slug,
  'collection-slot',
  '/',
  'home.' || ps.slug,
  false,
  true
from public.page_schemas ps
where ps.integration_requirements ->> 'required_slug_structure' = '/'
  and not exists (
    select 1 from public.schema_frontend_targets existing
    where existing.schema_id = ps.id and existing.enabled
  )
on conflict (schema_id, target_key) do nothing;