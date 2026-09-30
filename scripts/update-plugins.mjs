#!/usr/bin/env node
/**
 * update-plugins.mjs
 *
 * Updates workspace plugins: pulls the latest changes from their git
 * remotes (or re-downloads registry entries), validates migrations and
 * applies pending plugin migrations via the Supabase Management API (PAT).
 *
 * Migration application is deployment-state aware: each plugin migration is
 * compared against its recorded `public.deployment_state` row
 * (owner_kind='plugin', component='migrations') via checksum —
 *   - pending (never recorded)   → applied, then recorded (write-after-confirm)
 *   - drifted (checksum changed) → re-applied after confirmation (or --force),
 *                                  then re-recorded (migrations are idempotent)
 *   - converged (checksum match) → skipped
 * State rows are written ONLY after the migration SQL was applied
 * successfully; a failed application records nothing and aborts the
 * remaining migrations of that plugin without killing the whole run.
 *
 * Usage:
 *   node scripts/update-plugins.mjs <id...>   Update the given plugin(s)
 *   node scripts/update-plugins.mjs --all     Update every detected plugin
 *   node scripts/update-plugins.mjs --list    Show detected plugins + status
 *   node scripts/update-plugins.mjs --force   Re-apply drifted migrations without prompting
 *   (no args)                                 List only — selection happens in update.mjs
 *
 * Environment:
 *   SUPABASE_ACCESS_TOKEN        Supabase PAT (prompted if missing, never stored)
 *   GITHUB_TOKEN                 GitHub PAT for private plugin repos (optional)
 */

import { existsSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { createInterface } from 'readline';
import { pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import { join } from 'path';
import {
  rebuildWorkspacePluginArtifacts,
  scanWorkspacePlugins,
  WORKSPACE_PLUGINS_DIR,
} from './lib/plugin-workspace.mjs';
import { validatePluginMigrations, collectSqlFiles } from './lib/migration-validation.mjs';
import { normalizeSqlEol } from './lib/core-update.mjs';
import { readDeploymentState, writeDeploymentState } from './lib/deployment-state.mjs';
import { sqlStr } from './lib/sqlStr.mjs';
import { createPatDb, patQuery } from './lib/remote-sql.mjs';

const ROOT = join(import.meta.dirname, '..');

const c = { reset: '\x1b[0m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
const log = (...a) => console.log(...a);
const info = (m) => log(`${c.cyan}i${c.reset}  ${m}`);
const okMsg = (m) => log(`${c.green}✓${c.reset}  ${m}`);
const warn = (m) => log(`${c.yellow}!${c.reset}  ${m}`);
const fail = (m) => log(`${c.red}✗${c.reset}  ${m}`);

// ─── Git helpers ─────────────────────────────────────────────────────────────

function git(dir, args) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  return { ok: res.status === 0, out: (res.stdout || '').trim(), err: (res.stderr || '').trim() };
}

function isGitRepo(dir) {
  return existsSync(join(dir, '.git'));
}

/**
 * Detects updatable plugins: workspace git clones + plugins.json entries.
 * Returns [{ id, dir, source: 'git' | 'registry', manifest, before }]
 */
export function detectUpdatablePlugins() {
  const results = [];
  const pluginsJson = readPluginsJson();

  for (const wp of scanWorkspacePlugins()) {
    const entry = pluginsJson.find((p) => p.id === wp.id);
    results.push({
      id: wp.id,
      dir: wp.dir,
      manifest: wp.manifest,
      source: isGitRepo(wp.dir) ? 'git' : 'local',
      repoUrl: entry?.repo_url ?? wp.manifest.repository ?? null,
      before: wp.manifest.version ?? '?',
    });
  }

  // Registry entries without a workspace folder → downloadable
  for (const entry of pluginsJson) {
    if (results.some((r) => r.id === entry.id)) continue;
    if (!entry.repo_url) continue;
    results.push({
      id: entry.id,
      dir: join(WORKSPACE_PLUGINS_DIR, entry.id),
      manifest: null,
      source: 'registry',
      repoUrl: entry.repo_url,
      downloadUrl: entry.download_url ?? null,
      before: null,
    });
  }

  return results;
}

function readPluginsJson() {
  const file = join(ROOT, 'plugins.json');
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, 'utf8')).plugins ?? [];
  } catch {
    return [];
  }
}

