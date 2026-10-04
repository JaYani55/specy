-- Keep legacy "string[]" schema definitions working through the same
-- schema-driven content validator used by service products and event pages.

create or replace function public.normalize_legacy_schema_field_definition(definition jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  normalized jsonb := definition;
  field_type text;
  properties jsonb;
  property record;
  normalized_items jsonb;
begin
  if jsonb_typeof(definition) <> 'object' then return definition; end if;

  field_type := definition ->> 'type';
  if field_type = 'string[]' then
    normalized := jsonb_set(normalized, '{type}', '"array"'::jsonb, true);
    normalized := jsonb_set(normalized, '{items}', '{"type":"string"}'::jsonb, true);
  end if;

  if jsonb_typeof(definition -> 'properties') = 'object' then
    properties := '{}'::jsonb;
    for property in select key, val from jsonb_each(definition -> 'properties') as entries(key, val) loop
      properties := properties || jsonb_build_object(property.key, public.normalize_legacy_schema_field_definition(property.val));
    end loop;
    normalized := jsonb_set(normalized, '{properties}', properties, true);
  end if;

  if jsonb_typeof(definition -> 'items') = 'object' then
    normalized_items := public.normalize_legacy_schema_field_definition(definition -> 'items');
    normalized := jsonb_set(normalized, '{items}', normalized_items, true);
  end if;

  return normalized;
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
  normalized_schema jsonb := '{}'::jsonb;
  field record;
  child_errors text[];
begin
  if jsonb_typeof(schema_definition) <> 'object' then return array['Schema definition must be a JSON object.']; end if;
  if jsonb_typeof(content_value) <> 'object' then return array['Content must be a JSON object.']; end if;

  for field in select key, val from jsonb_each(schema_definition) as schema_fields(key, val) loop
    normalized_schema := normalized_schema || jsonb_build_object(
      field.key,
      public.normalize_legacy_schema_field_definition(field.val)
    );
  end loop;

  errors := public.scan_service_product_json(content_value);
  for field in select key, val from jsonb_each(normalized_schema) as schema_fields(key, val) loop
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

revoke all on function public.normalize_legacy_schema_field_definition(jsonb) from public;
revoke all on function public.validate_service_product_content(jsonb, jsonb) from public;
grant execute on function public.normalize_legacy_schema_field_definition(jsonb) to authenticated;
grant execute on function public.validate_service_product_content(jsonb, jsonb) to authenticated;
