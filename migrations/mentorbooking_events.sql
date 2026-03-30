create table public.mentorbooking_events (
  id uuid not null default gen_random_uuid (),
  company text not null,
  company_id uuid null,
  date text not null,
  time text not null,
  description text null,
  status text null default 'new'::text,
  requesting_mentors uuid[] null default '{}'::uuid[],
  accepted_mentors uuid[] null default '{}'::uuid[],
  amount_requiredmentors integer null default 1,
  required_staff_count integer null default 1,
  required_trait_id bigint null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  product_id integer null,
  teams_link text not null default ''::text,
  declined_mentors uuid[] not null default '{}'::uuid[],
  end_time character varying(5) null,
  duration_minutes integer null,
  initial_selected_mentors uuid[] null default '{}'::uuid[],
  mode text null,
  staff_members text[] null default '{}'::text[],
  constraint mentorbooking_events_pkey primary key (id),
  constraint mentorbooking_events_company_id_fkey foreign KEY (company_id) references companies (id) on update CASCADE on delete set null,
  constraint mentorbooking_events_product_id_fkey foreign KEY (product_id) references mentorbooking_products (id) on delete set null,
  constraint mentorbooking_events_required_trait_id_fkey foreign KEY (required_trait_id) references staff_traits (id) on delete set null,
  constraint mentorbooking_events_mode_check check (
    (
      mode = any (
        array['live'::text, 'online'::text, 'hybrid'::text]
      )
    )
  ),
  constraint min_required_staff check ((required_staff_count >= 1)),
  constraint min_required_mentors check ((amount_requiredmentors >= 1)),
  constraint valid_event_status check (
    (
      status = any (
        array[
          'new'::text,
          'firstRequests'::text,
          'successPartly'::text,
          'successComplete'::text,
          'locked'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_events_company_id on public.mentorbooking_events using btree (company_id) TABLESPACE pg_default;
create index IF not exists idx_events_required_trait_id on public.mentorbooking_events using btree (required_trait_id) TABLESPACE pg_default;

create trigger event_status_update_on_request BEFORE
update on mentorbooking_events for EACH row
execute FUNCTION update_event_status_on_request ();

create trigger update_event_status_trigger BEFORE INSERT
or
update OF requesting_mentors,
accepted_mentors,
amount_requiredmentors on mentorbooking_events for EACH row
execute FUNCTION update_event_status ();