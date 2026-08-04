-- Global standard LLM specs are not tenant-owned. They are available to every
-- authenticated console user and through the public REST/MCP discovery APIs.

create table if not exists public.global_llm_specs (
  id uuid not null default gen_random_uuid(),
  slug character varying(255) not null,
  name character varying(255) not null,
  description text null,
  definition jsonb not null default '{}'::jsonb,
  llm_instructions text null,
  status character varying(50) not null default 'draft'::character varying,
  is_public boolean not null default true,
  is_main_template boolean not null default false,
  tags jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint global_llm_specs_pkey primary key (id),
  constraint global_llm_specs_slug_key unique (slug),
  constraint global_llm_specs_status_check check (status in ('draft', 'published', 'archived')),
  constraint global_llm_specs_tags_is_array_check check (jsonb_typeof(tags) = 'array'),
  constraint global_llm_specs_metadata_is_object_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists idx_global_llm_specs_status on public.global_llm_specs (status);
create index if not exists idx_global_llm_specs_public on public.global_llm_specs (is_public);

drop trigger if exists set_global_llm_specs_updated_at on public.global_llm_specs;
create trigger set_global_llm_specs_updated_at
  before update on public.global_llm_specs
  for each row execute function set_current_timestamp_updated_at();

alter table public.global_llm_specs enable row level security;

drop policy if exists "public_select_global_llm_specs" on public.global_llm_specs;
create policy "public_select_global_llm_specs"
  on public.global_llm_specs for select
  to anon, authenticated
  using (status = 'published' and is_public = true);

drop policy if exists "admin_insert_global_llm_specs" on public.global_llm_specs;
create policy "admin_insert_global_llm_specs"
  on public.global_llm_specs for insert
  to authenticated
  with check ((current_setting('request.jwt.claims', true))::jsonb -> 'user_roles' ?| array['admin', 'super-admin']);

drop policy if exists "admin_update_global_llm_specs" on public.global_llm_specs;
create policy "admin_update_global_llm_specs"
  on public.global_llm_specs for update
  to authenticated
  using ((current_setting('request.jwt.claims', true))::jsonb -> 'user_roles' ?| array['admin', 'super-admin'])
  with check ((current_setting('request.jwt.claims', true))::jsonb -> 'user_roles' ?| array['admin', 'super-admin']);

drop policy if exists "admin_delete_global_llm_specs" on public.global_llm_specs;
create policy "admin_delete_global_llm_specs"
  on public.global_llm_specs for delete
  to authenticated
  using ((current_setting('request.jwt.claims', true))::jsonb -> 'user_roles' ?| array['admin', 'super-admin']);

-- Copy the standard records from the original registry once. The source rows
-- remain intact for backwards compatibility with existing schema attachments.
insert into public.global_llm_specs (
  slug, name, description, definition, llm_instructions, status,
  is_public, is_main_template, tags, metadata, created_at, updated_at
)
select
  slug, name, description, definition, llm_instructions, status,
  true, is_main_template, tags, metadata, created_at, updated_at
from public.llm_specs source
where source.metadata ->> 'standard_prompt' = 'true'
  and not exists (
    select 1 from public.global_llm_specs target where target.slug = source.slug
  );