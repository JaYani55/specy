-- Catalogue schema unification. The service-product and event schema kinds
-- are merged into one catalogue concept: 'event' is the catalogue kind, and a
-- catalogue holds both the product's canonical page and its event pages. Pages
-- are classified by their linked aggregate (product row vs event row), not by
-- the schema kind alone.
--
-- Existing 'service-product' schemas are migrated to 'event'. The check
-- constraint keeps accepting the legacy value so this migration stays
-- idempotent and existing backups remain loadable.

update public.page_schemas
  set entity_kind = 'event'
  where entity_kind = 'service-product';

-- ------------------------------------------------------------------
-- Product aggregate RPCs accept catalogue schemas and mark their page
-- writes with the event-page write guard so the page triggers allow them.
-- ------------------------------------------------------------------

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
  if schema_entity_kind is distinct from 'event' or schema_content_scope is distinct from 'page-collection' then
    raise exception 'Schema is not an eligible catalogue collection.' using errcode = '23514';
  end if;

  perform set_config('specy.event_page_write', 'on', true);

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
  schema_definition jsonb;
  validation_errors text[];
begin
  if expected_tenant_id is null or expected_version is null or expected_definition_revision is null then
    raise exception 'tenant_id, expected_version and expected_definition_revision are required.' using errcode = '22023';
  end if;
  if target_name is null or btrim(target_name) = '' or target_slug is null or btrim(target_slug) = '' then
    raise exception 'Product name and page slug are required.' using errcode = '22023';
  end if;
  if jsonb_typeof(target_content) is distinct from 'object' or octet_length(target_content::text) > 1048576 then
    raise exception 'Product content must be an object no larger than 1 MiB.' using errcode = '22023';
  end if;

  select * into product from public.mentorbooking_products
    where integration_id = target_product_id and tenant_id = expected_tenant_id for update;
  if not found or product.retired_at is not null then raise exception 'Product not found.' using errcode = 'P0002'; end if;
  if product.version <> expected_version then raise exception 'Product version conflict.' using errcode = '40001'; end if;

  select schema_id into page_schema_id from public.pages
    where id = product.product_page_id and tenant_id = expected_tenant_id for update;
  if not found then raise exception 'Product page not found in the product workspace.' using errcode = '23514'; end if;
  select definition_revision, schema into current_definition_revision, schema_definition
    from public.page_schemas
    where id = page_schema_id and tenant_id = expected_tenant_id and entity_kind = 'event' for share;
  if not found then raise exception 'Linked catalogue schema not found.' using errcode = '23514'; end if;
  if current_definition_revision is distinct from expected_definition_revision then raise exception 'Schema definition revision conflict.' using errcode = '40001'; end if;

  validation_errors := public.validate_service_product_content(schema_definition, target_content);
  if cardinality(validation_errors) > 0 then
    raise exception 'Product content does not satisfy its schema.' using errcode = '22023', detail = array_to_string(validation_errors, E'\n');
  end if;

  perform set_config('specy.event_page_write', 'on', true);

  update public.pages set name = target_name, slug = target_slug, content = target_content
    where id = product.product_page_id and tenant_id = expected_tenant_id;
  update public.mentorbooking_products set name = target_name, description_de = target_name, version = version + 1
    where id = product.id and tenant_id = expected_tenant_id;
  return public.service_product_aggregate_json(target_product_id, expected_tenant_id);
end;
$$;

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
  schema_definition jsonb;
  page_content jsonb;
  validation_errors text[];
