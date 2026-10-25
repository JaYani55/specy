import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateDeployGate,
} from '../plugins/pluradash/api/sync/deployGate.ts';

/**
 * Deploy-gate contract: a production deploy (merge dev → Standard-Branch)
 * is only allowed when the latest dev-branch build (check_run webhook
 * feedback in pluradash.repo_deployments) succeeded AND was built on the
 * commit the dev branch currently points at.
 */

const SUCCESS = {
  buildStatus: 'succeeded',
  builtCommitSha: 'aaa111',
  devHeadSha: 'aaa111',
};

test('gate opens on a green dev build of the current dev head', () => {
  const decision = evaluateDeployGate(SUCCESS);
  assert.equal(decision.allowed, true);
  if (decision.allowed) assert.equal(decision.builtCommitSha, 'aaa111');
});

test('gate denies when no dev build exists yet', () => {
  for (const input of [
    { buildStatus: null, builtCommitSha: null, devHeadSha: 'aaa111' },
    { buildStatus: undefined, builtCommitSha: null, devHeadSha: 'aaa111' },
    { buildStatus: '', builtCommitSha: null, devHeadSha: 'aaa111' },
  ]) {
    const decision = evaluateDeployGate(input);
    assert.equal(decision.allowed, false);
    if (!decision.allowed) {
      assert.equal(decision.reason, 'no-build');
      assert.match(decision.message, /kein/);
    }
  }
});

test('gate denies while the latest dev build is running', () => {
  const decision = evaluateDeployGate({ ...SUCCESS, buildStatus: 'running' });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.reason, 'running');
});

test('gate denies when the latest dev build failed', () => {
  const decision = evaluateDeployGate({ ...SUCCESS, buildStatus: 'failed' });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.reason, 'failed');
});

test('gate denies untrackable build statuses', () => {
  const decision = evaluateDeployGate({ ...SUCCESS, buildStatus: 'skipped' });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.reason, 'no-build');
});

test('gate denies a stale build: dev advanced after the green build', () => {
  const decision = evaluateDeployGate({ ...SUCCESS, devHeadSha: 'bbb222' });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.reason, 'stale-build');
    assert.match(decision.message, /ge\u00e4ndert/);
  }
});

test('gate allows legacy succeeded rows without a stored commit SHA', () => {
  // Rows written before per-branch tracking (pre 2026-10-12) carry no
  // commit_sha and cannot be cross-checked — they pass instead of blocking.
  const decision = evaluateDeployGate({ buildStatus: 'succeeded', builtCommitSha: null, devHeadSha: 'aaa111' });
  assert.equal(decision.allowed, true);
});

test('gate allows a green build even if the dev head is unknown', () => {
  const decision = evaluateDeployGate({ ...SUCCESS, devHeadSha: null });
  assert.equal(decision.allowed, true);
});
