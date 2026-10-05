import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/202610050002_product_delete_with_events.sql', import.meta.url), 'utf8');
const productRoute = readFileSync(new URL('../api/routes/products.ts', import.meta.url), 'utf8');
const productAggregate = readFileSync(new URL('../api/lib/productAggregateService.ts', import.meta.url), 'utf8');
const productUi = readFileSync(new URL('../src/pages/ProductCatalogue.tsx', import.meta.url), 'utf8');
const legacyProductHook = readFileSync(new URL('../src/hooks/useProductManagement.ts', import.meta.url), 'utf8');
const mcpRoute = readFileSync(new URL('../api/routes/mcp.ts', import.meta.url), 'utf8');
const apiIndex = readFileSync(new URL('../api/index.ts', import.meta.url), 'utf8');

describe('tenant-scoped Product deletion with event cascade', () => {
  it('cascades active and archived event references and removes linked Event Pages transactionally', () => {
    assert.match(migration, /mentorbooking_events_product_id_fkey[\s\S]*on delete cascade/i);
    assert.match(migration, /mentorbooking_events_archive_pillar_id_fkey[\s\S]*on delete cascade/i);
    assert.match(migration, /delete from public\.mentorbooking_events[\s\S]*delete from public\.mentorbooking_events_archive[\s\S]*delete from public\.mentorbooking_products[\s\S]*delete from public\.pages/i);
    assert.match(migration, /security invoker/i);
    assert.match(migration, /delete_service_product_with_events_aggregate/);
    assert.match(migration, /expected_version/);
  });

  it('exposes versioned deletion through service-product REST and MCP', () => {
    assert.match(productRoute, /products\.delete\('\/:id'/);
    assert.match(productRoute, /deleteProductAggregate\(client, c\.req\.param\('id'\), input\.tenant_id, Number\(input\.expected_version\)\)/);
    assert.match(productAggregate, /rpc\('delete_service_product_with_events_aggregate'/);
    assert.match(mcpRoute, /'specy_products_delete'/);
    assert.match(mcpRoute, /confirm_delete: z\.literal\(true\)/);
    assert.match(apiIndex, /'specy_products_delete'/);
  });

  it('offers permanent deletion in the simplified Product UI without Website-Produkte affordances', () => {
    assert.match(productUi, /deleteProduct\(product\.id, activeTenantId\)/);
    assert.match(productUi, /alle zugehörigen Veranstaltungen/);
    assert.doesNotMatch(productUi, /deleteServiceProduct\(/);
    assert.doesNotMatch(productUi, /Website-Produkt/);
    assert.doesNotMatch(productUi, /\/products\/schemas/);
    const deleteGuard = legacyProductHook.match(/const checkProductUsageForDelete = useCallback\(async \(product: Product\) => \{[\s\S]*?\}, \[activeTenantId, language\]\)/)?.[0] ?? '';
    assert.ok(deleteGuard);
    assert.doesNotMatch(deleteGuard, /setProductInUseDialogOpen\(true\)/);
    assert.match(productUi, /dauerhaft löschen/);
  });
});
