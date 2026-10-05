-- Separate revalidation-oriented Page content from the dynamic Object stream,
-- and give public registration/capacity values an operational, typed contract.

alter table public.mentorbooking_events
  add column if not exists registration_status text null,
  add column if not exists participant_min integer null,
  add column if not exists participant_max integer null;

alter table public.mentorbooking_events
  alter column registration_status set default 'closed';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mentorbooking_events_registration_status_check') then
    alter table public.mentorbooking_events
      add constraint mentorbooking_events_registration_status_check
      check (registration_status is null or registration_status in ('open', 'waitlist', 'full', 'closed', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mentorbooking_events_participant_min_check') then
    alter table public.mentorbooking_events
      add constraint mentorbooking_events_participant_min_check
      check (participant_min is null or participant_min >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mentorbooking_events_participant_max_check') then
    alter table public.mentorbooking_events
      add constraint mentorbooking_events_participant_max_check
      check (participant_max is null or participant_max >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mentorbooking_events_participant_range_check') then
    alter table public.mentorbooking_events
      add constraint mentorbooking_events_participant_range_check
      check (participant_min is null or participant_max is null or participant_min <= participant_max);
  end if;
end;
$$;

-- Event-page creation remains one transaction. The legacy aggregate creates
-- the operational row/page; this wrapper then writes the typed public fields
-- before the transaction commits.
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
  requested_registration_status text;
  requested_participant_min integer;
  requested_participant_max integer;
begin
  if jsonb_typeof(target_event_custom_fields) is distinct from 'object'
    or octet_length(target_event_custom_fields::text) > 1048576 then
    raise exception 'Event custom_fields must be an object no larger than 1 MiB.' using errcode = '22023';
  end if;

  requested_registration_status := coalesce(nullif(target_event ->> 'registration_status', ''), 'closed');
  if requested_registration_status is not null
    and requested_registration_status not in ('open', 'waitlist', 'full', 'closed', 'cancelled') then
    raise exception 'Unsupported registration_status.' using errcode = '22023';
  end if;
  requested_participant_min := nullif(target_event ->> 'participant_min', '')::integer;
  requested_participant_max := nullif(target_event ->> 'participant_max', '')::integer;
  if requested_participant_min is not null and requested_participant_min < 1
    or requested_participant_max is not null and requested_participant_max < 1
    or requested_participant_min is not null and requested_participant_max is not null
      and requested_participant_min > requested_participant_max then
    raise exception 'Participant capacity must be positive and minimum cannot exceed maximum.' using errcode = '22023';
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
    set custom_fields = target_event_custom_fields,
        registration_status = requested_registration_status,
        participant_min = requested_participant_min,
        participant_max = requested_participant_max
    where id = created_event_id and tenant_id = target_tenant_id;
  if not found then raise exception 'Created event was not found in its workspace.' using errcode = 'P0002'; end if;
  return result;
end;
$$;

-- The Object is the dynamic operational data stream. Page editorial JSON stays
-- in Pages and is delivered through the schema Pages/revalidation contract.
-- This BEFORE trigger normalizes existing generated mirrors on every source
-- sync, including backfills, without touching manually authored Objects.
create or replace function public.project_product_object_dynamic_contract()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  product public.mentorbooking_products%rowtype;
  event_item jsonb;
  projected_events jsonb := '[]'::jsonb;
  event_row public.mentorbooking_events%rowtype;
  props jsonb;
begin
  if new.source_product_id is null then return new; end if;
  select * into product from public.mentorbooking_products where id = new.source_product_id;
  if not found then return new; end if;

  -- Replace embedded Page content with references. Page content continues to
  -- travel only through the Pages endpoints and their revalidation lifecycle.
  new.data := jsonb_set(new.data, '{product}',
    ((coalesce(new.data -> 'product', '{}'::jsonb) - 'content') ||
      jsonb_build_object('page_id', product.product_page_id)), true);

  for event_item in select value from jsonb_array_elements(coalesce(new.data -> 'events', '[]'::jsonb)) loop
    begin
      select * into event_row from public.mentorbooking_events
        where id = (event_item ->> 'id')::uuid
          and product_id = new.source_product_id
          and tenant_id = product.tenant_id;
    exception when invalid_text_representation then
      event_row := null;
    end;
    if event_row.id is not null then
      projected_events := projected_events || jsonb_build_array(
        ((event_item - 'content' - 'name') || jsonb_build_object(
          'page_id', event_row.page_id,
          'registration_status', event_row.registration_status,
          'participant_min', event_row.participant_min,
          'participant_max', event_row.participant_max
        ))
      );
    end if;
  end loop;
  new.data := jsonb_set(new.data, '{events}', projected_events, true);

  props := coalesce(new.schema #> '{product,properties}', '{}'::jsonb) - 'content';
  props := props || jsonb_build_object('page_id', jsonb_build_object('type', 'string', 'nullable', true));
  new.schema := jsonb_set(new.schema, '{product,properties}', props, true);

  props := coalesce(new.schema #> '{events,items,properties}', '{}'::jsonb) - 'content' - 'name';
  props := props || jsonb_build_object(
    'page_id', jsonb_build_object('type', 'string'),
    'registration_status', jsonb_build_object('type', 'string', 'nullable', true, 'enum', jsonb_build_array('open', 'waitlist', 'full', 'closed', 'cancelled')),
    'participant_min', jsonb_build_object('type', 'number', 'nullable', true),
    'participant_max', jsonb_build_object('type', 'number', 'nullable', true)
  );
  new.schema := jsonb_set(new.schema, '{events,items,properties}', props, true);
  return new;
end;
$$;

revoke all on function public.project_product_object_dynamic_contract() from public, anon, authenticated;
drop trigger if exists project_product_object_dynamic_contract on public.objects;
create trigger project_product_object_dynamic_contract
  before insert or update on public.objects
  for each row execute function public.project_product_object_dynamic_contract();

-- Re-run the canonical sync so existing generated mirrors are normalized and
-- populated with the new structured fields. Safe to run repeatedly.
do $$
declare
  product_record record;
begin
  for product_record in select id from public.mentorbooking_products order by id loop
    perform public.sync_product_object(product_record.id);
  end loop;
end;
$$;
