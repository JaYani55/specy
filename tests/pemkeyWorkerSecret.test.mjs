// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

const loadMod = async () => {
  return import(pathToFileURL(join(ROOT, 'scripts/pemkeyworkersecret.mjs')).href);
};

// Minimal valid RSA key bodies (DER is irrelevant for validation — only the
// base64 transport rules and PEM armor are checked). The body is exactly
// base64 of 120 zero bytes (160 chars) so length/padding rules hold.
const KEY_BODY = Buffer.alloc(120).toString('base64');
const KEY_BODY_64LINES = KEY_BODY.replace(/(.{64})/g, '$1\r\n').replace(/\r\n$/, '');
const RSA_PRIVATE_PEM = [
  '-----BEGIN RSA PRIVATE KEY-----',
  KEY_BODY_64LINES,
  '-----END RSA PRIVATE KEY-----',
  '',
].join('\r\n');

const PKCS8_PEM = RSA_PRIVATE_PEM
  .replace('BEGIN RSA PRIVATE KEY', 'BEGIN PRIVATE KEY')
  .replace('END RSA PRIVATE KEY', 'END PRIVATE KEY');

test('pemkey: analyzePem accepts a valid PKCS#1 PEM with CRLF line endings', async () => {
  const { analyzePem } = await loadMod();
  const result = analyzePem(RSA_PRIVATE_PEM);
  assert.equal(result.ok, true);
  assert.equal(result.label, 'RSA PRIVATE KEY');
  assert.equal(result.keyFormat, 'PKCS#1');
  assert.ok(result.derByteLength > 0);
  assert.match(result.fingerprint, /^[0-9a-f]{16}$/);
});

test('pemkey: analyzePem classifies PKCS#8 as PKCS#8', async () => {
  const { analyzePem } = await loadMod();
  const result = analyzePem(PKCS8_PEM);
  assert.equal(result.ok, true);
  assert.equal(result.keyFormat, 'PKCS#8');
});

test('pemkey: analyzePem strips a BOM', async () => {
  const { analyzePem } = await loadMod();
  const result = analyzePem(`\uFEFF${PKCS8_PEM}`);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('pemkey: analyzePem rejects a missing PEM armor', async () => {
  const { analyzePem } = await loadMod();
  const result = analyzePem(KEY_BODY);
  assert.equal(result.ok, false);
  assert.match(result.error, /No PEM block found/);
});

test('pemkey: analyzePem rejects mismatched BEGIN/END markers', async () => {
  const { analyzePem } = await loadMod();
  const result = analyzePem(RSA_PRIVATE_PEM.replace('END RSA PRIVATE KEY', 'END CERTIFICATE'));
  assert.equal(result.ok, false);
  assert.match(result.error, /markers mismatch/);
});

test('pemkey: analyzePem rejects non-base64 characters (the atob() failure this script guards against)', async () => {
  const { analyzePem } = await loadMod();
  // Smart quote pasted into the body — exactly the copy-paste artifact that
  // breaks Workers' atob() at key-parse time.
  const polluted = RSA_PRIVATE_PEM.replace('AAAA', 'AA\u2019AA');
  const result = analyzePem(polluted);
  assert.equal(result.ok, false);
  assert.match(result.error, /outside the base64 alphabet/);
});

test('pemkey: analyzePem rejects escaped newlines embedded in the body', async () => {
  const { analyzePem } = await loadMod();
  // Literal backslash-n (JSON-escaped value) inside the body — \ and n are
  // both outside the base64 alphabet.
  const polluted = RSA_PRIVATE_PEM.replace('AAAA', 'AA\\nAA');
  const result = analyzePem(polluted);
  assert.equal(result.ok, false);
  assert.match(result.error, /outside the base64 alphabet/);
});

test('pemkey: analyzePem rejects a body length not divisible by 4 (truncated key)', async () => {
  const { analyzePem } = await loadMod();
  const truncated = RSA_PRIVATE_PEM.replace('AAAA', 'AAA');
  const result = analyzePem(truncated);
  assert.equal(result.ok, false);
  assert.match(result.error, /not divisible by 4/);
});

test('pemkey: validateSecretName', async () => {
  const { validateSecretName } = await loadMod();
  assert.equal(validateSecretName('GITHUB_PRIVATE_KEY'), null);
  assert.equal(validateSecretName('_x1'), null);
  assert.ok(validateSecretName('1abc'));
  assert.ok(validateSecretName('has-dash'));
  assert.ok(validateSecretName('has space'));
  assert.ok(validateSecretName(''));
  assert.ok(validateSecretName(null));
});

test('pemkey: normalizeInputPath strips Windows "Copy as path" quotes, expands ~, resolves relative to ROOT', async () => {
  const { normalizeInputPath } = await loadMod();
  const { homedir } = await import('os');

  const winPath = normalizeInputPath('"C:\\keys\\my-app.private-key.pem"');
  assert.equal(winPath, 'C:\\keys\\my-app.private-key.pem');

  const tilde = normalizeInputPath('~/.ssh/key.pem');
  assert.equal(tilde, join(homedir(), '.ssh', 'key.pem'));

  const rel = normalizeInputPath('keys/key.pem');
  assert.equal(rel, join(ROOT, 'keys', 'key.pem'));
});
