create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  created_by uuid null references public.user_profile(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_slug_key unique (slug),
  constraint tenants_slug_check check (btrim(slug) <> ''),
  constraint tenants_name_check check (btrim(name) <> '')
) tablespace pg_default;

create index if not exists idx_tenants_created_by on public.tenants using btree (created_by) tablespace pg_default;

drop trigger if exists set_tenants_updated_at on public.tenants;
create trigger set_tenants_updated_at
before update on public.tenants
for each row
execute function public.set_current_timestamp_updated_at();

create table if not exists public.tenant_users (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.user_profile(user_id) on delete cascade,
  is_tenant_admin boolean not null default false,
  status text not null default 'active',
  invited_by uuid null references public.user_profile(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_users_pkey primary key (tenant_id, user_id),
  constraint tenant_users_status_check check (status = any (array['active'::text, 'invited'::text, 'suspended'::text]))
) tablespace pg_default;

create index if not exists idx_tenant_users_user_id on public.tenant_users using btree (user_id) tablespace pg_default;
create index if not exists idx_tenant_users_admin_lookup on public.tenant_users using btree (tenant_id, is_tenant_admin, status) tablespace pg_default;

drop trigger if exists set_tenant_users_updated_at on public.tenant_users;
create trigger set_tenant_users_updated_at
before update on public.tenant_users
for each row
execute function public.set_current_timestamp_updated_at();

create or replace function public.current_user_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    auth.uid(),
    nullif((current_setting('request.jwt.claims', true))::jsonb ->> 'sub', '')::uuid
  )
$$;

alter table public.tenants
  alter column created_by set default public.current_user_id();

create or replace function public.current_user_roles()
returns text[]
language sql
stable
as $$
  select coalesce(
    array(
      select jsonb_array_elements_text(
        coalesce((current_setting('request.jwt.claims', true))::jsonb -> 'user_roles', '[]'::jsonb)
      )
    ),
    '{}'::text[]
  )
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select coalesce('super-admin' = any(public.current_user_roles()), false)
$$;

create or replace function public.is_content_admin()
returns boolean
language sql
stable
as $$
  select coalesce(public.current_user_roles() && array['admin', 'super-admin'], false)
$$;

create or replace function public.is_tenant_member(target_tenant_id uuid, target_user_id uuid default public.current_user_id())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = target_tenant_id
      and tu.user_id = target_user_id
      and tu.status = 'active'
  )
$$;

create or replace function public.is_tenant_admin(target_tenant_id uuid, target_user_id uuid default public.current_user_id())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = target_tenant_id
      and tu.user_id = target_user_id
      and tu.status = 'active'
      and tu.is_tenant_admin
  )
$$;

create or replace function public.can_administer_user_in_tenant(target_tenant_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_content_admin()
    or target_user_id = public.current_user_id()
    or (
      public.is_tenant_admin(target_tenant_id)
      and exists (
        select 1
        from public.tenant_users tu
        where tu.tenant_id = target_tenant_id
          and tu.user_id = target_user_id
          and tu.status = 'active'
      )
    )
$$;

create or replace function public.create_default_tenant_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.tenant_users (tenant_id, user_id, is_tenant_admin, status, invited_by)
    values (new.id, new.created_by, true, 'active', new.created_by)
    on conflict (tenant_id, user_id) do update
    set is_tenant_admin = excluded.is_tenant_admin,
        status = excluded.status,
        invited_by = excluded.invited_by,
        updated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists create_default_tenant_membership_trigger on public.tenants;
create trigger create_default_tenant_membership_trigger
after insert on public.tenants
for each row
execute function public.create_default_tenant_membership();

alter table public.tenants enable row level security;
alter table public.tenant_users enable row level security;

drop policy if exists "tenant_members_can_select_tenants" on public.tenants;
drop policy if exists "authenticated_insert_tenants" on public.tenants;
drop policy if exists "tenant_admins_update_tenants" on public.tenants;
drop policy if exists "super_admin_delete_tenants" on public.tenants;

create policy "tenant_members_can_select_tenants"
  on public.tenants
  for select
  to authenticated
  using (
    public.is_super_admin()
    or public.is_tenant_member(id)
  );

create policy "authenticated_insert_tenants"
  on public.tenants
  for insert
  to authenticated
  with check (
    public.current_user_id() is not null
    and created_by = public.current_user_id()
  );

create policy "tenant_admins_update_tenants"
  on public.tenants
  for update
  to authenticated
  using (
    public.is_super_admin()
    or public.is_tenant_admin(id)
  )
  with check (
    public.is_super_admin()
    or public.is_tenant_admin(id)
  );

create policy "super_admin_delete_tenants"
  on public.tenants
  for delete
  to authenticated
  using (public.is_super_admin());

drop policy if exists "self_or_admin_select_tenant_users" on public.tenant_users;
drop policy if exists "tenant_admin_insert_tenant_users" on public.tenant_users;
drop policy if exists "self_or_admin_update_tenant_users" on public.tenant_users;
drop policy if exists "tenant_admin_delete_tenant_users" on public.tenant_users;

create policy "self_or_admin_select_tenant_users"
  on public.tenant_users
  for select
  to authenticated
  using (
    public.is_super_admin()
    or user_id = public.current_user_id()
    or public.is_tenant_admin(tenant_id)
  );

create policy "tenant_admin_insert_tenant_users"
  on public.tenant_users
  for insert
  to authenticated
  with check (
    public.is_super_admin()
    or public.is_tenant_admin(tenant_id)
  );

create policy "self_or_admin_update_tenant_users"
  on public.tenant_users
  for update
  to authenticated
  using (
    public.is_super_admin()
    or public.can_administer_user_in_tenant(tenant_id, user_id)
  )
  with check (
    public.is_super_admin()
    or public.can_administer_user_in_tenant(tenant_id, user_id)
  );

create policy "tenant_admin_delete_tenant_users"
  on public.tenant_users
  for delete
  to authenticated
  using (
    public.is_super_admin()
    or public.is_tenant_admin(tenant_id)
  );