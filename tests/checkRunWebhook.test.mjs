import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';

import {
  buildWebhookUrl,
  extractBuildDetails,
  findWebhookByUrl,
  parseCheckRunEvent,
  timingSafeBytesEqual,
  verifyWebhookSignature,
  webhookNeedsRecreation,
} from '../plugins/pluradash/api/sync/webhookLogic.ts';

/** Computes the GitHub-style X-Hub-Signature-256 value for a body. */
async function signPayload(secret, body) {
  const key = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return 'sha256=' + Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const SECRET = 'whsec_test_0123456789abcdef';
const BODY = JSON.stringify({ action: 'created', check_run: { id: 1 } });

// ─── Signature verification ──────────────────────────────────────────────────

test('verifyWebhookSignature accepts a valid GitHub signature', async () => {
  const signature = await signPayload(SECRET, BODY);
  assert.equal(await verifyWebhookSignature(SECRET, BODY, signature), true);
});

test('verifyWebhookSignature rejects a tampered body', async () => {
  const signature = await signPayload(SECRET, BODY);
  assert.equal(await verifyWebhookSignature(SECRET, BODY + ' ', signature), false);
});

test('verifyWebhookSignature rejects a wrong secret', async () => {
  const signature = await signPayload('other-secret', BODY);
  assert.equal(await verifyWebhookSignature(SECRET, BODY, signature), false);
});

test('verifyWebhookSignature rejects missing and malformed headers', async () => {
  assert.equal(await verifyWebhookSignature(SECRET, BODY, null), false);
  assert.equal(await verifyWebhookSignature(SECRET, BODY, ''), false);
  assert.equal(await verifyWebhookSignature(SECRET, BODY, 'sha1=deadbeef'), false);
  assert.equal(await verifyWebhookSignature(SECRET, BODY, 'sha256=not-hex'), false);
  assert.equal(await verifyWebhookSignature(SECRET, BODY, 'sha256=abc'), false);
});

test('timingSafeBytesEqual is length-safe and value-sensitive', () => {
  const enc = new TextEncoder();
  assert.equal(timingSafeBytesEqual(new TextEncoder().encode('aa'), new TextEncoder().encode('aa')), true);
  assert.equal(timingSafeBytesEqual(new TextEncoder().encode('aa'), new TextEncoder().encode('ab')), false);
  assert.equal(timingSafeBytesEqual(new Uint8Array(1), new Uint8Array(2)), false);
  assert.equal(timingSafeBytesEqual(new Uint8Array(0), new Uint8Array(0)), true);
  void enc;
});

// ─── Webhook URL ─────────────────────────────────────────────────────────────

test('buildWebhookUrl prefers APP_URL and trims trailing slashes', () => {
  assert.equal(
    buildWebhookUrl({ APP_URL: 'https://cms.example.com/' }, 'https://worker.dev/x'),
    'https://cms.example.com/api/plugin/pluradash/webhooks/check-run',
  );
});

test('buildWebhookUrl falls back to the request origin', () => {
  assert.equal(
    buildWebhookUrl({}, 'https://worker.dev/api/plugins'),
    'https://worker.dev/api/plugin/pluradash/webhooks/check-run',
  );
});

// ─── Output extraction (Cloudflare Workers Builds format) ────────────────────

const WORKERS_BUILD_OUTPUT = `Build ID: 66d57c5b-ed49-46b1-b849-fd7309557d6a
Script: field-notes-ssr
Version ID: 728fd8ca-ae38-4738-9b3a-faa6ca50fbca
Preview URL: https://728fd8ca-field-notes-ssr.demo1-data109.workers.dev
Preview Alias URL: https://dev-field-notes-ssr.demo1-data109.workers.dev`;

test('extractBuildDetails parses the Workers Builds output format', () => {
  const details = extractBuildDetails(WORKERS_BUILD_OUTPUT);
  assert.equal(details.buildId, '66d57c5b-ed49-46b1-b849-fd7309557d6a');
  assert.equal(details.versionId, '728fd8ca-ae38-4738-9b3a-faa6ca50fbca');
  assert.equal(details.previewUrl, 'https://728fd8ca-field-notes-ssr.demo1-data109.workers.dev/');
  assert.equal(details.previewAliasUrl, 'https://dev-field-notes-ssr.demo1-data109.workers.dev/');
});

test('extractBuildDetails tolerates unknown output formats', () => {
  const details = extractBuildDetails('Something went wrong.');
  assert.equal(details.buildId, null);
  assert.equal(details.versionId, null);
  assert.equal(details.previewUrl, null);
  assert.equal(details.previewAliasUrl, null);
});

test('extractBuildDetails rejects non-https preview URLs', () => {
  const details = extractBuildDetails('Preview URL: http://insecure.example.com');
  assert.equal(details.previewUrl, null);
});

// ─── Event parsing & state mapping ───────────────────────────────────────────

function buildPayload(overrides = {}) {
  return {
    action: 'created',
    check_run: {
      name: 'Workers Builds: field-notes-ssr',
      status: 'in_progress',
      conclusion: null,
      head_sha: '2c5577aabc',
      started_at: '2026-09-13T10:00:00Z',
      completed_at: null,
      check_suite: { head_branch: 'dev' },
      output: { title: 'Workers Builds: field-notes-ssr', summary: WORKERS_BUILD_OUTPUT, text: null },
    },
    repository: { id: 987654, full_name: 'acme/field-notes-ssr' },
    ...overrides,
  };
}

test('parseCheckRunEvent maps created/in_progress to running', () => {
  const parsed = parseCheckRunEvent(buildPayload());
  assert.ok(parsed);
  assert.equal(parsed.buildStatus, 'running');
  assert.equal(parsed.repoId, 987654);
  assert.equal(parsed.repoFullName, 'acme/field-notes-ssr');
  assert.equal(parsed.branch, 'dev');
  assert.equal(parsed.headSha, '2c5577aabc');
  assert.equal(parsed.checkName, 'Workers Builds: field-notes-ssr');
  assert.equal(parsed.previewUrl, 'https://728fd8ca-field-notes-ssr.demo1-data109.workers.dev/');
  assert.equal(parsed.versionId, '728fd8ca-ae38-4738-9b3a-faa6ca50fbca');
});

test('parseCheckRunEvent maps completed conclusions', () => {
  const success = parseCheckRunEvent(buildPayload({
    action: 'completed',
    check_run: {
      status: 'completed', conclusion: 'success', check_suite: { head_branch: 'dev' },
      output: { summary: WORKERS_BUILD_OUTPUT },
    },
  }));
  assert.equal(success.buildStatus, 'succeeded');

  const failure = parseCheckRunEvent(buildPayload({
    action: 'completed',
    check_run: {
      status: 'completed', conclusion: 'failure', check_suite: { head_branch: 'dev' },
      output: { summary: 'Build failed.' },
    },
  }));
  assert.equal(failure.buildStatus, 'failed');

  for (const conclusion of ['cancelled', 'timed_out', 'startup_failure']) {
    const parsed = parseCheckRunEvent(buildPayload({
      action: 'completed',
      check_run: {
        status: 'completed', conclusion, check_suite: { head_branch: 'dev' },
        output: {},
      },
    }));
    assert.equal(parsed.buildStatus, 'failed', conclusion);
  }
});

test('parseCheckRunEvent ignores skipped/stale/neutral conclusions', () => {
  for (const conclusion of ['skipped', 'stale', 'neutral', 'action_required']) {
    const parsed = parseCheckRunEvent(buildPayload({
      action: 'completed',
      check_run: {
        status: 'completed', conclusion, check_suite: { head_branch: 'dev' }, output: {},
      },
    }));
    assert.equal(parsed.buildStatus, null, conclusion);
  }
});

test('parseCheckRunEvent maps queued and rerequested actions to running', () => {
  const queued = parseCheckRunEvent(buildPayload({ check_run: { status: 'queued', check_suite: { head_branch: 'dev' }, output: {} } }));
  assert.equal(queued.buildStatus, 'running');
  const rerequested = parseCheckRunEvent(buildPayload({ action: 'rerequested', check_run: { status: 'in_progress', check_suite: { head_branch: 'dev' }, output: {} } }));
  assert.equal(rerequested.buildStatus, 'running');
});

function rerequested(a, b) { return a; }
function parsedStatus(v) { return v?.buildStatus; }

test('parseCheckRunEvent returns null for non-check_run payloads', () => {
  assert.equal(parseCheckRunEvent({ zen: 'Keep it simple.' }), null);
  assert.equal(parseCheckRunEvent(null), null);
  assert.equal(parseCheckRunEvent('string'), null);
  assert.equal(parseCheckRunEvent({ action: 'completed' }), null);
});

// ─── Repo webhook matching ───────────────────────────────────────────────────

const WEBHOOK_URL = 'https://cms.example.com/api/plugin/pluradash/webhooks/check-run';

test('findWebhookByUrl matches the endpoint URL exactly', () => {
  const hooks = [
    { id: 1, config: { url: 'https://other.example.com/hook' } },
    { id: 2, config: { url: WEBHOOK_URL } },
  ];
  assert.equal(findWebhookByUrl(hooks, WEBHOOK_URL)?.id, 2);
  assert.equal(findWebhookByUrl(hooks, 'https://unmatched.example.com'), null);
  assert.equal(findWebhookByUrl([], WEBHOOK_URL), null);
});

test('webhookNeedsRecreation detects inactive or mismatched hooks', () => {
  assert.equal(webhookNeedsRecreation({ id: 1, active: true, events: ['check_run'], config: { url: WEBHOOK_URL } }, WEBHOOK_URL), false);
  assert.equal(webhookNeedsRecreation({ id: 1, active: false, events: ['check_run'], config: { url: WEBHOOK_URL } }, WEBHOOK_URL), true);
  assert.equal(webhookNeedsRecreation({ id: 1, active: true, events: ['push'], config: { url: WEBHOOK_URL } }, WEBHOOK_URL), true);
  assert.equal(webhookNeedsRecreation({ id: 1, active: true, events: ['check_run'], config: { url: 'https://other' } }, WEBHOOK_URL), true);
});

