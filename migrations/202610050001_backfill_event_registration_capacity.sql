-- Backfill the typed Event registration/capacity contract from legacy editorial
-- copies and custom fields when their values are explicit and unambiguous.
-- Existing values in the typed columns always win; unrecognized/conflicting
-- legacy values remain unset for operator review.

create or replace function public.try_event_participant_count(value jsonb)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  raw_value text;
  parsed numeric;
begin
  if value is null or jsonb_typeof(value) = 'null' then return null; end if;
  if jsonb_typeof(value) not in ('number', 'string') then return null; end if;
  raw_value := btrim(value #>> '{}');
  if raw_value !~ '^[0-9]+(\.0+)?$' then return null; end if;
  parsed := raw_value::numeric;
  if parsed < 1 or parsed > 2147483647 or trunc(parsed) <> parsed then return null; end if;
  return parsed::integer;
exception when numeric_value_out_of_range or invalid_text_representation then
  return null;
end;
$$;

do $$
declare
  event_row record;
  raw_status text;
  normalized_status text;
  inferred_min integer;
  inferred_max integer;
  final_min integer;
  final_max integer;
begin
  for event_row in
    select e.id, e.tenant_id, e.registration_status, e.participant_min, e.participant_max,
      e.custom_fields, p.content as page_content
    from public.mentorbooking_events e
    left join public.pages p on p.id = e.page_id and p.tenant_id = e.tenant_id
    where e.registration_status is null
      or e.participant_min is null
      or e.participant_max is null
  loop
    raw_status := coalesce(
      nullif(btrim(event_row.custom_fields ->> 'registration_status'), ''),
      nullif(btrim(event_row.page_content ->> 'registration_status'), ''),
      nullif(btrim(event_row.page_content ->> 'status'), '')
    );
    normalized_status := case lower(regexp_replace(coalesce(raw_status, ''), '\s+', ' ', 'g'))
      when 'open' then 'open'
      when 'registration open' then 'open'
      when 'anmeldung offen' then 'open'
      when 'offen' then 'open'
      when 'waitlist' then 'waitlist'
      when 'waiting list' then 'waitlist'
      when 'warteliste' then 'waitlist'
      when 'full' then 'full'
      when 'fully booked' then 'full'
      when 'ausgebucht' then 'full'
      when 'closed' then 'closed'
      when 'registration closed' then 'closed'
      when 'anmeldung geschlossen' then 'closed'
      when 'geschlossen' then 'closed'
      when 'cancelled' then 'cancelled'
      when 'canceled' then 'cancelled'
      when 'abgesagt' then 'cancelled'
      else null
    end;

    inferred_min := coalesce(
      public.try_event_participant_count(event_row.custom_fields -> 'participant_min'),
      public.try_event_participant_count(event_row.custom_fields -> 'participantMin'),
      public.try_event_participant_count(event_row.page_content -> 'participant_min'),
      public.try_event_participant_count(event_row.page_content -> 'participantMin')
    );
    inferred_max := coalesce(
      public.try_event_participant_count(event_row.custom_fields -> 'participant_max'),
      public.try_event_participant_count(event_row.custom_fields -> 'participantMax'),
      public.try_event_participant_count(event_row.page_content -> 'participant_max'),
      public.try_event_participant_count(event_row.page_content -> 'participantMax')
    );

    final_min := coalesce(event_row.participant_min, inferred_min);
    final_max := coalesce(event_row.participant_max, inferred_max);
    if final_min is not null and final_max is not null and final_min > final_max then
      -- Do not guess which conflicting legacy value is correct.
      if event_row.participant_min is null then inferred_min := null; end if;
      if event_row.participant_max is null then inferred_max := null; end if;
    end if;

    update public.mentorbooking_events
      set registration_status = coalesce(event_row.registration_status, normalized_status),
          participant_min = coalesce(event_row.participant_min, inferred_min),
          participant_max = coalesce(event_row.participant_max, inferred_max)
      where id = event_row.id
        and tenant_id = event_row.tenant_id
        and (
          (event_row.registration_status is null and normalized_status is not null)
          or (event_row.participant_min is null and inferred_min is not null)
          or (event_row.participant_max is null and inferred_max is not null)
        );
  end loop;
end;
$$;

revoke all on function public.try_event_participant_count(jsonb) from public, anon, authenticated;
drop function public.try_event_participant_count(jsonb);
