create or replace function public.can_access_owned_row(row_tenant_id uuid, row_owner_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when row_owner_user_id is null then public.is_content_admin()
    else public.can_administer_user_in_tenant(
      coalesce(row_tenant_id, public.default_tenant_for_user(row_owner_user_id)),
      row_owner_user_id
    )
  end
$$;

drop trigger if exists set_mentor_groups_updated_at on public.mentor_groups;
create trigger set_mentor_groups_updated_at
before update on public.mentor_groups
for each row
execute function public.set_current_timestamp_updated_at();

alter table public.companies enable row level security;
alter table public.forms enable row level security;
alter table public.forms_answers enable row level security;
alter table public.form_notification_settings enable row level security;
alter table public.form_notification_recipients enable row level security;
alter table public.objects enable row level security;
alter table public.pages enable row level security;
alter table public.page_schemas enable row level security;
alter table public.page_schema_specs enable row level security;
alter table public.llm_specs enable row level security;
alter table public.employers enable row level security;
alter table public.mentor_groups enable row level security;
alter table public.mentorbooking_events enable row level security;
alter table public.mentorbooking_notifications enable row level security;
alter table public.mentorbooking_products enable row level security;
alter table public.page_schema_templates enable row level security;
alter table public.staff enable row level security;
alter table public.staff_traits enable row level security;
alter table public.staff_trait_assignments enable row level security;
alter table public.managed_secrets enable row level security;
alter table public.system_config enable row level security;

drop policy if exists "authenticated_select_companies" on public.companies;
drop policy if exists "event_staff_insert_companies" on public.companies;
drop policy if exists "event_staff_update_companies" on public.companies;
drop policy if exists "admin_delete_companies" on public.companies;

create policy "owned_select_companies"
  on public.companies
  for select
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id));

create policy "owned_insert_companies"
  on public.companies
  for insert
  to authenticated
  with check (
    public.is_content_admin()
    or (
      owner_user_id = public.current_user_id()
      and coalesce(tenant_id, public.current_tenant_id()) = public.current_tenant_id()
    )
  );

create policy "owned_update_companies"
  on public.companies
  for update
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id))
  with check (public.can_access_owned_row(tenant_id, owner_user_id));

create policy "owned_delete_companies"
  on public.companies
  for delete
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id));

drop policy if exists "authenticated_select_forms" on public.forms;
drop policy if exists "user_insert_forms" on public.forms;
drop policy if exists "user_update_forms" on public.forms;
drop policy if exists "admin_delete_forms" on public.forms;

create policy "authenticated_select_forms"
  on public.forms
  for select
  to authenticated
  using (
    public.can_access_owned_row(tenant_id, owner_user_id)
    or (
      status = 'published'
      and (share_enabled = true or api_enabled = true)
    )
  );

create policy "user_insert_forms"
  on public.forms
  for insert
  to authenticated
  with check (
    public.is_content_admin()
    or (
      owner_user_id = public.current_user_id()
      and coalesce(tenant_id, public.current_tenant_id()) = public.current_tenant_id()
    )
  );

create policy "user_update_forms"
  on public.forms
  for update
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id))
  with check (public.can_access_owned_row(tenant_id, owner_user_id));

create policy "admin_delete_forms"
  on public.forms
  for delete
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id));

drop policy if exists "user_select_forms_answers" on public.forms_answers;
drop policy if exists "admin_delete_forms_answers" on public.forms_answers;

create policy "user_select_forms_answers"
  on public.forms_answers
  for select
  to authenticated
  using (
    submitted_by = public.current_user_id()
    or exists (
      select 1
      from public.forms f
      where f.id = forms_answers.form_id
        and public.can_access_owned_row(f.tenant_id, f.owner_user_id)
    )
  );

create policy "admin_delete_forms_answers"
  on public.forms_answers
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.forms f
      where f.id = forms_answers.form_id
        and public.can_access_owned_row(f.tenant_id, f.owner_user_id)
    )
  );

