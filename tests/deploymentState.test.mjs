import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCoreUpsertSql,
  buildPluginDeleteByIdSql,
  buildPluginDeleteSql,
  buildPluginUpsertSql,
  coreKeyToComponent,
  coreRecordToStateRow,
  driftFields,
  isDrifted,
  normalizeOwner,
  stateRowToLegacyKey,
  stateValueToLegacyValue,
  normalizeStateValue,
  reconcileRecords,
  summarizeDeploymentRows,
  toStateRow,
} from '../scripts/lib/deployment-state.mjs';

// ─── normalizeOwner ──────────────────────────────────────────────────────────

test('normalizeOwner: core', () => {
  assert.deepEqual(normalizeOwner('core'), { ownerKind: 'core', pluginSlug: null });
});

test('normalizeOwner: plugin slug', () => {
  assert.deepEqual(normalizeOwner('plugin:pluradash'), { ownerKind: 'plugin', pluginSlug: 'pluradash' });
});

test('normalizeOwner: rejects unknown and empty-slug owners', () => {
  assert.throws(() => normalizeOwner('plugin'), /expected 'core' or 'plugin:<slug>'/);
  assert.throws(() => normalizeOwner('plugin:'), /slug is required/);
  assert.throws(() => normalizeOwner('nope'), /Invalid owner/);
});

// ─── coreKeyToComponent ──────────────────────────────────────────────────────

test('coreKeyToComponent maps the legacy taxonomy', () => {
  assert.deepEqual(coreKeyToComponent('migration:objects.sql'), { component: 'migrations', key: 'objects.sql' });
  assert.deepEqual(coreKeyToComponent('function:send_email'), { component: 'edge_functions', key: 'send_email' });
  assert.deepEqual(coreKeyToComponent('deployment:worker'), { component: 'worker', key: 'worker' });
  assert.deepEqual(coreKeyToComponent('deployment:core_commit'), { component: 'worker', key: 'core_commit' });
  assert.deepEqual(coreKeyToComponent('deployment:functions'), { component: 'edge_functions', key: 'deployed' });
  assert.deepEqual(coreKeyToComponent('anything-else'), { component: 'config', key: 'anything-else' });
});

// ─── normalizeStateValue ─────────────────────────────────────────────────────

test('normalizeStateValue maps legacy fields onto the §3.2 shape and keeps meta', () => {
  const value = normalizeStateValue({
    checksum: 'abc', commit: 'def', updatedAt: '2026-01-01T00:00:00Z', name: 'objects.sql',
  });
  assert.equal(value.status, null);
  assert.equal(value.checksum, 'abc');
  assert.equal(value.commit, 'def');
  assert.equal(value.deployed_at, '2026-01-01T00:00:00Z');
  assert.equal(value.meta.name, 'objects.sql');
});

test('normalizeStateValue handles non-object input', () => {
  assert.deepEqual(normalizeStateValue(null), {
    status: null, version: null, commit: null, checksum: null,
    provider: null, deployed_at: null, meta: {},
  });
});

// ─── coreRecordToStateRow ────────────────────────────────────────────────────

test('coreRecordToStateRow maps a worker deployment record', () => {
  const row = coreRecordToStateRow({
    key: 'deployment:worker',
    value: { commit: 'abc123', workerName: 'specy', deployedAt: '2026-01-01T00:00:00Z' },
  });
  assert.equal(row.owner, 'core');
  assert.equal(row.component, 'worker');
  assert.equal(row.key, 'worker');
  assert.equal(row.value.status, 'deployed');
  assert.equal(row.value.commit, 'abc123');
  assert.equal(row.value.meta.workerName, 'specy');
});

test('coreRecordToStateRow maps a migration record (applied status)', () => {
  const row = coreRecordToStateRow({ key: 'migration:objects.sql', value: { checksum: 'sha', commit: 'def' } });
  assert.deepEqual([row.component, row.key, row.value.status], ['migrations', 'objects.sql', 'applied']);
});

// ─── toStateRow ──────────────────────────────────────────────────────────────

