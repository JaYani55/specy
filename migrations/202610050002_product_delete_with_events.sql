-- Explicit Product deletion removes its operational and archived Events, their
-- linked Event Pages, generated Product Object, and canonical Product Page in
-- one tenant-scoped transaction. Product retirement remains a separate path.

alter table public.mentorbooking_events
  drop constraint if exists mentorbooking_events_product_id_fkey;
alter table public.mentorbooking_events
  add constraint mentorbooking_events_product_id_fkey
  foreign key (product_id)
  references public.mentorbooking_products(id)
  on update cascade
  on delete cascade;

alter table public.mentorbooking_events_archive
  drop constraint if exists mentorbooking_events_archive_pillar_id_fkey;
alter table public.mentorbooking_events_archive
  add constraint mentorbooking_events_archive_pillar_id_fkey
  foreign key (pillar_id)
  references public.mentorbooking_products(id)
  on update cascade
  on delete cascade;

create or replace function public.delete_mentorbooking_product_aggregate(
  target_product_id integer,
  expected_tenant_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  linked_page_id uuid;
  product_tenant_id uuid;
  page_tenant_id uuid;
  linked_product_count integer;
begin
  if expected_tenant_id is null then
    raise exception 'A tenant is required to delete a product.' using errcode = '22023';
  end if;

  select product_page_id, tenant_id
    into linked_page_id, product_tenant_id
    from public.mentorbooking_products
    where id = target_product_id
      and tenant_id = expected_tenant_id
    for update;

  if not found then
    raise exception 'Product not found.' using errcode = 'P0002';
  end if;

  if linked_page_id is not null then
    select tenant_id into page_tenant_id
      from public.pages
      where id = linked_page_id
      for update;

    if not found or page_tenant_id is distinct from product_tenant_id then
      raise exception 'Linked page is missing or belongs to another tenant.' using errcode = '23514';
    end if;

    select count(*) into linked_product_count
      from public.mentorbooking_products
      where product_page_id = linked_page_id;
    if linked_product_count <> 1 then
      raise exception 'Linked page is shared by multiple products.' using errcode = '23514';
    end if;
  end if;

  -- Event deletion triggers remove each linked Event Page in this same
  -- transaction. Archived Event rows are historical records keyed by the
  -- globally unique legacy Product ID and are removed with the Product too.
  delete from public.mentorbooking_events
    where product_id = target_product_id
      and tenant_id = expected_tenant_id;
  delete from public.mentorbooking_events_archive
    where pillar_id = target_product_id;

  delete from public.mentorbooking_products
    where id = target_product_id
      and tenant_id = expected_tenant_id;
  if not found then
    raise exception 'Product deletion was denied.' using errcode = '42501';
  end if;

  if linked_page_id is not null then
    delete from public.pages
      where id = linked_page_id
        and tenant_id = expected_tenant_id;
    if not found then
      raise exception 'Linked product page deletion was denied.' using errcode = '42501';
    end if;
  end if;
end;
$$;

create or replace function public.delete_service_product_with_events_aggregate(
  target_product_id uuid,
  expected_tenant_id uuid,
  expected_version bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  legacy_product_id integer;
  current_version bigint;
begin
  if target_product_id is null or expected_tenant_id is null or expected_version is null then
    raise exception 'Product ID, workspace and expected version are required.' using errcode = '22023';
  end if;

  select id, version into legacy_product_id, current_version
    from public.mentorbooking_products
    where integration_id = target_product_id
      and tenant_id = expected_tenant_id
    for update;
  if not found then raise exception 'Product not found.' using errcode = 'P0002'; end if;
  if current_version is distinct from expected_version then
    raise exception 'Product version conflict. Reload before deleting.' using errcode = '40001';
  end if;

  perform public.delete_mentorbooking_product_aggregate(legacy_product_id, expected_tenant_id);
  return jsonb_build_object('deleted', true, 'product_id', target_product_id);
end;
$$;

revoke all on function public.delete_mentorbooking_product_aggregate(integer, uuid) from public, anon;
revoke all on function public.delete_service_product_with_events_aggregate(uuid, uuid, bigint) from public, anon;
grant execute on function public.delete_mentorbooking_product_aggregate(integer, uuid) to authenticated;
grant execute on function public.delete_service_product_with_events_aggregate(uuid, uuid, bigint) to authenticated;
