import assert from 'node:assert/strict';
import test from 'node:test';

import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
  isUsernameTakenError,
  validateUsername,
} from '../src/utils/usernameUtils.ts';

const errorOf = (value) => validateUsername(value);

// ─── validateUsername ───────────────────────────────────────────────────────

test('accepts typical usernames', () => {
  for (const value of ['Ada Lovelace', 'ada', 'Ada_Lovelace-2', '  Ada  ']) {
    assert.equal(errorOf(value), null, `"${value}" should be valid`);
  }
});

test('rejects values below the minimum length (after trimming)', () => {
  const error = errorOf('a');
  assert.ok(error);
  assert.match(error.en, new RegExp(`at least ${USERNAME_MIN_LENGTH}`));
});

test('rejects values above the maximum length', () => {
  const error = errorOf('x'.repeat(USERNAME_MAX_LENGTH + 1));
  assert.ok(error);
  assert.match(error.en, new RegExp(`${USERNAME_MAX_LENGTH} characters`));
});

test('accepts exactly min and max length values', () => {
  assert.equal(errorOf('x'.repeat(USERNAME_MIN_LENGTH)), null);
  assert.equal(errorOf('x'.repeat(USERNAME_MAX_LENGTH)), null);
});

test('rejects characters outside the allowed set', () => {
  for (const value of ['ada@lovelace', 'ada.lovelace', 'ada!', 'ada#1', 'ada/lace', 'adaü']) {
    const error = errorOf(value);
    assert.ok(error, `"${value}" should be rejected`);
    assert.match(error.en, /letters, numbers, spaces, hyphens and underscores/);
  }
});

test('rejects values that break the AuthContext first/last-name split', () => {
  // AuthContext derives names via Username.split(' ') — the pattern must not
  // allow characters that make a space-separated display name unsafe.
  assert.equal(USERNAME_PATTERN.test('A\tB'), false, 'tabs must be rejected');
  assert.equal(USERNAME_PATTERN.test('A\nB'), false, 'newlines must be rejected');
});

test('returns localized rule messages (en + de)', () => {
  const error = errorOf('!');
  assert.equal(typeof error.en, 'string');
  assert.equal(typeof error.de, 'string');
  assert.ok(error.en.length > 0 && error.de.length > 0);
});

// ─── isUsernameTakenError ───────────────────────────────────────────────────

test('detects Postgres unique-violation error code 23505', () => {
  assert.equal(isUsernameTakenError({ code: '23505', message: 'duplicate key' }), true);
});

test('detects the user_profile username constraint by name', () => {
  assert.equal(
    isUsernameTakenError({ message: 'duplicate key value violates unique constraint "user_profile_username_key"' }),
    true,
  );
});

test('detects generic duplicate-key messages mentioning the column', () => {
  assert.equal(
    isUsernameTakenError({ message: 'duplicate key ... "Username"' }),
    true,
  );
  // Duplicate key on another constraint (e.g. the primary key) is not a
  // username conflict.
  assert.equal(
    isUsernameTakenError({ message: 'duplicate key value violates unique constraint "user_profile_pkey"' }),
    false,
  );
});

test('rejects unrelated errors and non-objects', () => {
  assert.equal(isUsernameTakenError(new Error('network timeout')), false);
  assert.equal(isUsernameTakenError({ code: '42501' }), false);
  assert.equal(isUsernameTakenError(null), false);
  assert.equal(isUsernameTakenError('duplicate key'), false);
  assert.equal(isUsernameTakenError(undefined), false);
});
