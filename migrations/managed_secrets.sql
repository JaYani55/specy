create table if not exists public.managed_secrets (
  id uuid not null default gen_random_uuid(),
  name character varying(255) not null,
  namespace character varying(100) not null,
  encrypted_value text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint managed_secrets_pkey primary key (id),
  constraint managed_secrets_name_key unique (name)
) tablespace pg_default;

create index if not exists idx_managed_secrets_namespace on public.managed_secrets(namespace);

alter table public.managed_secrets enable row level security;

drop trigger if exists set_managed_secrets_updated_at on public.managed_secrets;
create trigger set_managed_secrets_updated_at
  before update on public.managed_secrets
  for each row
  execute function set_current_timestamp_updated_at();

alter table public.page_schemas
  add column if not exists revalidation_secret_name text null;