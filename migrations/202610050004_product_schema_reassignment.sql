-- Permit an existing service Product's canonical Page to move between
-- eligible Product schemas through one tenant/version/revision-checked RPC.
-- Page content and identity are preserved; published pages become drafts so
-- the PageBuilder can reconcile them with the newly selected schema.

create or replace function public.guard_service_product_page_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  old_schema_kind text;
  schema_kind text;
  schema_tenant_id uuid;
  schema_definition jsonb;
  validation_errors text[];
  controlled_reassignment boolean := coalesce(current_setting('specy.product_schema_reassignment', true), '') = 'on';
  is_schema_reassignment boolean := false;
begin
  if tg_op = 'UPDATE' then
    is_schema_reassignment := new.schema_id is distinct from old.schema_id;
    select entity_kind into old_schema_kind from public.page_schemas where id = old.schema_id;
    if old_schema_kind = 'service-product' and is_schema_reassignment then
      if not controlled_reassignment then
        raise exception 'A product page can only change Product schemas through the Product aggregate service.' using errcode = '23514';
      end if;
      if new.tenant_id is distinct from old.tenant_id then
        raise exception 'A Product page cannot be moved to another workspace.' using errcode = '23514';
      end if;
    end if;
  end if;

  select entity_kind, tenant_id, schema
    into schema_kind, schema_tenant_id, schema_definition
    from public.page_schemas
    where id = new.schema_id
    for share;

  if old_schema_kind = 'service-product' and is_schema_reassignment
    and schema_kind is distinct from 'service-product' then
    raise exception 'A Product page can only be reassigned to another Product schema.' using errcode = '23514';
  end if;

  if schema_kind = 'service-product' then
    if schema_tenant_id is distinct from new.tenant_id then
      raise exception 'Product page and schema must belong to the same workspace.' using errcode = '23514';
    end if;
    if not (controlled_reassignment and is_schema_reassignment and old_schema_kind = 'service-product') then
      validation_errors := public.validate_service_product_content(schema_definition, new.content);
      if cardinality(validation_errors) > 0 then
        raise exception 'Product content does not satisfy its schema.' using errcode = '22023', detail = array_to_string(validation_errors, E'\n');
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.bump_product_version_after_page_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    update public.mentorbooking_products
      set name = new.name, description_de = new.name, version = version + 1
      where product_page_id = new.id and tenant_id = new.tenant_id;
  elsif new.content is distinct from old.content
    or new.slug is distinct from old.slug
    or new.status is distinct from old.status
    or new.schema_id is distinct from old.schema_id
  then
    update public.mentorbooking_products
      set version = version + 1
      where product_page_id = new.id and tenant_id = new.tenant_id;
  end if;
  return new;
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
  if target_schema_kind is distinct from 'service-product' or target_content_scope is distinct from 'page-collection' then
    raise exception 'Target schema is not an eligible Product page collection.' using errcode = '23514';
  end if;
  if current_definition_revision is distinct from expected_definition_revision then
    raise exception 'Target schema definition revision conflict.' using errcode = '40001';
  end if;

  perform set_config('specy.product_schema_reassignment', 'on', true);
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
