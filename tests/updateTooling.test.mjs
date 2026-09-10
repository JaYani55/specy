// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

test('update tooling: migration validator accepts the pluradash workspace plugin', async () => {
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

test('update tooling: detectUpdatablePlugins finds workspace git plugins', async () => {
  const { detectUpdatablePlugins } = await import(pathToFileURL(join(ROOT, 'scripts/update-plugins.mjs')).href);
  const detected = detectUpdatablePlugins();
  const pluradash = detected.find((d) => d.id === 'pluradash');
  assert.ok(pluradash, 'pluradash should be detected');
  assert.equal(pluradash.source, 'git');
  assert.ok(pluradash.manifest, 'manifest should be loaded');
});
