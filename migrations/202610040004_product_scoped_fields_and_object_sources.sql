-- Product-owned Product/Event field definitions and an internal Object source
-- marker. Existing workspace definitions remain intact for explicit migration;
-- they are not copied to every Product automatically.

create or replace function public.is_valid_product_custom_field_schema(target_schema jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  namespace record;
  field record;
  definition jsonb;
begin
  if jsonb_typeof(target_schema) is distinct from 'object'
    or jsonb_typeof(target_schema -> 'product') is distinct from 'object'
    or jsonb_typeof(target_schema -> 'event') is distinct from 'object'
    or octet_length(target_schema::text) > 262144 then
    return false;
  end if;

  for namespace in select key, value from jsonb_each(target_schema) loop
    if namespace.key not in ('product', 'event') or jsonb_typeof(namespace.value) is distinct from 'object' then
      return false;
    end if;
    for field in select key, value from jsonb_each(namespace.value) loop
      definition := field.value;
      if field.key !~ '^[a-z][a-z0-9_]{0,63}$'
        or jsonb_typeof(definition) is distinct from 'object'
        or jsonb_typeof(definition -> 'label') is distinct from 'string'
        or length(btrim(definition ->> 'label')) = 0
        or length(definition ->> 'label') > 120
        or jsonb_typeof(definition -> 'type') is distinct from 'string'
        or definition ->> 'type' not in ('string', 'number', 'boolean', 'date', 'url', 'email', 'json', 'price') then
        return false;
      end if;
      if definition ? 'description' and jsonb_typeof(definition -> 'description') is distinct from 'string' then return false; end if;
      if definition ? 'required' and jsonb_typeof(definition -> 'required') is distinct from 'boolean' then return false; end if;
      if definition ? 'is_public' and jsonb_typeof(definition -> 'is_public') is distinct from 'boolean' then return false; end if;
    end loop;
  end loop;
  return true;
end;
$$;

alter table public.mentorbooking_products
  add column if not exists custom_field_schema jsonb not null
  default '{"product": {}, "event": {}}'::jsonb;

alter table public.mentorbooking_products
  drop constraint if exists mentorbooking_products_custom_field_schema_check;
alter table public.mentorbooking_products
  add constraint mentorbooking_products_custom_field_schema_check
  check (public.is_valid_product_custom_field_schema(custom_field_schema));

create or replace function public.product_custom_field_value_errors(
  target_definitions jsonb,
  target_values jsonb,
  enforce_required boolean default true
)
returns text[]
language plpgsql
immutable
set search_path = public
as $$
declare
  field record;
  definition jsonb;
  field_value jsonb;
  field_type text;
  errors text[] := array[]::text[];
begin
  if jsonb_typeof(target_definitions) is distinct from 'object'
    or jsonb_typeof(target_values) is distinct from 'object' then
    return array['Custom field values and definitions must be JSON objects.'];
  end if;
  for field in select key, value from jsonb_each(target_definitions) loop
    definition := field.value;
    field_type := definition ->> 'type';
    if not target_values ? field.key or target_values -> field.key = 'null'::jsonb or target_values -> field.key = '""'::jsonb then
      if enforce_required and definition ->> 'required' = 'true' then
        errors := array_append(errors, coalesce(definition ->> 'label', field.key) || ' is required.');
      end if;
      continue;
    end if;
    field_value := target_values -> field.key;
    if field_type in ('string', 'date', 'url', 'email') and jsonb_typeof(field_value) is distinct from 'string'
      or field_type = 'number' and jsonb_typeof(field_value) is distinct from 'number'
      or field_type = 'boolean' and jsonb_typeof(field_value) is distinct from 'boolean'
      or field_type = 'price' and (
        jsonb_typeof(field_value) is distinct from 'object'
        or jsonb_typeof(field_value -> 'amount') is distinct from 'string'
        or field_value ->> 'amount' !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'
        or jsonb_typeof(field_value -> 'currency') is distinct from 'string'
        or field_value ->> 'currency' !~ '^[A-Z]{3}$'
      ) then
      errors := array_append(errors, coalesce(definition ->> 'label', field.key) || ' has an invalid value.');
    end if;
  end loop;
  return errors;
end;
$$;

create or replace function public.validate_product_custom_field_values_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  field_definitions jsonb;
  validation_errors text[];
  should_enforce_required boolean;
begin
  if tg_op = 'UPDATE' then
    if new.custom_fields is not distinct from old.custom_fields then return new; end if;
  end if;
  field_definitions := coalesce(new.custom_field_schema -> 'product', '{}'::jsonb);
  should_enforce_required := true;
  validation_errors := public.product_custom_field_value_errors(field_definitions, new.custom_fields, should_enforce_required);
  if cardinality(validation_errors) > 0 then
    raise exception 'Product custom values do not satisfy their definitions.' using errcode = '22023', detail = array_to_string(validation_errors, E'\n');
  end if;
  return new;
end;
$$;

drop trigger if exists validate_product_custom_field_values on public.mentorbooking_products;
create trigger validate_product_custom_field_values
  before insert or update of custom_fields, custom_field_schema on public.mentorbooking_products
  for each row execute function public.validate_product_custom_field_values_trigger();

create or replace function public.validate_event_custom_field_values_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  field_definitions jsonb;
  validation_errors text[];
  product_schema jsonb;
begin
  if new.product_id is null or new.tenant_id is null then return new; end if;
  select custom_field_schema into product_schema
    from public.mentorbooking_products
    where id = new.product_id and tenant_id = new.tenant_id;
  if not found then return new; end if;
  field_definitions := coalesce(product_schema -> 'event', '{}'::jsonb);
  validation_errors := public.product_custom_field_value_errors(
    field_definitions,
    new.custom_fields,
    coalesce(current_setting('specy.event_custom_field_defer_required', true), '') <> 'on'
  );
  if cardinality(validation_errors) > 0 then
    raise exception 'Event custom values do not satisfy the selected Product definitions.' using errcode = '22023', detail = array_to_string(validation_errors, E'\n');
  end if;
  return new;
end;
$$;

drop trigger if exists validate_event_custom_field_values on public.mentorbooking_events;
create trigger validate_event_custom_field_values
  before insert or update of custom_fields, product_id, tenant_id on public.mentorbooking_events
  for each row execute function public.validate_event_custom_field_values_trigger();

-- Event-page aggregate creation inserts the base Event before writing its
-- custom_fields wrapper value. Defer required-value checks for that one insert,
-- then validate the complete custom_fields payload on the following UPDATE.
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
  previous_defer_setting text := current_setting('specy.event_custom_field_defer_required', true);
begin
  if jsonb_typeof(target_event_custom_fields) is distinct from 'object'
    or octet_length(target_event_custom_fields::text) > 1048576 then
    raise exception 'Event custom_fields must be an object no larger than 1 MiB.' using errcode = '22023';
  end if;

  perform set_config('specy.event_custom_field_defer_required', 'on', true);
  result := public.create_event_page_aggregate(
    target_tenant_id,
    target_schema_id,
    expected_definition_revision,
    target_event,
    target_page_name,
    target_page_slug,
    target_page_content
  );
  perform set_config('specy.event_custom_field_defer_required', coalesce(previous_defer_setting, ''), true);

  created_event_id := (result ->> 'event_id')::uuid;
  update public.mentorbooking_events
    set custom_fields = target_event_custom_fields
    where id = created_event_id and tenant_id = target_tenant_id;
  if not found then raise exception 'Created event was not found in its workspace.' using errcode = 'P0002'; end if;
  return result;
end;
$$;

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
  custom_fields,
  custom_field_schema
from public.mentorbooking_products;
grant select on public.service_products to authenticated;
grant select on public.service_products to service_role;

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
    'custom_field_schema', product.custom_field_schema,
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

alter table public.objects
  add column if not exists source_product_id integer null
  references public.mentorbooking_products(id) on update cascade on delete cascade;

create unique index if not exists idx_objects_source_product_unique
  on public.objects (source_product_id)
  where source_product_id is not null;

-- The source key is an internal join detail. Revoke broad PostgREST table
-- grants, then restore the existing Object contract column-by-column without
-- granting the new source_product_id column to anonymous/authenticated roles.
revoke all on table public.objects from public, anon, authenticated;
revoke select (source_product_id) on table public.objects from public, anon, authenticated;
grant select (
  id, name, slug, description, schema, data, status, requires_auth, api_enabled,
  created_at, updated_at, agent_description, object_type, share_enabled, share_slug
) on table public.objects to anon;
grant select (
  id, name, slug, description, schema, data, status, requires_auth, api_enabled,
  created_at, updated_at, agent_description, object_type, share_enabled, share_slug,
  owner_user_id, tenant_id
) on table public.objects to authenticated;
grant insert (
  id, name, slug, description, schema, data, status, requires_auth, api_enabled,
  created_at, updated_at, agent_description, object_type, share_enabled, share_slug,
  owner_user_id, tenant_id
) on table public.objects to authenticated;
grant update (
  name, slug, description, schema, data, status, requires_auth, api_enabled,
  updated_at, agent_description, object_type, share_enabled, share_slug,
  owner_user_id, tenant_id
) on table public.objects to authenticated;
grant delete on table public.objects to authenticated;
grant select, insert, update, delete on table public.objects to service_role;

create or replace function public.guard_product_managed_object()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sync_enabled boolean := coalesce(current_setting('specy.product_object_sync', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.source_product_id is not null and not sync_enabled then
      raise exception 'Product-managed Objects can only be created by the Product synchronizer.' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if (old.source_product_id is not null or new.source_product_id is not null) and not sync_enabled then
      raise exception 'Product-managed Objects are read-only.' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.source_product_id is not null and not sync_enabled and pg_trigger_depth() <= 1 then
      raise exception 'Product-managed Objects can only be removed with their Product.' using errcode = '42501';
    end if;
    return old;
  end if;

  return null;
end;
$$;

revoke all on function public.guard_product_managed_object() from public, anon, authenticated;
drop trigger if exists guard_product_managed_object on public.objects;
create trigger guard_product_managed_object
  before insert or update or delete on public.objects
  for each row execute function public.guard_product_managed_object();

comment on column public.objects.source_product_id is
  'Internal source relation for generated Product Objects. Never expose in API or MCP DTOs.';

revoke all on function public.is_valid_product_custom_field_schema(jsonb) from public, anon;
revoke all on function public.product_custom_field_value_errors(jsonb, jsonb, boolean) from public, anon;
revoke all on function public.validate_product_custom_field_values_trigger() from public, anon, authenticated;
revoke all on function public.validate_event_custom_field_values_trigger() from public, anon, authenticated;
grant execute on function public.is_valid_product_custom_field_schema(jsonb) to authenticated, service_role;
