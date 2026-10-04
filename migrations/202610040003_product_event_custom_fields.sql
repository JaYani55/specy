-- Workspace-defined custom fields for product/event records, plus the public
-- read projection needed by dynamic product URLs. Custom data stays outside
-- page_schemas.schema and pages.content.

alter table public.mentorbooking_products
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table public.mentorbooking_products
  drop constraint if exists mentorbooking_products_custom_fields_object_check;
alter table public.mentorbooking_products
  add constraint mentorbooking_products_custom_fields_object_check
  check (jsonb_typeof(custom_fields) = 'object' and octet_length(custom_fields::text) <= 1048576);

alter table public.mentorbooking_events
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table public.mentorbooking_events
  drop constraint if exists mentorbooking_events_custom_fields_object_check;
alter table public.mentorbooking_events
  add constraint mentorbooking_events_custom_fields_object_check
  check (jsonb_typeof(custom_fields) = 'object' and octet_length(custom_fields::text) <= 1048576);

create table if not exists public.tenant_custom_field_definitions (
  tenant_id uuid not null references public.tenants(id) on update cascade on delete cascade,
  entity_type text not null,
  definitions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_custom_field_definitions_pkey primary key (tenant_id, entity_type),
  constraint tenant_custom_field_definitions_entity_type_check check (entity_type in ('product', 'event')),
  constraint tenant_custom_field_definitions_object_check check (
    jsonb_typeof(definitions) = 'object'
    and octet_length(definitions::text) <= 262144
  )
);

create index if not exists idx_tenant_custom_field_definitions_entity
  on public.tenant_custom_field_definitions (entity_type, tenant_id);

drop trigger if exists set_tenant_custom_field_definitions_updated_at on public.tenant_custom_field_definitions;
create trigger set_tenant_custom_field_definitions_updated_at
  before update on public.tenant_custom_field_definitions
  for each row execute function public.set_current_timestamp_updated_at();

alter table public.tenant_custom_field_definitions enable row level security;
drop policy if exists tenant_custom_field_definitions_select on public.tenant_custom_field_definitions;
drop policy if exists tenant_custom_field_definitions_write on public.tenant_custom_field_definitions;
create policy tenant_custom_field_definitions_select
  on public.tenant_custom_field_definitions
  for select to authenticated
  using (public.is_content_admin() or public.is_tenant_member(tenant_id));
create policy tenant_custom_field_definitions_write
  on public.tenant_custom_field_definitions
  for all to authenticated
  using (public.is_content_admin() or public.is_tenant_member(tenant_id))
  with check (public.is_content_admin() or public.is_tenant_member(tenant_id));
grant select, insert, update, delete on table public.tenant_custom_field_definitions to authenticated;
grant select on table public.tenant_custom_field_definitions to service_role;

-- Preserve the existing authenticated product projection and append only the
-- explicitly managed custom JSON values.
create or replace view public.service_products
with (security_invoker = true)
as
select
  integration_id as id,
  tenant_id,
  name,
  product_page_id as page_id,
  retired_at,
  team_enabled,
  version,
  created_at,
  updated_at,
  custom_fields
from public.mentorbooking_products;
grant select on public.service_products to authenticated;
grant select on public.service_products to service_role;

-- Return custom_fields as part of the internal authenticated service-product
-- aggregate; the public route applies the workspace field definitions before
-- projecting values.
create or replace function public.service_product_aggregate_json(target_product_id uuid, expected_tenant_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', product.integration_id,
    'tenant_id', product.tenant_id,
    'name', product.name,
    'page_id', page.id,
    'schema_id', page.schema_id,
    'slug', page.slug,
    'status', page.status,
    'content', page.content,
    'custom_fields', product.custom_fields,
    'retired_at', product.retired_at,
    'team_enabled', product.team_enabled,
    'version', product.version,
    'created_at', product.created_at,
    'updated_at', product.updated_at
  )
  from public.mentorbooking_products product
  join public.pages page on page.id = product.product_page_id
  where product.integration_id = target_product_id
    and product.tenant_id = expected_tenant_id
    and page.tenant_id = expected_tenant_id
$$;

