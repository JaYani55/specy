create table if not exists public.system_config (
  id uuid not null default gen_random_uuid(),
  namespace character varying(100) not null default 'core',
  key character varying(255) not null,
  value text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint system_config_pkey primary key (id),
  constraint system_config_namespace_key_key unique (namespace, key)
) tablespace pg_default;

create index if not exists idx_system_config_namespace on public.system_config(namespace);

alter table public.system_config enable row level security;

drop trigger if exists set_system_config_updated_at on public.system_config;
create trigger set_system_config_updated_at
  before update on public.system_config
  for each row
  execute function set_current_timestamp_updated_at();