// @ts-check — imports TS sources directly (Node ≥ 24 strips types)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimValueMatches, pluginClaimMatches } from '../src/plugins/claimMatching.ts';

test('claimValueMatches: primitives by value', () => {
  assert.equal(claimValueMatches('pro', 'pro'), true);
  assert.equal(claimValueMatches('pro', 'free'), false);
  assert.equal(claimValueMatches(true, true), true);
  assert.equal(claimValueMatches(1, 1), true);
  assert.equal(claimValueMatches(null, null), true);
  assert.equal(claimValueMatches(null, 'x'), false);
});

test('claimValueMatches: deep-subset for objects (expected ⊆ actual)', () => {
  assert.equal(claimValueMatches({ tier: 'pro' }, { tier: 'pro', extra: true }), true);
  assert.equal(claimValueMatches({ tier: 'pro', extra: true }, { tier: 'pro' }), false);
  assert.equal(claimValueMatches({ nested: { a: 1 } }, { nested: { a: 1, b: 2 } }), true);
  assert.equal(claimValueMatches({ nested: { a: 2 } }, { nested: { a: 1 } }), false);
});

test('claimValueMatches: arrays must match exactly (length and order)', () => {
  assert.equal(claimValueMatches(['a', 'b'], ['a', 'b']), true);
  assert.equal(claimValueMatches(['a'], ['a', 'b']), false);
  assert.equal(claimValueMatches([], {}), false);
});

test('pluginClaimMatches: namespaced lookup under claims.<pluginId>', () => {
  const tokenClaims = { pluradash: { entitlements: { tier: 'pro' } }, is_agent: true };
  assert.equal(
    pluginClaimMatches('pluradash', { entitlements: { tier: 'pro' } }, tokenClaims),
    true,
  );
  assert.equal(
    pluginClaimMatches('pluradash', { entitlements: { tier: 'pro' } }, { pluradash: { entitlements: { tier: 'free' } } }),
    false,
  );
  // No cross-namespace leakage: another plugin's claim object never satisfies predicates
  assert.equal(
    pluginClaimMatches('acme', { entitlements: { tier: 'pro' } }, tokenClaims),
    false,
  );
});

test('pluginClaimMatches: fail-closed when claims are absent (E-001 fail-closed)', () => {
  // No tokenClaims at all (caller did not pass them)
  assert.equal(pluginClaimMatches('pluradash', { entitlements: { tier: 'pro' } }, undefined), false);
  assert.equal(pluginClaimMatches('pluradash', { entitlements: { tier: 'pro' } }, null), false);
  // Plugin claim object missing entirely (resolver returned NULL → omitted at mint)
  assert.equal(pluginClaimMatches('pluradash', { entitlements: { tier: 'pro' } }, { is_agent: true }), false);
  // Claim object malformed (not an object)
  assert.equal(pluginClaimMatches('pluradash', { entitlements: { tier: 'pro' } }, { pluradash: 'oops' }), false);
});

test('pluginClaimMatches: empty predicate set matches only with claims present', () => {
  // An empty predicate object over an absent claim object still fails closed —
  // gating on a claim that does not exist must not grant access.
  assert.equal(pluginClaimMatches('pluradash', {}, undefined), false);
  assert.equal(pluginClaimMatches('pluradash', {}, { pluradash: {} }), true);
});
