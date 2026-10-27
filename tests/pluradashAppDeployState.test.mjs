import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canDeployState,
  deriveAppDeployState,
  parseBranchCompare,
} from '../plugins/pluradash/api/sync/appDeployInfo.ts';

/**
 * App deploy-state contract: the "Deployen" button is enabled only when dev
 * contains commits the dynamically resolved production branch lacks AND the
 * latest dev build (check_run webhook loop) is green on the current dev head.
 * When dev is fully merged into the production branch there is nothing to
 * ship — the button must stay disabled regardless of build feedback.
 */

const CHANGES_GREEN = {
  changesToDeploy: true,
  devBuildStatus: 'succeeded',
  builtCommitSha: 'def456',
  devHeadSha: 'def456',
};

test('changes-available when dev is ahead and the dev build is green on the dev head', () => {
  assert.equal(deriveAppDeployState(CHANGES_GREEN), 'changes-available');
  assert.equal(canDeployState('changes-available'), true);
});

test('up-to-date wins over any build state when dev is fully merged (ahead_by 0)', () => {
  // After a deploy the branch SHAs still differ (merge commit only on the
  // production branch) — the compare result decides, not SHA equality.
  for (const devBuildStatus of ['succeeded', 'failed', 'running', null, undefined]) {
    assert.equal(
      deriveAppDeployState({ ...CHANGES_GREEN, changesToDeploy: false, devBuildStatus }),
      'up-to-date',
    );
  }
});

test('build feedback blocks deployable changes: running, failed, missing', () => {
  assert.equal(deriveAppDeployState({ ...CHANGES_GREEN, devBuildStatus: 'running' }), 'build-running');
  assert.equal(deriveAppDeployState({ ...CHANGES_GREEN, devBuildStatus: 'failed' }), 'build-failed');
  assert.equal(deriveAppDeployState({ ...CHANGES_GREEN, devBuildStatus: null }), 'no-build');
  assert.equal(deriveAppDeployState({ ...CHANGES_GREEN, devBuildStatus: 'unknown-conclusion' }), 'no-build');
  for (const state of ['build-running', 'build-failed', 'no-build']) {
    assert.equal(canDeployState(state), false);
  }
});

test('stale-build when the green build ran on an older dev head', () => {
  const state = deriveAppDeployState({
    ...CHANGES_GREEN,
    builtCommitSha: 'aaa111',
    devHeadSha: 'def456',
  });
  assert.equal(state, 'stale-build');
  assert.equal(canDeployState(state), false);
});

test('legacy build rows without commit sha are not stale', () => {
  const state = deriveAppDeployState({ ...CHANGES_GREEN, builtCommitSha: null });
  assert.equal(state, 'changes-available');
});

test('missing dev branch means no build and no changes to deploy', () => {
  const state = deriveAppDeployState({
    changesToDeploy: false,
    devBuildStatus: null,
    builtCommitSha: null,
    devHeadSha: null,
    devBranchExists: false,
  });
  assert.equal(state, 'no-build');
  assert.equal(canDeployState(state), false);
});

test('unknown (failed GitHub comparison) is fail-closed', () => {
  const state = deriveAppDeployState({ ...CHANGES_GREEN, changesToDeploy: null });
  assert.equal(state, 'unknown');
  assert.equal(canDeployState(state), false);
});

test('parseBranchCompare: only ahead_by counts as changes to deploy', () => {
  assert.deepEqual(parseBranchCompare({ ahead_by: 2, behind_by: 0, status: 'ahead' }), {
    aheadBy: 2,
    behindBy: 0,
    changesToDeploy: true,
  });
  // Post-deploy state: heads differ, but dev is fully contained in production.
  assert.deepEqual(parseBranchCompare({ ahead_by: 0, behind_by: 1, status: 'behind' }), {
    aheadBy: 0,
    behindBy: 1,
    changesToDeploy: false,
  });
  assert.deepEqual(parseBranchCompare({ ahead_by: 0, behind_by: 0, status: 'identical' }), {
    aheadBy: 0,
    behindBy: 0,
    changesToDeploy: false,
  });
  assert.deepEqual(parseBranchCompare({ ahead_by: 3, behind_by: 2, status: 'diverged' }), {
    aheadBy: 3,
    behindBy: 2,
    changesToDeploy: true,
  });
  // Missing/invalid fields degrade to 0 (no changes), never throw.
  assert.deepEqual(parseBranchCompare({}), { aheadBy: 0, behindBy: 0, changesToDeploy: false });
  assert.deepEqual(parseBranchCompare({ ahead_by: Number.NaN }), { aheadBy: 0, behindBy: 0, changesToDeploy: false });
});
