#!/usr/bin/env node
/**
 * migrate.mjs — npm run migrations
 *
 * Applies pending CORE migrations from the workspace to the connected Supabase
 * project. No git pull, no dirty-tree check, no deploy — exactly what the
 * workspace contains, checksum-tracked so it stays idempotent.
 *
 * Use when the update flow's git gate is in the way (uncommitted work) but the
 * database needs the current migration state (e.g. the hardened auth hook).
 *
 * Behavior:
 *   - pending migrations (never applied) → applied in order, state recorded.
 *   - drifted migrations (checksum changed since recording) → RE-APPLIED after
 *     confirmation (migrations are idempotent by doctrine; re-apply updates the
 *     recorded checksum). Non-interactive: listed, skipped unless --force.
 *   - bootstrap (no recorded state) → interactive baseline confirmation, same
 *     semantics as the cf-update wizard.
 *   - auth hook registration verified at the end.
 *
 * Flags:
 *   --dry-run          Show what would be applied, change nothing.
 *   --force            Re-apply drifted migrations without confirmation.
 *   --replay <file>    Force-apply a named migration (idempotent) and update
 *                      its recorded state — for files the baseline marked as
 *                      applied but that never ran on this instance. Repeatable.
 *
 * Follow-up: `npm run auth:check` verifies the auth hook health.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { createInterface } from 'readline';
import {
  analyzeCoreUpdates,
  buildFunctionManifest,
  buildMigrationManifest,
  fetchCoreUpdateState,
  registerAuthHook,
  upsertCoreUpdateRecords,
} from './lib/core-update.mjs';
import { createPatDb, extractProjectRef, getSupabaseUrl, resolvePat, runSqlQuery } from './lib/remote-sql.mjs';
import { createActionLog } from './lib/action-log.mjs';

const ROOT = resolve(import.meta.dirname, '..'); // repo root — buildMigrationManifest joins ROOT/migrations

const c = { reset:'\x1b[0m', bold:'\x1b[1m', red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m', cyan:'\x1b[36m' };
const log  = (...a) => console.log(...a);
const info = (m) => log(`${c.cyan}i${c.reset}  ${m}`);
const ok   = (m) => log(`${c.green}✓${c.reset}  ${m}`);
const warn = (m) => log(`${c.yellow}!${c.reset}  ${m}`);
const fail = (m) => log(`${c.red}✗${c.reset}  ${m}`);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const replayNames = args
  .map((a, i) => (args[i - 1] === '--replay' ? a : null))
  .filter(Boolean);

async function confirm(question) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolvePromise) => {
    rl.question(`${c.yellow}?${c.reset}  ${question} [y/N] `, (a) => { rl.close(); resolvePromise(a.trim().toLowerCase()); });
  });
  return answer === 'y' || answer === 'yes';
}

function readEnvRaw() {
  const out = {};
  for (const file of ['.env.local', '.env']) {
    const p = join(ROOT, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const idx = t.indexOf('=');
      if (idx === -1) continue;
      if (!(t.slice(0, idx).trim() in out)) out[t.slice(0, idx).trim()] = t.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

function stateRecord(item) {
  return {
    key: item.id,
    value: {
      name: item.name,
      checksum: item.checksum,
      updatedAt: new Date().toISOString(),
      commit: 'workspace',
    },
  };
}

async function main() {
  log('');
  log(`${c.bold}Core migrations — workspace state → Supabase${c.reset} (no git, no deploy)`);

  // Critical action log — every migrations run appends to /data/logs.
  const actionLog = createActionLog('migrations', { root: ROOT, meta: { dryRun: String(dryRun) } });

  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) {
    fail('SUPABASE_URL not found in .env — cannot connect.');
    actionLog.entry('SUPABASE_URL not found in .env');
    actionLog.finish('failed', 'no SUPABASE_URL');
    process.exitCode = 1;
    return;
  }
  const projectRef = extractProjectRef(supabaseUrl);
  actionLog.entry(`project: ${projectRef}`);

  const { pat } = (await createPatDb()) ?? {};
  if (!pat) {
    fail('No Supabase PAT — migrations cannot be applied.');
    actionLog.entry('no Supabase PAT available');
    actionLog.finish('failed', 'no PAT');
    process.exitCode = 1;
    return;
  }

  const env = readEnvRaw();
  const storageProvider = (process.env.STORAGE_PROVIDER ?? env['STORAGE_PROVIDER'] ?? 'supabase').toLowerCase();
  const storageBucket = process.env.STORAGE_BUCKET ?? env['STORAGE_BUCKET'] ?? 'booking_media';

  const migrations = buildMigrationManifest(ROOT, storageProvider, storageBucket);
  const functions = buildFunctionManifest(ROOT);
  const remote = await fetchCoreUpdateState(projectRef, pat);
  const plan = analyzeCoreUpdates(migrations, functions, remote.state);

  if (plan.pendingMigrations.length > 0) {
    info(`Pending migrations (${plan.pendingMigrations.length}):`);
    for (const m of plan.pendingMigrations) log(`    ${c.cyan}+${c.reset} ${m.name}`);
  } else {
    ok('No pending core migrations.');
  }

  if (plan.driftedMigrations.length > 0) {
    warn(`Drifted migrations (${plan.driftedMigrations.length}) — checksum changed since recording; re-apply updates the recorded state:`);
    for (const m of plan.driftedMigrations) log(`    ${c.yellow}~${c.reset} ${m.name}`);
  }

  actionLog.entry(`plan: ${plan.pendingMigrations.length} pending, ${plan.driftedMigrations.length} drifted, bootstrap=${plan.bootstrapRequired}`);

  if (dryRun) {
    info('Dry run — nothing applied.');
    actionLog.finish('dry-run');
    return;
  }

  if (plan.bootstrapRequired) {
    info('No core update metadata on this instance (bootstrap).');
    const proceed = await confirm('Record the current manifest as baseline and apply pending migrations?');
    if (!proceed) {
      warn('Aborted.');
      actionLog.entry('bootstrap baseline confirmation declined');
      actionLog.finish('aborted');
      process.exitCode = 1;
      return;
    }
    await upsertCoreUpdateRecords(projectRef, pat, migrations.map(stateRecord));
    ok('Baseline recorded.');
    // Recompute the plan against the freshly baselined state.
    const fresh = await fetchCoreUpdateState(projectRef, pat);
    Object.assign(plan, analyzeCoreUpdates(migrations, functions, fresh.state));
    if (plan.pendingMigrations.length === 0 && plan.driftedMigrations.length === 0) {
      info('Baseline complete — all manifest entries recorded as applied.');
      info('If this instance is missing specific migrations (e.g. newly added ones), force-apply them with:');
      info(`  ${c.cyan}npm run migrations -- --replay <migration-file>${c.reset}`);
    }
  }

  const reapplyDrift = plan.driftedMigrations.length > 0
    && (force || (await confirm(`Re-apply ${plan.driftedMigrations.length} drifted migration(s)? (idempotent CREATE OR REPLACE — recorded state will be updated)`)));
  if (plan.driftedMigrations.length > 0 && !reapplyDrift) {
    warn('Drifted migrations left as-is (pass --force to re-apply non-interactively).');
  }

  const driftedNames = new Set(plan.driftedMigrations.map((m) => m.name));

  // ── --replay: explicit force-apply of named files (state-independent) ──
  const replayMigrations = [];
  for (const name of replayNames) {
    const match = migrations.find((m) => m.name === name || m.name.endsWith(`/${name}`) || m.name === join('migrations', name));
    if (!match) {
      fail(`--replay: no migration named "${name}" in the manifest.`);
      actionLog.entry(`--replay: unknown migration "${name}"`);
      actionLog.finish('failed', 'unknown --replay target');
      process.exitCode = 1;
      return;
    }
    replayMigrations.push(match);
  }
  if (replayMigrations.length > 0) {
    info(`Replay requested for ${replayMigrations.length} migration file(s) (ignores recorded state):`);
    for (const m of replayMigrations) log(`    ${c.yellow}↻${c.reset} ${m.name}`);
  }

  const toApply = [
    ...replayMigrations,
    ...(reapplyDrift ? migrations.filter((m) => driftedNames.has(m.name)) : []),
    ...plan.pendingMigrations,
  ];

  if (toApply.length === 0) {
    ok('Nothing to apply.');
    actionLog.finish('nothing-to-apply');
    return;
  }

  log('');
  const pendingRecords = [];
  let canRecordState = !plan.bootstrapRequired;
  for (const migration of toApply) {
    process.stdout.write(`  Applying ${c.yellow}${migration.name}${c.reset}… `);
    try {
      await runSqlQuery(projectRef, pat, migration.sql);
      process.stdout.write(`${c.green}✓${c.reset}\n`);
    } catch (e) {
      process.stdout.write(`${c.red}✗${c.reset}\n`);
      fail(`  ${migration.name}: ${e.message}`);
      fail('Migration aborted — fix and re-run npm run migrations (idempotent, safe to re-run).');
      actionLog.entry(`FAILED applying ${migration.name}: ${e.message}`);
      actionLog.finish('failed', migration.name);
      process.exitCode = 1;
      return;
    }
    actionLog.entry(`applied ${migration.name}`);
    pendingRecords.push(stateRecord(migration));
    if (migration.name === 'system_config.sql') canRecordState = true;
    if (canRecordState && pendingRecords.length > 0) {
      await upsertCoreUpdateRecords(projectRef, pat, pendingRecords.splice(0, pendingRecords.length));
    }
  }
  ok(`${toApply.length} migration(s) applied and state recorded.`);
  actionLog.entry(`${toApply.length} migration(s) applied and state recorded.`);
  actionLog.finish('applied');

  try {
    await registerAuthHook(projectRef, pat);
    ok('Auth hook registration verified.');
  } catch (e) {
    warn(`Auth hook registration check failed: ${e.message}`);
  }

  log('');
  info(`Verify the auth hook health with: ${c.cyan}npm run auth:check${c.reset}`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}