drop policy if exists "authenticated_select_form_notification_settings" on public.form_notification_settings;
drop policy if exists "user_insert_form_notification_settings" on public.form_notification_settings;
drop policy if exists "user_update_form_notification_settings" on public.form_notification_settings;
drop policy if exists "admin_delete_form_notification_settings" on public.form_notification_settings;

create policy "authenticated_select_form_notification_settings"
  on public.form_notification_settings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.forms f
      where f.id = form_notification_settings.form_id
        and public.can_access_owned_row(f.tenant_id, f.owner_user_id)
    )
  );

create policy "user_insert_form_notification_settings"
  on public.form_notification_settings
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.forms f
      where f.id = form_notification_settings.form_id
        and public.can_access_owned_row(f.tenant_id, f.owner_user_id)
    )
  );

create policy "user_update_form_notification_settings"
  on public.form_notification_settings
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.forms f
      where f.id = form_notification_settings.form_id
        and public.can_access_owned_row(f.tenant_id, f.owner_user_id)
    )
  )
  with check (
    exists (
      select 1
      from public.forms f
      where f.id = form_notification_settings.form_id
        and public.can_access_owned_row(f.tenant_id, f.owner_user_id)
    )
  );

create policy "admin_delete_form_notification_settings"
  on public.form_notification_settings
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.forms f
      where f.id = form_notification_settings.form_id
        and public.can_access_owned_row(f.tenant_id, f.owner_user_id)
    )
  );

drop policy if exists "authenticated_select_form_notification_recipients" on public.form_notification_recipients;
drop policy if exists "user_insert_form_notification_recipients" on public.form_notification_recipients;
drop policy if exists "user_update_form_notification_recipients" on public.form_notification_recipients;
drop policy if exists "user_delete_form_notification_recipients" on public.form_notification_recipients;

create policy "authenticated_select_form_notification_recipients"
  on public.form_notification_recipients
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.forms f
      where f.id = form_notification_recipients.form_id
        and public.can_access_owned_row(f.tenant_id, f.owner_user_id)
    )
  );

create policy "user_insert_form_notification_recipients"
  on public.form_notification_recipients
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.forms f
      where f.id = form_notification_recipients.form_id
        and public.can_access_owned_row(f.tenant_id, f.owner_user_id)
    )
  );

create policy "user_update_form_notification_recipients"
  on public.form_notification_recipients
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.forms f
      where f.id = form_notification_recipients.form_id
        and public.can_access_owned_row(f.tenant_id, f.owner_user_id)
    )
  )
  with check (
    exists (
      select 1
      from public.forms f
      where f.id = form_notification_recipients.form_id
        and public.can_access_owned_row(f.tenant_id, f.owner_user_id)
    )
  );

create policy "user_delete_form_notification_recipients"
  on public.form_notification_recipients
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.forms f
      where f.id = form_notification_recipients.form_id
        and public.can_access_owned_row(f.tenant_id, f.owner_user_id)
    )
  );

drop policy if exists "admin_select_objects" on public.objects;
drop policy if exists "admin_insert_objects" on public.objects;
drop policy if exists "admin_update_objects" on public.objects;
drop policy if exists "admin_delete_objects" on public.objects;

create policy "admin_select_objects"
  on public.objects
  for select
  to authenticated
  using (
    public.can_access_owned_row(tenant_id, owner_user_id)
    or (
      status = 'published'
      and api_enabled = true
    )
  );

create policy "admin_insert_objects"
  on public.objects
  for insert
  to authenticated
  with check (
    public.is_content_admin()
    or (
      owner_user_id = public.current_user_id()
      and coalesce(tenant_id, public.current_tenant_id()) = public.current_tenant_id()
    )
  );

create policy "admin_update_objects"
  on public.objects
  for update
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id))
  with check (public.can_access_owned_row(tenant_id, owner_user_id));

create policy "admin_delete_objects"
  on public.objects
  for delete
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id));

drop policy if exists "authenticated_select_pages" on public.pages;
drop policy if exists "staff_insert_pages" on public.pages;
drop policy if exists "staff_update_pages" on public.pages;
drop policy if exists "admin_delete_pages" on public.pages;