test('toStateRow derives ownership from a plugin:<slug> owner', () => {
  const row = toStateRow({ owner: 'plugin:pluradash', component: 'code', key: 'code', value: { status: 'installed', version: '1.0.0' } });
  assert.equal(row.ownerKind, 'plugin');
  assert.equal(row.pluginSlug, 'pluradash');
  assert.equal(row.value.version, '1.0.0');
});

test('toStateRow rejects an empty plugin slug', () => {
  assert.throws(
    () => toStateRow({ owner: 'plugin:', component: 'code', key: 'code', value: {} }),
    /slug is required/,
  );
});

// ─── SQL builders ────────────────────────────────────────────────────────────

test('buildCoreUpsertSql emits a partial-unique conflict target and jsonb cast', () => {
  const sql = buildCoreUpsertSql([
    toStateRow({ owner: 'core', component: 'worker', key: 'worker', value: { status: 'deployed', commit: 'abc' } }),
  ]);
  assert.match(sql, /owner_kind, plugin_id, component, key, value/);
  assert.match(sql, /on conflict \(component, key\) where plugin_id is null/i);
  assert.match(sql, /::jsonb/);
  assert.match(sql, /"status":"deployed"/);
  assert.doesNotMatch(sql, /plugin_id is not null/i);
});

test('buildCoreUpsertSql returns null when no core rows', () => {
  assert.equal(buildCoreUpsertSql([]), null);
});

test('buildPluginUpsertSql resolves the slug to the registry uuid via subquery', () => {
  const sql = buildPluginUpsertSql([
    toStateRow({ owner: 'plugin:pluradash', component: 'bindings', key: 'sms-notifications', value: { status: 'provisioned' } }),
  ]);
  assert.match(sql, /\(select id from public\.plugins where slug = 'pluradash'\)/);
  assert.match(sql, /on conflict \(plugin_id, component, key\) where plugin_id is not null/i);
});

test('buildPluginUpsertSql returns null when no plugin rows', () => {
  assert.equal(buildPluginUpsertSql([]), null);
});

test('buildPluginDeleteSql deletes by slug subquery', () => {
  const sql = buildPluginDeleteSql('pluradash');
  assert.match(sql, /delete from public\.deployment_state/);
  assert.match(sql, /slug = 'pluradash'/);
});

test('buildPluginDeleteByIdSql deletes by registry uuid', () => {
  const id = '00000000-0000-0000-0000-000000000001';
  const sql = buildPluginDeleteByIdSql(id);
  assert.match(sql, /delete from public\.deployment_state/);
  assert.match(sql, new RegExp(`plugin_id = '${id}'`));
});

// ─── reconcileRecords ────────────────────────────────────────────────────────

const LOCAL = [
  { owner: 'core', component: 'migrations', key: 'a.sql', checksum: 'aaa' },
  { owner: 'core', component: 'migrations', key: 'b.sql', checksum: 'bbb' },
  { owner: 'core', component: 'worker', key: 'worker', commit: 'HEAD' },
  { owner: 'plugin:pluradash', component: 'code', key: 'code', version: '2.0.0' },
];

const RECORDED = [
  { owner: 'core', component: 'migrations', key: 'a.sql', value: { checksum: 'aaa' } },
  { owner: 'core', component: 'migrations', key: 'b.sql', value: { checksum: 'OLD' } },
  { owner: 'core', component: 'migrations', key: 'gone.sql', value: { checksum: 'zzz' } },
  { owner: 'plugin:pluradash', component: 'code', key: 'code', value: { version: '1.0.0' } },
];

test('reconcileRecords classifies converged/drifted/unrecorded/stale', () => {
  const { unrecorded, drifted, stale, converged } = reconcileRecords(LOCAL, RECORDED);

  assert.equal(converged.length, 1);
  assert.equal(converged[0].local.key, 'a.sql');

  assert.equal(drifted.length, 2); // b.sql checksum + plugin code version
  assert.ok(drifted.some((d) => d.local.key === 'b.sql'));
  assert.ok(drifted.some((d) => d.local.owner === 'plugin:pluradash'));

  assert.equal(unrecorded.length, 1);
  assert.equal(unrecorded[0].key, 'worker');

  assert.equal(stale.length, 1);
  assert.equal(stale[0].key, 'gone.sql');
});

