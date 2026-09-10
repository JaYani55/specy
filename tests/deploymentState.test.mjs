import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCoreUpsertSql,
  buildPluginDeleteByIdSql,
  buildPluginDeleteSql,
  buildPluginUpsertSql,
  coreKeyToComponent,
  coreRecordToStateRow,
  normalizeOwner,
  normalizeStateValue,
  reconcileRecords,
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
