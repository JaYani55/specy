/**
 * remote-sql.mjs — shared Supabase Management API access for update tooling
 * (update-plugins.mjs, update.mjs). Mirrors the PAT flow of
 * install-plugins.mjs / uninstall-plugin.mjs.
 *
 * The PAT is read from SUPABASE_ACCESS_TOKEN or prompted once (masked) and
 * held in memory only for the duration of the run — never written to disk.
 * Management API SQL runs with project-owner privileges (RLS does not apply).
 */

import { loadDotEnv, ROOT } from './env.mjs';
import { promptSecret } from './prompts.mjs';

const c = { reset: '\x1b[0m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
const log = (...a) => console.log(...a);
const info = (m) => log(`${c.cyan}i${c.reset}  ${m}`);
const okMsg = (m) => log(`${c.green}✓${c.reset}  ${m}`);
const warn = (m) => log(`${c.yellow}!${c.reset}  ${m}`);

export function getSupabaseUrl() {
  const env = loadDotEnv();
  return process.env.SUPABASE_URL
    ?? process.env.VITE_SUPABASE_URL
    ?? env['SUPABASE_URL']
    ?? env['VITE_SUPABASE_URL'];
}

export function extractProjectRef(supabaseUrl) {
  try {
    return new URL(supabaseUrl).hostname.split('.')[0];
  } catch {
    return null;
  }
}

export async function runSqlQuery(projectRef, pat, sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!res.ok) {
    const rawText = await res.text().catch(() => '');
    let detail = rawText;
    try {
      const body = JSON.parse(rawText);
      detail = body.message || body.error || rawText;
    } catch { /* keep raw */ }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return res.json().catch(() => null);
}

/**
 * Resolves the Supabase PAT: env var first, then interactive prompt.
 * Returns null when unavailable — callers skip DB operations gracefully.
 */
export async function resolvePat() {
  const envPat = process.env.SUPABASE_ACCESS_TOKEN ?? loadDotEnv()['SUPABASE_ACCESS_TOKEN'];
  if (envPat && envPat.trim().length >= 10) return envPat.trim();

  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) {
    warn('SUPABASE_URL not found — DB operations will be skipped.');
    return null;
  }
  if (!process.stdin.isTTY) {
    warn('Non-interactive session and no SUPABASE_ACCESS_TOKEN set — DB operations will be skipped.');
    return null;
  }

  log('');
  log(`${c.bold}Supabase personal access token required${c.reset}`);
  log(`  Project: ${c.cyan}${supabaseUrl}${c.reset}`);
  log(`  Create one at: ${c.cyan}https://supabase.com/dashboard/account/tokens${c.reset}`);
  log(`  ${c.yellow}PATs start with sbp_ or sb_pat_ — do NOT use your anon/secret keys.${c.reset}`);
  log('  The token is only used locally for this run and is never stored.');
  log('');
  const pat = await promptSecret(`${c.cyan}Supabase PAT:${c.reset} `);
  if (!pat || pat.length < 10) {
    warn('No PAT entered — DB operations will be skipped.');
    return null;
  }
  return pat;
}

/**
 * Thin DB facade over the Management API. Returns null when no valid PAT is
 * available; callers then skip DB operations gracefully.
 */
export async function createPatDb() {
  const pat = await resolvePat();
  if (!pat) return null;
  const projectRef = extractProjectRef(getSupabaseUrl());
  if (!projectRef) {
    warn('Could not extract project ref from SUPABASE_URL — DB operations will be skipped.');
    return null;
  }
  try {
    await runSqlQuery(projectRef, pat, 'select 1');
  } catch (e) {
    warn(`Supabase PAT rejected (${e.message}) — DB operations will be skipped.`);
    return null;
  }
  okMsg(`Supabase connected (project ${projectRef}) via PAT.`);
  return { pat, projectRef };
}

export function patQuery(db, sql) {
  return runSqlQuery(db.projectRef, db.pat, sql);
}

export { info, log, warn, okMsg };
