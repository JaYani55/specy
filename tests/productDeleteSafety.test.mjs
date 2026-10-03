import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/202610020002_product_page_delete_safety.sql', import.meta.url), 'utf8');
const aggregateMigration = readFileSync(new URL('../migrations/202610020003_service_product_aggregates.sql', import.meta.url), 'utf8');
const validationMigration = readFileSync(new URL('../migrations/202610020004_product_content_validation.sql', import.meta.url), 'utf8');
const productService = readFileSync(new URL('../src/services/events/productService.ts', import.meta.url), 'utf8');

describe('product/page delete safety contract', () => {
  it('restricts page and event-history foreign keys instead of cascading or nulling history', () => {
    assert.match(migration, /references public\.pages\(id\)\s+on update cascade\s+on delete restrict/i);
    assert.match(migration, /references public\.mentorbooking_products\(id\)\s+on delete restrict/i);
    assert.equal((migration.match(/on delete restrict/gi) ?? []).length, 3);
  });

  it('validates product content inside update and publish RPCs, not only REST adapters', () => {
    assert.match(validationMigration, /create or replace function public\.validate_service_product_content/i);
    assert.match(validationMigration, /security invoker/i);
    assert.match(validationMigration, /public\.validate_service_product_content\(schema_definition, target_content\)/i);
    assert.match(validationMigration, /public\.validate_service_product_content\(schema_definition, page_content\)/i);
    assert.match(aggregateMigration, /expected_definition_revision bigint/i);
  });

  it('deletes product and page through one tenant-required invoker transaction', () => {
    assert.match(migration, /security invoker/i);
    assert.match(migration, /for update/i);
    assert.match(migration, /delete_mentorbooking_product_aggregate/);
    assert.match(migration, /grant execute .* to authenticated/i);
    assert.doesNotMatch(migration, /grant execute .* to anon/i);
    assert.match(productService, /requireProductTenantId\(tenantId\)/);
    assert.match(productService, /supabase\.rpc\('delete_mentorbooking_product_aggregate'/);
    assert.doesNotMatch(productService, /Continuing with product deletion despite page deletion error/);
  });
});
