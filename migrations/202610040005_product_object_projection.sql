-- Synchronously maintain one generated public Object read model per service Product.
-- Product/Event/Page rows remain the only write/source model.

create or replace function public.project_product_custom_fields(definitions jsonb, target_values jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  field record;
  field_type text;
  field_value jsonb;
  result jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(definitions) is distinct from 'object' or jsonb_typeof(target_values) is distinct from 'object' then
    return result;
  end if;
  for field in select key, value from jsonb_each(definitions) loop
    if field.key !~ '^[a-z][a-z0-9_]{0,63}$'
      or field.key in ('__proto__', 'prototype', 'constructor')
      or jsonb_typeof(field.value) is distinct from 'object'
      or field.value ->> 'is_public' is distinct from 'true'
      or not (target_values ? field.key) then
      continue;
    end if;
    field_type := field.value ->> 'type';
    field_value := target_values -> field.key;
    if (field_type in ('string', 'date', 'url', 'email') and jsonb_typeof(field_value) is distinct from 'string')
      or (field_type = 'number' and jsonb_typeof(field_value) is distinct from 'number')
      or (field_type = 'boolean' and jsonb_typeof(field_value) is distinct from 'boolean')
      or (field_type = 'price' and (
        jsonb_typeof(field_value) is distinct from 'object'
        or jsonb_typeof(field_value -> 'amount') is distinct from 'string'
        or field_value ->> 'amount' !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$'
        or jsonb_typeof(field_value -> 'currency') is distinct from 'string'
        or field_value ->> 'currency' !~ '^[A-Z]{3}$'
      )) then
      continue;
    end if;
    result := result || jsonb_build_object(field.key, field_value);
  end loop;
  return result;
end;
$$;

create or replace function public.product_custom_object_schema(definitions jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  field record;
  definition jsonb;
  result jsonb := '{}'::jsonb;
  field_type text;
  property_schema jsonb;
begin
  if jsonb_typeof(definitions) is distinct from 'object' then return result; end if;
  for field in select key, value from jsonb_each(definitions) loop
    definition := field.value;
    field_type := definition ->> 'type';
    if field.key !~ '^[a-z][a-z0-9_]{0,63}$'
      or jsonb_typeof(definition) is distinct from 'object'
      or definition ->> 'is_public' is distinct from 'true' then continue; end if;
    if field_type = 'price' then
      property_schema := jsonb_build_object('type', 'object', 'description', coalesce(definition ->> 'description', definition ->> 'label'), 'properties', jsonb_build_object(
        'amount', jsonb_build_object('type', 'string', 'description', 'Decimal amount'),
        'currency', jsonb_build_object('type', 'string', 'description', 'ISO 4217 currency code')
      ));
    else
      property_schema := jsonb_build_object(
        'type', case when field_type in ('string','number','boolean','date','url','email','json') then field_type else 'json' end,
        'description', coalesce(definition ->> 'description', definition ->> 'label')
      );
    end if;
    if definition ->> 'required' = 'true' then property_schema := property_schema || jsonb_build_object('required', true); end if;
    result := result || jsonb_build_object(field.key, property_schema);
  end loop;
  return result;
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
      and product_schema.entity_kind = 'service-product'
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

create or replace function public.sync_product_object_from_product_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_product_object(old.id);
    return old;
  end if;
  perform public.sync_product_object(new.id);
  if tg_op = 'UPDATE' and old.id is distinct from new.id then perform public.sync_product_object(old.id); end if;
  return new;
end;
$$;

drop trigger if exists sync_product_object_from_product on public.mentorbooking_products;
create trigger sync_product_object_from_product
  after insert or update or delete on public.mentorbooking_products
  for each row execute function public.sync_product_object_from_product_trigger();

create or replace function public.sync_product_object_from_event_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.product_id is not null then perform public.sync_product_object(old.product_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and new.product_id is not null
    and (tg_op = 'INSERT' or old.product_id is distinct from new.product_id or old.tenant_id is distinct from new.tenant_id) then
    perform public.sync_product_object(new.product_id);
  elsif tg_op = 'UPDATE' and new.product_id is not null then
    perform public.sync_product_object(new.product_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists sync_product_object_from_event on public.mentorbooking_events;
create trigger sync_product_object_from_event
  after insert or update or delete on public.mentorbooking_events
  for each row execute function public.sync_product_object_from_event_trigger();

create or replace function public.sync_product_object_from_page_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_page_id uuid;
  linked_product_id integer;
  linked_event_product_id integer;
begin
  target_page_id := case when tg_op = 'DELETE' then old.id else new.id end;
  select id into linked_product_id from public.mentorbooking_products where product_page_id = target_page_id;
  if linked_product_id is not null then perform public.sync_product_object(linked_product_id); end if;
  select product_id into linked_event_product_id from public.mentorbooking_events where page_id = target_page_id;
  if linked_event_product_id is not null and linked_event_product_id is distinct from linked_product_id then
    perform public.sync_product_object(linked_event_product_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists sync_product_object_from_page on public.pages;
create trigger sync_product_object_from_page
  after insert or update or delete on public.pages
  for each row execute function public.sync_product_object_from_page_trigger();

create or replace function public.sync_product_objects_for_schema_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_product record;
begin
  for affected_product in
    select affected.id from (
      select p.id
      from public.mentorbooking_products p
      join public.pages page on page.id = p.product_page_id
      where page.schema_id = case when tg_op = 'DELETE' then old.id else new.id end
      union
      select p.id
      from public.mentorbooking_products p
      join public.mentorbooking_events e on e.product_id = p.id and e.tenant_id = p.tenant_id
      join public.pages event_page on event_page.id = e.page_id
      where event_page.schema_id = case when tg_op = 'DELETE' then old.id else new.id end
    ) affected
  loop
    perform public.sync_product_object(affected_product.id);
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists sync_product_objects_for_schema on public.page_schemas;
create trigger sync_product_objects_for_schema
  after update of registration_status, entity_kind, tenant_id or delete on public.page_schemas
  for each row execute function public.sync_product_objects_for_schema_trigger();

revoke all on function public.project_product_custom_fields(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.product_custom_object_schema(jsonb) from public, anon, authenticated;
revoke all on function public.sync_product_object(integer) from public, anon, authenticated;
revoke all on function public.sync_product_object_from_product_trigger() from public, anon, authenticated;
revoke all on function public.sync_product_object_from_event_trigger() from public, anon, authenticated;
revoke all on function public.sync_product_object_from_page_trigger() from public, anon, authenticated;
revoke all on function public.sync_product_objects_for_schema_trigger() from public, anon, authenticated;
grant execute on function public.project_product_custom_fields(jsonb, jsonb) to service_role;
grant execute on function public.product_custom_object_schema(jsonb) to service_role;

-- Backfill is deterministic/idempotent; it creates no public exposure unless
-- the canonical Product page and schema are already published and registered.
do $$
declare
  product_record record;
begin
  for product_record in select id from public.mentorbooking_products order by id loop
    perform public.sync_product_object(product_record.id);
  end loop;
end;
$$;
