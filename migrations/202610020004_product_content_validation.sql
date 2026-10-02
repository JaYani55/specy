-- Database-side recursive validation closes the direct-RPC bypass. The REST
-- validator provides field-path responses; these invoker functions are the
-- authoritative guard for writes/publishing through Supabase RPC.

create or replace function public.scan_service_product_json(value jsonb, path text default '$', depth integer default 0)
returns text[]
language plpgsql
immutable
set search_path = public
as $$
declare
  errors text[] := '{}'::text[];
  entry record;
  child_errors text[];
  index_value integer := 0;
begin
  if depth > 32 then
    return array[path || ' exceeds maximum JSON depth (32).'];
  end if;
  if jsonb_typeof(value) = 'object' then
    for entry in select key, val from jsonb_each(value) as object_entries(key, val) loop
      if entry.key in ('__proto__', 'prototype', 'constructor') then
        errors := array_append(errors, path || ' contains an unsafe key.');
      end if;
      child_errors := public.scan_service_product_json(entry.val, path || '.' || entry.key, depth + 1);
      errors := errors || child_errors;
      if cardinality(errors) >= 100 then return errors[1:100]; end if;
    end loop;
  elsif jsonb_typeof(value) = 'array' then
    if jsonb_array_length(value) > 1000 then
      return array[path || ' exceeds the 1000 item limit.'];
    end if;
    for entry in select element from jsonb_array_elements(value) as array_entries(element) loop
      child_errors := public.scan_service_product_json(entry.element, path || '[' || index_value || ']', depth + 1);
      errors := errors || child_errors;
      index_value := index_value + 1;
      if cardinality(errors) >= 100 then return errors[1:100]; end if;
    end loop;
  end if;
  return errors;
end;
$$;

create or replace function public.validate_service_product_field(
  definition jsonb,
  value jsonb,
  field_path text,
  depth integer default 0
)
returns text[]
language plpgsql
immutable
set search_path = public
as $$
declare
  errors text[] := '{}'::text[];
  child_errors text[];
  property record;
  item jsonb;
  item_index integer := 0;
  field_type text;
  string_value text;
  number_value numeric;
