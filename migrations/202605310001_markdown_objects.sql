alter table public.objects
  add column if not exists object_type character varying(50) not null default 'json',
  add column if not exists agent_description text null,
  add column if not exists share_enabled boolean not null default false,
  add column if not exists share_slug character varying(255) null;

alter table public.objects
  drop constraint if exists objects_object_type_check;

alter table public.objects
  add constraint objects_object_type_check check (
    (object_type)::text = any (array['json'::text, 'markdown'::text])
  );

create unique index if not exists idx_objects_tenant_share_slug_unique
  on public.objects using btree (tenant_id, share_slug)
  where share_slug is not null;

create index if not exists idx_objects_share_enabled
  on public.objects using btree (share_enabled, share_slug)
  where share_enabled = true;