test('reconcileRecords ignores drift when neither side carries a comparable field', () => {
  const { unrecorded, drifted, converged, stale } = reconcileRecords(
    [{ owner: 'core', component: 'auth_hook', key: 'custom_access_token_hook' }],
    [{ owner: 'core', component: 'auth_hook', key: 'custom_access_token_hook', value: { status: 'applied' } }],
  );
  assert.equal(unrecorded.length, 0);
  assert.equal(drifted.length, 0);
  assert.equal(stale.length, 0);
  assert.equal(converged.length, 1);
});

// ─── driftFields (content-anchored vs commit-anchored rows) ─────────────────

test('driftFields: checksum-anchored rows ignore a moved git commit', () => {
  // Regression: migration rows carry `commit: <git head>` locally. Any repo
  // commit moved the head; the SQL content (checksum) stayed identical — that
  // must NOT count as drift.
  const local = { owner: 'core', component: 'migrations', key: 'a.sql', checksum: 'aaa', commit: 'afbea61new' };
  const recorded = { value: { checksum: 'aaa', commit: '9f2a44bold' } };
  assert.deepEqual(driftFields(local, recorded), []);
  assert.equal(isDrifted(local, recorded), false);
});

test('driftFields: checksum-anchored rows still drift on checksum mismatch', () => {
  const local = { owner: 'core', component: 'edge_functions', key: 'send_email', checksum: 'new', commit: 'afbea61new' };
  const recorded = { value: { checksum: 'old', commit: '9f2a44bold' } };
  assert.deepEqual(driftFields(local, recorded), ['checksum']);
});

test('driftFields: commit-only rows (worker) drift on commit', () => {
  const local = { owner: 'core', component: 'worker', key: 'worker', commit: 'afbea61new' };
  assert.deepEqual(driftFields(local, { value: { commit: '9f2a44bold' } }), ['commit']);
  assert.deepEqual(driftFields(local, { value: { commit: 'afbea61new' } }), []);
});

test('driftFields: version rows (plugin code) drift on version', () => {
  const local = { owner: 'plugin:pluradash', component: 'code', key: 'code', version: '2.0.0' };
  assert.deepEqual(driftFields(local, { value: { version: '1.0.0' } }), ['version']);
  assert.deepEqual(driftFields(local, { value: { version: '2.0.0' } }), []);
});

test('driftFields: checksum anchor wins over version/commit comparisons', () => {
  // A row carrying a checksum never drifts on version/commit — the checksum
  // is its drift truth.
  const local = { owner: 'core', component: 'migrations', key: 'a.sql', checksum: 'same', version: '1', commit: 'aaa' };
  const recorded = { value: { checksum: 'same', version: '2', commit: 'bbb' } };
  assert.deepEqual(driftFields(local, recorded), []);
});

// ─── summarizeDeploymentRows (TUI state footer aggregation) ──────────────────

test('summarizeDeploymentRows aggregates core and plugin rows', () => {
  const summary = summarizeDeploymentRows([
    { owner: 'core', ownerKind: 'core', component: 'migrations', key: 'preamble.sql', value: { checksum: 'x' } },
    { owner: 'core', ownerKind: 'core', component: 'migrations', key: 'objects.sql', value: { checksum: 'y' } },
    { owner: 'core', ownerKind: 'core', component: 'edge_functions', key: 'send_email', value: {} },
    {
      owner: 'core', ownerKind: 'core', component: 'worker', key: 'worker',
      value: { commit: 'afbea61full', deployed_at: '2026-09-11T10:00:00Z' },
    },
    { owner: 'core', ownerKind: 'core', component: 'worker', key: 'core_commit', value: { commit: '9f2a44bfull' } },
    {
      owner: 'plugin:pluradash', ownerKind: 'plugin', pluginSlug: 'pluradash',
      component: 'code', key: 'code', value: { version: '1.4.2' },
    },
    { owner: 'plugin:pluradash', ownerKind: 'plugin', pluginSlug: 'pluradash', component: 'migrations', key: '001.sql', value: {} },
    { owner: 'plugin:pluradash', ownerKind: 'plugin', pluginSlug: 'pluradash', component: 'migrations', key: '002.sql', value: {} },
    { owner: 'plugin:pluradash', ownerKind: 'plugin', pluginSlug: 'pluradash', component: 'bindings', key: 'sms', value: {} },
    { owner: 'plugin:pluradash', ownerKind: 'plugin', pluginSlug: 'pluradash', component: 'claims', key: 'pluradash', value: {} },
  ]);

  assert.equal(summary.coreMigrations, 2);
  assert.equal(summary.edgeFunctions, 1);
  assert.equal(summary.workerCommit, 'afbea61full');
  assert.equal(summary.workerDeployedAt, '2026-09-11T10:00:00Z');
  assert.equal(summary.coreCommit, '9f2a44bfull');

  assert.equal(summary.plugins.length, 1);
  const [plugin] = summary.plugins;
  assert.equal(plugin.slug, 'pluradash');
  assert.equal(plugin.version, '1.4.2');
  assert.equal(plugin.migrations, 2);
  assert.equal(plugin.bindings, 1);
  assert.equal(plugin.claims, true);
});

