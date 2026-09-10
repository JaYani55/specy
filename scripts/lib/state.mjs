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
    workspacePlugins: plugins.map((p) => ({ id: p.id, version: p.manifest?.version ?? null })),
    pluginSources: readPluginsJsonSources(),
    ledgerRows: Array.isArray(ledger?.resources) ? ledger.resources.length : 0,
  };
}

export { ROOT, LEDGER_FILE };