create policy "authenticated_select_pages"
  on public.pages
  for select
  to authenticated
  using (
    public.can_access_owned_row(tenant_id, owner_user_id)
    or status = 'published'
  );

create policy "staff_insert_pages"
  on public.pages
  for insert
  to authenticated
  with check (
    public.is_content_admin()
    or (
      owner_user_id = public.current_user_id()
      and coalesce(tenant_id, public.current_tenant_id()) = public.current_tenant_id()
    )
  );

create policy "staff_update_pages"
  on public.pages
  for update
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id))
  with check (public.can_access_owned_row(tenant_id, owner_user_id));

create policy "admin_delete_pages"
  on public.pages
  for delete
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id));

drop policy if exists "anon_select_pages" on public.pages;
create policy "anon_select_pages"
  on public.pages
  for select
  to anon
  using (status = 'published');

drop policy if exists "authenticated_select_page_schemas" on public.page_schemas;
drop policy if exists "anon_select_page_schemas" on public.page_schemas;
drop policy if exists "staff_insert_page_schemas" on public.page_schemas;
drop policy if exists "anon_insert_page_schemas" on public.page_schemas;
drop policy if exists "staff_update_page_schemas" on public.page_schemas;
drop policy if exists "anon_update_page_schemas" on public.page_schemas;
drop policy if exists "admin_delete_page_schemas" on public.page_schemas;

create policy "authenticated_select_page_schemas"
  on public.page_schemas
  for select
  to authenticated
  using (
    owner_user_id is null
    or public.can_access_owned_row(tenant_id, owner_user_id)
  );

create policy "anon_select_page_schemas"
  on public.page_schemas
  for select
  to anon
  using (
    owner_user_id is null
    and (is_default = true or registration_status = 'registered')
  );

create policy "staff_insert_page_schemas"
  on public.page_schemas
  for insert
  to authenticated
  with check (
    (owner_user_id is null and public.is_super_admin())
    or (
      owner_user_id is not null
      and (
        public.is_content_admin()
        or (
          owner_user_id = public.current_user_id()
          and coalesce(tenant_id, public.current_tenant_id()) = public.current_tenant_id()
        )
      )
    )
  );

create policy "staff_update_page_schemas"
  on public.page_schemas
  for update
  to authenticated
  using (
    (owner_user_id is null and public.is_super_admin())
    or public.can_access_owned_row(tenant_id, owner_user_id)
  )
  with check (
    (owner_user_id is null and public.is_super_admin())
    or public.can_access_owned_row(tenant_id, owner_user_id)
  );

create policy "admin_delete_page_schemas"
  on public.page_schemas
  for delete
  to authenticated
  using (
    (owner_user_id is null and public.is_super_admin())
    or public.can_access_owned_row(tenant_id, owner_user_id)
  );

drop policy if exists "authenticated_select_llm_specs" on public.llm_specs;
drop policy if exists "authenticated_insert_llm_specs" on public.llm_specs;
drop policy if exists "authenticated_update_llm_specs" on public.llm_specs;
drop policy if exists "admin_delete_llm_specs" on public.llm_specs;

create policy "authenticated_select_llm_specs"
  on public.llm_specs
  for select
  to authenticated
  using (
    public.can_access_owned_row(tenant_id, created_by)
    or (
      status = 'published'
      and is_public = true
    )
  );

create policy "authenticated_insert_llm_specs"
  on public.llm_specs
  for insert
  to authenticated
  with check (
    public.is_content_admin()
    or (
      created_by = public.current_user_id()
      and coalesce(tenant_id, public.current_tenant_id()) = public.current_tenant_id()
    )
  );

create policy "authenticated_update_llm_specs"
  on public.llm_specs
  for update
  to authenticated
  using (public.can_access_owned_row(tenant_id, created_by))
  with check (public.can_access_owned_row(tenant_id, created_by));

create policy "admin_delete_llm_specs"
  on public.llm_specs
  for delete
  to authenticated
  using (public.can_access_owned_row(tenant_id, created_by));

