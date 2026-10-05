import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MIGRATION_ORDER_CORE } from '../scripts/lib/migration-order.mjs';

const migration = await readFile('migrations/202610050004_product_schema_reassignment.sql', 'utf8');
const route = await readFile('api/routes/products.ts', 'utf8');
const catalogue = await readFile('src/pages/Products.tsx', 'utf8');
const management = await readFile('src/pages/ProductCatalogue.tsx', 'utf8');
const schemaEditor = await readFile('src/features/schema-editor/SchemaEditorPage.tsx', 'utf8');

test('Product schema reassignment is an ordered, tenant/version/revision-checked aggregate operation', () => {
  assert.ok(MIGRATION_ORDER_CORE.indexOf('202610050004_product_schema_reassignment.sql') > MIGRATION_ORDER_CORE.indexOf('202610050003_product_object_api_independent_from_pages.sql'));
  assert.match(migration, /change_service_product_schema_aggregate[\s\S]*?security invoker/i);
  assert.match(migration, /integration_id = target_product_id[\s\S]*?tenant_id = expected_tenant_id[\s\S]*?for update/i);
  assert.match(migration, /product\.version <> expected_version/i);
  assert.match(migration, /target_schema_tenant_id is distinct from expected_tenant_id/i);
  assert.match(migration, /current_definition_revision is distinct from expected_definition_revision/i);
  assert.match(migration, /target_schema_kind is distinct from 'service-product'/i);
  assert.match(migration, /set schema_id = target_schema_id,[\s\S]*?status = case when status = 'published' then 'draft' else status end/i);
  assert.match(migration, /grant execute on function public\.change_service_product_schema_aggregate[\s\S]*?to authenticated/i);
});

test('Products schema overview exposes reassignment and the main overview links to it', () => {
  assert.match(route, /products\.patch\('\/:id\/schema'/);
  assert.match(route, /expected_version, schema_id and expected_definition_revision are required/);
  assert.match(catalogue, /Schema ändern/);
  assert.match(catalogue, /changeServiceProductSchema/);
  assert.match(management, /navigate\('\/products\/schemas'\)/);
});

test('schema purpose is explicit and no longer described as integration-forced', () => {
  assert.match(schemaEditor, /<SelectItem value="service-product">[\s\S]*?Produktschema/);
  assert.match(schemaEditor, /<SelectItem value="event">[\s\S]*?Veranstaltungsschema/);
  assert.doesNotMatch(schemaEditor, /Veranstaltungsschema \(über Integration festgelegt\)/i);
});
