-- Make the human-facing page schema slug unique within its tenant while
-- preserving every pre-migration slug as a stable API identifier.
-- Existing clients continue to use api_slug values equal to their old slug.

alter table public.page_schemas
  add column if not exists api_slug text;

update public.page_schemas
set api_slug = slug
where api_slug is null or btrim(api_slug) = '';

alter table public.page_schemas
  alter column api_slug set not null;

create unique index if not exists page_schemas_api_slug_key
  on public.page_schemas (api_slug);

alter table public.page_schemas
  drop constraint if exists page_schemas_slug_key;

-- Tenant-owned schemas may reuse a slug in different tenants. Global/system
-- schemas remain unique among themselves, and NULL tenant values are not
-- accidentally treated as equal by PostgreSQL's ordinary composite UNIQUE.
create unique index if not exists page_schemas_tenant_slug_key
  on public.page_schemas (tenant_id, slug)
  where tenant_id is not null;

create unique index if not exists page_schemas_global_slug_key
  on public.page_schemas (slug)
  where tenant_id is null;

create index if not exists idx_page_schemas_tenant_slug
  on public.page_schemas (tenant_id, slug);

create or replace function public.set_page_schema_api_slug()
returns trigger
language plpgsql
as $$
begin
  -- UUID API identifiers for new rows avoid collisions while the old API
  -- aliases above remain stable for all schemas that existed at migration time.
  if new.api_slug is null or btrim(new.api_slug) = '' then
    new.api_slug := new.id::text;
  end if;
  return new;
end;
$$;

drop trigger if exists set_page_schema_api_slug on public.page_schemas;
create trigger set_page_schema_api_slug
  before insert on public.page_schemas
  for each row
  execute function public.set_page_schema_api_slug();
