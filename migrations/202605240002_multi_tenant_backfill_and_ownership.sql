create or replace function public.default_tenant_for_user(target_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tu.tenant_id
  from public.tenant_users tu
  join public.tenants t on t.id = tu.tenant_id
  where tu.user_id = target_user_id
    and tu.status = 'active'
  order by tu.is_tenant_admin desc, t.created_at asc
  limit 1
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
as $$
  select public.default_tenant_for_user(public.current_user_id())
$$;

alter table public.tenants
  add column if not exists default_for_user_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenants_default_for_user_id_fkey'
  ) then
    alter table public.tenants
      add constraint tenants_default_for_user_id_fkey
      foreign key (default_for_user_id)
      references public.user_profile(user_id)
      on delete set null;
  end if;
end $$;

create unique index if not exists idx_tenants_default_for_user_id
  on public.tenants using btree (default_for_user_id)
  where default_for_user_id is not null;

create or replace function public.ensure_default_tenant_for_user(target_user_id uuid, target_username text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_tenant_id uuid;
  resolved_slug text;
  resolved_name text;
begin
  if target_user_id is null then
    return null;
  end if;

  resolved_slug := 'workspace-' || replace(target_user_id::text, '-', '');
  resolved_name := coalesce(nullif(btrim(target_username), ''), 'Workspace ' || left(target_user_id::text, 8));

    insert into public.tenants (slug, name, created_by, default_for_user_id)
    values (resolved_slug, resolved_name, target_user_id, target_user_id)
  on conflict (slug) do update
  set name = excluded.name,
      default_for_user_id = excluded.default_for_user_id,
      updated_at = now()
  returning id into resolved_tenant_id;

  insert into public.tenant_users (tenant_id, user_id, is_tenant_admin, status, invited_by)
  values (resolved_tenant_id, target_user_id, true, 'active', target_user_id)
  on conflict (tenant_id, user_id) do update
  set is_tenant_admin = excluded.is_tenant_admin,
      status = excluded.status,
      invited_by = excluded.invited_by,
      updated_at = now();

  return resolved_tenant_id;
end;
$$;

create or replace function public.create_default_tenant_for_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_default_tenant_for_user(new.user_id, new."Username");
  return new;
end;
$$;

drop trigger if exists create_default_tenant_for_profile_trigger on public.user_profile;
create trigger create_default_tenant_for_profile_trigger
after insert on public.user_profile
for each row
execute function public.create_default_tenant_for_profile();

select public.ensure_default_tenant_for_user(up.user_id, up."Username")
from public.user_profile up;

update public.tenants t
set default_for_user_id = t.created_by
where t.default_for_user_id is null
  and t.created_by is not null
  and t.slug = 'workspace-' || replace(t.created_by::text, '-', '');

alter table public.companies
  add column if not exists owner_user_id uuid null,
  add column if not exists tenant_id uuid null;

alter table public.forms
  add column if not exists tenant_id uuid null;

alter table public.objects
  add column if not exists owner_user_id uuid null,
  add column if not exists tenant_id uuid null;

alter table public.pages
  add column if not exists owner_user_id uuid null,
  add column if not exists tenant_id uuid null;

alter table public.page_schemas
  add column if not exists owner_user_id uuid null,
  add column if not exists tenant_id uuid null;

alter table public.llm_specs
  add column if not exists tenant_id uuid null;

alter table public.page_schema_specs
  add column if not exists tenant_id uuid null;

alter table public.employers
  add column if not exists owner_user_id uuid null,
  add column if not exists tenant_id uuid null;

alter table public.mentor_groups
  add column if not exists owner_user_id uuid null,
  add column if not exists tenant_id uuid null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.mentorbooking_events
  add column if not exists owner_user_id uuid null,
  add column if not exists tenant_id uuid null;

alter table public.mentorbooking_notifications
  add column if not exists tenant_id uuid null;

alter table public.mentorbooking_products
  add column if not exists owner_user_id uuid null,
  add column if not exists tenant_id uuid null;

alter table public.page_schema_templates
  add column if not exists owner_user_id uuid null,
  add column if not exists tenant_id uuid null,
  add column if not exists visibility text not null default 'private';

alter table public.staff
  add column if not exists tenant_id uuid null;

alter table public.staff_traits
  add column if not exists tenant_id uuid null;

alter table public.staff_trait_assignments
  add column if not exists tenant_id uuid null;

alter table public.managed_secrets
  add column if not exists created_by uuid null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'companies_owner_user_id_fkey') then
    alter table public.companies
      add constraint companies_owner_user_id_fkey
      foreign key (owner_user_id)
      references public.user_profile(user_id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'companies_tenant_id_fkey') then
    alter table public.companies
      add constraint companies_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'forms_tenant_id_fkey') then
    alter table public.forms
      add constraint forms_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'objects_owner_user_id_fkey') then
    alter table public.objects
      add constraint objects_owner_user_id_fkey
      foreign key (owner_user_id)
      references public.user_profile(user_id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'objects_tenant_id_fkey') then
    alter table public.objects
      add constraint objects_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pages_owner_user_id_fkey') then
    alter table public.pages
      add constraint pages_owner_user_id_fkey
      foreign key (owner_user_id)
      references public.user_profile(user_id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pages_tenant_id_fkey') then
    alter table public.pages
      add constraint pages_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'page_schemas_owner_user_id_fkey') then
    alter table public.page_schemas
      add constraint page_schemas_owner_user_id_fkey
      foreign key (owner_user_id)
      references public.user_profile(user_id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'page_schemas_tenant_id_fkey') then
    alter table public.page_schemas
      add constraint page_schemas_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'llm_specs_tenant_id_fkey') then
    alter table public.llm_specs
      add constraint llm_specs_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'page_schema_specs_tenant_id_fkey') then
    alter table public.page_schema_specs
      add constraint page_schema_specs_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'employers_owner_user_id_fkey') then
    alter table public.employers
      add constraint employers_owner_user_id_fkey
      foreign key (owner_user_id)
      references public.user_profile(user_id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'employers_tenant_id_fkey') then
    alter table public.employers
      add constraint employers_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'mentor_groups_owner_user_id_fkey') then
    alter table public.mentor_groups
      add constraint mentor_groups_owner_user_id_fkey
      foreign key (owner_user_id)
      references public.user_profile(user_id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'mentor_groups_tenant_id_fkey') then
    alter table public.mentor_groups
      add constraint mentor_groups_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'mentorbooking_events_owner_user_id_fkey') then
    alter table public.mentorbooking_events
      add constraint mentorbooking_events_owner_user_id_fkey
      foreign key (owner_user_id)
      references public.user_profile(user_id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'mentorbooking_events_tenant_id_fkey') then
    alter table public.mentorbooking_events
      add constraint mentorbooking_events_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'mentorbooking_notifications_tenant_id_fkey') then
    alter table public.mentorbooking_notifications
      add constraint mentorbooking_notifications_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'mentorbooking_products_owner_user_id_fkey') then
    alter table public.mentorbooking_products
      add constraint mentorbooking_products_owner_user_id_fkey
      foreign key (owner_user_id)
      references public.user_profile(user_id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'mentorbooking_products_tenant_id_fkey') then
    alter table public.mentorbooking_products
      add constraint mentorbooking_products_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'page_schema_templates_owner_user_id_fkey') then
    alter table public.page_schema_templates
      add constraint page_schema_templates_owner_user_id_fkey
      foreign key (owner_user_id)
      references public.user_profile(user_id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'page_schema_templates_tenant_id_fkey') then
    alter table public.page_schema_templates
      add constraint page_schema_templates_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'staff_tenant_id_fkey') then
    alter table public.staff
      add constraint staff_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'staff_traits_tenant_id_fkey') then
    alter table public.staff_traits
      add constraint staff_traits_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'staff_trait_assignments_tenant_id_fkey') then
    alter table public.staff_trait_assignments
      add constraint staff_trait_assignments_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants(id)
      on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'managed_secrets_created_by_fkey') then
    alter table public.managed_secrets
      add constraint managed_secrets_created_by_fkey
      foreign key (created_by)
      references public.user_profile(user_id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_companies_owner_user_id on public.companies using btree (owner_user_id) tablespace pg_default;
create index if not exists idx_companies_tenant_id on public.companies using btree (tenant_id) tablespace pg_default;
create index if not exists idx_forms_tenant_id on public.forms using btree (tenant_id) tablespace pg_default;
create index if not exists idx_objects_owner_user_id on public.objects using btree (owner_user_id) tablespace pg_default;
create index if not exists idx_objects_tenant_id on public.objects using btree (tenant_id) tablespace pg_default;
create index if not exists idx_pages_owner_user_id on public.pages using btree (owner_user_id) tablespace pg_default;
create index if not exists idx_pages_tenant_id on public.pages using btree (tenant_id) tablespace pg_default;
create index if not exists idx_page_schemas_owner_user_id on public.page_schemas using btree (owner_user_id) tablespace pg_default;
create index if not exists idx_page_schemas_tenant_id on public.page_schemas using btree (tenant_id) tablespace pg_default;
create index if not exists idx_llm_specs_tenant_id on public.llm_specs using btree (tenant_id) tablespace pg_default;
create index if not exists idx_page_schema_specs_tenant_id on public.page_schema_specs using btree (tenant_id) tablespace pg_default;
create index if not exists idx_employers_owner_user_id on public.employers using btree (owner_user_id) tablespace pg_default;
create index if not exists idx_employers_tenant_id on public.employers using btree (tenant_id) tablespace pg_default;
create index if not exists idx_mentor_groups_owner_user_id on public.mentor_groups using btree (owner_user_id) tablespace pg_default;
create index if not exists idx_mentor_groups_tenant_id on public.mentor_groups using btree (tenant_id) tablespace pg_default;
create index if not exists idx_events_owner_user_id on public.mentorbooking_events using btree (owner_user_id) tablespace pg_default;
create index if not exists idx_events_tenant_id on public.mentorbooking_events using btree (tenant_id) tablespace pg_default;
create index if not exists idx_notifications_tenant_id on public.mentorbooking_notifications using btree (tenant_id) tablespace pg_default;
create index if not exists idx_mentorbooking_products_owner_user_id on public.mentorbooking_products using btree (owner_user_id) tablespace pg_default;
create index if not exists idx_mentorbooking_products_tenant_id on public.mentorbooking_products using btree (tenant_id) tablespace pg_default;
create index if not exists idx_page_schema_templates_owner_user_id on public.page_schema_templates using btree (owner_user_id) tablespace pg_default;
create index if not exists idx_page_schema_templates_tenant_id on public.page_schema_templates using btree (tenant_id) tablespace pg_default;
create index if not exists idx_staff_tenant_id on public.staff using btree (tenant_id) tablespace pg_default;
create index if not exists idx_staff_traits_tenant_id on public.staff_traits using btree (tenant_id) tablespace pg_default;
create index if not exists idx_staff_trait_assignments_tenant_id on public.staff_trait_assignments using btree (tenant_id) tablespace pg_default;
create index if not exists idx_managed_secrets_created_by on public.managed_secrets using btree (created_by) tablespace pg_default;

alter table public.companies alter column owner_user_id set default public.current_user_id();
alter table public.companies alter column tenant_id set default public.current_tenant_id();
alter table public.forms alter column tenant_id set default public.current_tenant_id();
alter table public.objects alter column owner_user_id set default public.current_user_id();
alter table public.objects alter column tenant_id set default public.current_tenant_id();
alter table public.pages alter column owner_user_id set default public.current_user_id();
alter table public.pages alter column tenant_id set default public.current_tenant_id();
alter table public.page_schemas alter column owner_user_id set default public.current_user_id();
alter table public.page_schemas alter column tenant_id set default public.current_tenant_id();
alter table public.llm_specs alter column created_by set default public.current_user_id();
alter table public.llm_specs alter column tenant_id set default public.current_tenant_id();
alter table public.page_schema_specs alter column tenant_id set default public.current_tenant_id();
alter table public.employers alter column owner_user_id set default public.current_user_id();
alter table public.employers alter column tenant_id set default public.current_tenant_id();
alter table public.mentor_groups alter column owner_user_id set default public.current_user_id();
alter table public.mentor_groups alter column tenant_id set default public.current_tenant_id();
alter table public.mentorbooking_events alter column owner_user_id set default public.current_user_id();
alter table public.mentorbooking_events alter column tenant_id set default public.current_tenant_id();
alter table public.mentorbooking_notifications alter column tenant_id set default public.current_tenant_id();
alter table public.mentorbooking_products alter column owner_user_id set default public.current_user_id();
alter table public.mentorbooking_products alter column tenant_id set default public.current_tenant_id();
alter table public.page_schema_templates alter column owner_user_id set default public.current_user_id();
alter table public.page_schema_templates alter column tenant_id set default public.current_tenant_id();
alter table public.staff alter column tenant_id set default public.current_tenant_id();
alter table public.staff_traits alter column tenant_id set default public.current_tenant_id();
alter table public.staff_trait_assignments alter column tenant_id set default public.current_tenant_id();
alter table public.managed_secrets alter column created_by set default public.current_user_id();

update public.companies c
set owner_user_id = coalesce(
      c.owner_user_id,
      c.created_by,
      case
        when c.custom_data ? 'legacy_user_id'
          and (c.custom_data ->> 'legacy_user_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (c.custom_data ->> 'legacy_user_id')::uuid
        else null
      end
    ),
    tenant_id = coalesce(c.tenant_id, public.default_tenant_for_user(coalesce(
      c.owner_user_id,
      c.created_by,
      case
        when c.custom_data ? 'legacy_user_id'
          and (c.custom_data ->> 'legacy_user_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (c.custom_data ->> 'legacy_user_id')::uuid
        else null
      end
    )));

  update public.forms f
  set tenant_id = coalesce(f.tenant_id, public.default_tenant_for_user(f.owner_user_id));

  update public.objects o
  set owner_user_id = coalesce(o.owner_user_id, public.current_user_id()),
     tenant_id = coalesce(o.tenant_id, public.default_tenant_for_user(o.owner_user_id), public.current_tenant_id())
  where o.owner_user_id is not null
    or public.current_user_id() is not null;

  update public.pages p
  set owner_user_id = coalesce(p.owner_user_id, public.current_user_id()),
     tenant_id = coalesce(p.tenant_id, public.default_tenant_for_user(p.owner_user_id), public.current_tenant_id())
  where p.owner_user_id is not null
    or public.current_user_id() is not null;

  update public.page_schemas ps
  set owner_user_id = coalesce(ps.owner_user_id, public.current_user_id()),
     tenant_id = coalesce(ps.tenant_id, public.default_tenant_for_user(ps.owner_user_id), public.current_tenant_id())
  where ps.owner_user_id is not null
    or public.current_user_id() is not null;

  update public.llm_specs ls
  set tenant_id = coalesce(ls.tenant_id, public.default_tenant_for_user(ls.created_by));

  update public.page_schema_specs pss
  set tenant_id = coalesce(pss.tenant_id, ps.tenant_id, ls.tenant_id)
  from public.page_schemas ps
  left join public.llm_specs ls on ls.id = pss.spec_id
  where pss.schema_id = ps.id;

update public.employers e
set owner_user_id = coalesce(e.owner_user_id, e.user_id, e.created_by),
    tenant_id = coalesce(e.tenant_id, public.default_tenant_for_user(coalesce(e.owner_user_id, e.user_id, e.created_by)));

update public.mentor_groups mg
set owner_user_id = coalesce(mg.owner_user_id, mg.created_by),
    tenant_id = coalesce(mg.tenant_id, public.default_tenant_for_user(coalesce(mg.owner_user_id, mg.created_by)));

update public.mentorbooking_events e
set owner_user_id = coalesce(e.owner_user_id, c.owner_user_id, c.created_by),
    tenant_id = coalesce(e.tenant_id, c.tenant_id, public.default_tenant_for_user(coalesce(e.owner_user_id, c.owner_user_id, c.created_by)))
from public.companies c
where e.company_id = c.id;

update public.mentorbooking_notifications n
set tenant_id = coalesce(n.tenant_id, public.default_tenant_for_user(n.user_id));

update public.page_schema_templates pst
set visibility = case
      when pst.owner_user_id is null and pst.source_schema_id is not null then 'system'
      else pst.visibility
    end,
    tenant_id = coalesce(pst.tenant_id, public.default_tenant_for_user(pst.owner_user_id));

update public.staff s
set tenant_id = coalesce(s.tenant_id, public.default_tenant_for_user(coalesce(s.account_user_id, s.created_by)));

update public.staff_traits st
set tenant_id = coalesce(st.tenant_id, public.default_tenant_for_user(st.created_by));

update public.staff_trait_assignments sta
set tenant_id = coalesce(sta.tenant_id, s.tenant_id, st.tenant_id)
from public.staff s
join public.staff_traits st on st.id = sta.trait_id
where sta.staff_id = s.id;

update public.managed_secrets ms
set created_by = coalesce(ms.created_by, public.current_user_id())
where ms.created_by is null
  and public.current_user_id() is not null;

alter table public.page_schema_templates
  drop constraint if exists page_schema_templates_visibility_check;

alter table public.page_schema_templates
  add constraint page_schema_templates_visibility_check
  check (visibility = any (array['private'::text, 'tenant'::text, 'system'::text]));