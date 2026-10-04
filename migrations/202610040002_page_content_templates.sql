-- Page content templates are scoped to one schema and never store operational
-- event data; they contain only a reusable page title and content JSON.

create table if not exists public.page_content_templates (
  id uuid primary key default gen_random_uuid(),
  schema_id uuid not null references public.page_schemas(id) on update cascade on delete cascade,
  tenant_id uuid null references public.tenants(id) on update cascade on delete cascade,
  owner_user_id uuid not null references auth.users(id) on update cascade on delete cascade default public.current_user_id(),
  name text not null,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint page_content_templates_name_check check (length(btrim(name)) between 1 and 120),
  constraint page_content_templates_content_check check (
    jsonb_typeof(content) = 'object'
    and octet_length(content::text) <= 1048576
  ),
  constraint page_content_templates_schema_name_key unique (schema_id, name)
);

create index if not exists idx_page_content_templates_schema_updated
  on public.page_content_templates (schema_id, updated_at desc);

create or replace function public.validate_page_content_template_schema_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  schema_tenant_id uuid;
begin
  select tenant_id into schema_tenant_id
    from public.page_schemas
    where id = new.schema_id
    for key share;
  if not found then
    raise exception 'Template schema was not found.' using errcode = '23503';
  end if;
  if schema_tenant_id is distinct from new.tenant_id then
    raise exception 'Template and schema must belong to the same workspace.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_page_content_template_schema_scope on public.page_content_templates;
create trigger validate_page_content_template_schema_scope
  before insert or update of schema_id, tenant_id on public.page_content_templates
  for each row execute function public.validate_page_content_template_schema_scope();

drop trigger if exists set_page_content_templates_updated_at on public.page_content_templates;
create trigger set_page_content_templates_updated_at
  before update on public.page_content_templates
  for each row execute function public.set_current_timestamp_updated_at();

alter table public.page_content_templates enable row level security;

drop policy if exists page_content_templates_select on public.page_content_templates;
drop policy if exists page_content_templates_insert on public.page_content_templates;
drop policy if exists page_content_templates_update on public.page_content_templates;
drop policy if exists page_content_templates_delete on public.page_content_templates;

create policy page_content_templates_select
  on public.page_content_templates
  for select to authenticated
  using (
    public.is_content_admin()
    or (tenant_id is not null and public.is_tenant_member(tenant_id))
    or public.can_access_owned_row(tenant_id, owner_user_id)
  );

create policy page_content_templates_insert
  on public.page_content_templates
  for insert to authenticated
  with check (
    public.is_content_admin()
    or (
      owner_user_id = public.current_user_id()
      and (
        (tenant_id is null and public.is_content_admin())
        or (tenant_id is not null and tenant_id = public.current_tenant_id() and public.is_tenant_member(tenant_id))
      )
    )
  );

create policy page_content_templates_update
  on public.page_content_templates
  for update to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id))
  with check (public.can_access_owned_row(tenant_id, owner_user_id));

create policy page_content_templates_delete
  on public.page_content_templates
  for delete to authenticated
  using (public.can_access_owned_row(tenant_id, owner_user_id));

grant select, insert, update, delete on table public.page_content_templates to authenticated;
revoke all on function public.validate_page_content_template_schema_scope() from public, anon;
grant execute on function public.validate_page_content_template_schema_scope() to authenticated;