drop policy if exists "authenticated_select_page_schema_specs" on public.page_schema_specs;
drop policy if exists "authenticated_insert_page_schema_specs" on public.page_schema_specs;
drop policy if exists "authenticated_update_page_schema_specs" on public.page_schema_specs;
drop policy if exists "admin_delete_page_schema_specs" on public.page_schema_specs;

create policy "authenticated_select_page_schema_specs"
  on public.page_schema_specs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.page_schemas ps
      where ps.id = page_schema_specs.schema_id
        and (ps.owner_user_id is null or public.can_access_owned_row(ps.tenant_id, ps.owner_user_id))
    )
    and exists (
      select 1
      from public.llm_specs ls
      where ls.id = page_schema_specs.spec_id
        and (public.can_access_owned_row(ls.tenant_id, ls.created_by) or (ls.status = 'published' and ls.is_public = true))
    )
  );

create policy "authenticated_insert_page_schema_specs"
  on public.page_schema_specs
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.page_schemas ps
      where ps.id = page_schema_specs.schema_id
        and ((ps.owner_user_id is null and public.is_super_admin()) or public.can_access_owned_row(ps.tenant_id, ps.owner_user_id))
    )
    and exists (
      select 1
      from public.llm_specs ls
      where ls.id = page_schema_specs.spec_id
        and public.can_access_owned_row(ls.tenant_id, ls.created_by)
    )
  );

create policy "authenticated_update_page_schema_specs"
  on public.page_schema_specs
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.page_schemas ps
      where ps.id = page_schema_specs.schema_id
        and ((ps.owner_user_id is null and public.is_super_admin()) or public.can_access_owned_row(ps.tenant_id, ps.owner_user_id))
    )
    and exists (
      select 1
      from public.llm_specs ls
      where ls.id = page_schema_specs.spec_id
        and public.can_access_owned_row(ls.tenant_id, ls.created_by)
    )
  )
  with check (
    exists (
      select 1
      from public.page_schemas ps
      where ps.id = page_schema_specs.schema_id
        and ((ps.owner_user_id is null and public.is_super_admin()) or public.can_access_owned_row(ps.tenant_id, ps.owner_user_id))
    )
    and exists (
      select 1
      from public.llm_specs ls
      where ls.id = page_schema_specs.spec_id
        and public.can_access_owned_row(ls.tenant_id, ls.created_by)
    )
  );

create policy "admin_delete_page_schema_specs"
  on public.page_schema_specs
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.page_schemas ps
      where ps.id = page_schema_specs.schema_id
        and ((ps.owner_user_id is null and public.is_super_admin()) or public.can_access_owned_row(ps.tenant_id, ps.owner_user_id))
    )
  );

drop policy if exists "owned_select_employers" on public.employers;
drop policy if exists "owned_insert_employers" on public.employers;
drop policy if exists "owned_update_employers" on public.employers;
drop policy if exists "owned_delete_employers" on public.employers;

create policy "owned_select_employers"
  on public.employers
  for select
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id));

create policy "owned_insert_employers"
  on public.employers
  for insert
  to authenticated
  with check (
    public.is_content_admin()
    or (
      owner_user_id = public.current_user_id()
      and coalesce(tenant_id, public.current_tenant_id()) = public.current_tenant_id()
    )
  );

create policy "owned_update_employers"
  on public.employers
  for update
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id))
  with check (public.can_access_owned_row(tenant_id, owner_user_id));

create policy "owned_delete_employers"
  on public.employers
  for delete
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id));

drop policy if exists "owned_select_mentor_groups" on public.mentor_groups;
drop policy if exists "owned_insert_mentor_groups" on public.mentor_groups;
drop policy if exists "owned_update_mentor_groups" on public.mentor_groups;
drop policy if exists "owned_delete_mentor_groups" on public.mentor_groups;

create policy "owned_select_mentor_groups"
  on public.mentor_groups
  for select
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id));

create policy "owned_insert_mentor_groups"
  on public.mentor_groups
  for insert
  to authenticated
  with check (
    public.is_content_admin()
    or (
      owner_user_id = public.current_user_id()
      and coalesce(tenant_id, public.current_tenant_id()) = public.current_tenant_id()
    )
  );

