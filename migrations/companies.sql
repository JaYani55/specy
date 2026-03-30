create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text null,
  status text not null default 'active',
  website_url text null,
  industry text null,
  company_size text null,
  primary_contact_name text null,
  primary_contact_email text null,
  primary_contact_phone text null,
  billing_email text null,
  notes text null,
  logo_url text null,
  address jsonb not null default '{}'::jsonb,
  custom_data jsonb not null default '{}'::jsonb,
  legacy_employer_id uuid null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_name_check check (btrim(name) <> ''),
  constraint companies_status_check check (
    status = any (array['active'::text, 'inactive'::text, 'prospect'::text, 'archived'::text])
  ),
  constraint companies_address_is_object check (jsonb_typeof(address) = 'object'),
  constraint companies_custom_data_is_object check (jsonb_typeof(custom_data) = 'object'),
  constraint companies_legacy_employer_id_key unique (legacy_employer_id),
  constraint companies_created_by_fkey foreign key (created_by) references public.user_profile (user_id) on delete set null,
  constraint companies_legacy_employer_id_fkey foreign key (legacy_employer_id) references public.employers (id) on delete set null
) tablespace pg_default;

create index if not exists idx_companies_name on public.companies using btree (name) tablespace pg_default;
create index if not exists idx_companies_status on public.companies using btree (status) tablespace pg_default;
create index if not exists idx_companies_industry on public.companies using btree (industry) tablespace pg_default;

drop trigger if exists set_companies_updated_at on public.companies;
create trigger set_companies_updated_at
before update on public.companies
for each row
execute function set_current_timestamp_updated_at();

alter table public.companies enable row level security;

drop policy if exists "authenticated_select_companies" on public.companies;
drop policy if exists "event_staff_insert_companies" on public.companies;
drop policy if exists "event_staff_update_companies" on public.companies;
drop policy if exists "admin_delete_companies" on public.companies;

create policy "authenticated_select_companies"
  on public.companies
  for select
  to authenticated
  using (true);

create policy "event_staff_insert_companies"
  on public.companies
  for insert
  to authenticated
  with check (
    (current_setting('request.jwt.claims', true))::jsonb -> 'user_roles' ?| array['staff', 'mentoringmanagement', 'admin', 'super-admin']
  );

create policy "event_staff_update_companies"
  on public.companies
  for update
  to authenticated
  using (
    (current_setting('request.jwt.claims', true))::jsonb -> 'user_roles' ?| array['staff', 'mentoringmanagement', 'admin', 'super-admin']
  )
  with check (
    (current_setting('request.jwt.claims', true))::jsonb -> 'user_roles' ?| array['staff', 'mentoringmanagement', 'admin', 'super-admin']
  );

create policy "admin_delete_companies"
  on public.companies
  for delete
  to authenticated
  using (
    (current_setting('request.jwt.claims', true))::jsonb -> 'user_roles' ?| array['admin', 'super-admin']
  );

do $$
begin
  if to_regclass('public.employers') is not null then
    insert into public.companies (
      name,
      legal_name,
      logo_url,
      created_by,
      legacy_employer_id,
      custom_data
    )
    select
      e.name,
      coalesce(nullif(e.alt_name, ''), e.name),
      e.logo_url,
      e.created_by,
      e.id,
      jsonb_strip_nulls(
        jsonb_build_object(
          'legacy_user_id', e.user_id,
          'legacy_flags', jsonb_build_object(
            'fh', e.fh,
            'smartsync_enabled', e.smartsync_enabled,
            'provisionsvereinbarung', e."Provisionsvereinbarung"
          ),
          'legacy_job_limits', jsonb_build_object(
            'jobs_count', e.jobscount,
            'jobs_limit_enabled', e.jobs_limit_bool,
            'jobs_limit', e.jobs_limit,
            'jobs_count_online', e.jobscount_online
          )
        )
      )
    from public.employers e
    on conflict (legacy_employer_id) do update
    set name = excluded.name,
        legal_name = excluded.legal_name,
        logo_url = excluded.logo_url,
        custom_data = excluded.custom_data,
        updated_at = now();
  end if;
end $$;