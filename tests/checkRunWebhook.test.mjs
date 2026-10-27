import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';

import {
  buildWebhookUrl,
  extractBuildDetails,
  findWebhookByUrl,
  groupRepoDeploymentRows,
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

// Real Cloudflare Pages summary (repo Pluracon/akademiefreytag, delivery
// 2e7b5bd0-bc02-11f1-9980-0cad9dba189e): HTML table with the URL only inside
// an <a href> target. Regression guard for the preview_url: null bug.
const PAGES_HTML_OUTPUT = `<table><tr><td><strong>Latest commit:</strong> </td><td>\n<code>7f54bd6</code>\n</td></tr>\n<tr><td><strong>Status:</strong></td><td>&nbsp;✅&nbsp; Deploy successful!</td></tr>\n<tr><td><strong>Preview URL:</strong></td><td>\n<a href='https://09920446.freytag-akademie.pages.dev'>https://09920446.freytag-akademie.pages.dev</a>\n</td></tr>\n</table>\n\n[View logs](https://dash.cloudflare.com/?to=/pages/view/freytag-akademie/09920446)`;

test('extractBuildDetails parses the Cloudflare Pages HTML-table output format', () => {
  const details = extractBuildDetails(PAGES_HTML_OUTPUT);
  assert.equal(details.previewUrl, 'https://09920446.freytag-akademie.pages.dev/');
  assert.equal(details.buildId, null);
  assert.equal(details.versionId, null);
});

test('extractBuildDetails normalizes HTML entities inside labels', () => {
  const details = extractBuildDetails(
    '<tr><td><strong>Status:</strong></td><td>&nbsp;Deploy ok</td></tr>\nPreview URL: https://plain.example.com',
  );
  assert.equal(details.previewUrl, 'https://plain.example.com/');
});

test('extractBuildDetails still rejects non-https URLs wrapped in anchor tags', () => {
  const details = extractBuildDetails("<a href='http://insecure.example.com'>http://insecure.example.com</a>");
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

test('parseCheckRunEvent captures the build link from the check_run itself', () => {
  const fromDetails = parseCheckRunEvent(buildPayload({
    check_run: {
      status: 'in_progress', check_suite: { head_branch: 'main' }, output: {},
      details_url: 'https://github.com/acme/field-notes-ssr/actions/runs/12345',
      html_url: 'https://github.com/acme/field-notes-ssr/actions/runs/12345/checks',
    },
  }));
  assert.ok(fromDetails);
  assert.equal(fromDetails.buildUrl, 'https://github.com/acme/field-notes-ssr/actions/runs/12345');

  const fromHtml = parseCheckRunEvent(buildPayload({
    check_run: {
      status: 'in_progress', check_suite: { head_branch: 'main' }, output: {},
      html_url: 'https://github.com/acme/field-notes-ssr/actions/runs/99',
    },
  }));
  assert.ok(fromHtml);
  assert.equal(fromHtml.buildUrl, 'https://github.com/acme/field-notes-ssr/actions/runs/99');

  const withoutLink = parseCheckRunEvent(buildPayload({ check_run: { status: 'queued', check_suite: { head_branch: 'dev' }, output: {} } }));
  assert.equal(withoutLink.buildUrl, null);
});

// Regression guard: builds on main/master (or any non-dev branch) used to be
// dropped by the service layer and never reached the apps overview.
test('parseCheckRunEvent tracks builds on main/master and other branches', () => {
  for (const branch of ['main', 'master', 'feature/new-hero', 'release/1.4']) {
    const parsed = parseCheckRunEvent(buildPayload({
      action: 'completed',
      check_run: {
        status: 'completed', conclusion: 'success', check_suite: { head_branch: branch },
        html_url: 'https://github.com/acme/field-notes-ssr/actions/runs/7',
        output: {},
      },
    }));
    assert.equal(parsed.buildStatus, 'succeeded', branch);
    assert.equal(parsed.branch, branch);
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

test('parseCheckRunEvent maps a created+completed check run to its terminal state', () => {
  // Cloudflare Pages delivers its check run as action=created with
  // status=completed in one event. Regression guard: this used to be dropped
  // (buildStatus null) because only queued/in_progress mapped to running.
  const parsed = parseCheckRunEvent(buildPayload({
    check_run: {
      name: 'Cloudflare Pages',
      status: 'completed',
      conclusion: 'success',
      head_sha: '7f54bd6ef4a5',
      check_suite: { head_branch: 'dev' },
      output: { title: 'Deployed successfully', summary: PAGES_HTML_OUTPUT },
    },
  }));
  assert.ok(parsed);
  assert.equal(parsed.buildStatus, 'succeeded');
  assert.equal(parsed.checkName, 'Cloudflare Pages');
  assert.equal(parsed.previewUrl, 'https://09920446.freytag-akademie.pages.dev/');
});

test('parseCheckRunEvent maps a created+completed failure to failed', () => {
  const parsed = parseCheckRunEvent(buildPayload({
    check_run: {
      status: 'completed', conclusion: 'failure', check_suite: { head_branch: 'dev' }, output: {},
    },
  }));
  assert.equal(parsed.buildStatus, 'failed');
});

test('parseCheckRunEvent still ignores created+completed with untrackable conclusions', () => {
  const parsed = parseCheckRunEvent(buildPayload({
    check_run: {
      status: 'completed', conclusion: 'skipped', check_suite: { head_branch: 'dev' }, output: {},
    },
  }));
  assert.equal(parsed.buildStatus, null);
});

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

// ─── Deployment row grouping ─────────────────────────────────────────────────

test('groupRepoDeploymentRows groups every per-branch row under its repo id', () => {
  const devRow = { github_repo_id: 101, branch: 'dev', build_status: 'succeeded', preview_url: 'https://dev.acme-app.workers.dev' };
  const mainRow = { github_repo_id: 101, branch: 'main', build_status: 'succeeded', preview_url: 'https://main.acme-app.workers.dev' };
  const otherRepoRow = { github_repo_id: 202, branch: 'dev', build_status: 'failed', preview_url: null };

  const grouped = groupRepoDeploymentRows([devRow, mainRow, otherRepoRow]);

  assert.equal(grouped.size, 2);
  assert.equal(grouped.get(101).length, 2);
  assert.equal(grouped.get(101)[0].branch, 'dev');
  assert.equal(grouped.get(101)[0].preview_url, 'https://dev.acme-app.workers.dev');
  assert.equal(grouped.get(101)[1].branch, 'main');
  assert.deepEqual(grouped.get(202), [otherRepoRow]);
});

test('groupRepoDeploymentRows never collapses branch rows for one repo (regression)', () => {
  // Regression for GET /apps: the previous flat Map<number, Row> keyed only
  // by github_repo_id kept just the LAST row per repo, silently dropping the
  // other branch's build feedback (and its preview URL). Every row must
  // survive the grouping so every tracked branch gets a build tile.
  const devRow = { github_repo_id: 7, branch: 'dev', build_status: 'succeeded', preview_url: 'https://dev-preview.example.com' };
  const prodRow = { github_repo_id: 7, branch: 'main', build_status: 'succeeded', preview_url: 'https://prod-preview.example.com' };

  const grouped = groupRepoDeploymentRows([devRow, prodRow]);

  assert.equal(grouped.size, 1);
  const list = grouped.get(7);
  assert.equal(list.length, 2);
  assert.ok(list.some((row) => row.branch === 'dev' && row.preview_url === 'https://dev-preview.example.com'));
  assert.ok(list.some((row) => row.branch === 'main' && row.preview_url === 'https://prod-preview.example.com'));
});

test('groupRepoDeploymentRows handles empty input', () => {
  const grouped = groupRepoDeploymentRows([]);
  assert.equal(grouped.size, 0);
  assert.ok(grouped instanceof Map);
});

