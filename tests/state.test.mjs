import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterMigrationSqlChanges,
  formatGitStatusLine,
  parseAheadBehind,
  parseUncommittedPaths,
  wranglerHasPlaceholders,
} from '../scripts/lib/state.mjs';
import { partitionDriftByOwner } from '../scripts/state-recheck.mjs';

test('wranglerHasPlaceholders detects template placeholders', () => {
  assert.equal(wranglerHasPlaceholders('"account_id": "REPLACE_WITH_YOUR_CF_ACCOUNT_ID"'), true);
  assert.equal(wranglerHasPlaceholders('"name": "specy-dev"'), false);
  assert.equal(wranglerHasPlaceholders(null), false);
  assert.equal(wranglerHasPlaceholders(undefined), false);
  assert.equal(wranglerHasPlaceholders(''), false);
  // A configured file may mention the token name in a comment without the
  // placeholder marker; only the literal marker counts.
  assert.equal(wranglerHasPlaceholders('// REPLACE_WITH is gone'), true);
});

// ─── Git branch / sync status parsing (state footer + migration guards) ─────

test('parseAheadBehind reads rev-list left/right count output', () => {
  assert.deepEqual(parseAheadBehind('2\t5'), { ahead: 2, behind: 5 });
  assert.deepEqual(parseAheadBehind('0\t0'), { ahead: 0, behind: 0 });
  assert.deepEqual(parseAheadBehind(''), { ahead: 0, behind: 0 });
  assert.deepEqual(parseAheadBehind(null), { ahead: 0, behind: 0 });
  // garbage → zero, never NaN
  assert.deepEqual(parseAheadBehind('garbage'), { ahead: 0, behind: 0 });
});

test('parseUncommittedPaths parses porcelain status lines', () => {
  const entries = parseUncommittedPaths(' M scripts/setup.mjs\n?? migrations/001_new.sql\nM  migrations/002_x.sql\n\n');
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0], { status: 'M', path: 'scripts/setup.mjs' });
  assert.deepEqual(entries[1], { status: '??', path: 'migrations/001_new.sql' });
  assert.deepEqual(entries[2], { status: 'M', path: 'migrations/002_x.sql' });
});

test('filterMigrationSqlChanges keeps only migrations/*.sql', () => {
  const kept = filterMigrationSqlChanges([
    { status: '??', path: 'migrations/001_new.sql' },
    { status: 'M', path: 'scripts/setup.mjs' },
    { status: '??', path: 'migrations/sub/002.sql' },
    { status: '??', path: 'migrations/not-migration.txt' },
    { status: 'M', path: 'migrations\\win_path.sql' },
  ]);
  assert.equal(kept.length, 3);
  assert.ok(kept.some((e) => e.path === 'migrations/001_new.sql'));
  assert.ok(kept.some((e) => e.path === 'migrations/sub/002.sql'));
  assert.ok(kept.some((e) => e.path === 'migrations\\win_path.sql'));
});

test('formatGitStatusLine renders the four git states', () => {
  assert.equal(
    formatGitStatusLine({ head: 'afbea61', branch: 'dev', upstream: 'origin/dev', ahead: 0, behind: 0 }),
    'dev @ afbea61 · up to date with origin/dev',
  );
  assert.equal(
    formatGitStatusLine({ head: 'afbea61', branch: 'dev', upstream: 'origin/dev', ahead: 1, behind: 3 }),
    'dev @ afbea61 · ↑1 ahead ↓3 behind vs origin/dev',
  );
  assert.equal(
    formatGitStatusLine({ head: 'afbea61', branch: 'dev', upstream: null, ahead: null, behind: null }),
    'dev @ afbea61 · no upstream branch',
  );
  assert.equal(formatGitStatusLine({ head: null, branch: null, upstream: null, ahead: null, behind: null }), '— (not a git checkout)');
  // detached HEAD still renders
  assert.equal(
    formatGitStatusLine({ head: 'afbea61', branch: null, upstream: null, ahead: null, behind: null }),
    '(detached) @ afbea61 · no upstream branch',
  );
});

test('partitionDriftByOwner: core drift requires confirmation, plugin drift is auto re-recordable', () => {
  const drifted = [
    { local: { owner: 'core', component: 'migrations', key: 'a.sql' }, recorded: { value: {} } },
    { local: { owner: 'plugin:acme', component: 'migrations', key: 'b.sql' }, recorded: { value: {} } },
    { local: { owner: 'core', component: 'worker', key: 'deployment:worker' }, recorded: { value: {} } },
    { local: { owner: 'plugin:be', component: 'bindings', key: 'x' }, recorded: { value: {} } },
  ];
  const { coreDrift, pluginDrift } = partitionDriftByOwner(drifted);
  assert.equal(coreDrift.length, 2);
  assert.deepEqual(coreDrift.map((d) => d.local.key), ['a.sql', 'deployment:worker']);
  assert.equal(pluginDrift.length, 2);
  assert.ok(pluginDrift.every((d) => d.local.owner.startsWith('plugin:')));
  // Edge cases: empty/null input, owner-less entries fall into plugin bucket
  assert.deepEqual(partitionDriftByOwner([]), { coreDrift: [], pluginDrift: [] });
  assert.deepEqual(partitionDriftByOwner(null), { coreDrift: [], pluginDrift: [] });
  assert.equal(partitionDriftByOwner([{ local: {} }]).pluginDrift.length, 1);
});