begin
  if target_status not in ('draft', 'published') then raise exception 'Product publication status must be draft or published.' using errcode = '22023'; end if;
  select * into product from public.mentorbooking_products
    where integration_id = target_product_id and tenant_id = expected_tenant_id for update;
  if not found or product.retired_at is not null then raise exception 'Product not found.' using errcode = 'P0002'; end if;
  if product.version <> expected_version then raise exception 'Product version conflict.' using errcode = '40001'; end if;
  select schema_id, content into page_schema_id, page_content from public.pages
    where id = product.product_page_id and tenant_id = expected_tenant_id for update;
  if not found then raise exception 'Product page not found.' using errcode = '23514'; end if;
  select definition_revision, schema into current_definition_revision, schema_definition
    from public.page_schemas
    where id = page_schema_id and tenant_id = expected_tenant_id and entity_kind = 'event' for share;
  if not found then raise exception 'Catalogue schema not found.' using errcode = '23514'; end if;
  if current_definition_revision is distinct from expected_definition_revision then raise exception 'Schema definition revision conflict.' using errcode = '40001'; end if;
  validation_errors := public.validate_service_product_content(schema_definition, page_content);
  if cardinality(validation_errors) > 0 then
    raise exception 'Product cannot be published until content satisfies its schema.' using errcode = '22023', detail = array_to_string(validation_errors, E'\n');
  end if;

  perform set_config('specy.event_page_write', 'on', true);

  update public.pages set status = target_status where id = product.product_page_id and tenant_id = expected_tenant_id;
  if not found then raise exception 'Product page not found.' using errcode = '23514'; end if;
  update public.mentorbooking_products set version = version + 1 where id = product.id and tenant_id = expected_tenant_id;
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
  perform set_config('specy.event_page_write', 'on', true);

  update public.pages
    set status = 'archived'
    where id = product.product_page_id and tenant_id = expected_tenant_id;

  return public.service_product_aggregate_json(target_product_id, expected_tenant_id);
end;
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
  if not found or page_schema_tenant_id is distinct from expected_tenant_id or page_schema_kind is distinct from 'event' then
    raise exception 'Linked page is not owned by a catalogue schema.' using errcode = '23514';
  end if;
  if current_definition_revision is distinct from expected_definition_revision then
    raise exception 'Schema definition revision conflict.' using errcode = '40001';
  end if;

  validation_errors := public.validate_service_product_content(schema_definition, target_page_content);
  if cardinality(validation_errors) > 0 then
    raise exception 'Product content does not satisfy its schema.' using errcode = '22023', detail = array_to_string(validation_errors, E'\n');
  end if;

  perform set_config('specy.event_page_write', 'on', true);

  update public.pages set name = btrim(target_name), slug = target_slug, content = target_page_content
    where id = page_row.id and tenant_id = expected_tenant_id;
  update public.mentorbooking_products
    set name = btrim(target_name), description_de = btrim(target_name), custom_fields = target_custom_fields
    where id = product.id and tenant_id = expected_tenant_id;

  return public.service_product_aggregate_json(target_product_id, expected_tenant_id);
end;
$$;

