import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wranglerHasPlaceholders } from '../scripts/lib/state.mjs';

test('wranglerHasPlaceholders detects template placeholders', () => {
  assert.equal(wranglerHasPlaceholders('"account_id": "REPLACE_WITH_YOUR_CF_ACCOUNT_ID"'), true);
  assert.equal(wranglerHasPlaceholders('"name": "specy-dev"'), false);
  assert.equal(wranglerHasPlaceholders(null), false);
  assert.equal(wranglerHasPlaceholders(undefined), false);
  assert.equal(wranglerHasPlaceholders(''), false);
  // A configured file may mention the token name in a comment without the
  // placeholder marker; only the literal marker counts.
  assert.equal(wranglerHasPlaceholders('// REPLACE_WITH is gone'), true);
});