begin
  if depth > 32 then return array[field_path || ' exceeds maximum schema depth (32).']; end if;
  if jsonb_typeof(definition) <> 'object' then return array[field_path || ' has an invalid field definition.']; end if;
  if jsonb_typeof(value) = 'null' then
    if coalesce((definition ->> 'nullable')::boolean, false) then return errors; end if;
    return array[field_path || ' does not allow null.'];
  end if;

  field_type := definition ->> 'type';
  case field_type
    when 'string' then
      if jsonb_typeof(value) <> 'string' then return array[field_path || ' must be a string.']; end if;
      string_value := value #>> '{}';
      if jsonb_typeof(definition -> 'enum') = 'array' and not ((definition -> 'enum') @> jsonb_build_array(string_value)) then
        errors := array_append(errors, field_path || ' is not an allowed enum value.');
      end if;
      if definition ? 'minLength' and char_length(string_value) < (definition ->> 'minLength')::integer then
        errors := array_append(errors, field_path || ' is shorter than minLength.');
      end if;
      if definition ? 'maxLength' and char_length(string_value) > (definition ->> 'maxLength')::integer then
        errors := array_append(errors, field_path || ' exceeds maxLength.');
      end if;
    when 'media' then
      if jsonb_typeof(value) not in ('string', 'object') then errors := array_append(errors, field_path || ' must be a media reference string or object.'); end if;
    when 'number' then
      if jsonb_typeof(value) <> 'number' then return array[field_path || ' must be a number.']; end if;
      number_value := (value #>> '{}')::numeric;
      if definition ? 'minimum' and number_value < (definition ->> 'minimum')::numeric then errors := array_append(errors, field_path || ' is below minimum.'); end if;
      if definition ? 'maximum' and number_value > (definition ->> 'maximum')::numeric then errors := array_append(errors, field_path || ' exceeds maximum.'); end if;
    when 'boolean' then
      if jsonb_typeof(value) <> 'boolean' then errors := array_append(errors, field_path || ' must be a boolean.'); end if;
    when 'object' then
      if jsonb_typeof(value) <> 'object' then return array[field_path || ' must be an object.']; end if;
      if jsonb_typeof(definition -> 'properties') = 'object' then
        for property in select key, val from jsonb_each(definition -> 'properties') as properties(key, val) loop
          if property.key in ('__proto__', 'prototype', 'constructor') then
            errors := array_append(errors, field_path || ' schema contains an unsafe key.');
          elsif not (value ? property.key) then
            if coalesce((property.val ->> 'required')::boolean, false) then errors := array_append(errors, field_path || '.' || property.key || ' is required.'); end if;
          else
            child_errors := public.validate_service_product_field(property.val, value -> property.key, field_path || '.' || property.key, depth + 1);
            errors := errors || child_errors;
          end if;
          if cardinality(errors) >= 100 then return errors[1:100]; end if;
        end loop;
      end if;
    when 'array', 'ContentBlock[]', 'CodeBlock[]' then
      if jsonb_typeof(value) <> 'array' then return array[field_path || ' must be an array.']; end if;
      if jsonb_array_length(value) > 1000 then return array[field_path || ' exceeds the 1000 item limit.']; end if;
      if definition ? 'minItems' and jsonb_array_length(value) < (definition ->> 'minItems')::integer then errors := array_append(errors, field_path || ' has fewer items than minItems.'); end if;
      if definition ? 'maxItems' and jsonb_array_length(value) > (definition ->> 'maxItems')::integer then errors := array_append(errors, field_path || ' exceeds maxItems.'); end if;
      for item in select element from jsonb_array_elements(value) as array_entries(element) loop
        if field_type = 'ContentBlock[]' then
          if jsonb_typeof(item) <> 'object' or jsonb_typeof(item -> 'type') <> 'string' then errors := array_append(errors, field_path || '[' || item_index || '] must be an object with a block type.'); end if;
        elsif definition ? 'items' then
          child_errors := public.validate_service_product_field(definition -> 'items', item, field_path || '[' || item_index || ']', depth + 1);
          errors := errors || child_errors;
        end if;
        item_index := item_index + 1;
        if cardinality(errors) >= 100 then return errors[1:100]; end if;
      end loop;
    else
      errors := array_append(errors, field_path || ' uses unsupported schema type ' || coalesce(field_type, '(missing)') || '.');
  end case;
  return errors;
end;
$$;

create or replace function public.validate_service_product_content(schema_definition jsonb, content_value jsonb)
returns text[]
language plpgsql
immutable
set search_path = public
as $$
declare
  errors text[] := '{}'::text[];
  field record;
  child_errors text[];
begin
  if jsonb_typeof(schema_definition) <> 'object' then return array['Schema definition must be a JSON object.']; end if;
  if jsonb_typeof(content_value) <> 'object' then return array['Content must be a JSON object.']; end if;
  errors := public.scan_service_product_json(content_value);
  for field in select key, val from jsonb_each(schema_definition) as schema_fields(key, val) loop
    if field.key in ('__proto__', 'prototype', 'constructor') then
      errors := array_append(errors, 'Schema includes an unsafe field key.');
    elsif not (content_value ? field.key) then
      if coalesce((field.val ->> 'required')::boolean, false) then errors := array_append(errors, field.key || ' is required.'); end if;
    else
      child_errors := public.validate_service_product_field(field.val, content_value -> field.key, field.key, 0);
      errors := errors || child_errors;
    end if;
    if cardinality(errors) >= 100 then return errors[1:100]; end if;
  end loop;
  return errors;
end;
$$;

create or replace function public.guard_service_product_page_update()
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
  if tg_op = 'UPDATE' then
    select entity_kind into schema_kind from public.page_schemas where id = old.schema_id;
    if schema_kind = 'service-product'
      and (new.schema_id is distinct from old.schema_id or new.tenant_id is distinct from old.tenant_id) then
      raise exception 'A product page cannot be moved to another schema or workspace.' using errcode = '23514';
    end if;
  end if;

  select entity_kind, tenant_id, schema into schema_kind, schema_tenant_id, schema_definition
    from public.page_schemas where id = new.schema_id for share;
  if schema_kind = 'service-product' then
    if schema_tenant_id is distinct from new.tenant_id then
      raise exception 'Product page and schema must belong to the same workspace.' using errcode = '23514';
    end if;
    validation_errors := public.validate_service_product_content(schema_definition, new.content);
    if cardinality(validation_errors) > 0 then
      raise exception 'Product content does not satisfy its schema.' using errcode = '22023', detail = array_to_string(validation_errors, E'\n');
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
  then
    update public.mentorbooking_products
      set version = version + 1
      where product_page_id = new.id and tenant_id = new.tenant_id;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_service_product_page_update on public.pages;
create trigger guard_service_product_page_update
  before update on public.pages
  for each row
  execute function public.guard_service_product_page_update();

drop trigger if exists bump_product_version_after_page_update on public.pages;
create trigger bump_product_version_after_page_update
  after update on public.pages
  for each row
  execute function public.bump_product_version_after_page_update();

-- Replace the update RPC with the database-side validation guard. This also
-- protects direct authenticated RPC invocation, not only the REST adapter.
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
    where id = page_schema_id and tenant_id = expected_tenant_id and entity_kind = 'service-product' for share;
  if not found then raise exception 'Linked product schema not found.' using errcode = '23514'; end if;
  if current_definition_revision is distinct from expected_definition_revision then raise exception 'Schema definition revision conflict.' using errcode = '40001'; end if;

  validation_errors := public.validate_service_product_content(schema_definition, target_content);
  if cardinality(validation_errors) > 0 then
    raise exception 'Product content does not satisfy its schema.' using errcode = '22023', detail = array_to_string(validation_errors, E'\n');
  end if;

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
    where id = page_schema_id and tenant_id = expected_tenant_id and entity_kind = 'service-product' for share;
  if not found then raise exception 'Product schema not found.' using errcode = '23514'; end if;
  if current_definition_revision is distinct from expected_definition_revision then raise exception 'Schema definition revision conflict.' using errcode = '40001'; end if;
  validation_errors := public.validate_service_product_content(schema_definition, page_content);
  if cardinality(validation_errors) > 0 then
    raise exception 'Product cannot be published until content satisfies its schema.' using errcode = '22023', detail = array_to_string(validation_errors, E'\n');
  end if;

  update public.pages set status = target_status where id = product.product_page_id and tenant_id = expected_tenant_id;
  if not found then raise exception 'Product page not found.' using errcode = '23514'; end if;
  update public.mentorbooking_products set version = version + 1 where id = product.id and tenant_id = expected_tenant_id;
  return public.service_product_aggregate_json(target_product_id, expected_tenant_id);
end;
$$;

revoke all on function public.scan_service_product_json(jsonb, text, integer) from public;
revoke all on function public.validate_service_product_field(jsonb, jsonb, text, integer) from public;
revoke all on function public.validate_service_product_content(jsonb, jsonb) from public;
grant execute on function public.scan_service_product_json(jsonb, text, integer) to authenticated;
grant execute on function public.validate_service_product_field(jsonb, jsonb, text, integer) to authenticated;
grant execute on function public.validate_service_product_content(jsonb, jsonb) to authenticated;
