create table public.mentorbooking_events_archive (
  id uuid not null default gen_random_uuid (),
  company text not null,
  company_id uuid null,
  date text not null,
  time text not null,
  description text null,
  coach_id uuid not null,
  status text null default 'new'::text,
  requesting_mentors uuid[] null default '{}'::uuid[],
  accepted_mentors uuid[] null default '{}'::uuid[],
  backup_mentors uuid[] null default '{}'::uuid[],
  amount_requiredmentors integer null default 1,
  required_staff_count integer null default 1,
  required_trait_id bigint null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  pillar_id integer null,
  teams_link text not null default ''::text,
  declined_mentors uuid[] not null default '{}'::uuid[],
  coacheswant_backup uuid[] not null default '{}'::uuid[],
  mentordeclinesto_backup uuid[] not null default '{}'::uuid[],
  end_time character varying(5) null,
  duration_minutes integer null,
  constraint mentorbooking_events_archive_pkey primary key (id),
  constraint mentorbooking_events_archive_coach_id_fkey foreign KEY (coach_id) references auth.users (id),
  constraint mentorbooking_events_archive_company_id_fkey foreign KEY (company_id) references companies (id),
  constraint mentorbooking_events_archive_pillar_id_fkey foreign KEY (pillar_id) references mentorbooking_products (id) on delete set null,
  constraint mentorbooking_events_archive_required_trait_id_fkey foreign KEY (required_trait_id) references staff_traits (id) on delete set null,
  constraint mentorbooking_events_archive_required_staff_count_check check ((required_staff_count >= 1)),
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

create index IF not exists mentorbooking_events_archive_company_id_idx on public.mentorbooking_events_archive using btree (company_id) TABLESPACE pg_default;
create index IF not exists mentorbooking_events_archive_required_trait_id_idx on public.mentorbooking_events_archive using btree (required_trait_id) TABLESPACE pg_default;