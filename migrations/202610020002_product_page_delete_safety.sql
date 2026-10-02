-- Product/page lifecycle safety. The product table is still the historical
-- mentorbooking_products table during the compatibility window; IDs remain
-- stable and page deletion no longer cascades into business products.

alter table public.mentorbooking_products
  drop constraint if exists mentorbooking_products_page_id_fkey;
alter table public.mentorbooking_products
  add constraint mentorbooking_products_page_id_fkey
  foreign key (product_page_id)
  references public.pages(id)
  on update cascade
  on delete restrict;

-- Operational and archive history must be checked by the database even when
-- a caller cannot select those rows through RLS. RESTRICT makes the FK the
-- final authority instead of silently clearing historical product references.
alter table public.mentorbooking_events
  drop constraint if exists mentorbooking_events_product_id_fkey;
alter table public.mentorbooking_events
  add constraint mentorbooking_events_product_id_fkey
  foreign key (product_id)
  references public.mentorbooking_products(id)
  on delete restrict;

alter table public.mentorbooking_events_archive
  drop constraint if exists mentorbooking_events_archive_pillar_id_fkey;
alter table public.mentorbooking_events_archive
  add constraint mentorbooking_events_archive_pillar_id_fkey
  foreign key (pillar_id)
  references public.mentorbooking_products(id)
  on delete restrict;

-- Delete product and its canonical page atomically. RLS remains active because
-- this is SECURITY INVOKER; either both deletes succeed or neither does.
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
      raise exception 'Linked page deletion was denied.' using errcode = '42501';
    end if;
  end if;
end;
$$;

revoke all on function public.delete_mentorbooking_product_aggregate(integer, uuid) from public;
revoke all on function public.delete_mentorbooking_product_aggregate(integer, uuid) from anon;
grant execute on function public.delete_mentorbooking_product_aggregate(integer, uuid) to authenticated;