create policy "owned_update_mentor_groups"
  on public.mentor_groups
  for update
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id))
  with check (public.can_access_owned_row(tenant_id, owner_user_id));

create policy "owned_delete_mentor_groups"
  on public.mentor_groups
  for delete
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id));

drop policy if exists "owned_select_mentorbooking_events" on public.mentorbooking_events;
drop policy if exists "owned_insert_mentorbooking_events" on public.mentorbooking_events;
drop policy if exists "owned_update_mentorbooking_events" on public.mentorbooking_events;
drop policy if exists "owned_delete_mentorbooking_events" on public.mentorbooking_events;

create policy "owned_select_mentorbooking_events"
  on public.mentorbooking_events
  for select
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id));

create policy "owned_insert_mentorbooking_events"
  on public.mentorbooking_events
  for insert
  to authenticated
  with check (
    public.is_content_admin()
    or (
      owner_user_id = public.current_user_id()
      and coalesce(tenant_id, public.current_tenant_id()) = public.current_tenant_id()
    )
  );

create policy "owned_update_mentorbooking_events"
  on public.mentorbooking_events
  for update
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id))
  with check (public.can_access_owned_row(tenant_id, owner_user_id));

create policy "owned_delete_mentorbooking_events"
  on public.mentorbooking_events
  for delete
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id));

drop policy if exists "owned_select_mentorbooking_notifications" on public.mentorbooking_notifications;
drop policy if exists "owned_insert_mentorbooking_notifications" on public.mentorbooking_notifications;
drop policy if exists "owned_update_mentorbooking_notifications" on public.mentorbooking_notifications;
drop policy if exists "owned_delete_mentorbooking_notifications" on public.mentorbooking_notifications;

create policy "owned_select_mentorbooking_notifications"
  on public.mentorbooking_notifications
  for select
  to authenticated
  using (
    public.can_administer_user_in_tenant(
      coalesce(tenant_id, public.default_tenant_for_user(user_id)),
      user_id
    )
  );

create policy "owned_insert_mentorbooking_notifications"
  on public.mentorbooking_notifications
  for insert
  to authenticated
  with check (
    public.is_content_admin()
    or (
      user_id = public.current_user_id()
      and coalesce(tenant_id, public.current_tenant_id()) = public.current_tenant_id()
    )
  );

create policy "owned_update_mentorbooking_notifications"
  on public.mentorbooking_notifications
  for update
  to authenticated
  using (
    public.can_administer_user_in_tenant(
      coalesce(tenant_id, public.default_tenant_for_user(user_id)),
      user_id
    )
  )
  with check (
    public.can_administer_user_in_tenant(
      coalesce(tenant_id, public.default_tenant_for_user(user_id)),
      user_id
    )
  );

create policy "owned_delete_mentorbooking_notifications"
  on public.mentorbooking_notifications
  for delete
  to authenticated
  using (
    public.can_administer_user_in_tenant(
      coalesce(tenant_id, public.default_tenant_for_user(user_id)),
      user_id
    )
  );

drop policy if exists "owned_select_mentorbooking_products" on public.mentorbooking_products;
drop policy if exists "owned_insert_mentorbooking_products" on public.mentorbooking_products;
drop policy if exists "owned_update_mentorbooking_products" on public.mentorbooking_products;
drop policy if exists "owned_delete_mentorbooking_products" on public.mentorbooking_products;

create policy "owned_select_mentorbooking_products"
  on public.mentorbooking_products
  for select
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id));

create policy "owned_insert_mentorbooking_products"
  on public.mentorbooking_products
  for insert
  to authenticated
  with check (
    public.is_content_admin()
    or (
      owner_user_id = public.current_user_id()
      and coalesce(tenant_id, public.current_tenant_id()) = public.current_tenant_id()
    )
  );

create policy "owned_update_mentorbooking_products"
  on public.mentorbooking_products
  for update
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id))
  with check (public.can_access_owned_row(tenant_id, owner_user_id));

