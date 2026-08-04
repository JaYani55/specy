-- Tighten global standard-spec permissions after the initial global table
-- migration has already been applied. This migration is safe to run repeatedly.
-- Global specs remain publicly readable only when published and public.

alter table public.global_llm_specs enable row level security;

drop policy if exists "super_admin_select_global_llm_specs" on public.global_llm_specs;
create policy "super_admin_select_global_llm_specs"
  on public.global_llm_specs
  for select
  to authenticated
  using (
    (current_setting('request.jwt.claims', true))::jsonb -> 'user_roles' ? 'super-admin'
  );

drop policy if exists "super_admin_insert_global_llm_specs" on public.global_llm_specs;
drop policy if exists "admin_insert_global_llm_specs" on public.global_llm_specs;
create policy "super_admin_insert_global_llm_specs"
  on public.global_llm_specs
  for insert
  to authenticated
  with check (
    (current_setting('request.jwt.claims', true))::jsonb -> 'user_roles' ? 'super-admin'
  );

drop policy if exists "admin_update_global_llm_specs" on public.global_llm_specs;
drop policy if exists "super_admin_update_global_llm_specs" on public.global_llm_specs;
create policy "super_admin_update_global_llm_specs"
  on public.global_llm_specs
  for update
  to authenticated
  using (
    (current_setting('request.jwt.claims', true))::jsonb -> 'user_roles' ? 'super-admin'
  )
  with check (
    (current_setting('request.jwt.claims', true))::jsonb -> 'user_roles' ? 'super-admin'
  );

drop policy if exists "admin_delete_global_llm_specs" on public.global_llm_specs;
drop policy if exists "super_admin_delete_global_llm_specs" on public.global_llm_specs;
create policy "super_admin_delete_global_llm_specs"
  on public.global_llm_specs
  for delete
  to authenticated
  using (
    (current_setting('request.jwt.claims', true))::jsonb -> 'user_roles' ? 'super-admin'
  );
