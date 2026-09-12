#!/usr/bin/env node
/**
 * scripts/state-recheck.mjs — npm run state:recheck
 *
 * Prod catch-up / re-check for the deployment-state registry
 * (DEPLOYMENT-STATE-TRACKING.md §7). Reconciles "what should be" (local
 * manifests + git head + workspace plugins + binding ledger) against "what is
 * recorded" (public.deployment_state, with a legacy core_update fallback for
 * the shim window).
 *
 * Output classes (each attributed core-owned / plugin-owned):
 *   - unrecorded  local says a migration/binding/version exists but no row
 *   - drifted     recorded checksum/commit/version differs from local
 *   - stale       recorded rows whose component no longer exists locally
 *   - converged   recorded == local
 *
 * Usage:
 *   node scripts/state-recheck.mjs            # report only (dry-run)
 *   node scripts/state-recheck.mjs --sync     # backfill unrecorded, re-record
 *                                             # drifted, delete stale plugin rows
 *   node scripts/state-recheck.mjs --help
 *
 * --sync is idempotent (all writes via ON CONFLICT DO UPDATE) — safe to run
 * repeatedly and in CI. The one-time backfill migration
 * (202609100001_deployment_state.sql) + one `state:recheck --sync` is the
 * documented prod catch-up path.
 */

import { existsSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { createInterface } from 'readline';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createPatDb } from './lib/remote-sql.mjs';
import { fetchCoreUpdateState, buildFunctionManifest, buildMigrationManifest, normalizeSqlEol } from './lib/core-update.mjs';
import { scanWorkspacePlugins, WRANGLER_CONFIG_FILE } from './lib/plugin-workspace.mjs';
import { collectPluginIntents, readBindingLedger, readWorkerName } from './lib/binding-intents.mjs';
import { collectSqlFiles } from './lib/migration-validation.mjs';
import {
  buildPluginDeleteByIdSql,
  coreRecordsToStateRows,
  deletePluginDeploymentState,
  driftFields,
  normalizeStateValue,
  readDeploymentState,
  reconcileRecords,
  resolvedIntentsToBindingStateRows,
  writeDeploymentState,
} from './lib/deployment-state.mjs';
import { runSqlQuery } from './lib/remote-sql.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const c = { reset: '\x1b[0m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m' };
const log = (...a) => console.log(...a);
const info = (m) => log(`${c.cyan}i${c.reset}  ${m}`);
const ok = (m) => log(`${c.green}✓${c.reset}  ${m}`);
const warn = (m) => log(`${c.yellow}!${c.reset}  ${m}`);
const fail = (m) => log(`${c.red}✗${c.reset}  ${m}`);

const args = process.argv.slice(2);
const sync = args.includes('--sync');
const help = args.includes('--help') || args.includes('-h');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

// Plugin-migration checksums follow the same EOL-normalization contract as
// core migrations (see normalizeSqlEol in core-update.mjs) — otherwise a
// Windows checkout records CRLF hashes and re-checks report false drift.
function normalizedSha256(value) {
  return sha256(normalizeSqlEol(value));
}

function readGitHead() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
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

// ─── Local truth ("what should be") ──────────────────────────────────────────

function collectPluginMigrationItems(plugin) {
  const migrationsDir = join(plugin.dir, 'migrations');
  const files = collectSqlFiles(migrationsDir, `plugins/${plugin.dirName}/migrations`);
  return files.map(({ name, sql }) => ({
    owner: `plugin:${plugin.id}`,
    component: 'migrations',
    key: name,
    checksum: normalizedSha256(sql),
  }));
}

function buildLocalTruth() {
  const env = readEnvRaw();
  const storageProvider = (process.env.STORAGE_PROVIDER ?? env['STORAGE_PROVIDER'] ?? 'supabase').toLowerCase();
  const storageBucket = process.env.STORAGE_BUCKET ?? env['STORAGE_BUCKET'] ?? 'booking_media';
  const head = readGitHead();

  const core = [];

  for (const migration of buildMigrationManifest(ROOT, storageProvider, storageBucket)) {
    core.push({ owner: 'core', component: 'migrations', key: migration.name, checksum: migration.checksum, commit: head });
  }
  for (const fn of buildFunctionManifest(ROOT)) {
    core.push({ owner: 'core', component: 'edge_functions', key: fn.name, checksum: fn.checksum, commit: head });
  }
  core.push({ owner: 'core', component: 'worker', key: 'worker', commit: head });
  core.push({ owner: 'core', component: 'auth_hook', key: 'custom_access_token_hook' });

  const plugin = [];
  const plugins = scanWorkspacePlugins();
  const ledger = readBindingLedger(ROOT);
  const workerName = readWorkerName(WRANGLER_CONFIG_FILE);
  const { resolvedIntents } = collectPluginIntents(plugins, { wranglerJsoncPath: WRANGLER_CONFIG_FILE, ledger });

  for (const p of plugins) {
    plugin.push({ owner: `plugin:${p.id}`, component: 'code', key: 'code', version: p.manifest?.version ?? null });
    if (Array.isArray(p.manifest?.claims_declarations) && p.manifest.claims_declarations.length > 0) {
      plugin.push({ owner: `plugin:${p.id}`, component: 'claims', key: p.id });
    }
    plugin.push(...collectPluginMigrationItems(p));
  }
  for (const row of resolvedIntentsToBindingStateRows(resolvedIntents)) {
    plugin.push({ owner: row.owner, component: row.component, key: row.key, commit: null });
  }

  return { core, plugin, head, workerName };
}

// ─── Recorded state ("what is recorded") ─────────────────────────────────────

async function readRecorded(db) {
  const recorded = [];
  const state = await readDeploymentState(db.projectRef, db.pat);

  if (state.available) {
    for (const row of state.rows) {
      recorded.push({ owner: row.owner, component: row.component, key: row.key, value: row.value, pluginId: row.pluginId, pluginSlug: row.pluginSlug });
    }
  }

  // Shim fallback: merge any legacy core_update rows not already represented
  // (covers pre-feature deployments + the window before the migration ran).
  const legacy = await fetchCoreUpdateState(db.projectRef, db.pat).catch(() => null);
  if (legacy?.available && legacy.state.size > 0) {
    const legacyItems = [...legacy.state.entries()].map(([key, value]) => ({ key, value }));
    const legacyRows = coreRecordsToStateRows(legacyItems);
    const present = new Set(recorded.map((r) => `${r.owner}|${r.component}|${r.key}`));
    for (const row of legacyRows) {
      if (!present.has(`${row.owner}|${row.component}|${row.key}`)) {
        recorded.push({ owner: row.owner, component: row.component, key: row.key, value: row.value, pluginId: null, pluginSlug: null });
      }
    }
  }

  return recorded;
}

// ─── Sync helpers ─────────────────────────────────────────────────────────────

/**
 * Split drifted rows by owner: core drift can mean the recorded migration
 * genuinely differs from the file on disk (masking it by re-recording would
 * hide a real divergence) → requires per-row confirmation. Plugin drift is
 * locally generated truth (install/update flows write these rows) → safe to
 * re-record automatically.
 *
 * @param {{ local: { owner: string } }[]} drifted entries from reconcileRecords
 * @returns {{ coreDrift: typeof drifted, pluginDrift: typeof drifted }}
 */
export function partitionDriftByOwner(drifted) {
  const coreDrift = [];
  const pluginDrift = [];
  for (const entry of drifted ?? []) {
    if (entry?.local?.owner === 'core') coreDrift.push(entry);
    else pluginDrift.push(entry);
  }
  return { coreDrift, pluginDrift };
}

async function confirm(question) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolvePromise) => {
    rl.question(`${c.yellow}?${c.reset}  ${question} [y/N] `, (a) => { rl.close(); resolvePromise(a.trim().toLowerCase()); });
  });
  return answer === 'y' || answer === 'yes';
}

