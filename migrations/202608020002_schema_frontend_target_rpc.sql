-- Atomically replace the target metadata for one schema.
-- Validation of the public contract happens in the Worker; database constraints
-- and the tenant-consistency trigger remain the final integrity boundary.

create or replace function public.replace_schema_frontend_targets(
  target_schema_id uuid,
  target_targets jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.page_schemas where id = target_schema_id) then
    raise exception 'Schema not found';
  end if;

  delete from public.schema_frontend_targets
  where schema_id = target_schema_id;

  insert into public.schema_frontend_targets (
    schema_id,
    tenant_id,
    target_key,
    kind,
    host_path,
    placement_key,
    supports_preview,
    is_primary,
    sort_order,
    enabled
  )
  select
    ps.id,
    ps.tenant_id,
    item.target_key,
    item.kind,
    item.host_path,
    item.placement_key,
    coalesce(item.supports_preview, item.kind = 'detail-page'),
    coalesce(item.is_primary, false),
    coalesce(item.sort_order, 0),
    coalesce(item.enabled, true)
  from public.page_schemas ps
  cross join lateral jsonb_to_recordset(coalesce(target_targets, '[]'::jsonb)) as item(
    target_key text,
    kind text,
    host_path text,
    placement_key text,
    supports_preview boolean,
    is_primary boolean,
    sort_order integer,
    enabled boolean
  )
  where ps.id = target_schema_id;
end;
$$;

revoke all on function public.replace_schema_frontend_targets(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_schema_frontend_targets(uuid, jsonb) to service_role;
