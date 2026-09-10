/**
 * scripts/lib/binding-consistency-remote.mjs
 *
 * Remote drift check as a callable step — shared by update.mjs (pre-deploy)
 * and provision-bindings.mjs (--check-remote). Fetches the live Worker's
 * bindings and diffs them against the generated wrangler.jsonc.
 *
 * Non-interactive by design: a deploy is convergent (local config is the
 * source of truth), so the check exists to REMOVE surprises from the wrangler
 * prompt, not to gatekeep it. Fails soft — any API problem degrades to
 * "skipped" with the reason.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseJsoncConfig } from './wrangler-config.mjs';
import {
  fetchRemoteBindings,
  normalizeRemoteBinding,
  normalizeLocalBindings,
  diffBindings,
} from './binding-provisioner.mjs';

/**
 * Run the remote drift check.
 * @param {{ ROOT: string, wranglerJsoncPath?: string, token?: string, accountId?: string, log?: (m: string) => void, warn?: (m: string) => void }} opts
 * @returns {{ drifted: boolean, added: number, removed: number, changed: number, same: number } | { skipped: true, reason: string }}
 */
export async function runRemoteDriftCheck({
  ROOT,
  wranglerJsoncPath = join(ROOT, 'wrangler.jsonc'),
  token = null,
  accountId = null,
  log = console.log,
  warn = console.warn,
}) {
  // Resolve token/account lazily — the check degrades gracefully without them.
  let resolvedToken = token;
  let resolvedAccount = accountId;
  if (!resolvedToken || !resolvedAccount) {
    const { loadDotEnv } = await import('./env.mjs');
    const { existsSync, readFileSync } = await import('fs');
    const env = loadDotEnv();
    resolvedToken = resolvedToken
      ?? process.env.CF_API_TOKEN
      ?? process.env.CLOUDFLARE_API_TOKEN
      ?? env['CF_API_TOKEN']
      ?? env['CLOUDFLARE_API_TOKEN'];
    if (!wranglerJsoncPath || !existsSync(wranglerJsoncPath)) {
      return { skipped: true, reason: 'no generated wrangler.jsonc' };
    }
    if (!resolvedAccount) {
      const raw = readFileSync(wranglerJsoncPath, 'utf8');
      const top = /"account_id"\s*:\s*"([^"]+)"/.exec(raw)?.[1] ?? null;
      const varId = /"CF_ACCOUNT_ID"\s*:\s*"([^"]+)"/.exec(raw)?.[1] ?? null;
      resolvedAccount = top && !top.startsWith('REPLACE_') ? top : (varId && !varId.startsWith('REPLACE_') ? varId : null);
    }
  }

  if (!resolvedToken || !resolvedAccount) {
    return { skipped: true, reason: 'no CF_API_TOKEN / account id available' };
  }

  const config = parseJsoncConfig(existsSync(wranglerJsoncPath) ? readFileSync(wranglerJsoncPath, 'utf8') : null);
  if (!config) return { skipped: true, reason: 'wrangler.jsonc unparseable' };
  const workerName = config.name ?? 'specy';

  const { ok, bindings: remoteRaw, error } = await fetchRemoteBindings({ token: resolvedToken, accountId: resolvedAccount, workerName });
  if (!ok) return { skipped: true, reason: `remote settings unreadable: ${error}` };

  const local = normalizeLocalBindings(config);
  const remote = remoteRaw.map(normalizeRemoteBinding).filter(Boolean);
  const { added, removed, changed, same } = diffBindings(local, remote);

  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    log(`Remote drift: none — ${same.length} binding(s) converged with the live Worker.`);
    return { added: 0, removed: 0, changed: 0, same: same.length };
  }

  const R = '\x1b[31m', Y = '\x1b[33m', G = '\x1b[32m', B = '\x1b[1m', X = '\x1b[0m';
  for (const b of added) {
    log(`${G}+${X} ${b.kind} ${B}${b.binding}${X} → ${b.target} — deploy will ADD`);
  }
  for (const c of changed) {
    log(`${Y}~${X} ${c.kind} ${B}${c.binding}${X} — local: ${c.localTarget} | remote: ${c.remoteTarget} — deploy will CHANGE`);
  }
  for (const b of removed) {
    log(`${R}-${X} ${b.kind} ${B}${b.binding}${X} → ${b.target} — deploy will REMOVE (review: dashboard-side change?)`);
  }
  log(`Drift: ${added.length} added, ${removed.length} removed, ${changed.length} changed, ${same.length} converged. Local generated config is the source of truth.`);

  return { added: added.length, removed: removed.length, changed: changed.length, same: same.length };
}
