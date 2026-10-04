import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectPublicCustomFields, validateCustomFieldValues } from '../api/lib/customFields.ts';

const route = readFileSync(new URL('../api/routes/products.ts', import.meta.url), 'utf8');
const objectRoute = readFileSync(new URL('../api/routes/objects.ts', import.meta.url), 'utf8');
const objectEditor = readFileSync(new URL('../src/pages/ObjectEditor.tsx', import.meta.url), 'utf8');
const objectList = readFileSync(new URL('../src/pages/Objects.tsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/202610040003_product_event_custom_fields.sql', import.meta.url), 'utf8');
const productSchemaMigration = readFileSync(new URL('../migrations/202610040004_product_scoped_fields_and_object_sources.sql', import.meta.url), 'utf8');
const objectSyncMigration = readFileSync(new URL('../migrations/202610040005_product_object_projection.sql', import.meta.url), 'utf8');

describe('dynamic product/event custom fields', () => {
  it('validates typed money values on authenticated writes', () => {
    const definitions = { sale_price: { label: 'Price', type: 'price', required: true } };
    assert.deepEqual(validateCustomFieldValues(definitions, { sale_price: { amount: '125.00', currency: 'EUR' } }), []);
    assert.match(validateCustomFieldValues(definitions, { sale_price: { amount: 125, currency: 'EUR' } }).join(' '), /invalid value/);
    assert.match(validateCustomFieldValues(definitions, {}).join(' '), /required/);
  });

  it('projects only configured public fields and leaves private/undefined data out', () => {
    assert.deepEqual(projectPublicCustomFields({
      registration_status: { type: 'string', is_public: true },
      internal_note: { type: 'string', is_public: false },
      not_configured: { type: 'string', is_public: true },
      invalid_number: { type: 'number', is_public: true },
    }, {
      registration_status: 'open',
      internal_note: 'internal',
      invalid_number: 'not-a-number',
    }), { registration_status: 'open' });
  });

  it('stores custom values independently and returns the Product Object envelope from the friendly URL', () => {
    assert.match(migration, /mentorbooking_products[\s\S]*custom_fields jsonb not null default '\{\}'::jsonb/);
    assert.match(migration, /mentorbooking_events[\s\S]*custom_fields jsonb not null default '\{\}'::jsonb/);
    assert.match(migration, /tenant_custom_field_definitions/);
    assert.match(productSchemaMigration, /custom_field_schema jsonb not null/);
    assert.match(productSchemaMigration, /source_product_id integer/);
    assert.match(productSchemaMigration, /revoke select \(source_product_id\) on table public\.objects from public, anon, authenticated/i);
    assert.match(objectSyncMigration, /create or replace function public\.sync_product_object\(/);
    assert.match(objectSyncMigration, /after insert or update or delete on public\.mentorbooking_events/);
    assert.match(objectSyncMigration, /after insert or update or delete on public\.pages/);
    assert.match(objectSyncMigration, /project_product_custom_fields\(product_field_schema -> 'event', event_record\.custom_fields\)/);
    assert.match(route, /products\.get\('\/:workspaceSlug\/:productSlug'/);
    assert.match(route, /\.eq\('source_product_id', product\.id\)/);
    assert.match(route, /\.eq\('api_enabled', true\)/);
    assert.match(route, /return c\.json\(mirror\)/);
    assert.match(objectRoute, /source_product_id/);
    assert.match(objectRoute, /visibleRows\.filter\(\(row\) => !managedIds\.has\(row\.id\)\)/);
    assert.match(objectEditor, /getManagedObjectEditorPath/);
    assert.match(objectList, /getObjects\(activeTenantId\)/);
  });
});
