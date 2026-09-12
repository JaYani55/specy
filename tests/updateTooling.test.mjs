// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

// The pluradash plugin is workspace *state*, not repo truth — it may be
// uninstalled (parked in plugins/.uninstalled/) in a given checkout. Skip the
// workspace-dependent assertions when the directory is absent instead of
// failing (or vacuously passing) on clean workspaces.
const PLURADASH_DIR = join(ROOT, 'plugins', 'pluradash');
const pluradashInstalled = () => existsSync(PLURADASH_DIR);

test('update tooling: migration validator accepts the pluradash workspace plugin', { skip: !pluradashInstalled() ? 'pluradash not installed in this workspace' : false }, async () => {
  const { validatePluginMigrations } = await import(pathToFileURL(join(ROOT, 'scripts/lib/migration-validation.mjs')).href);
  const result = validatePluginMigrations(join(ROOT, 'plugins'), 'pluradash');
  assert.equal(result.ok, true, `expected pluradash migrations to validate, got: ${result.errors.join(' | ')}`);
});

test('update tooling: validator rejects plugin DDL targeting public schema', async () => {
  const { validatePluginMigrations } = await import(pathToFileURL(join(ROOT, 'scripts/lib/migration-validation.mjs')).href);
  const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = await import('fs');
  const { tmpdir } = await import('os');

  const dir = mkdtempSync(join(tmpdir(), 'migval-'));
  try {
    mkdirSync(join(dir, 'acme', 'migrations', 'down'), { recursive: true });
    writeFileSync(
      join(dir, 'acme', 'migrations', '001_create.sql'),
      "CREATE SCHEMA IF NOT EXISTS acme;\nCREATE TABLE acme.things (id uuid);\nCREATE OR REPLACE FUNCTION public.is_pro() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;\n",
    );
    writeFileSync(join(dir, 'acme', 'migrations', 'down', '001_create.sql'), 'DROP TABLE acme.things;\n');

    const result = validatePluginMigrations(dir, 'acme');
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /CREATE\/DROP FUNCTION targets schema "public"/.test(e)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('update tooling: detectUpdatablePlugins finds workspace git plugins', { skip: !pluradashInstalled() ? 'pluradash not installed in this workspace' : false }, async () => {
  const { detectUpdatablePlugins } = await import(pathToFileURL(join(ROOT, 'scripts/update-plugins.mjs')).href);
  const detected = detectUpdatablePlugins();
  const pluradash = detected.find((d) => d.id === 'pluradash');
  assert.ok(pluradash, 'pluradash should be detected');
  assert.equal(pluradash.source, 'git');
  assert.ok(pluradash.manifest, 'manifest should be loaded');
});

test('update tooling: first-time-setup state recording matches buildMigrationManifest checksums', async () => {
  const { buildMigrationManifest, normalizeSqlEol } = await import(pathToFileURL(join(ROOT, 'scripts/lib/core-update.mjs')).href);
  const { readFileSync } = await import('fs');
  const { createHash } = await import('crypto');

  // first-time-setup.mjs records state with the same formula the manifest
  // builder uses — a mismatch would make every wizard-recorded migration
  // report drift on the next migrate/recheck run. Lock the parity in.
  const hash = (v) => createHash('sha256').update(v).digest('hex');
  const manifest = buildMigrationManifest(ROOT, 'supabase', 'booking_media');
  assert.ok(manifest.length > 0);
  for (const entry of manifest) {
    const raw = readFileSync(join(ROOT, 'migrations', entry.name === 'storage.sql' ? 'storage.default.sql' : entry.name), 'utf8');
    if (entry.name === 'storage.sql') {
      // The wizard and the builder substitute the same bucket placeholder.
      assert.equal(entry.checksum, hash(normalizeSqlEol(raw.replaceAll('REPLACE_WITH_STORAGE_BUCKET', 'booking_media'))));
    } else {
      assert.equal(entry.checksum, hash(normalizeSqlEol(raw)), `checksum parity for ${entry.name}`);
    }
  }
});

test('update tooling: planBaseline keeps missing-table migrations pending instead of baselining them', async () => {
  const { planBaseline } = await import(pathToFileURL(join(ROOT, 'scripts/lib/core-update.mjs')).href);

  const migrations = [
    { name: 'creates_pages.sql', sql: 'CREATE TABLE public.pages (id uuid);' },
    { name: 'creates_missing.sql', sql: 'CREATE TABLE IF NOT EXISTS public.never_applied (id uuid);' },
    { name: 'policy_only.sql', sql: "CREATE POLICY p ON public.pages USING (true);" },
  ];
  const existing = ['pages', 'system_config'];

  const { baseline, applyInstead } = planBaseline(migrations, existing);
  assert.deepEqual(baseline.map((m) => m.name), ['creates_pages.sql', 'policy_only.sql'],
    'migrations whose tables exist (or create none) are baseline');
  assert.deepEqual(applyInstead.map((m) => m.name), ['creates_missing.sql'],
    'a migration whose created tables are all missing stays pending');
});

test('update tooling: migration checksums are EOL-independent (CRLF checkout == LF checkout)', async () => {
  const { normalizeSqlEol } = await import(pathToFileURL(join(ROOT, 'scripts/lib/core-update.mjs')).href);
  const { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { createHash } = await import('crypto');

  assert.equal(normalizeSqlEol('a\r\nb\r\n'), 'a\nb\n');
  assert.equal(normalizeSqlEol('already-lf\n'), 'already-lf\n');

  // The same migration content written with LF (Linux/CI checkout) and CRLF
  // (Windows checkout with core.autocrlf) must produce identical checksums —
  // this is what buildMigrationManifest hashes after normalization.
  const makeFakeRepo = (eol) => {
    const dir = mkdtempSync(join(tmpdir(), 'eol-manifest-'));
    mkdirSync(join(dir, 'migrations'), { recursive: true });
    writeFileSync(join(dir, 'migrations', 'preamble.sql'), `-- one${eol}-- two${eol}`);
    return dir;
  };
  const hash = (v) => createHash('sha256').update(v).digest('hex');
  const lfRepo = makeFakeRepo('\n');
  const crlfRepo = makeFakeRepo('\r\n');
  try {
    const lfSql = readFileSync(join(lfRepo, 'migrations', 'preamble.sql'), 'utf8');
    const crlfSql = readFileSync(join(crlfRepo, 'migrations', 'preamble.sql'), 'utf8');
    assert.equal(hash(normalizeSqlEol(crlfSql)), hash(normalizeSqlEol(lfSql)), 'normalized checksums must match across EOL flavors');
    assert.notEqual(hash(crlfSql), hash(lfSql), 'raw hashes would differ — this is the drift being guarded against');
  } finally {
    rmSync(lfRepo, { recursive: true, force: true });
    rmSync(crlfRepo, { recursive: true, force: true });
  }
});
