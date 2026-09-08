import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WORKER_NAME, validateWorkerName } from '../scripts/lib/worker-name.mjs';

describe('validateWorkerName', () => {
  it('accepts the default "specy"', () => {
    assert.equal(validateWorkerName('specy'), undefined);
  });

  it('accepts lowercase letters, digits, hyphens and underscores', () => {
    assert.equal(validateWorkerName('specy-dev'), undefined);
    assert.equal(validateWorkerName('specy_dev'), undefined);
    assert.equal(validateWorkerName('specy2'), undefined);
  });

  it('trims surrounding whitespace before validating', () => {
    assert.equal(validateWorkerName('  specy  '), undefined);
  });

  it('accepts the maximum length of 58 characters', () => {
    const max = 'a' + 'b'.repeat(57);
    assert.equal(max.length, 58);
    assert.equal(validateWorkerName(max), undefined);
  });

  it('rejects names longer than 58 characters', () => {
    const tooLong = 'a' + 'b'.repeat(58);
    assert.equal(tooLong.length, 59);
    assert.match(validateWorkerName(tooLong), /58/);
  });

  it('rejects names not starting with a letter', () => {
    assert.ok(validateWorkerName('2specy'));
    assert.ok(validateWorkerName('-specy'));
    assert.ok(validateWorkerName('_specy'));
  });

  it('rejects uppercase letters, spaces and special characters', () => {
    assert.ok(validateWorkerName('Specy'));
    assert.ok(validateWorkerName('my cms'));
    assert.ok(validateWorkerName('specy.dev'));
    assert.ok(validateWorkerName('specy/dev'));
  });

  it('rejects empty and missing input', () => {
    assert.ok(validateWorkerName(''));
    assert.ok(validateWorkerName('   '));
    assert.ok(validateWorkerName(undefined));
  });
});

describe('DEFAULT_WORKER_NAME', () => {
  it('is "specy"', () => {
    assert.equal(DEFAULT_WORKER_NAME, 'specy');
  });

  it('passes its own validation', () => {
    assert.equal(validateWorkerName(DEFAULT_WORKER_NAME), undefined);
  });
});