function statusFor(component) {
  return {
    worker: 'deployed',
    auth_hook: 'deployed',
    code: 'installed',
    bindings: 'provisioned',
    claims: 'applied',
    migrations: 'applied',
    edge_functions: 'applied',
    config: 'applied',
  }[component] ?? 'applied';
}

function localItemToStateValue(item) {
  return normalizeStateValue({
    status: statusFor(item.component),
    version: item.version ?? null,
    commit: item.commit ?? null,
    checksum: item.checksum ?? null,
    provider: item.component === 'bindings' ? 'cloudflare' : 'supabase',
  });
}

async function applySync(result, db) {
  const unrecordedRows = [];
  for (const item of result.unrecorded) {
    unrecordedRows.push({ owner: item.owner, component: item.component, key: item.key, value: localItemToStateValue(item) });
  }
  if (unrecordedRows.length) {
    await writeDeploymentState(db.projectRef, db.pat, unrecordedRows);
    ok(`Backfilled ${unrecordedRows.length} unrecorded row(s).`);
  }

  // Plugin drift → auto re-record (locally generated truth). Core drift →
  // confirm per row: re-recording would overwrite the DB-side record of what
  // actually ran, which can mask a genuine divergence.
  const { coreDrift, pluginDrift } = partitionDriftByOwner(result.drifted);

  const pluginDriftRows = pluginDrift.map(({ local }) => ({
    owner: local.owner,
    component: local.component,
    key: local.key,
    value: localItemToStateValue(local),
  }));
  if (pluginDriftRows.length) {
    await writeDeploymentState(db.projectRef, db.pat, pluginDriftRows);
    warn(`Re-recorded ${pluginDriftRows.length} drifted plugin row(s) to the local values.`);
  }

  const confirmedCoreRows = [];
  for (const { local, recorded } of coreDrift) {
    const rec = recorded.value ?? {};
    const short = (v) => (v == null ? '?' : String(v).length > 12 ? `${String(v).slice(0, 12)}…` : String(v));
    const detail = driftFields(local, recorded).map((f) => `${f}: ${short(rec[f])} → ${short(local[f])}`).join(', ');
    const proceed = await confirm(
      `Core drift: ${local.component} ${local.key} (${detail}). Re-record local values as truth?`,
    );
    if (proceed) {
      confirmedCoreRows.push({ owner: local.owner, component: local.component, key: local.key, value: localItemToStateValue(local) });
    } else {
      warn(`Left drifted core row as-is: ${local.component} ${local.key}`);
    }
  }
  if (confirmedCoreRows.length) {
    await writeDeploymentState(db.projectRef, db.pat, confirmedCoreRows);
    ok(`Re-recorded ${confirmedCoreRows.length} confirmed core row(s).`);
  } else if (coreDrift.length) {
    warn(`${coreDrift.length} core drifted row(s) left as-is${process.stdin.isTTY ? '' : ' (non-interactive — re-run in a terminal)'}.`);
  }
  if (coreDrift.length) {
    info('  If a core migration drifted, also re-apply the SQL with: npm run migrations -- --replay <file>');
  }

  // Stale plugin rows → delete; stale core rows → report only (never auto-delete).
  const stalePlugin = result.stale.filter((r) => r.owner.startsWith('plugin:'));
  for (const row of stalePlugin) {
    if (row.pluginId) {
      await runSqlQuery(db.projectRef, db.pat, buildPluginDeleteByIdSql(row.pluginId));
    } else if (row.pluginSlug) {
      await deletePluginDeploymentState(db.projectRef, db.pat, row.pluginSlug);
    }
  }
  if (stalePlugin.length) {
    ok(`Deleted ${stalePlugin.length} stale plugin state row(s).`);
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

function ownerLabel(owner) {
  return owner === 'core' ? `${c.bold}core${c.reset}` : `${c.bold}${owner}${c.reset}`;
}

function printReport(result) {
  log('');
  log(`${c.bold}Deployment-state re-check${c.reset}`);

  const any = result.unrecorded.length + result.drifted.length + result.stale.length > 0;

  if (result.unrecorded.length) {
    log('');
    warn(`Unrecorded (${result.unrecorded.length}) — local says it exists, no state row:`);
    for (const item of result.unrecorded) {
      log(`    ${ownerLabel(item.owner)} ${c.cyan}${item.component}${c.reset} ${c.bold}${item.key}${c.reset}`);
    }
  }

  if (result.drifted.length) {
    log('');
    warn(`Drifted (${result.drifted.length}) — recorded differs from local:`);
    for (const { local, recorded } of result.drifted) {
      const rec = recorded.value ?? {};
      const short = (v) => (v == null ? '?' : String(v).length > 12 ? `${String(v).slice(0, 12)}…` : String(v));
      const fields = driftFields(local, recorded);
      const detail = fields.map((f) => `${f}: ${short(rec[f])} → ${short(local[f])}`).join(', ');
      log(`    ${ownerLabel(local.owner)} ${c.cyan}${local.component}${c.reset} ${c.bold}${local.key}${c.reset}  ${c.dim}${detail || '?'}${c.reset}`);
    }
  }

  if (result.stale.length) {
    log('');
    warn(`Stale/orphaned (${result.stale.length}) — recorded but no longer exists locally:`);
    for (const item of result.stale) {
      log(`    ${ownerLabel(item.owner)} ${c.cyan}${item.component}${c.reset} ${c.bold}${item.key}${c.reset}`);
    }
  }

  if (!any) {
    ok(`All ${result.converged.length} state row(s) converged.`);
  } else {
    log('');
    log(`  Converged: ${result.converged.length} · Unrecorded: ${result.unrecorded.length} · Drifted: ${result.drifted.length} · Stale: ${result.stale.length}`);
    if (!sync) {
      info('This was a dry run — re-run with --sync to backfill/re-record/delete.');
    }
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  if (help) {
    log('');
    log('Usage:');
    log('  node scripts/state-recheck.mjs            Report only (dry-run).');
    log('  node scripts/state-recheck.mjs --sync     Backfill unrecorded, re-record drifted, delete stale plugin rows.');
    log('');
    log('Reconciles local manifests + git head + workspace plugins + binding ledger against');
    log('public.deployment_state (legacy core_update fallback). See specs/plans/DEPLOYMENT-STATE-TRACKING.md §7.');
    log('');
    return;
  }

  log('');
  log(`${c.bold}Deployment-state re-check${c.reset}${sync ? '  (--sync)' : '  (dry-run)'}`);

  const db = await createPatDb();
  if (!db) {
    fail('Supabase not reachable — cannot read deployment state.');
    process.exitCode = 1;
    return;
  }

  const local = buildLocalTruth();
  const recorded = await readRecorded(db);
  const allLocal = [...local.core, ...local.plugin];
  const result = reconcileRecords(allLocal, recorded);

  printReport(result);

  if (sync) {
    await applySync(result, db);
    log('');
    ok('Re-check sync complete.');
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}
