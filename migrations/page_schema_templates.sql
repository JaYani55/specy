create table if not exists public.page_schema_templates (
  id uuid not null default gen_random_uuid(),
  name character varying(255) not null,
  slug character varying(255) not null,
  description text null,
  icon character varying(32) null,
  schema jsonb not null,
  llm_instructions text null,
  source_schema_id uuid null references public.page_schemas(id) on update cascade on delete set null,
  external_source_url text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint page_schema_templates_pkey primary key (id),
  constraint page_schema_templates_slug_key unique (slug)
) tablespace pg_default;

create trigger set_page_schema_templates_updated_at
  before update on public.page_schema_templates
  for each row
  execute function set_current_timestamp_updated_at();