create or replace function public.change_service_product_schema_aggregate(
  target_product_id uuid,
  expected_tenant_id uuid,
  expected_version bigint,
  target_schema_id uuid,
  expected_definition_revision bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  product public.mentorbooking_products%rowtype;
  linked_page public.pages%rowtype;
  target_schema_tenant_id uuid;
  target_schema_kind text;
  target_content_scope text;
  current_definition_revision bigint;
  affected_rows bigint;
  previous_reassignment_setting text := current_setting('specy.product_schema_reassignment', true);
begin
  if target_product_id is null or expected_tenant_id is null or expected_version is null
    or target_schema_id is null or expected_definition_revision is null then
    raise exception 'Product, workspace, expected version, target schema and schema revision are required.' using errcode = '22023';
  end if;

  select * into product
    from public.mentorbooking_products
    where integration_id = target_product_id
      and tenant_id = expected_tenant_id
      and retired_at is null
    for update;
  if not found then raise exception 'Product not found.' using errcode = 'P0002'; end if;
  if product.version <> expected_version then raise exception 'Product version conflict.' using errcode = '40001'; end if;

  select * into linked_page
    from public.pages
    where id = product.product_page_id
      and tenant_id = expected_tenant_id
    for update;
  if not found then raise exception 'Product page not found in the product workspace.' using errcode = '23514'; end if;
  if linked_page.schema_id = target_schema_id then
    raise exception 'Product already uses the selected schema.' using errcode = '22023';
  end if;

  select tenant_id, entity_kind, content_scope, definition_revision
    into target_schema_tenant_id, target_schema_kind, target_content_scope, current_definition_revision
    from public.page_schemas
    where id = target_schema_id
    for share;
  if not found or target_schema_tenant_id is distinct from expected_tenant_id then
    raise exception 'Target schema not found in the Product workspace.' using errcode = 'P0002';
  end if;
  if target_schema_kind is distinct from 'event' or target_content_scope is distinct from 'page-collection' then
    raise exception 'Target schema is not an eligible catalogue collection.' using errcode = '23514';
  end if;
  if current_definition_revision is distinct from expected_definition_revision then
    raise exception 'Target schema definition revision conflict.' using errcode = '40001';
  end if;

  perform set_config('specy.product_schema_reassignment', 'on', true);
  perform set_config('specy.event_page_write', 'on', true);
  update public.pages
    set schema_id = target_schema_id,
        status = case when status = 'published' then 'draft' else status end
    where id = linked_page.id and tenant_id = expected_tenant_id;
  get diagnostics affected_rows = row_count;
  perform set_config('specy.product_schema_reassignment', coalesce(previous_reassignment_setting, ''), true);
  if affected_rows = 0 then raise exception 'Product page schema could not be changed.' using errcode = '42501'; end if;

  return public.service_product_aggregate_json(target_product_id, expected_tenant_id);
end;
$$;
revoke all on function public.change_service_product_schema_aggregate(uuid, uuid, bigint, uuid, bigint) from public, anon;
grant execute on function public.change_service_product_schema_aggregate(uuid, uuid, bigint, uuid, bigint) to authenticated;

create or replace function public.delete_mentorbooking_product_aggregate(
  target_product_id integer,
  expected_tenant_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  linked_page_id uuid;
  product_tenant_id uuid;
  page_tenant_id uuid;
  linked_product_count integer;
begin
  perform set_config('specy.event_page_write', 'on', true);
  if expected_tenant_id is null then
    raise exception 'A tenant is required to delete a product.' using errcode = '22023';
  end if;

  select product_page_id, tenant_id
    into linked_page_id, product_tenant_id
    from public.mentorbooking_products
    where id = target_product_id
      and tenant_id = expected_tenant_id
    for update;

  if not found then
    raise exception 'Product not found.' using errcode = 'P0002';
  end if;

  if linked_page_id is not null then
    select tenant_id into page_tenant_id
      from public.pages
      where id = linked_page_id
      for update;

    if not found or page_tenant_id is distinct from product_tenant_id then
      raise exception 'Linked page is missing or belongs to another tenant.' using errcode = '23514';
    end if;

    select count(*) into linked_product_count
      from public.mentorbooking_products
      where product_page_id = linked_page_id;
    if linked_product_count <> 1 then
      raise exception 'Linked page is shared by multiple products.' using errcode = '23514';
    end if;
  end if;

  -- Event deletion triggers remove each linked Event Page in this same
  -- transaction. Archived Event rows are historical records keyed by the
  -- globally unique legacy Product ID and are removed with the Product too.
  delete from public.mentorbooking_events
    where product_id = target_product_id
      and tenant_id = expected_tenant_id;
  delete from public.mentorbooking_events_archive
    where pillar_id = target_product_id;

  delete from public.mentorbooking_products
    where id = target_product_id
      and tenant_id = expected_tenant_id;
  if not found then
    raise exception 'Product deletion was denied.' using errcode = '42501';
  end if;

  if linked_page_id is not null then
    delete from public.pages
      where id = linked_page_id
        and tenant_id = expected_tenant_id;
    if not found then
      raise exception 'Linked product page deletion was denied.' using errcode = '42501';
    end if;
  end if;
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
  if exists (select 1 from public.mentorbooking_events where page_id = new.product_page_id) then
    raise exception 'A page cannot be owned by both an event and a product.' using errcode = '23514';
  end if;
  if page_entity_kind is not null and page_entity_kind <> 'page' and new.tenant_id is null then
    raise exception 'Service products require a tenant-owned page.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_event_page_link()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  page_entity_kind text;
begin
  if tg_op = 'DELETE' then return old; end if;
  select entity_kind into page_entity_kind
    from public.page_schemas where id = new.schema_id;
  if page_entity_kind = 'event' and not exists (
    select 1 from public.mentorbooking_events
    where page_id = new.id and tenant_id = new.tenant_id
  ) and not exists (
    select 1 from public.mentorbooking_products
    where product_page_id = new.id and tenant_id = new.tenant_id and retired_at is null
  ) then
    raise exception 'Event pages must be created through the event aggregate service.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.guard_event_page_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  schema_kind text;
  schema_tenant_id uuid;
  schema_definition jsonb;
  validation_errors text[];
begin
  if tg_op = 'DELETE' then
    select entity_kind into schema_kind from public.page_schemas where id = old.schema_id;
    if schema_kind = 'event' and coalesce(current_setting('specy.event_page_write', true), '') <> 'on'
      and exists (select 1 from public.mentorbooking_events where page_id = old.id) then
      raise exception 'Event pages must be changed through the event aggregate service.' using errcode = '42501';
    end if;
    return old;
  end if;

  select entity_kind, tenant_id, schema into schema_kind, schema_tenant_id, schema_definition
    from public.page_schemas where id = new.schema_id for share;
  if schema_kind = 'event' then
    if coalesce(current_setting('specy.event_page_write', true), '') <> 'on' then
      raise exception 'Event pages must be changed through the event aggregate service.' using errcode = '42501';
    end if;
    if schema_tenant_id is distinct from new.tenant_id then
      raise exception 'Event page and schema must belong to the same workspace.' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' then
      select entity_kind into schema_kind from public.page_schemas where id = old.schema_id;
      if schema_kind = 'event'
        and (new.schema_id is distinct from old.schema_id or new.tenant_id is distinct from old.tenant_id)
        and coalesce(current_setting('specy.product_schema_reassignment', true), '') <> 'on' then
        raise exception 'An event page cannot be moved to another schema or workspace.' using errcode = '23514';
      end if;
      if new.content is distinct from old.content then
        validation_errors := public.validate_service_product_content(schema_definition, new.content);
        if cardinality(validation_errors) > 0 then
          raise exception 'Event page content does not satisfy its schema.' using errcode = '22023', detail = array_to_string(validation_errors, E'\\n');
        end if;
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    select entity_kind into schema_kind from public.page_schemas where id = old.schema_id;
    if schema_kind = 'event' then
      raise exception 'An event page cannot be reclassified outside its aggregate service.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.sync_product_object(target_product_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  product public.mentorbooking_products%rowtype;
  product_page public.pages%rowtype;
  product_schema public.page_schemas%rowtype;
  has_product_page boolean := false;
  product_field_schema jsonb;
  product_custom_values jsonb;
  event_values jsonb := '[]'::jsonb;
  object_schema jsonb;
  object_data jsonb;
  object_is_public boolean := false;
  object_label text;
  object_share_slug text;
  event_record record;
  previous_sync_setting text := current_setting('specy.product_object_sync', true);
begin
  perform set_config('specy.product_object_sync', 'on', true);
  select * into product from public.mentorbooking_products where id = target_product_id;
  if not found then
    delete from public.objects where source_product_id = target_product_id;
    perform set_config('specy.product_object_sync', coalesce(previous_sync_setting, ''), true);
    return;
  end if;

  product_field_schema := coalesce(product.custom_field_schema, '{"product": {}, "event": {}}'::jsonb);
  product_custom_values := public.project_product_custom_fields(product_field_schema -> 'product', product.custom_fields);

  if product.product_page_id is not null then
    select * into product_page from public.pages
      where id = product.product_page_id and tenant_id = product.tenant_id;
    has_product_page := found;
  end if;
  if has_product_page then
    select * into product_schema from public.page_schemas where id = product_page.schema_id and tenant_id = product.tenant_id;
    object_is_public := found
      and product_page.status = 'published'
      and product.retired_at is null
      and product_schema.entity_kind = 'event'
      and product_schema.registration_status = 'registered';
  end if;

  for event_record in
    select e.id, e.date, e.time, e.end_time, e.duration_minutes, e.timezone, e.mode, e.custom_fields,
      p.name as page_name, p.slug as page_slug, p.content as page_content
    from public.mentorbooking_events e
    join public.pages p on p.id = e.page_id and p.tenant_id = e.tenant_id and p.status = 'published'
    join public.page_schemas s on s.id = p.schema_id and s.tenant_id = e.tenant_id
      and s.entity_kind = 'event' and s.registration_status = 'registered'
    where e.tenant_id = product.tenant_id
      and e.product_id = product.id
      and e.page_id is not null
      and e.timezone is not null
      and exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = e.timezone)
    order by e.date asc, e.time asc, e.id asc
  loop
    event_values := event_values || jsonb_build_array(jsonb_build_object(
      'id', event_record.id,
      'name', event_record.page_name,
      'slug', event_record.page_slug,
      'content', event_record.page_content,
      'date', event_record.date,
      'time', event_record.time,
      'end_time', event_record.end_time,
      'duration_minutes', event_record.duration_minutes,
      'timezone', event_record.timezone,
      'mode', event_record.mode,
      'custom_fields', public.project_product_custom_fields(product_field_schema -> 'event', event_record.custom_fields)
    ));
  end loop;

  object_schema := jsonb_build_object(
    'product', jsonb_build_object('type', 'object', 'required', true, 'properties', jsonb_build_object(
      'id', jsonb_build_object('type', 'string', 'required', true),
      'name', jsonb_build_object('type', 'string', 'required', true),
      'slug', jsonb_build_object('type', 'string'),
      'content', jsonb_build_object('type', 'object'),
      'description_de', jsonb_build_object('type', 'string'),
      'description_effort', jsonb_build_object('type', 'string'),
      'icon_name', jsonb_build_object('type', 'string'),
      'custom_fields', jsonb_build_object('type', 'object', 'properties', public.product_custom_object_schema(product_field_schema -> 'product'))
    )),
    'events', jsonb_build_object('type', 'array', 'items', jsonb_build_object('type', 'object', 'properties', jsonb_build_object(
      'id', jsonb_build_object('type', 'string'),
      'name', jsonb_build_object('type', 'string'),
      'slug', jsonb_build_object('type', 'string'),
      'content', jsonb_build_object('type', 'object'),
      'date', jsonb_build_object('type', 'date'),
      'time', jsonb_build_object('type', 'string'),
      'end_time', jsonb_build_object('type', 'string'),
      'duration_minutes', jsonb_build_object('type', 'number'),
      'timezone', jsonb_build_object('type', 'string'),
      'mode', jsonb_build_object('type', 'string'),
      'custom_fields', jsonb_build_object('type', 'object', 'properties', public.product_custom_object_schema(product_field_schema -> 'event'))
    )))
  );

  object_data := jsonb_build_object('product', jsonb_build_object(
    'id', product.integration_id,
    'name', product.name,
    'slug', product_page.slug,
    'content', coalesce(product_page.content, '{}'::jsonb),
    'description_de', product.description_de,
    'description_effort', product.description_effort,
    'icon_name', product.icon_name,
    'custom_fields', product_custom_values
  ), 'events', event_values);

  object_label := coalesce(product_page.name, product.name, 'Produkt');
  object_share_slug := case when product_page.slug is null then null
    else left('product-' || product_page.slug, 180) || '-' || left(replace(product.integration_id::text, '-', ''), 8) end;

  insert into public.objects (
    name, slug, description, agent_description, object_type, schema, data, status,
    requires_auth, api_enabled, share_enabled, share_slug, tenant_id, owner_user_id, source_product_id
  ) values (
    object_label,
    'product-' || product.integration_id::text,
    'Automatisch gepflegte Produktdaten',
    'Generiertes Produktobjekt mit veröffentlichten Veranstaltungen und freigegebenen Zusatzangaben.',
    'json', object_schema, object_data,
    case when product.retired_at is not null then 'archived' else 'published' end,
    false, object_is_public, object_is_public, case when object_is_public then object_share_slug else null end,
    product.tenant_id, product.owner_user_id, product.id
  )
  on conflict (source_product_id) where source_product_id is not null
  do update set
    name = excluded.name,
    description = excluded.description,
    agent_description = excluded.agent_description,
    object_type = excluded.object_type,
    schema = excluded.schema,
    data = excluded.data,
    status = excluded.status,
    requires_auth = excluded.requires_auth,
    api_enabled = excluded.api_enabled,
    share_enabled = excluded.share_enabled,
    share_slug = excluded.share_slug,
    tenant_id = excluded.tenant_id,
    owner_user_id = excluded.owner_user_id;
  perform set_config('specy.product_object_sync', coalesce(previous_sync_setting, ''), true);
end;
$$;

-- Re-asserted function permissions

revoke all on function public.create_service_product_aggregate(uuid, uuid, bigint, text, text, jsonb, uuid) from public;
grant execute on function public.create_service_product_aggregate(uuid, uuid, bigint, text, text, jsonb, uuid) to authenticated;
revoke all on function public.update_service_product_aggregate(uuid, uuid, bigint, bigint, text, text, jsonb) from public;
grant execute on function public.update_service_product_aggregate(uuid, uuid, bigint, bigint, text, text, jsonb) to authenticated;
revoke all on function public.publish_service_product_aggregate(uuid, uuid, bigint, bigint, text) from public;
grant execute on function public.publish_service_product_aggregate(uuid, uuid, bigint, bigint, text) to authenticated;
revoke all on function public.archive_service_product_aggregate(uuid, uuid, bigint) from public;
grant execute on function public.archive_service_product_aggregate(uuid, uuid, bigint) to authenticated;
revoke all on function public.update_service_product_aggregate_with_custom_fields(uuid, uuid, bigint, bigint, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.update_service_product_aggregate_with_custom_fields(uuid, uuid, bigint, bigint, text, text, jsonb, jsonb) to authenticated;
revoke all on function public.change_service_product_schema_aggregate(uuid, uuid, bigint, uuid, bigint) from public, anon;
grant execute on function public.change_service_product_schema_aggregate(uuid, uuid, bigint, uuid, bigint) to authenticated;
revoke all on function public.delete_mentorbooking_product_aggregate(integer, uuid) from public, anon;
grant execute on function public.delete_mentorbooking_product_aggregate(integer, uuid) to authenticated;
revoke all on function public.validate_service_product_page_owner() from public;
grant execute on function public.validate_service_product_page_owner() to authenticated;
revoke all on function public.enforce_event_page_link() from public, anon;
grant execute on function public.enforce_event_page_link() to authenticated;
revoke all on function public.guard_event_page_mutation() from public, anon;
grant execute on function public.guard_event_page_mutation() to authenticated;
revoke all on function public.sync_product_object(integer) from public, anon, authenticated;
revoke all on function public.update_product_object_api_access(uuid, uuid, boolean, boolean) from public, anon;
grant execute on function public.update_product_object_api_access(uuid, uuid, boolean, boolean) to authenticated;

