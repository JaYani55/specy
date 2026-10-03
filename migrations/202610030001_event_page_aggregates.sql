-- Optional public event pages are event-owned pages in a tenant event schema.
-- Existing operational events remain valid without a page; no legacy rows are
-- backfilled or assigned a timezone by this migration.

alter table public.mentorbooking_events
  add column if not exists page_id uuid null,
  add column if not exists timezone text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mentorbooking_events_page_id_fkey'
  ) then
    alter table public.mentorbooking_events
      add constraint mentorbooking_events_page_id_fkey
      foreign key (page_id) references public.pages(id) on delete restrict;
  end if;
end;
$$;

create unique index if not exists mentorbooking_events_page_id_key
  on public.mentorbooking_events (page_id)
  where page_id is not null;
create index if not exists idx_mentorbooking_events_tenant_page
  on public.mentorbooking_events (tenant_id, page_id)
  where page_id is not null;

create or replace function public.validate_event_product_tenant()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  product_tenant_id uuid;
begin
  if new.product_id is null then return new; end if;
  select tenant_id into product_tenant_id
    from public.mentorbooking_products
    where id = new.product_id
    for key share;
  if not found or product_tenant_id is distinct from new.tenant_id then
    raise exception 'Selected product does not belong to the event workspace.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_event_product_tenant on public.mentorbooking_events;
create trigger validate_event_product_tenant
  before insert or update of product_id, tenant_id on public.mentorbooking_events
  for each row execute function public.validate_event_product_tenant();

create or replace function public.validate_event_company_tenant()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  company_tenant_id uuid;
begin
  if new.company_id is null then return new; end if;
  select tenant_id into company_tenant_id from public.companies where id = new.company_id for key share;
  if not found or company_tenant_id is distinct from new.tenant_id then
    raise exception 'Selected company does not belong to the event workspace.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_event_company_tenant on public.mentorbooking_events;
create trigger validate_event_company_tenant
  before insert or update of company_id, tenant_id on public.mentorbooking_events
  for each row execute function public.validate_event_company_tenant();

create or replace function public.validate_event_page_link()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  linked_page_tenant_id uuid;
  linked_schema_id uuid;
  linked_entity_kind text;
  linked_content_scope text;
begin
  if new.page_id is null then return new; end if;
  select tenant_id, schema_id into linked_page_tenant_id, linked_schema_id
    from public.pages where id = new.page_id for key share;
  if not found or linked_page_tenant_id is distinct from new.tenant_id then
    raise exception 'Event and public page must belong to the same workspace.' using errcode = '23514';
  end if;
  select entity_kind, content_scope into linked_entity_kind, linked_content_scope
    from public.page_schemas where id = linked_schema_id for key share;
  if not found or linked_entity_kind is distinct from 'event' or linked_content_scope is distinct from 'page-collection' then
    raise exception 'Event pages must use an event page-collection schema.' using errcode = '23514';
  end if;
  if new.timezone is null then
    raise exception 'A public event page requires an IANA timezone.' using errcode = '22023';
  end if;
  if exists (select 1 from public.mentorbooking_products where product_page_id = new.page_id) then
    raise exception 'A page cannot be owned by both an event and a product.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_event_page_link on public.mentorbooking_events;
create trigger validate_event_page_link
  before insert or update of page_id, tenant_id, timezone on public.mentorbooking_events
  for each row execute function public.validate_event_page_link();

-- Extend the existing product link guard to prevent a legacy product from
-- claiming a page classified as an event.
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
  if page_entity_kind = 'event' then
    raise exception 'An event page cannot be linked as a product page.' using errcode = '23514';
  end if;
  if page_entity_kind = 'service-product' and new.tenant_id is null then
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
  ) then
    raise exception 'Event pages must be created through the event aggregate service.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_event_page_link on public.pages;
create constraint trigger enforce_event_page_link
  after insert or update of schema_id, tenant_id on public.pages
  deferrable initially deferred
  for each row execute function public.enforce_event_page_link();

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
    if schema_kind = 'event' and coalesce(current_setting('specy.event_page_write', true), '') <> 'on' then
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
      if schema_kind = 'event' and (new.schema_id is distinct from old.schema_id or new.tenant_id is distinct from old.tenant_id) then
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

drop trigger if exists guard_event_page_mutation on public.pages;
create trigger guard_event_page_mutation
  before insert or update or delete on public.pages
  for each row execute function public.guard_event_page_mutation();

create or replace function public.validate_event_timezone()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.timezone is not null and not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.timezone
  ) then
    raise exception 'timezone must be a valid IANA timezone.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_event_timezone on public.mentorbooking_events;
create trigger validate_event_timezone
  before insert or update of timezone on public.mentorbooking_events
  for each row execute function public.validate_event_timezone();

