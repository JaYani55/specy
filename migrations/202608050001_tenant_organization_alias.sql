-- Core organization alias support.
-- Organization records remain plugin-owned; this migration only adds a
-- backwards-compatible public alias to the existing tenant/workspace table.

alter table public.tenants
  add column if not exists organization_slug text null;

create unique index if not exists idx_tenants_organization_slug_unique
  on public.tenants (lower(organization_slug))
  where organization_slug is not null;

create index if not exists idx_tenants_organization_slug
  on public.tenants (organization_slug)
  where organization_slug is not null;

alter table public.tenants
  drop constraint if exists tenants_organization_slug_check;

alter table public.tenants
  add constraint tenants_organization_slug_check
  check (organization_slug is null or btrim(organization_slug) <> '');

create or replace function public.resolve_tenant_public_alias(target_alias text)
returns table (
  tenant_id uuid,
  tenant_name text,
  legacy_slug text,
  organization_slug text
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select lower(btrim(target_alias)) as alias
  ), matches as (
    select t.id, t.name, t.slug, t.organization_slug
    from public.tenants t
    cross join normalized n
    where lower(t.slug) = n.alias
       or lower(t.organization_slug) = n.alias
  )
  select m.id, m.name, m.slug, m.organization_slug
  from matches m
  where (select count(*) from matches) = 1
$$;

grant execute on function public.resolve_tenant_public_alias(text) to anon, authenticated;
