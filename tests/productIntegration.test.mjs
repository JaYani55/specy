import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCreateServiceProductInput, parseUpdateServiceProductInput } from '../api/lib/productAggregates.ts';

const tenant = '11111111-1111-4111-8111-111111111111';
const schema = '22222222-2222-4222-8222-222222222222';
const key = '33333333-3333-4333-8333-333333333333';

describe('service-product aggregate API input', () => {
  it('requires explicit tenant/schema/idempotency identities and preserves arbitrary JSON content', () => {
    const content = { 'Intro Headline': 'Welcome', sections: [{ variant: 'custom', props: { empty: [], enabled: false } }] };
    const result = parseCreateServiceProductInput({ tenant_id: tenant, schema_id: schema, expected_definition_revision: 2, name: 'Workshop', content, idempotency_key: key });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.slug, 'workshop');
      assert.deepEqual(result.value.content, content);
    }
    assert.equal(parseCreateServiceProductInput({ schema_id: schema, expected_definition_revision: 2, name: 'No tenant', content, idempotency_key: key }).ok, false);
  });

  it('normalizes the page slug and enforces optimistic update versions', () => {
    const result = parseUpdateServiceProductInput({ tenant_id: tenant, expected_version: 3, expected_definition_revision: 2, name: 'Neue Größe', slug: 'Neue Größe', content: {} });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.slug, 'neue-groesse');
      assert.equal(result.value.expected_version, 3);
    }
    assert.equal(parseUpdateServiceProductInput({ tenant_id: tenant, expected_version: 0, expected_definition_revision: 2, name: 'x' }).ok, false);
    assert.equal(parseUpdateServiceProductInput({ tenant_id: tenant, expected_version: 1, expected_definition_revision: 2 }).ok, false);
  });
});
