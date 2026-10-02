-- Add the neutral service-product integration contract to the existing
-- integer-ID product table. This is an additive compatibility phase: legacy
-- columns/writers remain in place while all new aggregate writes use RPCs.

alter table public.mentorbooking_products
  add column if not exists integration_id uuid not null default gen_random_uuid(),
  add column if not exists retired_at timestamptz null,
  add column if not exists team_enabled boolean not null default false,
  add column if not exists version bigint not null default 1,
  add column if not exists request_key uuid null,
  add column if not exists request_payload_hash text null;

create unique index if not exists mentorbooking_products_integration_id_key
  on public.mentorbooking_products (integration_id);
create unique index if not exists mentorbooking_products_request_key_tenant_key
  on public.mentorbooking_products (tenant_id, request_key)
  where request_key is not null;

alter table public.mentorbooking_products
  drop constraint if exists mentorbooking_products_version_check;
alter table public.mentorbooking_products
  add constraint mentorbooking_products_version_check check (version > 0);

-- A minimal, allow-listed business projection. The view is read-only to the
-- API role; mutations go through tenant-checked aggregate RPCs below.
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
  updated_at
from public.mentorbooking_products;

grant select on public.service_products to authenticated;
grant select on public.service_products to service_role;

create or replace function public.bump_service_product_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.version is distinct from old.version
    or (to_jsonb(new) - 'version' - 'updated_at') is distinct from (to_jsonb(old) - 'version' - 'updated_at') then
    new.version := old.version + 1;
    new.updated_at := now();
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;

drop trigger if exists bump_service_product_version on public.mentorbooking_products;
create trigger bump_service_product_version
  before update on public.mentorbooking_products
  for each row
  execute function public.bump_service_product_version();

