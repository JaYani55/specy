import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectPluginClaims, RESERVED_CLAIM_KEYS, GLOBAL_CLAIM_BUDGET_BYTES } from '../scripts/lib/plugin-workspace.mjs';

const plugin = (id, declarations) => ({ id, manifest: { claims_declarations: declarations } });

test('collectPluginClaims namespaces claims under the plugin id', () => {
  const { claims, errors } = collectPluginClaims([
    plugin('pluradash', [{ key: 'entitlements', type: 'json', resolver: 'claims_entitlements', budget_bytes: 512 }]),
  ]);
  assert.equal(errors.length, 0);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].topLevelKey, 'pluradash');
  assert.equal(claims[0].key, 'entitlements');
  assert.equal(claims[0].budgetBytes, 512);
});

test('collectPluginClaims rejects reserved core claim keys', () => {
  for (const reserved of RESERVED_CLAIM_KEYS) {
    const { errors } = collectPluginClaims([plugin('acme', [{ key: reserved, type: 'json', resolver: 'r' }])]);
    assert.equal(errors.length, 1, `reserved key "${reserved}" must be rejected`);
    assert.match(errors[0], /reserved/);
  }
});

test('collectPluginClaims rejects duplicate claim keys within a plugin (single-source)', () => {
  const { errors } = collectPluginClaims([
    plugin('acme', [
      { key: 'entitlements', type: 'json', resolver: 'r1' },
      { key: 'entitlements', type: 'json', resolver: 'r2' },
    ]),
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /duplicate/);
});

test('collectPluginClaims allows the same key in different plugins (namespacing)', () => {
  const { claims, errors } = collectPluginClaims([
    plugin('acme', [{ key: 'entitlements', type: 'json', resolver: 'r' }]),
    plugin('pluradash', [{ key: 'entitlements', type: 'json', resolver: 'r' }]),
  ]);
  assert.equal(errors.length, 0);
  assert.equal(claims.length, 2);
  assert.deepEqual(claims.map((c) => c.topLevelKey).sort(), ['acme', 'pluradash']);
});

test('collectPluginClaims enforces the global claim budget', () => {
  const perClaim = Math.floor(GLOBAL_CLAIM_BUDGET_BYTES / 2) + 1;
  const { errors } = collectPluginClaims([
    plugin('acme', [{ key: 'a', type: 'json', resolver: 'r', budget_bytes: perClaim }]),
    plugin('pluradash', [{ key: 'b', type: 'json', resolver: 'r', budget_bytes: perClaim }]),
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /budget/);
});

test('collectPluginClaims rejects malformed declarations and invalid key shapes', () => {
  const { errors } = collectPluginClaims([
    plugin('acme', [null, { key: 'Bad-Key', type: 'json', resolver: 'r' }, { key: 'ok', type: 'json' }]),
  ]);
  assert.equal(errors.length, 3); // null entry + invalid key + missing resolver
  assert.ok(errors.some((e) => /malformed/.test(e)));
  assert.ok(errors.some((e) => /Bad-Key/.test(e)));
  assert.ok(errors.some((e) => /missing a resolver/.test(e)));
});

test('collectPluginClaims ignores plugins without declarations', () => {
  const { claims, errors } = collectPluginClaims([{ id: 'acme', manifest: {} }]);
  assert.equal(errors.length, 0);
  assert.equal(claims.length, 0);
});
