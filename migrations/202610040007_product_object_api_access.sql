-- Persist API visibility preferences on the canonical Product source and
-- enforce Product publication/registration as an independent eligibility gate.

alter table public.mentorbooking_products
  add column if not exists object_api_enabled boolean not null default true,
  add column if not exists object_requires_auth boolean not null default false;

create or replace function public.update_product_object_api_access(
  target_product_id uuid,
  target_tenant_id uuid,
  target_api_enabled boolean,
  target_requires_auth boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated_product public.mentorbooking_products%rowtype;
begin
  if target_product_id is null or target_tenant_id is null
    or target_api_enabled is null or target_requires_auth is null then
    raise exception 'Product, workspace and both API access settings are required.' using errcode = '22023';
  end if;

  update public.mentorbooking_products
    set object_api_enabled = target_api_enabled,
        object_requires_auth = target_requires_auth
    where integration_id = target_product_id
      and tenant_id = target_tenant_id
      and retired_at is null
    returning * into updated_product;

  if not found then
    raise exception 'Product not found in the requested workspace.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'product_id', updated_product.integration_id,
    'tenant_id', updated_product.tenant_id,
    'api_enabled', updated_product.object_api_enabled,
    'requires_auth', updated_product.object_requires_auth
  );
end;
$$;

create or replace function public.apply_product_object_api_access_preferences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  product public.mentorbooking_products%rowtype;
  product_page public.pages%rowtype;
  product_schema public.page_schemas%rowtype;
  api_eligibility boolean := false;
  desired_api_enabled boolean := false;
  desired_requires_auth boolean := false;
  previous_access_setting text := current_setting('specy.product_object_access_sync', true);
begin
  if new.source_product_id is null
    or coalesce(current_setting('specy.product_object_access_sync', true), '') = 'on' then
    return new;
  end if;

  select * into product from public.mentorbooking_products where id = new.source_product_id;
  if not found then return new; end if;

  if product.product_page_id is not null then
    select * into product_page from public.pages
      where id = product.product_page_id and tenant_id = product.tenant_id;
    if found then
      select * into product_schema from public.page_schemas
        where id = product_page.schema_id and tenant_id = product.tenant_id;
      api_eligibility := found
        and new.status = 'published'
        and product.retired_at is null
        and product_page.status = 'published'
        and product_schema.entity_kind = 'service-product'
        and product_schema.registration_status = 'registered';
    end if;
  end if;

  desired_api_enabled := api_eligibility and product.object_api_enabled;
  desired_requires_auth := product.object_requires_auth;
  if new.api_enabled is not distinct from desired_api_enabled
    and new.requires_auth is not distinct from desired_requires_auth then
    return new;
  end if;

  perform set_config('specy.product_object_access_sync', 'on', true);
  update public.objects
    set api_enabled = desired_api_enabled,
        requires_auth = desired_requires_auth
    where id = new.id;
  perform set_config('specy.product_object_access_sync', coalesce(previous_access_setting, ''), true);
  return new;
end;
$$;

revoke all on function public.apply_product_object_api_access_preferences() from public, anon, authenticated;
drop trigger if exists zz_apply_product_object_api_access_preferences on public.objects;
create trigger zz_apply_product_object_api_access_preferences
  after insert or update of source_product_id, status, api_enabled, requires_auth, tenant_id
  on public.objects
  for each row execute function public.apply_product_object_api_access_preferences();

revoke all on function public.update_product_object_api_access(uuid, uuid, boolean, boolean) from public, anon;
grant execute on function public.update_product_object_api_access(uuid, uuid, boolean, boolean) to authenticated;

-- Rebuild existing Product mirrors so the persisted defaults match the current
-- publication/registration gate and future UI changes survive source syncs.
do $$
declare
  product_record record;
begin
  for product_record in select id from public.mentorbooking_products order by id loop
    perform public.sync_product_object(product_record.id);
  end loop;
end;
$$;
