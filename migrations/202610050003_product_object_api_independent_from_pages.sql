-- The Product Object is the dynamic data stream; its API access policy is
-- independent from Page publication/schema registration. Pages retain their
-- own publication/revalidation lifecycle. Product retirement still disables
-- the generated Object.

create or replace function public.apply_product_object_api_access_preferences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  product public.mentorbooking_products%rowtype;
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

  desired_api_enabled := new.status = 'published'
    and product.retired_at is null
    and product.object_api_enabled;
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

-- Rebuild every generated mirror so current API preferences apply immediately.
do $$
declare
  product_record record;
begin
  for product_record in select id from public.mentorbooking_products order by id loop
    perform public.sync_product_object(product_record.id);
  end loop;
end;
$$;
