import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEventPageCreateInput } from '../api/lib/eventPageAggregates.ts';

const tenant = '11111111-1111-4111-8111-111111111111';
const product = '22222222-2222-4222-8222-222222222222';

const validInput = () => ({
  tenant_id: tenant,
  expected_definition_revision: 3,
  name: 'Workshop Berlin',
  content: { headline: 'Public title', sections: [] },
  event: {
    company: 'Legacy operational label',
    product_id: product,
    date: '2026-11-05',
    time: '09:00',
    duration_minutes: 90,
    timezone: 'Europe/Berlin',
    mode: 'online',
  },
});

describe('agent event-page create input', () => {
  it('parses a tenant-scoped event page request and preserves the schema content', () => {
    const result = parseEventPageCreateInput(validInput());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.slug, 'workshop-berlin');
    assert.equal(result.value.event.product_id, product);
    assert.equal(result.value.event.timezone, 'Europe/Berlin');
    assert.deepEqual(result.value.content, { headline: 'Public title', sections: [] });
  });

  it('rejects missing tenant/revision and invalid operational schedule fields', () => {
    const noTenant = validInput();
    delete noTenant.tenant_id;
    assert.equal(parseEventPageCreateInput(noTenant).ok, false);
    assert.equal(parseEventPageCreateInput({ ...validInput(), expected_definition_revision: 0 }).ok, false);
    assert.equal(parseEventPageCreateInput({ ...validInput(), event: { ...validInput().event, date: '2026-02-31' } }).ok, false);
    assert.equal(parseEventPageCreateInput({ ...validInput(), event: { ...validInput().event, timezone: 'Not/A_Timezone' } }).ok, false);
    assert.equal(parseEventPageCreateInput({ ...validInput(), event: { ...validInput().event, product_id: 4 } }).ok, false);
  });
});
