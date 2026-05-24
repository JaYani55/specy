create or replace function public.can_administer_user_in_tenant(target_tenant_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_content_admin()
    or (
      target_user_id = public.current_user_id()
      and public.is_tenant_member(
        coalesce(target_tenant_id, public.default_tenant_for_user(target_user_id))
      )
    )
    or (
      public.is_tenant_admin(
        coalesce(target_tenant_id, public.default_tenant_for_user(target_user_id))
      )
      and exists (
        select 1
        from public.tenant_users tu
        where tu.tenant_id = coalesce(target_tenant_id, public.default_tenant_for_user(target_user_id))
          and tu.user_id = target_user_id
          and tu.status = 'active'
      )
    )
$$;

create or replace function public.can_insert_owned_row(target_tenant_id uuid, target_owner_user_id uuid default public.current_user_id())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_content_admin()
    or (
      target_owner_user_id = public.current_user_id()
      and public.is_tenant_member(coalesce(target_tenant_id, public.current_tenant_id()))
    )
$$;

drop policy if exists "owned_insert_companies" on public.companies;
create policy "owned_insert_companies"
  on public.companies
  for insert
  to authenticated
  with check (public.can_insert_owned_row(tenant_id, owner_user_id));

drop policy if exists "user_insert_forms" on public.forms;
create policy "user_insert_forms"
  on public.forms
  for insert
  to authenticated
  with check (public.can_insert_owned_row(tenant_id, owner_user_id));

drop policy if exists "admin_insert_objects" on public.objects;
create policy "admin_insert_objects"
  on public.objects
  for insert
  to authenticated
  with check (public.can_insert_owned_row(tenant_id, owner_user_id));

drop policy if exists "staff_insert_pages" on public.pages;
create policy "staff_insert_pages"
  on public.pages
  for insert
  to authenticated
  with check (public.can_insert_owned_row(tenant_id, owner_user_id));

drop policy if exists "staff_insert_page_schemas" on public.page_schemas;
create policy "staff_insert_page_schemas"
  on public.page_schemas
  for insert
  to authenticated
  with check (
    (owner_user_id is null and public.is_super_admin())
    or (
      owner_user_id is not null
      and public.can_insert_owned_row(tenant_id, owner_user_id)
    )
  );

drop policy if exists "authenticated_insert_llm_specs" on public.llm_specs;
create policy "authenticated_insert_llm_specs"
  on public.llm_specs
  for insert
  to authenticated
  with check (public.can_insert_owned_row(tenant_id, created_by));

drop policy if exists "owned_insert_employers" on public.employers;
create policy "owned_insert_employers"
  on public.employers
  for insert
  to authenticated
  with check (public.can_insert_owned_row(tenant_id, owner_user_id));

drop policy if exists "owned_insert_mentor_groups" on public.mentor_groups;
create policy "owned_insert_mentor_groups"
  on public.mentor_groups
  for insert
  to authenticated
  with check (public.can_insert_owned_row(tenant_id, owner_user_id));

drop policy if exists "owned_insert_mentorbooking_events" on public.mentorbooking_events;
create policy "owned_insert_mentorbooking_events"
  on public.mentorbooking_events
  for insert
  to authenticated
  with check (public.can_insert_owned_row(tenant_id, owner_user_id));

drop policy if exists "owned_insert_mentorbooking_notifications" on public.mentorbooking_notifications;
create policy "owned_insert_mentorbooking_notifications"
  on public.mentorbooking_notifications
  for insert
  to authenticated
  with check (
    public.is_content_admin()
    or (
      user_id = public.current_user_id()
      and public.is_tenant_member(coalesce(tenant_id, public.current_tenant_id()))
    )
  );

drop policy if exists "owned_insert_mentorbooking_products" on public.mentorbooking_products;
create policy "owned_insert_mentorbooking_products"
  on public.mentorbooking_products
  for insert
  to authenticated
  with check (public.can_insert_owned_row(tenant_id, owner_user_id));

drop policy if exists "insert_page_schema_templates" on public.page_schema_templates;
create policy "insert_page_schema_templates"
  on public.page_schema_templates
  for insert
  to authenticated
  with check (
    (visibility = 'system' and public.is_super_admin())
    or (
      visibility <> 'system'
      and public.can_insert_owned_row(tenant_id, owner_user_id)
    )
  );