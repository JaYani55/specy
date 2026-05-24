alter table public.plugins
  add column if not exists tenant_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'plugins_tenant_id_fkey'
  ) then
    alter table public.plugins
      add constraint plugins_tenant_id_fkey
      foreign key (tenant_id)
      references public.tenants (id)
      on update cascade
      on delete set null;
  end if;
end $$;

create index if not exists idx_plugins_tenant_id on public.plugins using btree (tenant_id) tablespace pg_default;

drop policy if exists "authenticated_select_plugins" on public.plugins;
drop policy if exists "tenant_aware_select_plugins" on public.plugins;
drop policy if exists "admin_insert_plugins" on public.plugins;
drop policy if exists "tenant_aware_insert_plugins" on public.plugins;
drop policy if exists "admin_update_plugins" on public.plugins;
drop policy if exists "tenant_aware_update_plugins" on public.plugins;
drop policy if exists "admin_delete_plugins" on public.plugins;
drop policy if exists "tenant_aware_delete_plugins" on public.plugins;

create policy "tenant_aware_select_plugins"
  on public.plugins
  for select
  to authenticated
  using (
    kind = 'plugin'
    or public.is_content_admin()
    or (
      kind = 'webapp'
      and tenant_id is not null
      and public.is_tenant_member(tenant_id)
    )
  );

create policy "tenant_aware_insert_plugins"
  on public.plugins
  for insert
  to authenticated
  with check (
    (kind = 'plugin' and public.is_super_admin())
    or (
      kind = 'webapp'
      and tenant_id is not null
      and (
        public.is_content_admin()
        or public.is_tenant_admin(tenant_id)
      )
    )
  );

create policy "tenant_aware_update_plugins"
  on public.plugins
  for update
  to authenticated
  using (
    (kind = 'plugin' and public.is_super_admin())
    or (
      kind = 'webapp'
      and (
        public.is_content_admin()
        or (tenant_id is not null and public.is_tenant_admin(tenant_id))
      )
    )
  )
  with check (
    (kind = 'plugin' and public.is_super_admin())
    or (
      kind = 'webapp'
      and tenant_id is not null
      and (
        public.is_content_admin()
        or public.is_tenant_admin(tenant_id)
      )
    )
  );

create policy "tenant_aware_delete_plugins"
  on public.plugins
  for delete
  to authenticated
  using (
    (kind = 'plugin' and public.is_super_admin())
    or (
      kind = 'webapp'
      and (
        public.is_content_admin()
        or (tenant_id is not null and public.is_tenant_admin(tenant_id))
      )
    )
  );