/**
 * Fetches the remote and reports how many commits the plugin is behind.
 * Returns { behind, currentBranch, hasUpstream }
 */
export function checkGitUpdate(dir) {
  const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch.ok) return { behind: 0, error: branch.err };
  const currentBranch = branch.out || 'HEAD';

  const fetch = git(dir, ['fetch', 'origin', currentBranch]);
  if (!fetch.ok) return { behind: 0, error: fetch.err, currentBranch };

  const count = git(dir, ['rev-list', '--count', `HEAD..origin/${currentBranch}`]);
  if (!count.ok) return { behind: 0, error: count.err, currentBranch };

  return { behind: parseInt(count.out, 10) || 0, currentBranch, hasUpstream: true };
}

function gitPull(dir) {
  return git(dir, ['pull', '--ff-only']);
}

/**
 * Updates a git-cloned plugin. Returns { updated, version, error }.
 */
export async function updateGitPlugin(item) {
  const status = checkGitUpdate(item.dir);
  if (status.error) return { updated: false, error: status.error };

  if (!status.behind) {
    return { updated: false, skipped: 'already up to date', version: item.manifest?.version ?? null };
  }

  const dirty = git(item.dir, ['status', '--porcelain']);
  if (dirty.out) {
    return { updated: false, error: `local changes present — commit or stash first (${dirty.out.split('\n').length} file(s))` };
  }

  const pull = gitPull(item.dir);
  if (!pull.ok) return { updated: false, error: `git pull failed: ${pull.err}` };

  return { updated: true, version: readPluginVersion(item.dir) };
}

