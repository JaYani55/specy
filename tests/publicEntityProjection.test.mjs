import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicEntityIncludes, projectPublicProductRelations } from '../api/lib/publicEntityProjection.ts';

describe('published service-product page projection', () => {
  it('allows only the named entity include for a product schema', () => {
    assert.deepEqual(parsePublicEntityIncludes(undefined, 'service-product'), { ok: true, includeEntity: false });
    assert.deepEqual(parsePublicEntityIncludes('entity', 'service-product'), { ok: true, includeEntity: true });
    assert.equal(parsePublicEntityIncludes('entity,team', 'service-product').ok, false);
    assert.equal(parsePublicEntityIncludes('entity', 'page').ok, false);
  });

  it('adds only a safe opaque product ID and leaves stored developer content unchanged', () => {
    const page = {
      id: 'page-id', slug: 'workshop', name: 'Workshop', status: 'published',
      content: { 'Intro Headline': 'Custom', sections: [{ variant: 'bespoke', empty: [] }] },
      domain_url: null, updated_at: '2026-10-02T00:00:00Z', published_at: null,
    };
    const projected = projectPublicProductRelations([page], [{ id: 'product-uuid', page_id: 'page-id' }]);
    assert.deepEqual(projected[0].content, page.content);
    assert.deepEqual(projected[0].relations, { entity: { kind: 'service-product', id: 'product-uuid' } });
    assert.equal(Object.hasOwn(projected[0], 'tenant_id'), false);
  });

  it('omits pages without an active product relation', () => {
    const page = { id: 'orphan', slug: 'orphan', name: 'Orphan', status: 'published', content: {}, domain_url: null, updated_at: '', published_at: null };
    assert.deepEqual(projectPublicProductRelations([page], []), []);
  });
});
