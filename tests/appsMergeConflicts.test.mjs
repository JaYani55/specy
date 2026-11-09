import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeConflictId,
  planMerge,
  resolveMerge,
} from '../plugins/pluradash/api/sync/merge.ts';
import {
  buildBranchPrefix,
  buildHeadPrefix,
  buildManifestKey,
  buildWorkspaceObjectKey,
  DEFAULT_SESSION_ID,
  normalizeSessionId,
} from '../plugins/pluradash/api/sync/keys.ts';
import { deriveAppDeployState } from '../plugins/pluradash/api/sync/appDeployInfo.ts';

/**
 * Pure 3-way merge planner contract (P1/P2/P5). The planner must auto-resolve
 * every case that does not need a human decision and fail closed ONLY on
 * same-path overlap. Key builders must namespace staging by session (P3).
 */

/** Small helper: build a tree map from `{ path: sha }`. */
function tree(entries) {
  const map = new Map();
  for (const [path, sha] of Object.entries(entries)) {
    map.set(path, { sha, mode: '100644' });
  }
  return map;
}

test('planMerge auto-resolves remote-only and local-only changes', () => {
  const base = tree({ 'a.txt': 'A', 'b.txt': 'B' });
  const ours = tree({ 'a.txt': 'A2', 'b.txt': 'B' }); // local-only change on a
  const theirs = tree({ 'a.txt': 'A', 'b.txt': 'B2' }); // remote-only change on b

  const plan = planMerge(base, ours, theirs);
  assert.deepEqual(plan.write, [{ path: 'a.txt', ourSha: 'A2', mode: '100644' }]);
  assert.deepEqual(plan.delete, []);
  assert.deepEqual(plan.keepTheirs, ['b.txt']);
  assert.deepEqual(plan.conflicts, []);
});

test('planMerge treats identical changes on both sides as no conflict', () => {
  const base = tree({ 'a.txt': 'A' });
  const ours = tree({ 'a.txt': 'SAME' });
  const theirs = tree({ 'a.txt': 'SAME' });
  const plan = planMerge(base, ours, theirs);
  assert.deepEqual(plan.write, []);
  assert.deepEqual(plan.conflicts, []);
});

test('edit-edit on the same path yields one conflict with exact SHAs', () => {
  const base = tree({ 'src/App.tsx': 'BASE' });
  const ours = tree({ 'src/App.tsx': 'OURS' });
  const theirs = tree({ 'src/App.tsx': 'THEIRS' });
  const plan = planMerge(base, ours, theirs);
  assert.equal(plan.conflicts.length, 1);
  const [conflict] = plan.conflicts;
  assert.equal(conflict.kind, 'edit-edit');
  assert.equal(conflict.path, 'src/App.tsx');
  assert.deepEqual(
    { baseSha: conflict.baseSha, ourSha: conflict.ourSha, theirSha: conflict.theirSha },
    { baseSha: 'BASE', ourSha: 'OURS', theirSha: 'THEIRS' },
  );
  assert.equal(conflict.binary, false);
});

test('delete-edit and edit-delete both directions are conflicts', () => {
  const base = tree({ 'x.txt': 'A' });
  const localDelete = tree({});
  const remoteEdit = tree({ 'x.txt': 'B' });
  const localEdit = tree({ 'x.txt': 'B' });
  const remoteDelete = tree({});

  const deleteEdit = planMerge(base, localDelete, remoteEdit);
  assert.equal(deleteEdit.conflicts[0].kind, 'delete-edit');

  const editDelete = planMerge(base, localEdit, remoteDelete);
  assert.equal(editDelete.conflicts[0].kind, 'edit-delete');
});

test('resolveMerge applies ours/theirs/content and reports remaining conflicts', () => {
  const base = tree({ 'a.txt': 'A' });
  const ours = tree({ 'a.txt': 'OURS' });
  const theirs = tree({ 'a.txt': 'THEIRS' });
  const plan = planMerge(base, ours, theirs);

  // No resolution → still conflicting (idempotent).
  assert.equal(resolveMerge(plan, {}).remaining.length, 1);

  // Partial: resolve a different path only, keep the conflict.
  const partial = resolveMerge(plan, { 'other.txt': 'ours' });
  assert.equal(partial.remaining.length, 1);

  // 'ours' writes the local side.
  const chooseOurs = resolveMerge(plan, { 'a.txt': 'ours' });
  assert.deepEqual(chooseOurs.remaining, []);
  assert.deepEqual(chooseOurs.write, [{
    path: 'a.txt',
    source: 'ours',
    ourSha: 'OURS',
    mode: '100644',
  }]);
  assert.deepEqual(chooseOurs.applied, [{ path: 'a.txt', choice: 'ours' }]);

  // 'theirs' is a no-op (remote already in the commit base).
  const chooseTheirs = resolveMerge(plan, { 'a.txt': 'theirs' });
  assert.deepEqual(chooseTheirs.write, []);
  assert.deepEqual(chooseTheirs.delete, []);
  assert.deepEqual(chooseTheirs.applied, [{ path: 'a.txt', choice: 'theirs' }]);

  // Inline content resolves with caller bytes.
  const chooseContent = resolveMerge(plan, { 'a.txt': { content: 'MERGED' } });
  assert.deepEqual(chooseContent.write, [{
    path: 'a.txt',
    source: 'content',
    content: 'MERGED',
    contentBase64: undefined,
    mode: '100644',
  }]);
});

