import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeProductTenantId, requireProductTenantId } from '../src/utils/productTenantScope.ts';

describe('product workspace scope', () => {
  it('fails closed when active workspace context is absent', () => {
    assert.equal(normalizeProductTenantId(''), null);
    assert.equal(normalizeProductTenantId(null), null);
    assert.throws(() => requireProductTenantId(undefined), /active workspace is required/i);
  });

  it('normalizes and requires explicit tenant identifiers', () => {
    assert.equal(normalizeProductTenantId(' tenant-a '), 'tenant-a');
    assert.equal(requireProductTenantId('tenant-a'), 'tenant-a');
  });

  it('keeps the legacy overview and event selector explicitly workspace-scoped', () => {
    const productService = readFileSync(new URL('../src/services/events/productService.ts', import.meta.url), 'utf8');
    const overview = readFileSync(new URL('../src/pages/VerwaltungAllProducts.tsx', import.meta.url), 'utf8');
    const productCombobox = readFileSync(new URL('../src/components/events/ProductCombobox.tsx', import.meta.url), 'utf8');
    const productManagement = readFileSync(new URL('../src/hooks/useProductManagement.ts', import.meta.url), 'utf8');
    assert.match(productService, /fetchProducts = async \(tenantId: string\)/);
    assert.match(productService, /\.eq\('tenant_id', scopedTenantId\)/);
    assert.match(overview, /fetchProducts\(activeTenantId\)/);
    assert.match(productCombobox, /fetchProducts\(requestedTenantId\)|fetchProducts\(activeTenantId\)/);
    assert.doesNotMatch(overview, /fetchProducts\(\)/);
    assert.match(productManagement, /\.eq\('tenant_id', activeTenantId\)/);
    assert.match(productManagement, /setEditingProduct\(null\)/);
  });
});
