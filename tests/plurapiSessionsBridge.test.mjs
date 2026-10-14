import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildArbitraryInjectionPayload,
  buildPlurapiPushPayload,
  composeBuildSummary,
  composeFailureDetail,
  MAX_DETAIL_CHARS,
  parseCloudflareLogLines,
  selectBuildTarget,
  truncateLogLines,
} from '../plugins/pluradash/api/sync/plurapiSessionsLogic.ts';

const NOW = Date.parse('2026-10-13T12:00:00.000Z');
const REPO_ID = 123456789;

function targetRow(overrides = {}) {
  return {
    github_repo_id: REPO_ID,
    branch: 'dev',
    head_sha: 'aaaaaaaaaaaaaaaaaaaa',
    workspace_id: '11111111-1111-1111-1111-111111111111',
    user_id: '22222222-2222-2222-2222-222222222222',
    session_id: null,
    created_at: '2026-10-13T11:00:00.000Z',
    ...overrides,
  };
}

function parsedCheckRun(overrides = {}) {
  return {
    action: 'completed',
    checkName: 'Workers Builds: app',
    checkStatus: 'completed',
    conclusion: 'success',
    headSha: 'aaaaaaaaaaaaaaaaaaaa',
    branch: 'dev',
    repoId: REPO_ID,
    repoFullName: 'acme/website',
    startedAt: null,
    completedAt: null,
    buildStatus: 'succeeded',
    buildId: 'b1c2d3e4-f5a6-4789-a012-3456789abcde',
    versionId: null,
    previewUrl: 'https://abc.pages.dev',
    previewAliasUrl: null,
    buildUrl: null,
    outputTitle: null,
    ...overrides,
  };
}

// ─── selectBuildTarget ───────────────────────────────────────────────────────

test('selectBuildTarget resolves the exact commit SHA', () => {
  const rows = [targetRow()];
  const target = selectBuildTarget(rows, parsedCheckRun(), NOW);
  assert.ok(target);
  assert.equal(target.tenantId, '11111111-1111-1111-1111-111111111111');
  assert.equal(target.userId, '22222222-2222-2222-2222-222222222222');
  assert.equal(target.exactShaMatch, true);
});

test('selectBuildTarget carries the pinned session id', () => {
  const rows = [targetRow({ session_id: 'sess_abc' })];
  const target = selectBuildTarget(rows, parsedCheckRun(), NOW);
  assert.equal(target?.sessionId, 'sess_abc');
});

test('selectBuildTarget falls back to the most recent same-branch push inside the window', () => {
  const rows = [
    targetRow({
      head_sha: 'old',
      created_at: '2026-10-13T06:00:00.000Z',
      session_id: 'sess_old',
    }),
    targetRow({
      head_sha: 'newer',
      created_at: '2026-10-13T10:00:00.000Z',
      session_id: 'sess_newer',
    }),
  ];
  const target = selectBuildTarget(rows, parsedCheckRun({ headSha: 'unknown-sha' }), NOW);
  assert.ok(target);
  assert.equal(target.exactShaMatch, false);
  assert.equal(target.sessionId, 'sess_newer');
});

test('selectBuildTarget ignores fallback rows outside the 24h window', () => {
  const rows = [targetRow({ head_sha: 'old', created_at: '2026-10-11T10:00:00.000Z' })];
  const target = selectBuildTarget(rows, parsedCheckRun({ headSha: 'unknown-sha' }), NOW);
  assert.equal(target, null);
});

test('selectBuildTarget requires the same branch for the fallback', () => {
  const rows = [targetRow({ branch: 'main' })];
  const target = selectBuildTarget(rows, parsedCheckRun({ headSha: 'unknown-sha', branch: 'dev' }), NOW);
  assert.equal(target, null);
});

test('selectBuildTarget returns null without a repository id', () => {
  assert.equal(selectBuildTarget([targetRow()], parsedCheckRun({ repoId: null }), NOW), null);
});

// ─── truncateLogLines ────────────────────────────────────────────────────────