create policy "owned_delete_mentorbooking_products"
  on public.mentorbooking_products
  for delete
  to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id));

drop policy if exists "select_page_schema_templates" on public.page_schema_templates;
drop policy if exists "insert_page_schema_templates" on public.page_schema_templates;
drop policy if exists "update_page_schema_templates" on public.page_schema_templates;
drop policy if exists "delete_page_schema_templates" on public.page_schema_templates;

create policy "select_page_schema_templates"
  on public.page_schema_templates
  for select
  to authenticated
  using (
    public.is_content_admin()
    or visibility = 'system'
    or public.can_access_owned_row(tenant_id, owner_user_id)
    or (visibility = 'tenant' and tenant_id is not null and public.is_tenant_member(tenant_id))
  );

create policy "insert_page_schema_templates"
  on public.page_schema_templates
  for insert
  to authenticated
  with check (
    (visibility = 'system' and public.is_super_admin())
    or (
      visibility <> 'system'
      and (
        public.is_content_admin()
        or (
          owner_user_id = public.current_user_id()
          and coalesce(tenant_id, public.current_tenant_id()) = public.current_tenant_id()
        )
      )
    )
  );

create policy "update_page_schema_templates"
  on public.page_schema_templates
  for update
  to authenticated
  using (
    (visibility = 'system' and public.is_super_admin())
    or (
      visibility <> 'system'
      and public.can_access_owned_row(tenant_id, owner_user_id)
    )
  )
  with check (
    (visibility = 'system' and public.is_super_admin())
    or (
      visibility <> 'system'
      and public.can_access_owned_row(tenant_id, owner_user_id)
    )
  );

create policy "delete_page_schema_templates"
  on public.page_schema_templates
  for delete
  to authenticated
  using (
    (visibility = 'system' and public.is_super_admin())
    or (
      visibility <> 'system'
      and public.can_access_owned_row(tenant_id, owner_user_id)
    )
  );

drop policy if exists "authenticated_select_staff" on public.staff;
drop policy if exists "admin_insert_staff" on public.staff;
drop policy if exists "admin_update_staff" on public.staff;
drop policy if exists "admin_delete_staff" on public.staff;

create policy "authenticated_select_staff"
  on public.staff
  for select
  to authenticated
  using (
    public.is_content_admin()
    or (tenant_id is not null and public.is_tenant_member(tenant_id))
  );

create policy "admin_insert_staff"
  on public.staff
  for insert
  to authenticated
  with check (
    public.is_content_admin()
    or (coalesce(tenant_id, public.current_tenant_id()) is not null and public.is_tenant_admin(coalesce(tenant_id, public.current_tenant_id())))
  );

create policy "admin_update_staff"
  on public.staff
  for update
  to authenticated
  using (
    public.is_content_admin()
    or (tenant_id is not null and public.is_tenant_admin(tenant_id))
  )
  with check (
    public.is_content_admin()
    or (tenant_id is not null and public.is_tenant_admin(tenant_id))
  );

create policy "admin_delete_staff"
  on public.staff
  for delete
  to authenticated
  using (
    public.is_content_admin()
    or (tenant_id is not null and public.is_tenant_admin(tenant_id))
  );

drop policy if exists "authenticated_select_staff_traits" on public.staff_traits;
drop policy if exists "admin_insert_staff_traits" on public.staff_traits;
drop policy if exists "admin_update_staff_traits" on public.staff_traits;
drop policy if exists "admin_delete_staff_traits" on public.staff_traits;

create policy "authenticated_select_staff_traits"
  on public.staff_traits
  for select
  to authenticated
  using (
    public.is_content_admin()
    or (tenant_id is not null and public.is_tenant_member(tenant_id))
  );

create policy "admin_insert_staff_traits"
  on public.staff_traits
  for insert
  to authenticated
  with check (
    public.is_content_admin()
    or (coalesce(tenant_id, public.current_tenant_id()) is not null and public.is_tenant_admin(coalesce(tenant_id, public.current_tenant_id())))
  );

