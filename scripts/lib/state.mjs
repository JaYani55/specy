/**
 * scripts/lib/state.mjs
 *
 * Unified installation/deployment state for the maintenance tooling.
 *
 * Specy spans three planes that must stay in sync:
 *   1. Git (code, migrations, plugin manifests)        — the "what should be" truth
 *   2. Local gitignored sidecars (wrangler.jsonc, .env,
 *      plugins.json, plugin-deps.json, .bindings-ledger.json) — resolved,
 *      environment-specific state that does NOT travel
 *   3. Supabase (public.system_config `core_update`/`deployment` namespaces,
 *      public.plugins) — the shared, queryable runtime truth reachable by both
 *      the operator and (via RLS/API) the dashboard
 *
 * This module reads the LOCAL plane and classifies the repository phase.
 * The REMOTE plane is read by scripts/lib/core-update.mjs
 * (fetchCoreUpdateState) and merged in the unified setup TUI.
 *
 * Design: specs/platform/unified-setup-tui.md
 */

import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { ROOT, loadDotEnv } from './env.mjs';
import { scanWorkspacePlugins, WRANGLER_CONFIG_FILE } from './plugin-workspace.mjs';
import { readBindingLedger } from './binding-intents.mjs';
import { parseJsoncConfig } from './wrangler-config.mjs';

const PLUGINS_JSON = join(ROOT, 'plugins.json');
const LEDGER_FILE = join(ROOT, '.bindings-ledger.json');

/**
 * Pure check: a generated wrangler.jsonc is still "fresh" (unconfigured) while
 * it contains template placeholders (`REPLACE_WITH_…`).
 *
 * @param {string|null} raw wrangler.jsonc content.
 * @returns {boolean}
 */
export function wranglerHasPlaceholders(raw) {
  return typeof raw === 'string' && raw.includes('REPLACE_WITH');
}

/**
 * A repo is "fresh" until a generated, non-placeholder wrangler.jsonc exists.
 * Placeholders (`REPLACE_WITH_…`) come from wrangler.default.jsonc and mean the
 * first-time wizard has not completed.
 *
 * @returns {'fresh' | 'configured'}
 */
export function detectPhase() {
  if (!existsSync(WRANGLER_CONFIG_FILE)) return 'fresh';
  let raw = '';
  try {
    raw = readFileSync(WRANGLER_CONFIG_FILE, 'utf8');
  } catch {
    return 'fresh';
  }
  return wranglerHasPlaceholders(raw) ? 'fresh' : 'configured';
}

function readGitHead() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

// ─── Git branch / sync status (pure helpers + thin runner) ──────────────────

/**
 * Parse `git rev-list --left-right --count HEAD...@{u}` output.
 *
 * @param {string} output e.g. `"2\t5"` (ahead TAB behind).
 * @returns {{ ahead: number, behind: number }}
 */
export function parseAheadBehind(output) {
  const parts = String(output ?? '').trim().split(/\s+/);
  const ahead = Number.parseInt(parts[0], 10);
  const behind = Number.parseInt(parts[1], 10);
  return {
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
  };
}

/**
 * Parse `git status --porcelain <path>` output lines into structured entries.
 *
 * @param {string} output porcelain lines, e.g. `" M scripts/setup.mjs\n?? migrations/001_new.sql"`.
 * @returns {{ status: string, path: string }[]}
 */
export function parseUncommittedPaths(output) {
  return String(output ?? '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2).trim() || line.slice(0, 2);
      const path = line.slice(3).trim().replace(/^"|"$/g, '');
      return { status: status || '?', path };
    });
}

/**
 * Keep only migration SQL files from a parsed `git status` entry list.
 *
 * @param {{ status: string, path: string }[]} entries
 * @returns {{ status: string, path: string }[]}
 */
export function filterMigrationSqlChanges(entries) {
  return (entries ?? []).filter((e) => /^migrations[\\/].+\.sql$/i.test(e.path));
}

/**
 * Pure formatter for the TUI state footer's git line.
 *
 * @param {{ head: string|null, branch: string|null, upstream: string|null,
 *           ahead: number|null, behind: number|null }} git
 * @returns {string} e.g. `dev @ afbea61 · ↑1 ahead · ↓3 behind origin/dev`
 */