function readPluginVersion(dir) {
  const mp = join(dir, 'plugin.json');
  if (!existsSync(mp)) return null;
  try {
    return JSON.parse(readFileSync(mp, 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

// ─── Migration plan (pure) ──────────────────────────────────────────────────

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Checksum normalization identical to migrate.mjs / state:recheck (EOL-insensitive). */
function normalizedSha256(sql) {
  return sha256(normalizeSqlEol(sql));
}

/**
 * Builds the local recorded state → apply plan (pure).
 *
 * @param {{ name: string, sql: string }[]} files Sorted up-migration files.
 * @param {{ key: string, value: object }[]} recordedRows deployment_state rows
 *        (component='migrations') for this plugin.
 * @returns {{ pending: object[], drifted: object[], converged: object[] }}
 */
export function planPluginMigrations(files, recordedRows) {
  const recorded = new Map((recordedRows ?? []).map((r) => [r.key, r]));
  const pending = [];
  const drifted = [];
  const converged = [];

  for (const file of files) {
    const checksum = normalizedSha256(file.sql);
    const rec = recorded.get(file.name);
    if (!rec) {
      pending.push({ ...file, checksum });
    } else if (rec.value?.checksum && rec.value.checksum !== checksum) {
      drifted.push({ ...file, checksum, recordedChecksum: rec.value.checksum });
    } else {
      converged.push({ ...file, checksum });
    }
  }
  return { pending, drifted, converged };
}

function confirm(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => {
      rl.close();
      const answer = a.trim().toLowerCase();
      resolve(answer === 'y' || answer === 'yes');
    });
  });
}

/**
 * Applies pending (and confirmed drifted) plugin up-migrations via the
 * Management API, recording each one in public.deployment_state —
 * write-after-confirm: a state row is only written after the SQL ran
 * successfully. A failed application records nothing and stops the remaining
 * migrations of this plugin (graceful: the caller keeps its result).
 *
 * @param {object} item Updatable plugin (dir, id).
 * @param {{ pat: string, projectRef: string }} db
 * @param {{ force?: boolean }} [options] force = re-apply drifted without prompt.
 * @returns {Promise<{ applied: string[], skipped: string[], drifted: string[],
 *                     failed: { name: string, error: string }[], converged: number }>}
 */
export async function applyPluginMigrations(item, db, { force = false } = {}) {
  const migDir = join(item.dir, 'migrations');
  const files = collectSqlFiles(migDir, `plugins/${item.id}/migrations`);
  if (!files.length) return { applied: [], skipped: [], drifted: [], failed: [], converged: 0 };

  // Recorded state ("what is") — component='migrations' rows owned by this plugin.
  let recordedRows = [];
  try {
    const state = await readDeploymentState(db.projectRef, db.pat);
    recordedRows = state.available
      ? state.rows.filter((r) => r.ownerKind === 'plugin' && r.pluginSlug === item.id && r.component === 'migrations')
      : [];
  } catch (e) {
    warn(`  ${item.id}: deployment_state unreadable (${e.message}) — treating all migrations as pending.`);
  }

  const plan = planPluginMigrations(files, recordedRows);
  const toApply = [...plan.pending];
  const skipped = [];

  if (plan.drifted.length) {
    warn(`  ${item.id}: ${plan.drifted.length} drifted migration(s) — checksum changed since recording (idempotent re-apply updates the recorded state):`);
    for (const d of plan.drifted) {
      warn(`    ${d.name} (recorded ${String(d.recordedChecksum).slice(0, 12)}… → local ${d.checksum.slice(0, 12)}…)`);
    }
    const reapply = force || (process.stdin.isTTY ? await confirm(`  Re-apply drifted migration(s) for ${item.id}? [y/N] `) : false);
    if (reapply) {
      toApply.push(...plan.drifted);
    } else {
      warn(`  ${item.id}: drifted migration(s) left as-is (pass --force to re-apply non-interactively).`);
      skipped.push(...plan.drifted.map((d) => d.name));
    }
  }

  const applied = [];
  const failed = [];
  for (const migration of toApply) {
    process.stdout.write(`  Applying ${c.yellow}${migration.name}${c.reset}… `);
    try {
      await patQuery(db, migration.sql);
      process.stdout.write(`${c.green}✓${c.reset}\n`);
      applied.push(migration.name);

      // Write-after-confirm: record state ONLY after successful application.
      try {
        await writeDeploymentState(db.projectRef, db.pat, [{
          owner: `plugin:${item.id}`,
          component: 'migrations',
          key: migration.name,
          value: { status: 'applied', checksum: migration.checksum, provider: 'supabase' },
        }]);
      } catch (e) {
        // The migration itself succeeded — surface the recording problem as a
        // warning; `npm run state:recheck -- --sync` converges the row later.
        warn(`  ${migration.name}: applied, but deployment_state could not be written: ${e.message}`);
      }
    } catch (err) {
      process.stdout.write(`${c.red}✗${c.reset}\n`);
      failed.push({ name: migration.name, error: err.message });
      warn(`  ${migration.name} failed: ${err.message}`);
      warn(`  ${item.id}: remaining migrations NOT applied — nothing was recorded for the failed file.`);
      break;
    }
  }

  return {
    applied,
    skipped,
    drifted: plan.drifted.map((d) => d.name),
    failed,
    converged: plan.converged.length,
  };
}

/**
 * Full update for one plugin: git/registry update → validate → migrations.
 * db: { pat, projectRef } | null
 * options.force: re-apply drifted migrations without confirmation.
 */
export async function updatePlugin(item, db, { force = false } = {}) {
  const result = { id: item.id, updated: false, migrations: [], migrationDetails: null, version: item.before, warnings: [] };

  if (item.source === 'git') {
    const gitResult = await updateGitPlugin(item);
    if (gitResult.error) { result.error = gitResult.error; return result; }
    result.updated = Boolean(gitResult.updated);
    if (gitResult.skipped) result.skipped = gitResult.skipped;
    if (gitResult.version) result.version = gitResult.version;
  } else if (item.source === 'registry') {
    result.error = 'registry-only entry — install it via `npm run plugin:install -- --all` first';
    return result;
  }

  // Refresh manifest after pull
  item.manifest = item.manifest && existsSync(join(item.dir, 'plugin.json'))
    ? JSON.parse(readFileSync(join(item.dir, 'plugin.json'), 'utf8'))
    : item.manifest;

  const validation = validatePluginMigrations(WORKSPACE_PLUGINS_DIR, item.id);
  if (!validation.ok) {
    result.error = `migration validation failed:\n- ${validation.errors.join('\n- ')}`;
    return result;
  }

  if (db) {
    const migrationResult = await applyPluginMigrations(item, db, { force });
    result.migrations = migrationResult.applied;
    result.migrationDetails = migrationResult;
    if (migrationResult.failed.length) {
      result.warnings.push(
        `${migrationResult.failed.length} migration(s) failed (${migrationResult.failed.map((f) => f.name).join(', ')}) — remaining migrations of this plugin were not applied.`);
    }
    // Refresh DB version/status (also when migrations failed or were skipped —
    // the git pull itself succeeded).
    try {
      await patQuery(db, `UPDATE plugins SET status = 'installed', installed_at = now()${item.manifest?.version ? `, version = ${sqlStr(item.manifest.version)}` : ''} WHERE slug = ${sqlStr(item.id)}`);
    } catch (e) {
      result.warnings.push(`DB status update failed: ${e.message}`);
    }
  } else {
    result.warnings.push('no Supabase PAT — migrations and status update skipped');
  }

  return result;
}

/**
 * Convenience wrapper used by update.mjs: creates the PAT db (prompt/env).
 */
export async function withDb() {
  return createPatDb();
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const list = args.includes('--list');
  const force = args.includes('--force');
  const ids = args.filter((a) => !a.startsWith('--'));

  const detected = detectUpdatablePlugins();
  if (!detected.length) {
    info('No updatable plugins found (no workspace plugins, no plugins.json entries).');
    return;
  }

  if (list || (!all && !ids.length)) {
    log(`\n${c.bold}Updatable plugins:${c.reset}`);
    for (const item of detected) {
      let status = '';
      if (item.source === 'git') {
        const s = checkGitUpdate(item.dir);
        status = s.error ? `${c.red}${s.error}${c.reset}` : s.behind ? `${c.yellow}${s.behind} commit(s) behind${c.reset}` : `${c.green}up to date${c.reset}`;
      } else if (item.source === 'registry') {
        status = `${c.yellow}registry-only (not installed locally)${c.reset}`;
      } else {
        status = `${c.yellow}local (no git)${c.reset}`;
      }
      log(`  ${c.cyan}${item.id}${c.reset}  v${item.before ?? '?'}  [${item.source}]  ${status}`);
    }
    log('');
    return;
  }

  const selected = all ? detected : detected.filter((item) => ids.includes(item.id));
  const missing = ids.filter((id) => !detected.some((d) => d.id === id));
  for (const id of missing) warn(`Plugin "${id}" not found — skipped.`);

  const db = await createPatDb();
  const results = [];
  for (const item of selected) {
    log(`\n${c.bold}Updating: ${item.id}${c.reset}`);
    try {
      results.push(await updatePlugin(item, db, { force }));
    } catch (e) {
      fail(`  ${e.message}`);
      results.push({ id: item.id, error: e.message });
    }
  }

  rebuildWorkspacePluginArtifacts();
  okMsg('Plugin registry artifacts rebuilt.');

  log(`\n${c.bold}Summary:${c.reset}`);
  for (const r of results) {
    if (r.error) {
      fail(`  ${r.id}: ${r.error}`);
    } else if (r.skipped) {
      info(`  ${r.id}: ${r.skipped}`);
    } else {
      const d = r.migrationDetails;
      const migInfo = d
        ? `, ${d.applied.length} applied${d.skipped.length ? `, ${d.skipped.length} drifted skipped` : ''}${d.failed.length ? `, ${c.red}${d.failed.length} FAILED${c.reset}` : ''}${d.converged ? `, ${d.converged} already current` : ''}`
        : '';
      okMsg(`  ${r.id}: ${r.updated ? 'updated' : 'unchanged'}${migInfo} → v${r.version ?? '?'}`);
      for (const f of d?.failed ?? []) fail(`    ${f.name}: ${f.error}`);
      for (const w of r.warnings ?? []) warn(`    ${w}`);
    }
  }
  log('');
  info('Finish with: npm run build && npx wrangler deploy');
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}
