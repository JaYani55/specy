#!/usr/bin/env node
/**
 * pemkeyworkersecret.mjs — npm run pemkey
 *
 * Stores a PEM private key (e.g. a GitHub App `.pem` private key) as a
 * Cloudflare Worker secret, read directly from a local file so the value
 * cannot be mangled by clipboard/chat/tooling round-trips (smart quotes,
 * re-wrapped lines, escaped newlines — all of which break Workers' `atob()`
 * at key-parse time).
 *
 * TUI flow:
 *   1. Prompt for the secret name to add or replace (e.g. GITHUB_PRIVATE_KEY).
 *   2. Prompt for a local path to the .pem file (Windows "Copy as path"
 *      quotes and ~ are handled).
 *   3. Validate the file strictly like the Worker will: PEM armor present,
 *      base64 body within the alphabet Workers' `atob()` accepts, correct
 *      length/padding, DER body decodable — and report key format
 *      (PKCS#1 "BEGIN RSA PRIVATE KEY" vs PKCS#8 "BEGIN PRIVATE KEY") +
 *      fingerprint before anything is uploaded.
 *   4. After confirmation, pipe the exact file bytes into
 *      `npx wrangler secret put <name>`.
 *
 * Notes:
 *   - PKCS#1 keys are fine: the consuming service (e.g. pluradash
 *     githubAuthService.normalizePrivateKey) auto-converts PKCS#1 → PKCS#8
 *     at runtime.
 *   - The key value itself is never printed, logged or stored anywhere.
 *
 * Requires wrangler auth (CLOUDFLARE_API_TOKEN or a logged-in wrangler).
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { homedir } from 'os';
import { isAbsolute, join, resolve } from 'path';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import * as p from '@clack/prompts';

const ROOT = join(import.meta.dirname, '..');

// ─── Pure helpers (unit-tested) ──────────────────────────────────────────────

/**
 * Validates a Cloudflare secret name (letters, digits, underscores; must not
 * start with a digit).
 *
 * @param {string} name
 * @returns {string|null} error message, or null when valid.
 */
export function validateSecretName(name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'Secret name is required.';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    return 'Secret name may only contain letters, digits and underscores and must not start with a digit.';
  }
  if (trimmed.length > 64) return 'Secret name is too long (max 64 characters).';
  return null;
}

/**
 * Normalizes a pasted local file path: strips the surrounding quotes Windows'
 * "Copy as path" adds, expands `~`, and resolves relative paths against the
 * repo root (not cwd) for predictable behavior.
 *
 * @param {string} input
 * @returns {string} absolute path (not necessarily existing).
 */
export function normalizeInputPath(input) {
  let value = (input ?? '').trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  if (value.startsWith('~')) {
    value = join(homedir(), value.slice(1));
  }
  if (!isAbsolute(value)) {
    value = join(ROOT, value);
  }
  return resolve(value);
}

/** Workers `atob()` base64 alphabet. */
const BASE64_BODY_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Extracts the base64 body of a PEM block and validates it with the same
 * rules Workers' `atob()` enforces: only base64 alphabet characters, length
 * divisible by 4, at most two terminal '=' signs.
 *
 * @param {string} raw File content.
 * @returns {{ ok: true, label: string, keyFormat: 'PKCS#1'|'PKCS#8',
 *             derByteLength: number, fingerprint: string } |
 *           { ok: false, error: string }}
 */
