#!/usr/bin/env node
/**
 * Generates migrations/202610060001_catalogue_schema_unification.sql by
 * extracting the latest definitions of the affected SQL functions from the
 * ordered migrations and applying targeted transformations.
 * Run: node scripts/build-catalogue-migration.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { MIGRATION_ORDER_CORE } from './lib/migration-order.mjs';

const normalize = (value) => value.replace(/\r\n/g, '\n');
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const GENERATED = '202610060001_catalogue_schema_unification.sql';
const ORDER = MIGRATION_ORDER_CORE.filter((name) => name.endsWith('.sql') && name !== 'preamble.sql' && name !== 'storage.sql' && name !== GENERATED);

const functions = new Map();

for (const file of ORDER) {
  const text = normalize(readFileSync(`${root}migrations/${file}`, 'utf8'));
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^create or replace function public\.([a-z_]+)\(/i);
    if (!match) continue;
    const name = match[1];
    let tag = '$$';
    for (let j = i; j < Math.min(i + 12, lines.length); j += 1) {
      const tagMatch = lines[j].match(/^as (\$[^$\s]+)\s*$/);
      if (tagMatch) { tag = tagMatch[1]; break; }
    }
    const terminator = `${tag};`;
    let end = i;
    while (end < lines.length && lines[end].trim() !== terminator) end += 1;
    if (end >= lines.length) {
      console.warn(`Skipping unterminated function ${name} in ${file}`);
      continue;
    }
    const body = lines.slice(i, end + 1).join('\n');
    const grants = [];
    for (let j = end + 1; j < Math.min(end + 16, lines.length); j += 1) {
      if (/^(grant|revoke) /.test(lines[j]) && lines[j].includes(`public.${name}(`)) grants.push(lines[j].trim());
    }
    functions.set(name, { body, grants, file });
  }
}

const transform = (name, replacements) => {
  const entry = functions.get(name);
  if (!entry) throw new Error(`Function not found: ${name}`);
  let body = entry.body;
  for (const [from, to] of replacements) {
    if (!body.includes(from)) throw new Error(`Pattern not found in ${name}: ${JSON.stringify(from)}`);
    body = body.split(from).join(to);
  }
  return { name, body, grants: entry.grants };
};

const out = [];
out.push(`-- Catalogue schema unification. The service-product and event schema kinds
-- are merged into one catalogue concept: 'event' is the catalogue kind, and a
-- catalogue holds both the product's canonical page and its event pages. Pages
-- are classified by their linked aggregate (product row vs event row), not by
-- the schema kind alone.
--
-- Existing 'service-product' schemas are migrated to 'event'. The check
-- constraint keeps accepting the legacy value so this migration stays
-- idempotent and existing backups remain loadable.

update public.page_schemas
  set entity_kind = 'event'
  where entity_kind = 'service-product';

-- ------------------------------------------------------------------
-- Product aggregate RPCs accept catalogue schemas and mark their page
-- writes with the event-page write guard so the page triggers allow them.
-- ------------------------------------------------------------------
`);

const redefine = (result) => {
  out.push(result.body);
  for (const grant of result.grants) out.push(grant);
  out.push('');
};

redefine(transform('create_service_product_aggregate', [
  ["if schema_entity_kind is distinct from 'service-product' or schema_content_scope is distinct from 'page-collection' then",
   "if schema_entity_kind is distinct from 'event' or schema_content_scope is distinct from 'page-collection' then"],
  ["raise exception 'Schema is not an eligible service-product collection.' using errcode = '23514';",
   "raise exception 'Schema is not an eligible catalogue collection.' using errcode = '23514';"],
  ["  insert into public.pages (name, slug, status, content, schema_id, tenant_id)",
   "  perform set_config('specy.event_page_write', 'on', true);\n\n  insert into public.pages (name, slug, status, content, schema_id, tenant_id)"],
]));

redefine(transform('update_service_product_aggregate', [
  ["and entity_kind = 'service-product' for share;", "and entity_kind = 'event' for share;"],
  ["raise exception 'Linked product schema not found.' using errcode = '23514';",
   "raise exception 'Linked catalogue schema not found.' using errcode = '23514';"],
  ["  update public.pages set name = target_name, slug = target_slug, content = target_content",
   "  perform set_config('specy.event_page_write', 'on', true);\n\n  update public.pages set name = target_name, slug = target_slug, content = target_content"],
]));

redefine(transform('publish_service_product_aggregate', [
  ["and entity_kind = 'service-product' for share;", "and entity_kind = 'event' for share;"],
  ["raise exception 'Product schema not found.' using errcode = '23514';",
   "raise exception 'Catalogue schema not found.' using errcode = '23514';"],
  ["  update public.pages set status = target_status where id = product.product_page_id and tenant_id = expected_tenant_id;",
   "  perform set_config('specy.event_page_write', 'on', true);\n\n  update public.pages set status = target_status where id = product.product_page_id and tenant_id = expected_tenant_id;"],
]));

redefine(transform('archive_service_product_aggregate', [
  ["  update public.pages\n    set status = 'archived'",
   "  perform set_config('specy.event_page_write', 'on', true);\n\n  update public.pages\n    set status = 'archived'"],
]));

redefine(transform('update_service_product_aggregate_with_custom_fields', [
  ["page_schema_kind is distinct from 'service-product'", "page_schema_kind is distinct from 'event'"],
  ["raise exception 'Linked page is not owned by a service-product schema.' using errcode = '23514';",
   "raise exception 'Linked page is not owned by a catalogue schema.' using errcode = '23514';"],
  ["  update public.pages set name = btrim(target_name), slug = target_slug, content = target_page_content",
   "  perform set_config('specy.event_page_write', 'on', true);\n\n  update public.pages set name = btrim(target_name), slug = target_slug, content = target_page_content"],
]));

redefine(transform('change_service_product_schema_aggregate', [
  ["if target_schema_kind is distinct from 'service-product' or target_content_scope is distinct from 'page-collection' then",
   "if target_schema_kind is distinct from 'event' or target_content_scope is distinct from 'page-collection' then"],
  ["raise exception 'Target schema is not an eligible Product page collection.' using errcode = '23514';",
   "raise exception 'Target schema is not an eligible catalogue collection.' using errcode = '23514';"],
  ["  perform set_config('specy.product_schema_reassignment', 'on', true);",
   "  perform set_config('specy.product_schema_reassignment', 'on', true);\n  perform set_config('specy.event_page_write', 'on', true);"],
]));

redefine(transform('delete_mentorbooking_product_aggregate', [
  ["begin\n  if expected_tenant_id is null then",
   "begin\n  perform set_config('specy.event_page_write', 'on', true);\n  if expected_tenant_id is null then"],
]));

redefine(transform('validate_service_product_page_owner', [
  ["  select entity_kind into page_entity_kind from public.page_schemas where id = page_schema_id;\n  if page_entity_kind = 'event' then\n    raise exception 'An event page cannot be linked as a product page.' using errcode = '23514';\n  end if;\n",
   "  select entity_kind into page_entity_kind from public.page_schemas where id = page_schema_id;\n  if exists (select 1 from public.mentorbooking_events where page_id = new.product_page_id) then\n    raise exception 'A page cannot be owned by both an event and a product.' using errcode = '23514';\n  end if;\n"],
  ["  if page_entity_kind = 'service-product' and new.tenant_id is null then",
   "  if page_entity_kind is not null and page_entity_kind <> 'page' and new.tenant_id is null then"],
]));

redefine(transform('enforce_event_page_link', [
  ["  if page_entity_kind = 'event' and not exists (\n    select 1 from public.mentorbooking_events\n    where page_id = new.id and tenant_id = new.tenant_id\n  ) then",
   "  if page_entity_kind = 'event' and not exists (\n    select 1 from public.mentorbooking_events\n    where page_id = new.id and tenant_id = new.tenant_id\n  ) and not exists (\n    select 1 from public.mentorbooking_products\n    where product_page_id = new.id and tenant_id = new.tenant_id and retired_at is null\n  ) then"],
]));

redefine(transform('guard_event_page_mutation', [
  ["    if schema_kind = 'event' and coalesce(current_setting('specy.event_page_write', true), '') <> 'on' then\n      raise exception 'Event pages must be changed through the event aggregate service.' using errcode = '42501';\n    end if;\n    return old;",
   "    if schema_kind = 'event' and coalesce(current_setting('specy.event_page_write', true), '') <> 'on'\n      and exists (select 1 from public.mentorbooking_events where page_id = old.id) then\n      raise exception 'Event pages must be changed through the event aggregate service.' using errcode = '42501';\n    end if;\n    return old;"],
  ["      if schema_kind = 'event' and (new.schema_id is distinct from old.schema_id or new.tenant_id is distinct from old.tenant_id) then\n        raise exception 'An event page cannot be moved to another schema or workspace.' using errcode = '23514';\n      end if;",
   "      if schema_kind = 'event'\n        and (new.schema_id is distinct from old.schema_id or new.tenant_id is distinct from old.tenant_id)\n        and coalesce(current_setting('specy.product_schema_reassignment', true), '') <> 'on' then\n        raise exception 'An event page cannot be moved to another schema or workspace.' using errcode = '23514';\n      end if;"],
]));

for (const [name, entry] of functions) {
  if (['sync_product_object', 'update_product_object_api_access'].includes(name) && entry.body.includes("entity_kind = 'service-product'")) {
    redefine(transform(name, [
      ["product_schema.entity_kind = 'service-product'", "product_schema.entity_kind = 'event'"],
    ]));
  }
}

// ------------------------------------------------------------------
// Re-assert function permissions after redefinition (CREATE OR REPLACE
// keeps existing grants, but we pin them explicitly to the source state).
// ------------------------------------------------------------------
out.push('-- Re-asserted function permissions\n');
const PERMISSIONS = [
  ['create_service_product_aggregate(uuid, uuid, bigint, text, text, jsonb, uuid)', 'from public', 'to authenticated'],
  ['update_service_product_aggregate(uuid, uuid, bigint, bigint, text, text, jsonb)', 'from public', 'to authenticated'],
  ['publish_service_product_aggregate(uuid, uuid, bigint, bigint, text)', 'from public', 'to authenticated'],
  ['archive_service_product_aggregate(uuid, uuid, bigint)', 'from public', 'to authenticated'],
  ['update_service_product_aggregate_with_custom_fields(uuid, uuid, bigint, bigint, text, text, jsonb, jsonb)', 'from public, anon', 'to authenticated'],
  ['change_service_product_schema_aggregate(uuid, uuid, bigint, uuid, bigint)', 'from public, anon', 'to authenticated'],
  ['delete_mentorbooking_product_aggregate(integer, uuid)', 'from public, anon', 'to authenticated'],
  ['validate_service_product_page_owner()', 'from public', 'to authenticated'],
  ['enforce_event_page_link()', 'from public, anon', 'to authenticated'],
  ['guard_event_page_mutation()', 'from public, anon', 'to authenticated'],
  ['sync_product_object(integer)', 'from public, anon, authenticated', null],
  ['update_product_object_api_access(uuid, uuid, boolean, boolean)', 'from public, anon', 'to authenticated'],
];
for (const [signature, revokeTargets, grantTarget] of PERMISSIONS) {
  out.push(`revoke all on function public.${signature} ${revokeTargets};`);
  if (grantTarget) out.push(`grant execute on function public.${signature} ${grantTarget};`);
}
out.push('');

const fileName = '202610060001_catalogue_schema_unification.sql';
writeFileSync(`${root}migrations/${fileName}`, out.join('\n') + '\n');
console.log(`Wrote migrations/${fileName} with ${out.join('\n').split('\n').length} lines.`);