create or replace function public.create_service_product_aggregate(
  target_tenant_id uuid,
  target_schema_id uuid,
  expected_definition_revision bigint,
  target_name text,
  target_slug text,
  target_content jsonb,
  idempotency_key uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  schema_tenant_id uuid;
  schema_entity_kind text;
  schema_content_scope text;
  current_definition_revision bigint;
  payload_hash text;
  existing_product public.mentorbooking_products%rowtype;
  created_page public.pages%rowtype;
  created_product public.mentorbooking_products%rowtype;
begin
  if target_tenant_id is null or target_schema_id is null or idempotency_key is null then
    raise exception 'tenant_id, schema_id and idempotency_key are required.' using errcode = '22023';
  end if;
  if target_name is null or btrim(target_name) = '' then
    raise exception 'Product name is required.' using errcode = '22023';
  end if;
  if target_slug is null or btrim(target_slug) = '' then
    raise exception 'Product page slug is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(target_content) is distinct from 'object' then
    raise exception 'Product page content must be a JSON object.' using errcode = '22023';
  end if;
  if octet_length(target_content::text) > 1048576 then
    raise exception 'Product page content exceeds the 1 MiB limit.' using errcode = '22023';
  end if;

  payload_hash := md5(target_schema_id::text || E'\x1f' || target_name || E'\x1f' || target_slug || E'\x1f' || target_content::text);

  select * into existing_product
    from public.mentorbooking_products
    where tenant_id = target_tenant_id and request_key = idempotency_key
    for update;
  if found then
    if existing_product.request_payload_hash is distinct from payload_hash then
      raise exception 'Idempotency key was already used with a different payload.' using errcode = '23505';
    end if;
    return public.service_product_aggregate_json(existing_product.integration_id, target_tenant_id);
  end if;

  select tenant_id, entity_kind, content_scope, definition_revision
    into schema_tenant_id, schema_entity_kind, schema_content_scope, current_definition_revision
    from public.page_schemas
    where id = target_schema_id
    for share;
  if not found or schema_tenant_id is distinct from target_tenant_id then
    raise exception 'Schema not found in the requested workspace.' using errcode = 'P0002';
  end if;
  if current_definition_revision is distinct from expected_definition_revision then
    raise exception 'Schema definition revision conflict.' using errcode = '40001';
  end if;
  if schema_entity_kind is distinct from 'service-product' or schema_content_scope is distinct from 'page-collection' then
    raise exception 'Schema is not an eligible service-product collection.' using errcode = '23514';
  end if;

  insert into public.pages (name, slug, status, content, schema_id, tenant_id)
  values (target_name, target_slug, 'draft', target_content, target_schema_id, target_tenant_id)
  returning * into created_page;

  insert into public.mentorbooking_products (
    name, description_de, description_effort, product_page_id, tenant_id,
    integration_id, request_key, request_payload_hash, team_enabled
  ) values (
    target_name, '', '', created_page.id, target_tenant_id,
    gen_random_uuid(), idempotency_key, payload_hash, false
  )
  returning * into created_product;

  return public.service_product_aggregate_json(created_product.integration_id, target_tenant_id);
end;
$$;

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

create or replace function public.update_service_product_aggregate(
  target_product_id uuid,
  expected_tenant_id uuid,
  expected_version bigint,
  expected_definition_revision bigint,
  target_name text,
  target_slug text,
  target_content jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  product public.mentorbooking_products%rowtype;
  page_schema_id uuid;
  current_definition_revision bigint;
begin
  if expected_tenant_id is null or expected_version is null then
    raise exception 'tenant_id and expected_version are required.' using errcode = '22023';
  end if;
  if target_name is null or btrim(target_name) = '' or target_slug is null or btrim(target_slug) = '' then
    raise exception 'Product name and page slug are required.' using errcode = '22023';
  end if;
  if jsonb_typeof(target_content) is distinct from 'object' or octet_length(target_content::text) > 1048576 then
    raise exception 'Product content must be an object no larger than 1 MiB.' using errcode = '22023';
  end if;

  select * into product
    from public.mentorbooking_products
    where integration_id = target_product_id and tenant_id = expected_tenant_id
    for update;
  if not found or product.retired_at is not null then
    raise exception 'Product not found.' using errcode = 'P0002';
  end if;
  if product.version <> expected_version then
    raise exception 'Product version conflict.' using errcode = '40001';
  end if;

  select schema_id into page_schema_id
    from public.pages
    where id = product.product_page_id and tenant_id = expected_tenant_id
    for update;
  if not found then
    raise exception 'Product page not found in the product workspace.' using errcode = '23514';
  end if;
  select definition_revision into current_definition_revision
    from public.page_schemas
    where id = page_schema_id and tenant_id = expected_tenant_id and entity_kind = 'service-product'
    for share;
  if not found then
    raise exception 'Linked page is not owned by a service-product schema.' using errcode = '23514';
  end if;
  if current_definition_revision is distinct from expected_definition_revision then
    raise exception 'Schema definition revision conflict.' using errcode = '40001';
  end if;

  update public.pages
    set name = target_name, slug = target_slug, content = target_content
    where id = product.product_page_id and tenant_id = expected_tenant_id;
  update public.mentorbooking_products
    set name = target_name, description_de = target_name, version = version + 1
    where id = product.id and tenant_id = expected_tenant_id;

  return public.service_product_aggregate_json(target_product_id, expected_tenant_id);
end;
$$;

create or replace function public.archive_service_product_aggregate(
  target_product_id uuid,
  expected_tenant_id uuid,
  expected_version bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  product public.mentorbooking_products%rowtype;
begin
  select * into product
    from public.mentorbooking_products
    where integration_id = target_product_id and tenant_id = expected_tenant_id
    for update;
  if not found then raise exception 'Product not found.' using errcode = 'P0002'; end if;
  if product.version <> expected_version then raise exception 'Product version conflict.' using errcode = '40001'; end if;

  update public.mentorbooking_products
    set retired_at = coalesce(retired_at, now())
    where id = product.id;
  update public.pages
    set status = 'archived'
    where id = product.product_page_id and tenant_id = expected_tenant_id;

  return public.service_product_aggregate_json(target_product_id, expected_tenant_id);
end;
$$;

-- Deferred completeness check: a service-product page cannot commit unless a
-- same-tenant business product row owns it. Aggregate RPC insertion is atomic.
create or replace function public.publish_service_product_aggregate(
  target_product_id uuid,
  expected_tenant_id uuid,
  expected_version bigint,
  expected_definition_revision bigint,
  target_status text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  product public.mentorbooking_products%rowtype;
  page_schema_id uuid;
  current_definition_revision bigint;
begin
  if target_status not in ('draft', 'published') then
    raise exception 'Product publication status must be draft or published.' using errcode = '22023';
  end if;
  select * into product
    from public.mentorbooking_products
    where integration_id = target_product_id and tenant_id = expected_tenant_id
    for update;
  if not found or product.retired_at is not null then raise exception 'Product not found.' using errcode = 'P0002'; end if;
  if product.version <> expected_version then raise exception 'Product version conflict.' using errcode = '40001'; end if;

  select schema_id into page_schema_id from public.pages
    where id = product.product_page_id and tenant_id = expected_tenant_id for update;
  if not found then raise exception 'Product page not found.' using errcode = '23514'; end if;
  select definition_revision into current_definition_revision from public.page_schemas
    where id = page_schema_id and tenant_id = expected_tenant_id and entity_kind = 'service-product' for share;
  if not found then raise exception 'Product schema not found.' using errcode = '23514'; end if;
  if current_definition_revision is distinct from expected_definition_revision then
    raise exception 'Schema definition revision conflict.' using errcode = '40001';
  end if;
  update public.pages
    set status = target_status
    where id = product.product_page_id and tenant_id = expected_tenant_id;
  if not found then raise exception 'Product page not found.' using errcode = '23514'; end if;
  update public.mentorbooking_products
    set version = version + 1
    where id = product.id and tenant_id = expected_tenant_id;

  return public.service_product_aggregate_json(target_product_id, expected_tenant_id);
end;
$$;

create or replace function public.validate_service_product_page_owner()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  page_tenant_id uuid;
  page_schema_id uuid;
  page_entity_kind text;
begin
  if new.product_page_id is null then return new; end if;
  select tenant_id, schema_id into page_tenant_id, page_schema_id
    from public.pages where id = new.product_page_id for key share;
  if not found then raise exception 'Linked product page does not exist.' using errcode = '23503'; end if;
  if page_tenant_id is distinct from new.tenant_id then
    raise exception 'Product and page must belong to the same workspace.' using errcode = '23514';
  end if;
  select entity_kind into page_entity_kind from public.page_schemas where id = page_schema_id;
  if page_entity_kind = 'service-product' and new.tenant_id is null then
    raise exception 'Service products require a tenant-owned page.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_service_product_page_owner on public.mentorbooking_products;
create trigger validate_service_product_page_owner
  before insert or update of product_page_id, tenant_id on public.mentorbooking_products
  for each row
  execute function public.validate_service_product_page_owner();

create or replace function public.enforce_service_product_page_link()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  kind text;
begin
  if tg_op = 'DELETE' then return old; end if;
  select entity_kind into kind from public.page_schemas where id = new.schema_id;
  if kind = 'service-product' and not exists (
    select 1 from public.mentorbooking_products
    where product_page_id = new.id and tenant_id = new.tenant_id
  ) then
    raise exception 'Service-product pages must be created through the product aggregate service.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_service_product_page_link on public.pages;
create constraint trigger enforce_service_product_page_link
  after insert or update of schema_id, tenant_id on public.pages
  deferrable initially deferred
  for each row
  execute function public.enforce_service_product_page_link();

revoke all on function public.create_service_product_aggregate(uuid, uuid, bigint, text, text, jsonb, uuid) from public;
revoke all on function public.update_service_product_aggregate(uuid, uuid, bigint, bigint, text, text, jsonb) from public;
revoke all on function public.archive_service_product_aggregate(uuid, uuid, bigint) from public;
revoke all on function public.publish_service_product_aggregate(uuid, uuid, bigint, bigint, text) from public;
revoke all on function public.service_product_aggregate_json(uuid, uuid) from public;
revoke all on function public.validate_service_product_page_owner() from public;
revoke all on function public.enforce_service_product_page_link() from public;
grant execute on function public.create_service_product_aggregate(uuid, uuid, bigint, text, text, jsonb, uuid) to authenticated;
grant execute on function public.update_service_product_aggregate(uuid, uuid, bigint, bigint, text, text, jsonb) to authenticated;
grant execute on function public.archive_service_product_aggregate(uuid, uuid, bigint) to authenticated;
grant execute on function public.publish_service_product_aggregate(uuid, uuid, bigint, bigint, text) to authenticated;
grant execute on function public.service_product_aggregate_json(uuid, uuid) to authenticated;
grant execute on function public.validate_service_product_page_owner() to authenticated;
grant execute on function public.enforce_service_product_page_link() to authenticated;