export function analyzePem(raw) {
  const text = String(raw ?? '').replace(/^\uFEFF/, ''); // strip BOM
  const beginMatch = text.match(/-----BEGIN ([^-]+)-----/);
  const endMatch = text.match(/-----END ([^-]+)-----/);
  if (!beginMatch || !endMatch) {
    return { ok: false, error: 'No PEM block found — the file must contain "-----BEGIN …-----" and "-----END …-----" markers.' };
  }
  if (beginMatch[1] !== endMatch[1]) {
    return { ok: false, error: `PEM markers mismatch: BEGIN ${beginMatch[1]} vs END ${endMatch[1]}.` };
  }

  const body = text
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');

  if (!body) {
    return { ok: false, error: 'PEM block has an empty base64 body.' };
  }
  if (!BASE64_BODY_RE.test(body)) {
    return { ok: false, error: 'Base64 body contains characters outside the base64 alphabet — this value would fail atob() in the Worker (smart quotes, escaped characters or copy artifacts?).' };
  }
  if (body.length % 4 !== 0) {
    return { ok: false, error: `Base64 body length (${body.length}) is not divisible by 4 — the key data is truncated or altered.` };
  }
  const padding = body.length - body.replace(/=+$/, '').length;
  if (padding > 2) {
    return { ok: false, error: 'More than two terminal "=" signs — malformed base64 padding.' };
  }

  let der;
  try {
    der = Buffer.from(body, 'base64');
  } catch (e) {
    return { ok: false, error: `Base64 body could not be decoded: ${e.message}` };
  }
  if (der.length === 0) {
    return { ok: false, error: 'Base64 body decodes to zero bytes.' };
  }

  const label = beginMatch[1];
  const keyFormat = label === 'RSA PRIVATE KEY' ? 'PKCS#1' : 'PKCS#8';
  const fingerprint = createHash('sha256').update(der).digest('hex').slice(0, 16);

  return { ok: true, label, keyFormat, derByteLength: der.length, fingerprint };
}

// ─── TUI ─────────────────────────────────────────────────────────────────────

async function runTui() {
  p.intro('PEM key → Worker secret');

  const name = await p.text({
    message: 'Secret name to add or replace',
    placeholder: 'GITHUB_PRIVATE_KEY',
    defaultValue: 'GITHUB_PRIVATE_KEY',
    validate: (value) => validateSecretName(value) ?? undefined,
  });
  if (p.isCancel(name)) return p.cancel('Aborted.');

  const pathInput = await p.text({
    message: 'Local path to the .pem key file (Windows "Copy as path" is fine)',
    placeholder: 'C:\\keys\\my-app.private-key.pem',
    validate: (value) => (value?.trim() ? undefined : 'A file path is required.'),
  });
  if (p.isCancel(pathInput)) return p.cancel('Aborted.');

  const filePath = normalizeInputPath(pathInput);
  if (!existsSync(filePath)) {
    return p.cancel(`File not found: ${filePath}`);
  }
  if (!statSync(filePath).isFile()) {
    return p.cancel(`Not a file: ${filePath}`);
  }

  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (e) {
    return p.cancel(`File could not be read: ${e.message}`);
  }

  const analysis = analyzePem(raw);
  if (!analysis.ok) {
    p.log.error(analysis.error);
    return p.cancel(`Key validation failed for ${filePath} — nothing was uploaded.`);
  }

  p.log.message(`Key validated:
  file        ${filePath}
  format      ${analysis.label} (${analysis.keyFormat})
  key bytes   ${analysis.derByteLength}
  fingerprint sha256:${analysis.fingerprint}…`);

  if (analysis.keyFormat === 'PKCS#1') {
    p.log.info('Legacy PKCS#1 format — the consuming service auto-converts to PKCS#8 at runtime. No action needed.');
  }

  const proceed = await p.confirm({
    message: `Upload as worker secret "${name}"? (wrangler secret put replaces an existing value)`,
    initialValue: true,
  });
  if (p.isCancel(proceed) || !proceed) {
    return p.cancel('Aborted — nothing was uploaded.');
  }

  const wranglerCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const res = spawnSync(wranglerCmd, ['wrangler', 'secret', 'put', name], {
    cwd: ROOT,
    input: raw,
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: true,
  });

  if (res.status !== 0) {
    return p.cancel(`wrangler secret put failed (exit ${res.status}). Check wrangler auth (npx wrangler login) and try again.`);
  }

  p.outro(`Secret "${name}" uploaded from ${filePath}. Redeploy/restart the worker if it reads the secret at boot.`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runTui();
}