create or replace function public.update_service_product_aggregate_with_custom_fields(
  target_product_id uuid,
  expected_tenant_id uuid,
  expected_version bigint,
  expected_definition_revision bigint,
  target_name text,
  target_slug text,
  target_page_content jsonb,
  target_custom_fields jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  product public.mentorbooking_products%rowtype;
  page_row public.pages%rowtype;
  page_schema_tenant_id uuid;
  page_schema_kind text;
  current_definition_revision bigint;
  schema_definition jsonb;
  validation_errors text[];
begin
  if expected_tenant_id is null or expected_version is null or expected_definition_revision is null then
    raise exception 'tenant_id, expected_version and expected_definition_revision are required.' using errcode = '22023';
  end if;
  if target_name is null or btrim(target_name) = '' or target_slug is null or btrim(target_slug) = '' then
    raise exception 'Product name and page slug are required.' using errcode = '22023';
  end if;
  if jsonb_typeof(target_page_content) is distinct from 'object'
    or octet_length(target_page_content::text) > 1048576 then
    raise exception 'Product content must be an object no larger than 1 MiB.' using errcode = '22023';
  end if;
  if jsonb_typeof(target_custom_fields) is distinct from 'object'
    or octet_length(target_custom_fields::text) > 1048576 then
    raise exception 'Product custom_fields must be an object no larger than 1 MiB.' using errcode = '22023';
  end if;

  select * into product from public.mentorbooking_products
    where integration_id = target_product_id and tenant_id = expected_tenant_id
    for update;
  if not found or product.retired_at is not null then raise exception 'Product not found.' using errcode = 'P0002'; end if;
  if product.version is distinct from expected_version then raise exception 'Product version conflict.' using errcode = '40001'; end if;

  select * into page_row from public.pages
    where id = product.product_page_id and tenant_id = expected_tenant_id
    for update;
  if not found then raise exception 'Product page not found in the product workspace.' using errcode = '23514'; end if;
  select tenant_id, entity_kind, definition_revision, schema
    into page_schema_tenant_id, page_schema_kind, current_definition_revision, schema_definition
    from public.page_schemas where id = page_row.schema_id for share;
  if not found or page_schema_tenant_id is distinct from expected_tenant_id or page_schema_kind is distinct from 'service-product' then
    raise exception 'Linked page is not owned by a service-product schema.' using errcode = '23514';
  end if;
  if current_definition_revision is distinct from expected_definition_revision then
    raise exception 'Schema definition revision conflict.' using errcode = '40001';
  end if;

  validation_errors := public.validate_service_product_content(schema_definition, target_page_content);
  if cardinality(validation_errors) > 0 then
    raise exception 'Product content does not satisfy its schema.' using errcode = '22023', detail = array_to_string(validation_errors, E'\n');
  end if;

  update public.pages set name = btrim(target_name), slug = target_slug, content = target_page_content
    where id = page_row.id and tenant_id = expected_tenant_id;
  update public.mentorbooking_products
    set name = btrim(target_name), description_de = btrim(target_name), custom_fields = target_custom_fields
    where id = product.id and tenant_id = expected_tenant_id;

  return public.service_product_aggregate_json(target_product_id, expected_tenant_id);
end;
$$;

create or replace function public.create_event_page_aggregate_with_custom_fields(
  target_tenant_id uuid,
  target_schema_id uuid,
  expected_definition_revision bigint,
  target_event jsonb,
  target_page_name text,
  target_page_slug text,
  target_page_content jsonb,
  target_event_custom_fields jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  result jsonb;
  created_event_id uuid;
begin
  if jsonb_typeof(target_event_custom_fields) is distinct from 'object'
    or octet_length(target_event_custom_fields::text) > 1048576 then
    raise exception 'Event custom_fields must be an object no larger than 1 MiB.' using errcode = '22023';
  end if;

  result := public.create_event_page_aggregate(
    target_tenant_id,
    target_schema_id,
    expected_definition_revision,
    target_event,
    target_page_name,
    target_page_slug,
    target_page_content
  );
  created_event_id := (result ->> 'event_id')::uuid;
  update public.mentorbooking_events
    set custom_fields = target_event_custom_fields
    where id = created_event_id and tenant_id = target_tenant_id;
  if not found then raise exception 'Created event was not found in its workspace.' using errcode = 'P0002'; end if;
  return result;
end;
$$;

revoke all on function public.update_service_product_aggregate_with_custom_fields(uuid, uuid, bigint, bigint, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.update_service_product_aggregate_with_custom_fields(uuid, uuid, bigint, bigint, text, text, jsonb, jsonb) to authenticated;
revoke all on function public.create_event_page_aggregate_with_custom_fields(uuid, uuid, bigint, jsonb, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_event_page_aggregate_with_custom_fields(uuid, uuid, bigint, jsonb, text, text, jsonb, jsonb) to authenticated;