create policy "admin_update_staff_traits"
  on public.staff_traits
  for update
  to authenticated
  using (
    public.is_content_admin()
    or (tenant_id is not null and public.is_tenant_admin(tenant_id))
  )
  with check (
    public.is_content_admin()
    or (tenant_id is not null and public.is_tenant_admin(tenant_id))
  );

create policy "admin_delete_staff_traits"
  on public.staff_traits
  for delete
  to authenticated
  using (
    public.is_content_admin()
    or (tenant_id is not null and public.is_tenant_admin(tenant_id))
  );

drop policy if exists "authenticated_select_staff_trait_assignments" on public.staff_trait_assignments;
drop policy if exists "admin_insert_staff_trait_assignments" on public.staff_trait_assignments;
drop policy if exists "admin_update_staff_trait_assignments" on public.staff_trait_assignments;
drop policy if exists "admin_delete_staff_trait_assignments" on public.staff_trait_assignments;

create policy "authenticated_select_staff_trait_assignments"
  on public.staff_trait_assignments
  for select
  to authenticated
  using (
    public.is_content_admin()
    or (tenant_id is not null and public.is_tenant_member(tenant_id))
  );

create policy "admin_insert_staff_trait_assignments"
  on public.staff_trait_assignments
  for insert
  to authenticated
  with check (
    public.is_content_admin()
    or (coalesce(tenant_id, public.current_tenant_id()) is not null and public.is_tenant_admin(coalesce(tenant_id, public.current_tenant_id())))
  );

create policy "admin_update_staff_trait_assignments"
  on public.staff_trait_assignments
  for update
  to authenticated
  using (
    public.is_content_admin()
    or (tenant_id is not null and public.is_tenant_admin(tenant_id))
  )
  with check (
    public.is_content_admin()
    or (tenant_id is not null and public.is_tenant_admin(tenant_id))
  );

create policy "admin_delete_staff_trait_assignments"
  on public.staff_trait_assignments
  for delete
  to authenticated
  using (
    public.is_content_admin()
    or (tenant_id is not null and public.is_tenant_admin(tenant_id))
  );

drop policy if exists "super_admin_select_managed_secrets" on public.managed_secrets;
drop policy if exists "super_admin_insert_managed_secrets" on public.managed_secrets;
drop policy if exists "super_admin_update_managed_secrets" on public.managed_secrets;
drop policy if exists "super_admin_delete_managed_secrets" on public.managed_secrets;

create policy "super_admin_select_managed_secrets"
  on public.managed_secrets
  for select
  to authenticated
  using (public.is_super_admin());

create policy "super_admin_insert_managed_secrets"
  on public.managed_secrets
  for insert
  to authenticated
  with check (public.is_super_admin());

create policy "super_admin_update_managed_secrets"
  on public.managed_secrets
  for update
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "super_admin_delete_managed_secrets"
  on public.managed_secrets
  for delete
  to authenticated
  using (public.is_super_admin());

drop policy if exists "super_admin_select_system_config" on public.system_config;
drop policy if exists "super_admin_insert_system_config" on public.system_config;
drop policy if exists "super_admin_update_system_config" on public.system_config;
drop policy if exists "super_admin_delete_system_config" on public.system_config;

create policy "super_admin_select_system_config"
  on public.system_config
  for select
  to authenticated
  using (public.is_super_admin());

create policy "super_admin_insert_system_config"
  on public.system_config
  for insert
  to authenticated
  with check (public.is_super_admin());

create policy "super_admin_update_system_config"
  on public.system_config
  for update
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "super_admin_delete_system_config"
  on public.system_config
  for delete
  to authenticated
  using (public.is_super_admin());

drop policy if exists "admin_insert_plugins" on public.plugins;
drop policy if exists "admin_update_plugins" on public.plugins;
drop policy if exists "admin_delete_plugins" on public.plugins;

create policy "admin_insert_plugins"
  on public.plugins
  for insert
  to authenticated
  with check (public.is_super_admin());

create policy "admin_update_plugins"
  on public.plugins
  for update
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "admin_delete_plugins"
  on public.plugins
  for delete
  to authenticated
  using (public.is_super_admin());