test('resolveMerge: delete-edit resolved theirs resurrects remote; ours deletes', () => {
  const base = tree({ 'x.txt': 'A' });
  const ours = tree({});
  const theirs = tree({ 'x.txt': 'B' });
  const plan = planMerge(base, ours, theirs);
  assert.equal(plan.conflicts[0].kind, 'delete-edit');

  const keepTheirs = resolveMerge(plan, { 'x.txt': 'theirs' });
  assert.deepEqual(keepTheirs.write, []);
  assert.deepEqual(keepTheirs.delete, []);

  const keepOurs = resolveMerge(plan, { 'x.txt': 'ours' });
  assert.deepEqual(keepOurs.delete, ['x.txt']);
});

test('resolveMerge: edit-delete resolved theirs deletes; ours restores', () => {
  const base = tree({ 'x.txt': 'A' });
  const ours = tree({ 'x.txt': 'B' });
  const theirs = tree({});
  const plan = planMerge(base, ours, theirs);
  assert.equal(plan.conflicts[0].kind, 'edit-delete');

  const acceptDeletion = resolveMerge(plan, { 'x.txt': 'theirs' });
  assert.deepEqual(acceptDeletion.delete, ['x.txt']);

  const restoreOurs = resolveMerge(plan, { 'x.txt': 'ours' });
  assert.equal(restoreOurs.write.length, 1);
  assert.deepEqual(restoreOurs.delete, []);
});

test('rename modelled as delete+add is never silently merged as one path', () => {
  // base: a→A. ours: delete a, add b=OURS. theirs: keep a, add b=THEIRS.
  // A rename is two paths: `a` (local delete) and `b` (add-add conflict).
  const base = tree({ 'a': 'A' });
  const ours = tree({ 'b': 'OURS' });
  const theirs = tree({ 'a': 'A', 'b': 'THEIRS' });
  const plan = planMerge(base, ours, theirs);
  assert.deepEqual(plan.delete, ['a']);
  const kinds = plan.conflicts.map((entry) => `${entry.path}:${entry.kind}`).sort();
  assert.deepEqual(kinds, ['b:add-add']);
});

test('both sides deleting the same path is a no-op, not a conflict', () => {
  const base = tree({ 'a': 'A' });
  const plan = planMerge(base, tree({}), tree({}));
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.write, []);
  assert.deepEqual(plan.delete, []);
});

test('conflictId is stable for identical inputs and changes with the head', async () => {
  const a = await computeConflictId('base', 'head1', ['b.txt', 'a.txt']);
  const b = await computeConflictId('base', 'head1', ['a.txt', 'b.txt']);
  const c = await computeConflictId('base', 'head2', ['a.txt', 'b.txt']);
  assert.equal(a, b); // path order does not matter
  assert.notEqual(a, c); // new head → new id
  assert.equal(a.length, 12);
});

test('deploy mergeState reuses the same planner output', () => {
  // Merge dev into production: ours = production, theirs = dev.
  const mergeBase = tree({ 'a.txt': 'A', 'b.txt': 'B' });
  const production = tree({ 'a.txt': 'A2', 'b.txt': 'B' }); // prod edited a
  const dev = tree({ 'a.txt': 'A3', 'b.txt': 'B' }); // dev edited a differently
  const conflicted = planMerge(mergeBase, production, dev);
  assert.equal(conflicted.conflicts.length, 1);
  assert.equal(conflicted.conflicts.length > 0 ? 'conflicted' : 'clean', 'conflicted');

  const cleanProduction = tree({ 'a.txt': 'A', 'b.txt': 'B' });
  const clean = planMerge(mergeBase, cleanProduction, dev);
  assert.equal(clean.conflicts.length, 0);
  assert.equal(clean.conflicts.length > 0 ? 'conflicted' : 'clean', 'clean');
});

test('deriveAppDeployState reports merge-conflict and blocks deploy', () => {
  const state = deriveAppDeployState({
    changesToDeploy: true,
    devBuildStatus: 'succeeded',
    builtCommitSha: 'def456',
    devHeadSha: 'def456',
    mergeState: 'conflicted',
  });
  assert.equal(state, 'merge-conflict');
});

test('session id validation rejects traversal/separators and defaults', () => {
  assert.equal(normalizeSessionId(undefined), DEFAULT_SESSION_ID);
  assert.equal(normalizeSessionId(''), DEFAULT_SESSION_ID);
  assert.equal(normalizeSessionId('sess_123'), 'sess_123');
  assert.throws(() => normalizeSessionId('..'));
  assert.throws(() => normalizeSessionId('a/b'));
  assert.throws(() => normalizeSessionId('a..b'));
  assert.throws(() => normalizeSessionId('x'.repeat(65)));
});

test('key builders namespace staging by session and default to legacy shape', () => {
  const manifestKey = buildManifestKey('ws', 'u', 'acme/site', 'dev');
  assert.equal(
    manifestKey,
    'tenant/ws/user/u/files/apps/acme__site/sessions/default/dev/manifest.json',
  );

  const sessionKey = buildManifestKey('ws', 'u', 'acme/site', 'dev', 'sess_9');
  assert.equal(
    sessionKey,
    'tenant/ws/user/u/files/apps/acme__site/sessions/sess_9/dev/manifest.json',
  );

  assert.equal(
    buildHeadPrefix('ws', 'u', 'acme/site', 'dev', 'sess_9'),
    'tenant/ws/user/u/files/apps/acme__site/sessions/sess_9/dev/HEAD',
  );
  assert.equal(
    buildBranchPrefix('ws', 'u', 'acme/site', 'dev', 'sess_9'),
    'tenant/ws/user/u/files/apps/acme__site/sessions/sess_9/dev',
  );
  assert.equal(
    buildWorkspaceObjectKey({
      tenantId: 'ws', userId: 'u', repoFullName: 'acme/site', branch: 'dev', path: 'src/main.ts', sessionId: 'sess_9',
    }),
    'tenant/ws/user/u/files/apps/acme__site/sessions/sess_9/dev/HEAD/src/main.ts',
  );
});

