-- Explicit schema content scope for MCP-created schemas.
-- Additive only: existing schema definitions and page content are unchanged.

alter table public.page_schemas
  add column if not exists content_scope text not null default 'page-collection',
  add column if not exists page_target jsonb null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'page_schemas_content_scope_check'
  ) then
    alter table public.page_schemas
      add constraint page_schemas_content_scope_check
      check (content_scope in ('page-collection', 'single-page'));
  end if;
end
$$;

-- Preserve legacy schemas as page collections unless an explicit root contract
-- already identifies a single existing page surface.
update public.page_schemas
set content_scope = 'single-page'
where content_scope = 'page-collection'
  and page_target is null
  and integration_requirements ->> 'content_scope' = 'single-page';
