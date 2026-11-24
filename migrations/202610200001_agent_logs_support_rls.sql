-- 202610200001_agent_logs_support_rls.sql
-- Support-role access to agent_logs: retrieve and delete their own log entries.
-- Cross-tenant log visibility remains super-admin-only (agent_logs_hardening.sql).
-- Tenancy for logging (tenant_id column + tenant-scoped policies) is a
-- deliberate follow-up — agent_logs has no tenant attribution yet.

alter table public.agent_logs enable row level security;

drop policy if exists "support_select_agent_logs" on public.agent_logs;
create policy "support_select_agent_logs"
  on public.agent_logs
  for select
  to authenticated
  using (
    public.is_support()
    and user_id = auth.uid()
  );

drop policy if exists "support_delete_agent_logs" on public.agent_logs;
create policy "support_delete_agent_logs"
  on public.agent_logs
  for delete
  to authenticated
  using (
    public.is_support()
    and user_id = auth.uid()
  );

comment on table public.agent_logs is
  'Operational logs for API and MCP requests. Anonymous insert only; super-admin sees all; support retrieves/deletes own entries (user_id-scoped). Tenant scoping not yet implemented.';
