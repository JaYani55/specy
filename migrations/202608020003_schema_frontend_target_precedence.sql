-- Repair target rows created before root collection requirements took precedence.
-- Never modifies schema definitions or page content.

delete from public.schema_frontend_targets target
using public.page_schemas ps
where target.schema_id = ps.id
  and ps.integration_requirements ->> 'required_slug_structure' = '/'
  and target.kind = 'detail-page'
  and target.host_path = '/:slug'
  and target.target_key = 'default';

-- If the original backfill already created a default detail target, remove any
-- competing legacy projection before installing the authoritative collection
-- target. User-defined non-default targets are preserved.
delete from public.schema_frontend_targets target
using public.page_schemas ps
where target.schema_id = ps.id
  and ps.integration_requirements ->> 'required_slug_structure' = '/'
  and target.kind = 'detail-page';

insert into public.schema_frontend_targets (
  schema_id, tenant_id, target_key, kind, host_path, placement_key,
  supports_preview, is_primary, sort_order, enabled
)
select
  ps.id, ps.tenant_id, 'home.' || ps.slug, 'collection-slot', '/',
  'home.' || ps.slug, false, true, 0, true
from public.page_schemas ps
where ps.integration_requirements ->> 'required_slug_structure' = '/'
  and not exists (
    select 1 from public.schema_frontend_targets target
    where target.schema_id = ps.id
      and target.enabled
      and target.kind = 'collection-slot'
      and target.host_path = '/'
  )
on conflict (schema_id, target_key) do update
set kind = excluded.kind,
    host_path = excluded.host_path,
    placement_key = excluded.placement_key,
    supports_preview = excluded.supports_preview,
    is_primary = excluded.is_primary,
    enabled = excluded.enabled;