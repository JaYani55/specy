drop policy if exists "authenticated_select_forms" on public.forms;
create policy "authenticated_select_forms"
  on public.forms
  for select
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id));

drop policy if exists "admin_select_objects" on public.objects;
create policy "admin_select_objects"
  on public.objects
  for select
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id));

drop policy if exists "authenticated_select_pages" on public.pages;
create policy "authenticated_select_pages"
  on public.pages
  for select
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id));

drop policy if exists "authenticated_select_page_schemas" on public.page_schemas;
create policy "authenticated_select_page_schemas"
  on public.page_schemas
  for select
  to authenticated
  using (
    (owner_user_id is null and public.is_super_admin())
    or public.can_access_owned_row(tenant_id, owner_user_id)
  );

drop policy if exists "authenticated_select_llm_specs" on public.llm_specs;
create policy "authenticated_select_llm_specs"
  on public.llm_specs
  for select
  to authenticated
  using (public.can_access_owned_row(tenant_id, created_by));

drop policy if exists "authenticated_select_page_schema_specs" on public.page_schema_specs;
create policy "authenticated_select_page_schema_specs"
  on public.page_schema_specs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.page_schemas ps
      where ps.id = page_schema_specs.schema_id
        and (
          (ps.owner_user_id is null and public.is_super_admin())
          or public.can_access_owned_row(ps.tenant_id, ps.owner_user_id)
        )
    )
    and exists (
      select 1
      from public.llm_specs ls
      where ls.id = page_schema_specs.spec_id
        and public.can_access_owned_row(ls.tenant_id, ls.created_by)
    )
  );