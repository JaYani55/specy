import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateTenantCustomFieldValues } from '../src/utils/tenantCustomFields.ts';

const definitions = {
  participant_min: { label: 'Minimum participants', type: 'number', required: true, is_public: true },
  registration_status: { label: 'Registration', type: 'string', required: true, is_public: true },
  internal_reference: { label: 'Internal reference', type: 'string', required: false, is_public: false },
};

describe('workspace custom field values', () => {
  it('validates required and typed product/event values', () => {
    assert.match(validateTenantCustomFieldValues(definitions, { registration_status: 'open' }) ?? '', /Minimum participants is required/);
    assert.match(validateTenantCustomFieldValues(definitions, { participant_min: '3', registration_status: 'open' }) ?? '', /Minimum participants has an invalid value/);
    assert.equal(validateTenantCustomFieldValues(definitions, { participant_min: 3, registration_status: 'open' }), null);
  });

  it('accepts false and zero as present values instead of treating them as empty', () => {
    assert.equal(validateTenantCustomFieldValues({ enabled: { label: 'Enabled', type: 'boolean', required: true } }, { enabled: false }), null);
    assert.equal(validateTenantCustomFieldValues({ min: { label: 'Minimum', type: 'number', required: true } }, { min: 0 }), null);
  });
});