create or replace function public.create_event_page_aggregate(
  target_tenant_id uuid,
  target_schema_id uuid,
  expected_definition_revision bigint,
  target_event jsonb,
  target_page_name text,
  target_page_slug text,
  target_page_content jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_schema_tenant_id uuid;
  current_schema_kind text;
  current_content_scope text;
  current_definition_revision bigint;
  created_event public.mentorbooking_events%rowtype;
  created_page public.pages%rowtype;
  event_status text;
  event_mode text;
  timezone_value text;
begin
  if target_tenant_id is null or target_schema_id is null or expected_definition_revision is null then
    raise exception 'tenant_id, schema_id and expected_definition_revision are required.' using errcode = '22023';
  end if;
  if jsonb_typeof(target_event) is distinct from 'object' then
    raise exception 'event must be a JSON object.' using errcode = '22023';
  end if;
  if target_page_name is null or btrim(target_page_name) = '' or target_page_slug is null or btrim(target_page_slug) = '' then
    raise exception 'Public event page name and slug are required.' using errcode = '22023';
  end if;
  if jsonb_typeof(target_page_content) is distinct from 'object' or octet_length(target_page_content::text) > 1048576 then
    raise exception 'Event page content must be a JSON object no larger than 1 MiB.' using errcode = '22023';
  end if;
  if coalesce(target_event ->> 'company', '') = ''
    or coalesce(target_event ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(target_event ->> 'time', '') !~ '^([01]\d|2[0-3]):[0-5]\d$'
    or coalesce(target_event ->> 'end_time', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' then
    raise exception 'event company, date, time and end_time are required in valid formats.' using errcode = '22023';
  end if;
  perform (target_event ->> 'date')::date;
  perform (target_event ->> 'time')::time;
  perform (target_event ->> 'end_time')::time;
  timezone_value := nullif(target_event ->> 'timezone', '');
  if timezone_value is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = timezone_value) then
    raise exception 'A valid IANA timezone is required for public events.' using errcode = '22023';
  end if;
  event_status := coalesce(nullif(target_event ->> 'status', ''), 'new');
  event_mode := coalesce(nullif(target_event ->> 'mode', ''), 'online');
  if event_status not in ('new', 'firstRequests', 'successPartly', 'successComplete', 'locked') then
    raise exception 'Unsupported event scheduling status.' using errcode = '22023';
  end if;
  if event_mode not in ('live', 'online', 'hybrid') then
    raise exception 'Unsupported event mode.' using errcode = '22023';
  end if;

  select tenant_id, entity_kind, content_scope, definition_revision
    into current_schema_tenant_id, current_schema_kind, current_content_scope, current_definition_revision
    from public.page_schemas where id = target_schema_id for share;
  if not found or current_schema_tenant_id is distinct from target_tenant_id then
    raise exception 'Event schema not found in the requested workspace.' using errcode = 'P0002';
  end if;
  if current_schema_kind is distinct from 'event' or current_content_scope is distinct from 'page-collection' then
    raise exception 'Selected schema is not an eligible event catalogue.' using errcode = '23514';
  end if;
  if current_definition_revision is distinct from expected_definition_revision then
    raise exception 'Schema definition revision conflict.' using errcode = '40001';
  end if;

  insert into public.mentorbooking_events (
    company, company_id, date, time, end_time, duration_minutes, description,
    status, mode, staff_members, requesting_mentors, accepted_mentors,
    declined_mentors, amount_requiredmentors, required_staff_count,
    required_trait_id, product_id, teams_link, initial_selected_mentors,
    tenant_id, owner_user_id, timezone
  ) values (
    target_event ->> 'company', nullif(target_event ->> 'company_id', '')::uuid,
    target_event ->> 'date', target_event ->> 'time', target_event ->> 'end_time',
    greatest(1, coalesce(nullif(target_event ->> 'duration_minutes', '')::integer, 60)),
    coalesce(target_event ->> 'description', ''), event_status, event_mode,
    case when jsonb_typeof(target_event -> 'staff_members') = 'array'
      then array(select jsonb_array_elements_text(target_event -> 'staff_members')) else '{}'::text[] end,
    case when jsonb_typeof(target_event -> 'requesting_mentors') = 'array'
      then array(select jsonb_array_elements_text(target_event -> 'requesting_mentors')::uuid) else '{}'::uuid[] end,
    case when jsonb_typeof(target_event -> 'accepted_mentors') = 'array'
      then array(select jsonb_array_elements_text(target_event -> 'accepted_mentors')::uuid) else '{}'::uuid[] end,
    case when jsonb_typeof(target_event -> 'declined_mentors') = 'array'
      then array(select jsonb_array_elements_text(target_event -> 'declined_mentors')::uuid) else '{}'::uuid[] end,
    greatest(1, coalesce(nullif(target_event ->> 'amount_requiredmentors', '')::integer, 1)),
    greatest(1, coalesce(nullif(target_event ->> 'required_staff_count', '')::integer, 1)),
    nullif(target_event ->> 'required_trait_id', '')::bigint,
    nullif(target_event ->> 'product_id', '')::integer,
    coalesce(target_event ->> 'teams_link', ''),
    case when jsonb_typeof(target_event -> 'initial_selected_mentors') = 'array'
      then array(select jsonb_array_elements_text(target_event -> 'initial_selected_mentors')::uuid) else '{}'::uuid[] end,
    target_tenant_id, public.current_user_id(), timezone_value
  ) returning * into created_event;

  perform set_config('specy.event_page_write', 'on', true);
  insert into public.pages (name, slug, status, content, schema_id, tenant_id, owner_user_id)
  values (btrim(target_page_name), target_page_slug, 'draft', target_page_content, target_schema_id, target_tenant_id, public.current_user_id())
  returning * into created_page;

  update public.mentorbooking_events
    set page_id = created_page.id
    where id = created_event.id and tenant_id = target_tenant_id
    returning * into created_event;

  return jsonb_build_object(
    'event_id', created_event.id,
    'page_id', created_page.id,
    'tenant_id', target_tenant_id,
    'page_slug', created_page.slug,
    'page_status', created_page.status,
    'page_updated_at', created_page.updated_at
  );
end;
$$;

create or replace function public.update_event_page_aggregate(
  target_event_id uuid,
  expected_tenant_id uuid,
  expected_definition_revision bigint,
  expected_page_updated_at timestamptz,
  target_page_name text,
  target_page_slug text,
  target_page_content jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  event_row public.mentorbooking_events%rowtype;
  page_row public.pages%rowtype;
  page_schema_tenant_id uuid;
  page_schema_kind text;
  current_definition_revision bigint;
  schema_definition jsonb;
  validation_errors text[];
begin
  if expected_tenant_id is null or expected_page_updated_at is null or expected_definition_revision is null then
    raise exception 'tenant_id, schema revision and page revision are required.' using errcode = '22023';
  end if;
  select * into event_row from public.mentorbooking_events
    where id = target_event_id and tenant_id = expected_tenant_id for update;
  if not found or event_row.page_id is null then raise exception 'Public event not found.' using errcode = 'P0002'; end if;
  select * into page_row from public.pages
    where id = event_row.page_id and tenant_id = expected_tenant_id for update;
  if not found then raise exception 'Event page not found.' using errcode = 'P0002'; end if;
  select tenant_id, entity_kind, definition_revision, schema
    into page_schema_tenant_id, page_schema_kind, current_definition_revision, schema_definition
    from public.page_schemas where id = page_row.schema_id for share;
  if not found or page_schema_tenant_id is distinct from expected_tenant_id or page_schema_kind is distinct from 'event' then
    raise exception 'Event page schema does not belong to the requested workspace.' using errcode = '23514';
  end if;
  if current_definition_revision is distinct from expected_definition_revision then
    raise exception 'Schema definition revision conflict.' using errcode = '40001';
  end if;
  if page_row.updated_at is distinct from expected_page_updated_at then
    raise exception 'Event page version conflict.' using errcode = '40001';
  end if;
  if target_page_name is null or btrim(target_page_name) = '' or target_page_slug is null or btrim(target_page_slug) = '' then
    raise exception 'Page name and slug are required.' using errcode = '22023';
  end if;
  validation_errors := public.validate_service_product_content(schema_definition, target_page_content);
  if cardinality(validation_errors) > 0 then
    raise exception 'Event page content does not satisfy its schema.' using errcode = '22023', detail = array_to_string(validation_errors, E'\n');
  end if;
  perform set_config('specy.event_page_write', 'on', true);
  update public.pages set name = btrim(target_page_name), slug = target_page_slug, content = target_page_content
    where id = page_row.id and tenant_id = expected_tenant_id and updated_at = expected_page_updated_at
    returning * into page_row;
  if not found then raise exception 'Event page version conflict.' using errcode = '40001'; end if;
  return jsonb_build_object('event_id', event_row.id, 'page_id', page_row.id, 'slug', page_row.slug, 'status', page_row.status, 'updated_at', page_row.updated_at);
end;
$$;

create or replace function public.set_event_page_publication(
  target_event_id uuid,
  expected_tenant_id uuid,
  expected_definition_revision bigint,
  expected_page_updated_at timestamptz,
  target_status text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  event_row public.mentorbooking_events%rowtype;
  page_row public.pages%rowtype;
  page_schema_tenant_id uuid;
  page_schema_kind text;
  current_definition_revision bigint;
  schema_definition jsonb;
  validation_errors text[];
begin
  if target_status not in ('draft', 'published', 'archived') then
    raise exception 'Event page status must be draft, published or archived.' using errcode = '22023';
  end if;
  select * into event_row from public.mentorbooking_events
    where id = target_event_id and tenant_id = expected_tenant_id for update;
  if not found or event_row.page_id is null then raise exception 'Public event not found.' using errcode = 'P0002'; end if;
  select * into page_row from public.pages where id = event_row.page_id and tenant_id = expected_tenant_id for update;
  if not found then raise exception 'Event page not found.' using errcode = 'P0002'; end if;
  select tenant_id, entity_kind, definition_revision, schema
    into page_schema_tenant_id, page_schema_kind, current_definition_revision, schema_definition
    from public.page_schemas where id = page_row.schema_id for share;
  if not found or page_schema_tenant_id is distinct from expected_tenant_id or page_schema_kind is distinct from 'event' then
    raise exception 'Event page schema does not belong to the requested workspace.' using errcode = '23514';
  end if;
  if current_definition_revision is distinct from expected_definition_revision then
    raise exception 'Schema definition revision conflict.' using errcode = '40001';
  end if;
  if page_row.updated_at is distinct from expected_page_updated_at then raise exception 'Event page version conflict.' using errcode = '40001'; end if;
  if target_status = 'published' then
    validation_errors := public.validate_service_product_content(schema_definition, page_row.content);
    if cardinality(validation_errors) > 0 then
      raise exception 'Event page cannot be published until content satisfies its schema.' using errcode = '22023', detail = array_to_string(validation_errors, E'\n');
    end if;
    if event_row.timezone is null then raise exception 'A public event requires a confirmed timezone.' using errcode = '22023'; end if;
  end if;
  perform set_config('specy.event_page_write', 'on', true);
  update public.pages set status = target_status
    where id = page_row.id and tenant_id = expected_tenant_id and updated_at = expected_page_updated_at
    returning * into page_row;
  if not found then raise exception 'Event page version conflict.' using errcode = '40001'; end if;
  return jsonb_build_object('event_id', event_row.id, 'page_id', page_row.id, 'slug', page_row.slug, 'status', page_row.status, 'updated_at', page_row.updated_at);
end;
$$;

-- Deleting an operational event also removes its linked event page in the same
-- caller-scoped transaction. A denied page delete rolls back the event delete.
create or replace function public.delete_event_page_after_event_delete()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.page_id is not null then
    perform set_config('specy.event_page_write', 'on', true);
    delete from public.pages where id = old.page_id and tenant_id = old.tenant_id;
    if not found then raise exception 'Linked event page deletion was denied.' using errcode = '42501'; end if;
  end if;
  return old;
end;
$$;

drop trigger if exists delete_event_page_after_event_delete on public.mentorbooking_events;
create trigger delete_event_page_after_event_delete
  after delete on public.mentorbooking_events
  for each row execute function public.delete_event_page_after_event_delete();

revoke all on function public.validate_event_product_tenant() from public, anon;
revoke all on function public.validate_event_company_tenant() from public, anon;
revoke all on function public.guard_event_page_mutation() from public, anon;
revoke all on function public.validate_event_page_link() from public, anon;
revoke all on function public.enforce_event_page_link() from public, anon;
revoke all on function public.validate_event_timezone() from public, anon;
revoke all on function public.delete_event_page_after_event_delete() from public, anon;
grant execute on function public.validate_event_product_tenant() to authenticated;
grant execute on function public.validate_event_company_tenant() to authenticated;
grant execute on function public.guard_event_page_mutation() to authenticated;
grant execute on function public.validate_event_page_link() to authenticated;
grant execute on function public.enforce_event_page_link() to authenticated;
grant execute on function public.validate_event_timezone() to authenticated;
grant execute on function public.delete_event_page_after_event_delete() to authenticated;

revoke all on function public.create_event_page_aggregate(uuid, uuid, bigint, jsonb, text, text, jsonb) from public, anon;
revoke all on function public.update_event_page_aggregate(uuid, uuid, bigint, timestamptz, text, text, jsonb) from public, anon;
revoke all on function public.set_event_page_publication(uuid, uuid, bigint, timestamptz, text) from public, anon;
grant execute on function public.create_event_page_aggregate(uuid, uuid, bigint, jsonb, text, text, jsonb) to authenticated;
grant execute on function public.update_event_page_aggregate(uuid, uuid, bigint, timestamptz, text, text, jsonb) to authenticated;
grant execute on function public.set_event_page_publication(uuid, uuid, bigint, timestamptz, text) to authenticated;
