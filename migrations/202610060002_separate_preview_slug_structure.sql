-- Separate preview slug structure
--
-- Schemas may now register an explicit non-public preview route alongside the
-- public detail route (e.g. /veranstaltungen/:slug + /preview/:slug).
--
-- 1. Relax the database-level "at most one enabled detail-page target per
--    schema" rule to "at most one enabled detail-page target per host_path".
--    The public detail target and the preview target (supports_preview) can
--    then coexist.
-- 2. integration_requirements changes must bump the optimistic
--    definition_revision so revision-checked update_definition patches guard
--    this field area as well.

drop index if exists schema_frontend_targets_detail_unique;
create unique index if not exists schema_frontend_targets_detail_host_unique
  on public.schema_frontend_targets (schema_id, host_path)
  where enabled and kind = 'detail-page';

create or replace function public.bump_page_schema_definition_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.schema is distinct from old.schema
    or new.editor_config is distinct from old.editor_config
    or new.integration_requirements is distinct from old.integration_requirements
    or new.entity_kind is distinct from old.entity_kind
    or new.content_scope is distinct from old.content_scope
  then
    new.definition_revision := old.definition_revision + 1;
  else
    -- The revision is server-owned and cannot be changed as ordinary metadata.
    new.definition_revision := old.definition_revision;
  end if;
  return new;
end;
$$;

-- The trigger itself is created (idempotently) in
-- 202610020001_schema_entity_contract.sql and remains in place.
