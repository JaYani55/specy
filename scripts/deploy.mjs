#!/usr/bin/env node
/**
 * deploy.mjs — npm run deploy
 *
 * Reproducible deploy wrapper: consistency audit → remote drift report →
 * wrangler deploy. Replaces the raw `npx wrangler deploy` habit so the
 * wrangler config-diff prompt can never surprise anyone:
 *
 *   1. Build — `npm run build` (typecheck + vite build) ALWAYS runs first so
 *      the deployed bundle reflects the current source: a deploy after a
 *      plugin uninstall/install without a rebuild would keep serving the old
 *      plugin UI from the stale dist/ bundle. Opt out with --skip-build.
 *   2. Consistency audit — all binding moving parts (intents, provisioning,
 *      secrets, ledger, generated config sync). Aborts with fix commands when
 *      not converged — deploying a divergent config is the failure mode this
 *      prevents.
 *   3. Remote drift check — the same diff the wrangler prompt shows, reported
 *      BEFORE the prompt (classified, attributed). Skipped gracefully without
 *      CF_API_TOKEN.
 *   4. wrangler deploy.
 *
 * Flags:
 *   --skip-build   Skip the build step (deploy the existing dist/ as-is)
 *   --skip-audit   Skip the consistency check (not recommended)
 *   --yes          Forwarded intent marker — informational only; wrangler still
 *                  owns its prompt in interactive terminals (CI auto-accepts).
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { rebuildWorkspacePluginArtifacts, scanWorkspacePlugins, WRANGLER_CONFIG_FILE } from './lib/plugin-workspace.mjs';
import { auditBindingConsistency, printBindingAuditReport } from './lib/binding-consistency.mjs';
import { readLedgerFromPath } from './lib/binding-provisioner.mjs';
import { parseJsoncConfig } from './lib/wrangler-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const c = { reset:'\x1b[0m', bold:'\x1b[1m', red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m', cyan:'\x1b[36m' };
const log  = (...a) => console.log(...a);
const info = (m) => log(`${c.cyan}i${c.reset}  ${m}`);
const ok   = (m) => log(`${c.green}v${c.reset}  ${m}`);
const warn = (m) => log(`${c.yellow}!${c.reset}  ${m}`);
const fail = (m) => log(`${c.red}x${c.reset}  ${m}`);

const args = process.argv.slice(2);
const skipAudit = args.includes('--skip-audit');
const skipBuild = args.includes('--skip-build');

// ─── 1. Registries (cheap, idempotent — protects against stale checkout) ─────
rebuildWorkspacePluginArtifacts();

// ─── 2. Build (always, unless explicitly skipped) ─────────────────────────
// The Worker serves the vite bundle from dist/ — deploying without rebuilding
// keeps stale plugin UI/routes live after install/uninstall. `npm run build`
// also runs the prebuild registry regeneration + typecheck, so a failing
// build (type errors, registry problems) aborts the deploy before wrangler
// sees a divergent config.
if (!skipBuild) {
  log('');
  log(`${c.bold}Build${c.reset} (npm run build — typecheck + vite; skip with --skip-build):`);
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const build = spawnSync(npmCmd, ['run', 'build'], { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' });
  if (build.status !== 0) {
    fail(`Build failed (exit ${build.status ?? '?'}).`);
    info('Fix the errors above, or deploy the existing dist/ as-is with: npm run deploy -- --skip-build');
    process.exit(1);
  }
  ok('Build succeeded.');
}

// ─── 3. Consistency audit (aborts on non-converged state) ────────────────────
if (!skipAudit) {
  log('');
  log(`${c.bold}Consistency check${c.reset}:`);
  const config = existsSync(WRANGLER_CONFIG_FILE) ? parseJsoncConfig(readFileSync(WRANGLER_CONFIG_FILE, 'utf8')) : null;
  if (!config && existsSync(WRANGLER_CONFIG_FILE)) {
    fail('wrangler.jsonc could not be parsed — run npm run build first.');
    process.exit(1);
  }
  const audit = auditBindingConsistency({
    plugins: scanWorkspacePlugins(),
    wranglerJsoncPath: WRANGLER_CONFIG_FILE,
    ledger: readLedgerFromPath(ROOT),
    config,
  });

  const { pendingCommands } = printBindingAuditReport(audit);

  if (!audit.consistent) {
    log('');
    fail('Not ready to deploy — resolve the pending items above first:');
    for (const [command, targets] of pendingCommands) {
      log(`    ${c.cyan}${command}${c.reset}`);
      for (const t of targets) log(`      ${c.dim}→ ${t}${c.reset}`);
    }
    log(`    Then re-run ${c.cyan}npm run deploy${c.reset} — the audit re-checks automatically.`);
    process.exitCode = 1;
    process.exit(1);
  }
  ok('All moving parts consistent.');
}

// ─── 4. Remote drift report (non-fatal, informational) ───────────────────────
log('');
try {
  const { runRemoteDriftCheck } = await import('./lib/binding-consistency-remote.mjs');
  const result = await runRemoteDriftCheck({ ROOT, log: (m) => log(m) });
  if (result?.skipped) {
    info(`Remote drift check skipped: ${result.reason}`);
  }
} catch (e) {
  warn(`Remote drift check unavailable: ${e.message}`);
}

// ─── 5. Deploy ────────────────────────────────────────────────────────────────────
log('');
info(`Deploying via wrangler… (the config-diff prompt, if shown, matches the drift report above)`);
const wranglerCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const res = spawnSync(wranglerCmd, ['wrangler', 'deploy'], { stdio: 'inherit', cwd: ROOT, shell: true });
process.exitCode = res.status ?? 0;
