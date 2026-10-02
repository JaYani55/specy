import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateSchemaContent } from '../api/lib/schemaContentValidation.ts';

describe('recursive schema content validator', () => {
  const schema = {
    enabled: { type: 'boolean', required: true },
    amount: { type: 'number', required: true, minimum: 0 },
    optional: { type: 'string', nullable: true },
    sections: { type: 'array', items: { type: 'object', properties: { variant: { type: 'string', required: true } } } },
  };

  it('accepts empty values and arbitrary nested extension keys without normalization', () => {
    const content = { enabled: false, amount: 0, optional: null, sections: [{ variant: 'custom', 'layout-token': { items: [] } }], unknown: { preserve: true } };
    assert.deepEqual(validateSchemaContent(schema, content), { ok: true, errors: [] });
    assert.equal(content.enabled, false);
    assert.equal(content.amount, 0);
  });

  it('reports recursive missing/type/bounds errors', () => {
    const result = validateSchemaContent(schema, { enabled: 'false', amount: -1, sections: [{}] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('enabled must be a boolean')));
    assert.ok(result.errors.some((error) => error.includes('amount is below minimum')));
    assert.ok(result.errors.some((error) => error.includes('sections[0].variant is required')));
  });

  it('rejects unsafe keys, over-deep content, and invalid root values', () => {
    assert.equal(validateSchemaContent(schema, JSON.parse('{"enabled":true,"amount":1,"__proto__":"bad"}')).ok, false);
    assert.equal(validateSchemaContent(schema, []).ok, false);
    let nested = {};
    for (let index = 0; index < 35; index += 1) nested = { next: nested };
    const deepSchema = { nested: { type: 'object', properties: { next: { type: 'object', properties: { next: { type: 'object' } } } } } };
    assert.equal(validateSchemaContent(deepSchema, { nested }).ok, false);
  });
});
