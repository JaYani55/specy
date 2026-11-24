import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  API_TOKEN_PREFIX,
  generateApiToken,
  hashApiToken,
  isApiToken,
  parseApiTokenValue,
  validateTokenCreateInput,
} from '../api/lib/apiTokenCrypto.ts';

test('generateApiToken produces spc_-prefixed base64url tokens with a display prefix', () => {
  const generated = generateApiToken();

  assert.ok(generated.raw.startsWith(API_TOKEN_PREFIX));
  // 32 random bytes → 43 base64url chars (no padding)
  assert.equal(generated.raw.length, API_TOKEN_PREFIX.length + 43);
  assert.ok(!generated.raw.includes('+'));
  assert.ok(!generated.raw.includes('/'));
  assert.ok(!generated.raw.includes('='));
  // display prefix = spc_ + first 8 body chars
  assert.equal(generated.displayPrefix, `${API_TOKEN_PREFIX}${generated.raw.slice(API_TOKEN_PREFIX.length, API_TOKEN_PREFIX.length + 8)}`);
});

test('generateApiToken produces unique tokens', () => {
  const a = generateApiToken();
  const b = generateApiToken();
  assert.notEqual(a.raw, b.raw);
});

test('hashApiToken is a deterministic SHA-256 hex digest', async () => {
  const hash1 = await hashApiToken('spc_testtoken');
  const hash2 = await hashApiToken('spc_testtoken');
  const hash3 = await hashApiToken('spc_othertoken');

  assert.equal(hash1, hash2);
  assert.notEqual(hash1, hash3);
  assert.match(hash1, /^[0-9a-f]{64}$/);
});

test('isApiToken accepts spc_ tokens and rejects Supabase JWTs', () => {
  assert.equal(isApiToken('spc_abcdefghijklmnopqrstuvwxyz0123456789'), true);
  assert.equal(isApiToken('spc_short'), false);
  assert.equal(isApiToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig'), false);
  assert.equal(isApiToken(undefined), false);
  assert.equal(isApiToken(null), false);
  assert.equal(isApiToken(''), false);
});

test('parseApiTokenValue extracts Bearer API tokens only', () => {
  assert.equal(parseApiTokenValue('Bearer spc_abcdefghijklmnopqrstuvwxyz0123456789'), 'spc_abcdefghijklmnopqrstuvwxyz0123456789');
  assert.equal(parseApiTokenValue('bearer spc_abcdefghijklmnopqrstuvwxyz0123456789'), 'spc_abcdefghijklmnopqrstuvwxyz0123456789');
  // JWT bearer values are not API tokens
  assert.equal(parseApiTokenValue('Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'), null);
  assert.equal(parseApiTokenValue('Bearer spc_short'), null);
  assert.equal(parseApiTokenValue(undefined), null);
  assert.equal(parseApiTokenValue(''), null);
});

test('validateTokenCreateInput enforces name length and optional future expiry', () => {
  assert.equal(validateTokenCreateInput('n8n sync', undefined), null);
  assert.equal(validateTokenCreateInput('n8n sync', null), null);
  assert.equal(validateTokenCreateInput('n8n sync', ''), null);

  const future = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(validateTokenCreateInput('n8n sync', future), null);

  // expiry must be in the future
  const past = new Date(Date.now() - 86_400_000).toISOString();
  assert.ok(validateTokenCreateInput('n8n sync', past)?.includes('future'));

  // expiry must parse
  assert.ok(validateTokenCreateInput('n8n sync', 'not-a-date')?.includes('ISO 8601'));

  // name bounds
  assert.ok(validateTokenCreateInput('', undefined)?.length);
  assert.ok(validateTokenCreateInput('   ', undefined)?.length);
  assert.ok(validateTokenCreateInput('x'.repeat(101), undefined)?.length);
  assert.equal(validateTokenCreateInput('x'.repeat(100), undefined), null);

  // non-string name
  assert.ok(validateTokenCreateInput(42, undefined)?.length);
  // non-string expiry
  assert.ok(validateTokenCreateInput('n8n sync', 42)?.length);
});
