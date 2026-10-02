-- Add schema classification and revisioned editor metadata without changing
-- developer-owned schema/content JSON. Existing schemas remain ordinary pages.

alter table public.page_schemas
  add column if not exists entity_kind text not null default 'page',
  add column if not exists definition_revision bigint not null default 1,
  add column if not exists editor_config jsonb not null default '{}'::jsonb;

alter table public.page_schemas
  drop constraint if exists page_schemas_entity_kind_check;
alter table public.page_schemas
  add constraint page_schemas_entity_kind_check
  check (entity_kind in ('page', 'service-product', 'event'));

alter table public.page_schemas
  drop constraint if exists page_schemas_entity_content_scope_check;
alter table public.page_schemas
  add constraint page_schemas_entity_content_scope_check
  check (
    entity_kind = 'page'
    or (tenant_id is not null and content_scope = 'page-collection')
  );

alter table public.page_schemas
  drop constraint if exists page_schemas_editor_config_object_check;
alter table public.page_schemas
  add constraint page_schemas_editor_config_object_check
  check (jsonb_typeof(editor_config) = 'object');

alter table public.page_schemas
  drop constraint if exists page_schemas_definition_revision_check;
alter table public.page_schemas
  add constraint page_schemas_definition_revision_check
  check (definition_revision > 0);

create index if not exists idx_page_schemas_entity_kind_tenant
  on public.page_schemas (tenant_id, entity_kind);

create or replace function public.bump_page_schema_definition_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.schema is distinct from old.schema
    or new.editor_config is distinct from old.editor_config
    or new.entity_kind is distinct from old.entity_kind
    or new.content_scope is distinct from old.content_scope
  then
    new.definition_revision := old.definition_revision + 1;
  else
    -- The revision is server-owned and cannot be changed as ordinary metadata.
    new.definition_revision := old.definition_revision;
  end if;
  return new;
end;
$$;

drop trigger if exists bump_page_schema_definition_revision on public.page_schemas;
create trigger bump_page_schema_definition_revision
  before update on public.page_schemas
  for each row
  execute function public.bump_page_schema_definition_revision();
