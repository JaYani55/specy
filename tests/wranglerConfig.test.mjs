import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { removeSecretsStoreBinding } from '../scripts/lib/wrangler-config.mjs';

const BINDING = [
  '  "secrets_store_secrets": [',
  '    {',
  '      "binding": "SS_SUPABASE_SECRET_KEY",',
  '      "store_id": "e99a63556266453693946991d25b6947",',
  '      "secret_name": "SUPABASE_SECRET_KEY"',
  '    },',
  '    {',
  '      "binding": "SS_OTHER",',
  '      "store_id": "aaaa",',
  '      "secret_name": "OTHER"',
  '    }',
  '  ],',
].join('\n');

describe('removeSecretsStoreBinding', () => {
  it('removes the matching binding and keeps the remaining entry valid', () => {
    const { text, removed } = removeSecretsStoreBinding(BINDING, 'SS_SUPABASE_SECRET_KEY');
    assert.equal(removed, true);
    assert.equal(text.includes('SS_SUPABASE_SECRET_KEY'), false);
    assert.ok(text.includes('"binding": "SS_OTHER"'));
    // remaining array must be valid JSON-ish: no double commas, no dangling comma
    assert.doesNotMatch(text, /,\s*,/);
    const arrayBody = text.match(/\[([\s\S]*)\]/)[1];
    assert.doesNotMatch(arrayBody, /,\s*\]$/);
  });

  it('removes the last remaining entry and leaves an empty array', () => {
    const single = [
      '  "secrets_store_secrets": [',
      '    {',
      '      "binding": "SS_SUPABASE_SECRET_KEY",',
      '      "store_id": "e99a63556266453693946991d25b6947",',
      '      "secret_name": "SUPABASE_SECRET_KEY"',
      '    }',
      '  ],',
    ].join('\n');
    const { text, removed } = removeSecretsStoreBinding(single, 'SS_SUPABASE_SECRET_KEY');
    assert.equal(removed, true);
    assert.match(text, /"secrets_store_secrets":\s*\[\s*\]\s*,/);
  });

  it('returns text unchanged when the binding is absent', () => {
    const { text, removed } = removeSecretsStoreBinding(BINDING, 'SS_MISSING');
    assert.equal(removed, false);
    assert.equal(text, BINDING);
  });

  it('does not touch other occurrences of the name outside the binding', () => {
    const doc = [
      '  // SS_SUPABASE_SECRET_KEY docs',
      '  "vars": { "X": "SS_SUPABASE_SECRET_KEY" },',
      '  "secrets_store_secrets": [',
      '    {',
      '      "binding": "SS_SUPABASE_SECRET_KEY",',
      '      "store_id": "e99a63556266453693946991d25b6947",',
      '      "secret_name": "SUPABASE_SECRET_KEY"',
      '    },',
      '  ],',
    ].join('\n');
    const { text, removed } = removeSecretsStoreBinding(doc, 'SS_SUPABASE_SECRET_KEY');
    assert.equal(removed, true);
    // the vars entry referencing the name stays intact
    assert.ok(text.includes('"X": "SS_SUPABASE_SECRET_KEY"'));
    assert.doesNotMatch(text, /"binding": "SS_SUPABASE_SECRET_KEY"/);
  });
});