export function formatGitStatusLine(git) {
  if (!git?.branch && !git?.head) return '— (not a git checkout)';
  const ref = `${git.branch ?? '(detached)'}${git.head ? ` @ ${git.head}` : ''}`;
  if (!git.upstream) return `${ref} · no upstream branch`;
  const parts = [];
  if (git.ahead) parts.push(`↑${git.ahead} ahead`);
  if (git.behind) parts.push(`↓${git.behind} behind`);
  return `${ref} · ${parts.length ? `${parts.join(' ')} vs ${git.upstream}` : `up to date with ${git.upstream}`}`;
}

/**
 * Read the full local git status: HEAD, current branch, upstream and
 * ahead/behind counts. Never throws — missing git returns nulls.
 *
 * @returns {{ head: string|null, branch: string|null, upstream: string|null,
 *             ahead: number|null, behind: number|null }}
 */
export function readGitStatus() {
  const run = (cmd) => {
    try {
      return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      return null;
    }
  };
  const head = readGitHead();
  const branch = run('git rev-parse --abbrev-ref HEAD');
  const upstream = run('git rev-parse --abbrev-ref --symbolic-full-name @{u}');
  let ahead = null;
  let behind = null;
  if (upstream) {
    ({ ahead, behind } = parseAheadBehind(run('git rev-list --left-right --count HEAD...@{u}') ?? ''));
  }
  return { head, branch, upstream, ahead: upstream ? ahead : null, behind: upstream ? behind : null };
}

/**
 * Uncommitted migration SQL files (new, modified, staged) under migrations/.
 *
 * @returns {{ status: string, path: string }[]}
 */
export function readUncommittedMigrations() {
  try {
    const output = execSync('git status --porcelain migrations/', {
      cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1024 * 1024,
    });
    return filterMigrationSqlChanges(parseUncommittedPaths(output));
  } catch {
    return [];
  }
}

function readPluginsJsonSources() {
  if (!existsSync(PLUGINS_JSON)) return [];
  try {
    const parsed = JSON.parse(readFileSync(PLUGINS_JSON, 'utf8'));
    return Array.isArray(parsed?.plugins) ? parsed.plugins.map((p) => ({ id: p.id, repo_url: p.repo_url, ref: p.ref ?? null })) : [];
  } catch {
    return [];
  }
}

function readWranglerConfig() {
  if (!existsSync(WRANGLER_CONFIG_FILE)) return null;
  try {
    return parseJsoncConfig(readFileSync(WRANGLER_CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Summarize the local installation state (no network calls).
 *
 * @returns {{
 *   phase: 'fresh'|'configured',
 *   workerName: string,
 *   accountId: string|null,
 *   hasEnv: boolean,
 *   supabaseUrl: string|null,
 *   gitHead: string|null,
 *   git: { head: string|null, branch: string|null, upstream: string|null,
 *          ahead: number|null, behind: number|null },
 *   workspacePlugins: { id: string, version: string|null }[],
 *   pluginSources: { id: string, repo_url: string, ref: string|null }[],
 *   ledgerRows: number,
 * }}
 */
export function readLocalState() {
  const config = readWranglerConfig();
  const env = loadDotEnv();
  const ledger = readBindingLedger(ROOT);
  const plugins = scanWorkspacePlugins();

  return {
    phase: detectPhase(),
    workerName: config?.name ?? 'specy',
    accountId: config?.account_id && !String(config.account_id).startsWith('REPLACE_') ? config.account_id : (config?.vars?.CF_ACCOUNT_ID ?? null),
    hasEnv: Object.keys(env).length > 0,
    supabaseUrl:
      process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? env['SUPABASE_URL'] ?? env['VITE_SUPABASE_URL'] ?? null,
    gitHead: readGitHead(),
    git: readGitStatus(),
    workspacePlugins: plugins.map((p) => ({ id: p.id, version: p.manifest?.version ?? null })),
    pluginSources: readPluginsJsonSources(),
    ledgerRows: Array.isArray(ledger?.resources) ? ledger.resources.length : 0,
  };
}

export { ROOT, LEDGER_FILE };
