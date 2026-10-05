import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyDefaultPublicEventInclude, parsePublicEntityIncludes, projectPublicEventRelations, projectPublicProductRelations } from '../api/lib/publicEntityProjection.ts';

describe('published service-product page projection', () => {
  it('allows only the named entity include for a product schema', () => {
    assert.deepEqual(parsePublicEntityIncludes(undefined, 'service-product'), { ok: true, includes: { includeEntity: false, includeEvent: false, includeProduct: false } });
    assert.deepEqual(parsePublicEntityIncludes('entity', 'service-product'), { ok: true, includes: { includeEntity: true, includeEvent: false, includeProduct: false } });
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

describe('published event page projection', () => {
  const page = {
    id: 'page-event', slug: 'workshop-berlin', name: 'Workshop', status: 'published',
    content: { headline: 'Public copy', private_extension: { keep: true } },
    domain_url: null, updated_at: '2026-10-03T00:00:00Z', published_at: null,
  };
  const event = {
    id: 'event-uuid', page_id: 'page-event', date: '2026-11-05', time: '09:00', end_time: '10:00',
    duration_minutes: 60, mode: 'online', timezone: 'Europe/Berlin', product_id: 4,
    registration_status: 'open', participant_min: 3, participant_max: 10,
  };

  it('allows only named event includes and rejects private/unknown expansions', () => {
    const parsed = parsePublicEntityIncludes('entity,event,product', 'event');
    assert.equal(parsed.ok, true);
    assert.equal(parsePublicEntityIncludes('company', 'event').ok, false);
    assert.equal(parsePublicEntityIncludes('entity,entity', 'event').ok, false);
  });

  it('includes operational event facts by default but honors explicit include selection', () => {
    const parsed = parsePublicEntityIncludes(undefined, 'event');
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(applyDefaultPublicEventInclude(parsed.includes, undefined).includeEvent, true);
    assert.equal(applyDefaultPublicEventInclude(parsed.includes, '').includeEvent, true);
    assert.equal(applyDefaultPublicEventInclude(parsed.includes, 'entity').includeEvent, false);
  });

  it('projects only allow-listed event facts and a published product reference', () => {
    const parsed = parsePublicEntityIncludes('entity,event,product', 'event');
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const projected = projectPublicEventRelations([page], [event], [
      { legacy_id: 4, id: 'product-public-uuid', name: 'Public Product', page_slug: 'public-product', schema_api_slug: 'products-api' },
    ], parsed.includes);
    assert.deepEqual(projected[0].content, page.content);
    assert.deepEqual(projected[0].relations, {
      entity: { kind: 'event', id: 'event-uuid' },
      event: { date: '2026-11-05', time: '09:00', end_time: '10:00', duration_minutes: 60, mode: 'online', timezone: 'Europe/Berlin', registration_status: 'open', participant_min: 3, participant_max: 10 },
      product: { id: 'product-public-uuid', name: 'Public Product', slug: 'public-product', schema_api_slug: 'products-api' },
    });
    assert.equal(JSON.stringify(projected).includes('product_id'), false);
    assert.equal(JSON.stringify(projected).includes('tenant_id'), false);
  });

  it('withholds event pages with missing timezone or no event link', () => {
    const parsed = parsePublicEntityIncludes('event', 'event');
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(projectPublicEventRelations([page], [{ ...event, timezone: null }], [], parsed.includes), []);
    assert.deepEqual(projectPublicEventRelations([page], [], [], parsed.includes), []);
  });
});
