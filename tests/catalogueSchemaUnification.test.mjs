import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MIGRATION_ORDER_CORE } from '../scripts/lib/migration-order.mjs';

const migration = await readFile('migrations/202610060001_catalogue_schema_unification.sql', 'utf8');

test('catalogue unification is ordered after the aggregate foundations', () => {
  assert.ok(MIGRATION_ORDER_CORE.indexOf('202610060001_catalogue_schema_unification.sql') > MIGRATION_ORDER_CORE.indexOf('202610050004_product_schema_reassignment.sql'));
});

test('existing service-product schemas are migrated to the catalogue kind', () => {
  assert.match(migration, /update public\.page_schemas\s+set entity_kind = 'event'\s+where entity_kind = 'service-product';/);
});

test('product aggregate RPCs accept the catalogue kind and guard their page writes', () => {
  for (const name of [
    'create_service_product_aggregate',
    'update_service_product_aggregate',
    'publish_service_product_aggregate',
    'archive_service_product_aggregate',
    'update_service_product_aggregate_with_custom_fields',
    'change_service_product_schema_aggregate',
  ]) {
    assert.ok(migration.includes(`create or replace function public.${name}(`), name);
  }
  const redefinedBodies = migration.split('update public.page_schemas')[1].split('-- Re-asserted')[0].replace(/-- [^\n]*\n/g, '\n').replace("  where entity_kind = 'service-product';", '');
  assert.ok(!/'service-product'/.test(redefinedBodies), 'no service-product kind checks remain in redefined bodies');
  assert.match(migration, /perform set_config\('specy\.event_page_write', 'on', true\);/);
});

test('page ownership guards accept product- and event-owned catalogue pages', () => {
  assert.match(migration, /A page cannot be owned by both an event and a product\./);
  assert.match(migration, /and not exists \(\s*select 1 from public\.mentorbooking_products\s+where product_page_id = new\.id and tenant_id = new\.tenant_id and retired_at is null\s*\)/);
  assert.match(migration, /and exists \(select 1 from public\.mentorbooking_events where page_id = old\.id\)/);
  assert.match(migration, /and coalesce\(current_setting\('specy\.product_schema_reassignment', true\), ''\) <> 'on'/);
});

test('the product object projection keys on the catalogue kind', () => {
  assert.match(migration, /product_schema\.entity_kind = 'event'/);
  assert.doesNotMatch(migration, /product_schema\.entity_kind = 'service-product'/);
});

test('function permissions are re-asserted after redefinition', () => {
  assert.match(migration, /grant execute on function public\.create_service_product_aggregate\(uuid, uuid, bigint, text, text, jsonb, uuid\) to authenticated;/);
  assert.match(migration, /revoke all on function public\.sync_product_object\(integer\) from public, anon, authenticated;/);
});
