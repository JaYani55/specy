import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/202610020005_product_sequence_permissions.sql', import.meta.url), 'utf8');

describe('service-product serial sequence permissions', () => {
  it('grants only sequence usage to authenticated RPC callers', () => {
    assert.match(migration, /grant usage on sequence public\.mentorbooking_products_id_seq to authenticated;/i);
    assert.doesNotMatch(migration, /grant .*sequence .* to anon/i);
    assert.doesNotMatch(migration, /grant .*sequence .* to public/i);
  });
});
