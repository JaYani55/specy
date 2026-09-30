// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { createHash } from 'crypto';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

const loadUpdatePlugins = async () => {
  const mod = await import(pathToFileURL(join(ROOT, 'scripts/update-plugins.mjs')).href);
  return mod;
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const FILES = [
  { name: '001_init.sql', sql: 'CREATE SCHEMA IF NOT EXISTS acme;\nCREATE TABLE acme.things (id uuid);\n' },
  { name: '002_more.sql', sql: 'ALTER TABLE acme.things ADD COLUMN label text;\n' },
];

test('update plugins: planPluginMigrations classifies pending / drifted / converged', async () => {
  const { planPluginMigrations } = await loadUpdatePlugins();
  const { normalizeSqlEol } = await import(pathToFileURL(join(ROOT, 'scripts/lib/core-update.mjs')).href);

  const checksum1 = sha256(normalizeSqlEol(FILES[0].sql));
  const checksum2 = sha256(normalizeSqlEol(FILES[1].sql));

  const recordedRows = [
    { key: '001_init.sql', value: { status: 'applied', checksum: checksum1 } },
    { key: '002_more.sql', value: { status: 'applied', checksum: 'deadbeef' } },
  ];

  const plan = planPluginMigrations(FILES, recordedRows);
  assert.deepEqual(plan.pending.map((f) => f.name), [], 'recorded + matching checksum → converged');
  assert.deepEqual(plan.drifted.map((f) => f.name), ['002_more.sql'], 'checksum mismatch → drifted');
  assert.equal(plan.drifted[0].recordedChecksum, 'deadbeef');
  assert.equal(plan.drifted[0].checksum, checksum2);
  assert.deepEqual(plan.converged.map((f) => f.name), ['001_init.sql']);
});

test('update plugins: unrecorded files are pending (fresh plugin or missing state rows)', async () => {
  const { planPluginMigrations } = await loadUpdatePlugins();

  const plan = planPluginMigrations(FILES, []);
  assert.deepEqual(plan.pending.map((f) => f.name), ['001_init.sql', '002_more.sql']);
  assert.equal(plan.drifted.length, 0);
  assert.equal(plan.converged.length, 0);

  const planNull = planPluginMigrations(FILES, null);
  assert.equal(planNull.pending.length, 2, 'null recorded rows must be treated as "nothing recorded"');
});

test('update plugins: recorded row without checksum is treated as converged (no false drift)', async () => {
  const { planPluginMigrations } = await loadUpdatePlugins();

  const recordedRows = [{ key: '001_init.sql', value: { status: 'applied' } }];
  const plan = planPluginMigrations(FILES, recordedRows);
  assert.deepEqual(plan.converged.map((f) => f.name), ['001_init.sql'],
    'no recorded checksum → cannot detect drift → skip, never re-apply');
  assert.deepEqual(plan.pending.map((f) => f.name), ['002_more.sql']);
});

test('update plugins: plan checksums are EOL-independent (CRLF checkout == LF checkout)', async () => {
  const { planPluginMigrations } = await loadUpdatePlugins();
  const { normalizeSqlEol } = await import(pathToFileURL(join(ROOT, 'scripts/lib/core-update.mjs')).href);

  const recordedRows = [{
    key: '001_init.sql',
    // State recorded from an LF checkout…
    value: { status: 'applied', checksum: sha256(normalizeSqlEol(FILES[0].sql)) },
  }];
  // …but the workspace was checked out with CRLF.
  const crlfFiles = [{ name: '001_init.sql', sql: FILES[0].sql.replaceAll('\n', '\r\n') }];

  const plan = planPluginMigrations(crlfFiles, recordedRows);
  assert.deepEqual(plan.converged.map((f) => f.name), ['001_init.sql'],
    'CRLF checkout must not report drift against LF-recorded state');
});

test('update plugins: state rows are written after successful application, never for failures', async () => {
  // Locks the write-after-confirm contract: the upsert SQL built for a plugin
  // migration row only carries status 'applied' + the applied checksum — there
  // is no code path that records an 'error' state for a failed migration.
  const { readFileSync } = await import('fs');
  const source = readFileSync(join(ROOT, 'scripts/update-plugins.mjs'), 'utf8');
  assert.ok(source.includes("value: { status: 'applied', checksum: migration.checksum, provider: 'supabase' }"),
    'migration state rows must be recorded as applied with the applied checksum');
  assert.ok(!source.includes("status: 'error'"),
    'a failed application must not write any deployment_state row');
});