test('truncateLogLines keeps the tail within the line budget', () => {
  const lines = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`);
  const kept = truncateLogLines(lines, 120, 1_000_000);
  assert.equal(kept.length, 120);
  assert.equal(kept[0], 'line 181');
  assert.equal(kept.at(-1), 'line 300');
});

test('truncateLogLines caps the total character budget with a notice', () => {
  const lines = Array.from({ length: 400 }, () => 'x'.repeat(100));
  const kept = truncateLogLines(lines, 500, 1_000);
  assert.ok(kept.length < 400);
  assert.match(kept[0], /^\.\.\.\[\d+ earlier log lines truncated\]$/);
});

test('truncateLogLines keeps a single oversized line instead of an empty list', () => {
  const huge = 'y'.repeat(MAX_DETAIL_CHARS + 5_000);
  const kept = truncateLogLines([huge], 120, MAX_DETAIL_CHARS);
  assert.equal(kept.length, 1);
  assert.equal(kept[0], huge);
});

// ─── composeFailureDetail / composeBuildSummary ─────────────────────────────

test('composeFailureDetail includes context header and log excerpt', () => {
  const parsed = parsedCheckRun({ buildStatus: 'failed', conclusion: 'failure', previewUrl: null });
  const detail = composeFailureDetail(parsed, ['npm ERR! code TS2345', 'Build failed']);
  assert.match(detail, /Cloudflare Workers Builds — preview build FAILED\./);
  assert.match(detail, /Branch: dev \| Commit: aaaaaaaaaaaa \| Build ID: b1c2d3e4/);
  assert.match(detail, /Build log excerpt \(last 2 lines\)/);
  assert.match(detail, /npm ERR! code TS2345/);
  assert.doesNotMatch(detail, /earlier log lines truncated/);
});

test('composeFailureDetail notes a missing log retrieval', () => {
  const detail = composeFailureDetail(parsedCheckRun({ buildStatus: 'failed', conclusion: 'failure' }), []);
  assert.match(detail, /No build log could be retrieved/);
});

test('composeBuildSummary mentions outcome, branch, commit and preview on success', () => {
  const summary = composeBuildSummary(parsedCheckRun());
  assert.match(summary, /Preview build succeeded/);
  assert.match(summary, /branch "dev"/);
  assert.match(summary, /commit aaaaaaaaaaaa/);
  assert.match(summary, /https:\/\/abc\.pages\.dev/);
});

test('composeBuildSummary omits the preview on failure', () => {
  const summary = composeBuildSummary(parsedCheckRun({ buildStatus: 'failed', conclusion: 'failure' }));
  assert.match(summary, /Preview build failed/);
  assert.doesNotMatch(summary, /pages\.dev/);
});

// ─── buildPlurapiPushPayload ────────────────────────────────────────────────

test('buildPlurapiPushPayload shapes a success push without detail', () => {
  const target = selectBuildTarget([targetRow({ session_id: 'sess_1' })], parsedCheckRun(), NOW);
  const payload = buildPlurapiPushPayload(target, parsedCheckRun(), undefined);
  assert.deepEqual(payload, {
    tenantId: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    projectId: '11111111-1111-1111-1111-111111111111',
    sessionId: 'sess_1',
    branch: 'dev',
    state: 'succeeded',
    commitSha: 'aaaaaaaaaaaaaaaaaaaa',
    commitUrl: 'https://github.com/acme/website/commit/aaaaaaaaaaaaaaaaaaaa',
    previewUrl: 'https://abc.pages.dev',
    summary: payload.summary,
  });
  assert.equal(payload.summary, composeBuildSummary(parsedCheckRun()));
});

test('buildPlurapiPushPayload carries the failure detail verbatim', () => {
  const target = selectBuildTarget([targetRow()], parsedCheckRun({ buildStatus: 'failed', conclusion: 'failure', previewUrl: null }), NOW);
  const payload = buildPlurapiPushPayload(target, parsedCheckRun({ buildStatus: 'failed', conclusion: 'failure' }), 'ERROR DETAILS');
  assert.equal(payload.state, 'failed');
  assert.equal(payload.detail, 'ERROR DETAILS');
  assert.equal(payload.previewUrl, undefined);
  assert.equal(payload.sessionId, undefined);
});

// ─── parseCloudflareLogLines ────────────────────────────────────────────────

test('parseCloudflareLogLines extracts object and string entries', () => {
  const lines = parseCloudflareLogLines({
    result: [
      { message: 'npm install', source: 'build-cacher' },
      'plain string entry',
      { line: 'x'.repeat(1) },
      { nothing: 1 },
    ],
  });
  assert.deepEqual(lines, [
    '[build-cacher] npm install',
    'plain string entry',
    'x'.repeat(1),
  ]);
});

test('parseCloudflareLogLines tolerates malformed payloads', () => {
  assert.deepEqual(parseCloudflareLogLines(null), []);
  assert.deepEqual(parseCloudflareLogLines('nope'), []);
  assert.deepEqual(parseCloudflareLogLines({ result: 'not-an-array' }), []);
});

// ─── Duplicate-delivery guard & exact-row lookup ────────────────────────────

import {
  findExactTargetRow,
  isDuplicateDelivery,
} from '../plugins/pluradash/api/sync/plurapiSessionsLogic.ts';
import { extractBuildIdFromUrl } from '../plugins/pluradash/api/sync/webhookLogic.ts';

test('findExactTargetRow matches repo + sha case-insensitively', () => {
  const rows = [targetRow({ head_sha: 'AAAAAAAA' }), targetRow({ head_sha: 'bbbb' })];
  const row = findExactTargetRow(rows, parsedCheckRun({ headSha: 'aaaaaaaa' }));
  assert.ok(row);
  assert.equal(row.head_sha, 'AAAAAAAA');
  assert.equal(findExactTargetRow(rows, parsedCheckRun({ headSha: 'zzzz' })), null);
  assert.equal(findExactTargetRow(rows, parsedCheckRun({ headSha: null })), null);
  assert.equal(findExactTargetRow(rows, parsedCheckRun({ repoId: null })), null);
});

test('isDuplicateDelivery only fires for the already-reported state', () => {
  const failed = parsedCheckRun({ buildStatus: 'failed', conclusion: 'failure' });
  assert.equal(isDuplicateDelivery(targetRow({ feedback_state: 'failed' }), failed), true);
  assert.equal(isDuplicateDelivery(targetRow({ feedback_state: 'succeeded' }), failed), false);
  assert.equal(isDuplicateDelivery(targetRow({ feedback_state: null }), failed), false);
  assert.equal(isDuplicateDelivery(null, failed), false);
});

// ─── extractBuildIdFromUrl ───────────────────────────────────────────────────

test('extractBuildIdFromUrl pulls the build id out of a details URL', () => {
  assert.equal(
    extractBuildIdFromUrl('https://dash.cloudflare.com/abc123/workers/builds/b1c2d3e4-f5a6-4789-a012-3456789abcde'),
    'b1c2d3e4-f5a6-4789-a012-3456789abcde',
  );
  assert.equal(extractBuildIdFromUrl('https://github.com/acme/website/actions/runs/123456'), null);
  assert.equal(extractBuildIdFromUrl(null), null);
});

// ─── Session tenant preference (JWT tenant over workspace) ──────────────────

test('selectBuildTarget prefers the JWT session tenant over the workspace', () => {
  const rows = [targetRow({
    session_tenant_id: 'personal',
    session_id: 'sess_personal',
  })];
  const target = selectBuildTarget(rows, parsedCheckRun(), NOW);
  assert.ok(target);
  assert.equal(target.tenantId, 'personal');
  assert.equal(target.sessionId, 'sess_personal');
});

test('selectBuildTarget falls back to the workspace when no JWT tenant was recorded', () => {
  const rows = [targetRow()];
  const target = selectBuildTarget(rows, parsedCheckRun(), NOW);
  assert.equal(target?.tenantId, '11111111-1111-1111-1111-111111111111');
});

// ─── buildArbitraryInjectionPayload ──────────────────────────────────────────

test('buildArbitraryInjectionPayload rides the build_feedback channel as a failed push', () => {
  const payload = buildArbitraryInjectionPayload({
    tenantId: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    sessionId: 'sess_abc',
    prompt: '  Bitte prüfe die Build-Fehler im Workspace.  ',
  });
  assert.equal(payload.tenantId, '11111111-1111-1111-1111-111111111111');
  assert.equal(payload.userId, '22222222-2222-2222-2222-222222222222');
  assert.equal(payload.projectId, payload.tenantId);
  assert.equal(payload.sessionId, 'sess_abc');
  assert.equal(payload.state, 'failed');
  assert.equal(payload.branch, 'manual');
  // The prompt is passed verbatim as the detail (DO §4.4).
  assert.equal(payload.detail, 'Bitte prüfe die Build-Fehler im Workspace.');
  // Summary is the trimmed first line (UI-safe).
  assert.equal(payload.summary, 'Bitte prüfe die Build-Fehler im Workspace.');
});

test('buildArbitraryInjectionPayload summarizes only the first line and omits sessionId when absent', () => {
  const prompt = 'Erste Zeile\nZweite Zeile mit Details\nDritte Zeile';
  const payload = buildArbitraryInjectionPayload({
    tenantId: 't',
    userId: 'u',
    prompt,
  });
  assert.equal(payload.sessionId, undefined);
  assert.equal(payload.detail, prompt);
  assert.equal(payload.summary, 'Erste Zeile');
});

test('buildArbitraryInjectionPayload truncates long first lines in the summary only', () => {
  const longLine = 'x'.repeat(300);
  const payload = buildArbitraryInjectionPayload({
    tenantId: 't',
    userId: 'u',
    prompt: `${longLine}\nrest`,
  });
  assert.equal(payload.detail.length, 305); // prompt verbatim (300 + \n + 'rest')
  assert.equal(payload.summary, `${'x'.repeat(120)}…`);
});

test('buildArbitraryInjectionPayload falls back to a default summary for whitespace-only prompts', () => {
  const payload = buildArbitraryInjectionPayload({ tenantId: 't', userId: 'u', prompt: '   \n  ' });
  assert.equal(payload.summary, 'Manuelle Injektion');
  assert.equal(payload.detail, '');
});
