#!/usr/bin/env node
/**
 * update-plugins.mjs
 *
 * Updates workspace plugins: pulls the latest changes from their git
 * remotes (or re-downloads registry entries), validates migrations and
 * applies pending plugin migrations via the Supabase Management API (PAT).
 *
 * Usage:
 *   node scripts/update-plugins.mjs <id...>   Update the given plugin(s)
 *   node scripts/update-plugins.mjs --all     Update every detected plugin
 *   node scripts/update-plugins.mjs --list    Show detected plugins + status
 *   (no args)                                 List only — selection happens in update.mjs
 *
 * Environment:
 *   SUPABASE_ACCESS_TOKEN        Supabase PAT (prompted if missing, never stored)
 *   GITHUB_TOKEN                 GitHub PAT for private plugin repos (optional)
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import { join } from 'path';
import {
  rebuildWorkspacePluginArtifacts,
  scanWorkspacePlugins,
  WORKSPACE_PLUGINS_DIR,
} from './lib/plugin-workspace.mjs';
import { validatePluginMigrations } from './lib/migration-validation.mjs';
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

/**
 * Applies pending plugin up-migrations via the Management API.
 * Returns applied file names.
 */
export async function applyPluginMigrations(item, db) {
  const migDir = join(item.dir, 'migrations');
  if (!existsSync(migDir)) return [];

  const files = readdirSync(migDir)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('.'))
    .sort();

  const applied = [];
  for (const file of files) {
    const sql = readFileSync(join(migDir, file), 'utf8');
    process.stdout.write(`  Applying ${c.yellow}${file}${c.reset}… `);
    try {
      await patQuery(db, sql);
      process.stdout.write(`${c.green}✓${c.reset}\n`);
      applied.push(file);
    } catch (err) {
      process.stdout.write(`${c.red}✗${c.reset}\n`);
      throw new Error(`${file}: ${err.message}`);
    }
  }
  return applied;
}

/**
 * Full update for one plugin: git/registry update → validate → migrations.
 * db: { pat, projectRef } | null
 */
export async function updatePlugin(item, db) {
  const result = { id: item.id, updated: false, migrations: [], version: item.before, warnings: [] };

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
    result.migrations = await applyPluginMigrations(item, db);
    // Refresh DB version/status
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
      results.push(await updatePlugin(item, db));
    } catch (e) {
      fail(`  ${e.message}`);
      results.push({ id: item.id, error: e.message });
    }
  }

  rebuildWorkspacePluginArtifacts();
  okMsg('Plugin registry artifacts rebuilt.');

  log(`\n${c.bold}Summary:${c.reset}`);
  for (const r of results) {
    if (r.error) fail(`  ${r.id}: ${r.error}`);
    else if (r.skipped) info(`  ${r.id}: ${r.skipped}`);
    else okMsg(`  ${r.id}: ${r.updated ? 'updated' : 'unchanged'}${r.migrations?.length ? `, ${r.migrations.length} migration(s) applied` : ''} → v${r.version ?? '?'}`);
  }
  log('');
  info('Finish with: npm run build && npx wrangler deploy');
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}
