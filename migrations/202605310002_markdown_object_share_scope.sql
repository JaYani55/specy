drop index if exists public.idx_objects_share_slug_unique;

create unique index if not exists idx_objects_tenant_share_slug_unique
  on public.objects using btree (tenant_id, share_slug)
  where share_slug is not null;