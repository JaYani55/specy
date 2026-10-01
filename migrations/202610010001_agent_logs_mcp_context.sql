-- Preserve logical MCP operation and verified actor context alongside the
-- transport request. status_code may reflect an inner MCP tool failure while
-- transport_status_code retains the outer HTTP response status.
alter table public.agent_logs
  add column if not exists operation_name text null,
  add column if not exists user_id uuid null,
  add column if not exists user_email text null,
  add column if not exists transport_status_code integer null;

create index if not exists idx_agent_logs_user_created_at
  on public.agent_logs (user_id, created_at desc);

comment on column public.agent_logs.operation_name is
  'Logical operation, e.g. tools/call:specy_pages_schemas_update_system_data; distinct from the HTTP path.';
comment on column public.agent_logs.user_id is
  'Verified Supabase user id from the bearer session, when present.';
comment on column public.agent_logs.user_email is
  'Verified email claim from the bearer session, when present; never a credential.';
comment on column public.agent_logs.transport_status_code is
  'Outer HTTP status. status_code may instead record an inner MCP tool failure.';