test('summarizeDeploymentRows: multiple plugins sort by slug, defaults are zero-valued', () => {
  const summary = summarizeDeploymentRows([
    { owner: 'plugin:zeta', ownerKind: 'plugin', pluginSlug: 'zeta', component: 'code', key: 'code', value: {} },
    { owner: 'plugin:alpha', ownerKind: 'plugin', pluginSlug: 'alpha', component: 'code', key: 'code', value: { version: '0.1.0' } },
  ]);
  assert.deepEqual(summary.plugins.map((p) => p.slug), ['alpha', 'zeta']);
  assert.equal(summary.plugins[0].version, '0.1.0');
  assert.equal(summary.plugins[1].version, null); // code row without version
  assert.equal(summary.plugins[1].migrations, 0);
  assert.equal(summary.plugins[1].bindings, 0);
  assert.equal(summary.plugins[1].claims, false);
  assert.equal(summary.coreMigrations, 0);
  assert.equal(summary.workerCommit, null);
});

test('summarizeDeploymentRows: empty/undefined input yields an empty summary', () => {
  const empty = summarizeDeploymentRows([]);
  assert.deepEqual(empty.plugins, []);
  assert.equal(empty.coreMigrations, 0);
  assert.equal(summarizeDeploymentRows(undefined).coreMigrations, 0);
});

test('stateRowToLegacyKey inverts coreKeyToComponent for all legacy keys', () => {
  // Round-trip: legacy key → state row → legacy key must be lossless.
  const legacyKeys = [
    'migration:objects.sql',
    'migration:Auth/Access_hook.sql',
    'function:send_email',
    'deployment:worker',
    'deployment:core_commit',
    'deployment:functions',
  ];
  for (const key of legacyKeys) {
    const row = coreRecordToStateRow({ key, value: {} });
    assert.equal(stateRowToLegacyKey(row), key, `round-trip failed for ${key}`);
  }
});

test('stateRowToLegacyKey: rows without legacy equivalent return null', () => {
  assert.equal(stateRowToLegacyKey({ owner: 'core', component: 'auth_hook', key: 'custom_access_token_hook' }), null);
  assert.equal(stateRowToLegacyKey({ owner: 'core', component: 'config', key: 'anything' }), null);
  assert.equal(stateRowToLegacyKey({ owner: 'plugin:pluradash', component: 'code', key: 'code' }), null);
  assert.equal(stateRowToLegacyKey(null), null);
});

test('stateValueToLegacyValue exposes checksum/commit at the legacy field positions', () => {
  const legacy = stateValueToLegacyValue({
    status: 'applied', checksum: 'abc123', commit: 'deadbee', version: null,
    deployed_at: '2026-09-12T00:00:00Z', meta: { workerName: 'service-cms' },
  });
  assert.equal(legacy.checksum, 'abc123');
  assert.equal(legacy.commit, 'deadbee');
  assert.equal(legacy.deployed_at, '2026-09-12T00:00:00Z');
  assert.equal(legacy.workerName, 'service-cms');
});
