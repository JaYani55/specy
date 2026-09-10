#!/usr/bin/env node
/**
 * provision-bindings.mjs
 *
 * Deploy-time provisioning for plugin binding intents (BIPS Layer 3 —
 * specs/platform/binding-management.md, design in
 * specs/plans/BINDING-MANAGEMENT.md).
 *
 * For every plugin-declared `wrangler_intents` entry with a provisionable kind
 * (queues, kv_namespaces) this script create-or-gets the resolved
 * per-environment instance via the Cloudflare API and records it in the
 * resource ledger (.bindings-ledger.json, git-ignored). Secrets Store links
 * are verified against the deployment's store.
 *
 * Run order: install plugins → provision → build → deploy.
 * `npm run build` (ensure-registry) resolves the intents and reads provisioned
 * ids from the ledger, so the generated wrangler.jsonc references only
 * environment-local instances — the queue duplicate-consumer incident
 * (prod's consumer registration colliding with a dev deploy) is structurally
 * impossible.
 *
 * Usage:
 *   node scripts/provision-bindings.mjs                     # provision (create-or-get)
 *   node scripts/provision-bindings.mjs --dry-run           # list resolved instances, no API calls
 *   node scripts/provision-bindings.mjs --check-remote      # diff local generated config vs live Worker (drift report)
 *   node scripts/provision-bindings.mjs --teardown pluradash # delete env-scoped instances the plugin owns
 *   node scripts/provision-bindings.mjs --teardown pluradash --dry-run
 *
 * Environment:
 *   CF_API_TOKEN / CLOUDFLARE_API_TOKEN   Cloudflare API token (prompted when
 *                                         missing in interactive sessions)
 *   Account id and worker name are read from the generated wrangler.jsonc.
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { scanWorkspacePlugins, WRANGLER_CONFIG_FILE } from './lib/plugin-workspace.mjs';
import { parseJsoncConfig } from './lib/wrangler-config.mjs';
import { auditBindingConsistency, printBindingAuditReport } from './lib/binding-consistency.mjs';
import {
  collectPluginIntents,
  listUnprovisionedIntents,
  PROVISIONABLE_KINDS,
} from './lib/binding-intents.mjs';
import {
  provisionBindingIntents,
  readLedgerFromPath,
  teardownPluginBindings,
} from './lib/binding-provisioner.mjs';
import { loadDotEnv } from './lib/env.mjs';
import { promptSecret } from './lib/prompts.mjs';
import { resolvedIntentsToBindingStateRows, writeDeploymentState } from './lib/deployment-state.mjs';
import { createPatDb } from './lib/remote-sql.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const c = { reset:'\x1b[0m', bold:'\x1b[1m', red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m', cyan:'\x1b[36m' };
const log  = (...a) => console.log(...a);
const info = (m) => log(`${c.cyan}i${c.reset}  ${m}`);
const ok   = (m) => log(`${c.green}v${c.reset}  ${m}`);
const warn = (m) => log(`${c.yellow}!${c.reset}  ${m}`);
const fail = (m) => log(`${c.red}x${c.reset}  ${m}`);

// ─── .env loader (CF_API_TOKEN may live in .env/.env.local) ──────────────────
// (shared with the rest of the tooling via scripts/lib/env.mjs)

async function resolveToken() {
  const env = loadDotEnv();
  const token = process.env.CF_API_TOKEN
    ?? process.env.CLOUDFLARE_API_TOKEN
    ?? env['CF_API_TOKEN']
    ?? env['CLOUDFLARE_API_TOKEN'];
  if (token) return token;

  if (!process.stdin.isTTY) {
    warn('No CF_API_TOKEN (env or .env) and non-interactive — cannot call the Cloudflare API.');
    return null;
  }
  log('');
  info('Cloudflare API token required for this operation.');
  log(`  Create one at: ${c.cyan}dash.cloudflare.com → My Profile → API Tokens${c.reset}`);
  log(`  ${c.yellow}Needs: Queues/KV/Secrets Store edit for the target account.${c.reset}`);
  log('');
  const prompted = await promptSecret(`${c.cyan}CF_API_TOKEN:${c.reset} `);
  return prompted && prompted.length >= 10 ? prompted : null;
}

/**
 * Publish provisioning state to the deployment-state registry (best-effort).
 * Needs a Supabase PAT — skipped gracefully when unavailable (the state is
 * repaired by `npm run state:recheck -- --sync`).
 */
async function recordBindingsState(resolvedIntents) {
  const rows = resolvedIntentsToBindingStateRows(resolvedIntents);
  if (rows.length === 0) return;
  const db = await createPatDb();
  if (!db) return;
  try {
    await writeDeploymentState(db.projectRef, db.pat, rows);
  } catch (e) {
    warn(`  Could not record binding state: ${e.message}`);
  }
}

function readAccountId() {
  if (!existsSync(WRANGLER_CONFIG_FILE)) return null;
  try {
    const raw = readFileSync(WRANGLER_CONFIG_FILE, 'utf8');
    const top = /"account_id"\s*:\s*"([^"]+)"/.exec(raw)?.[1] ?? null;
    const varId = /"CF_ACCOUNT_ID"\s*:\s*"([^"]+)"/.exec(raw)?.[1] ?? null;
    const id = top && !top.startsWith('REPLACE_') ? top : (varId && !varId.startsWith('REPLACE_') ? varId : null);
    return id;
  } catch {
    return null;
  }
}

// ─── Collect + resolve intents ────────────────────────────────────────────────

function collectAndReport() {
  const plugins = scanWorkspacePlugins();
  const ledger = readLedgerFromPath(ROOT);
  const { mode, resolvedIntents, errors, warnings, deploymentPaths } = collectPluginIntents(plugins, {
    wranglerJsoncPath: WRANGLER_CONFIG_FILE,
    ledger,
  });

  for (const warning of warnings) warn(warning);

  if (errors.length > 0) {
    fail('Binding intent validation failed:');
    for (const error of errors) fail(`  ${error}`);
    process.exitCode = 1;
    return null;
  }

  if (mode !== 'intents') {
    info('No wrangler_intents declared by any plugin — nothing to provision.');
    info('Legacy wrangler_bindings are injected verbatim (no per-environment provisioning).');
    return { mode: 'none', resolvedIntents: [], deploymentPaths: [] };
  }

  const workerName = /"name"\s*:\s*"([^"]+)"/.exec(existsSync(WRANGLER_CONFIG_FILE) ? readFileSync(WRANGLER_CONFIG_FILE, 'utf8') : '')?.[1] ?? 'specy';
  info(`Deployment path: ${c.bold}${deploymentPaths.join(', ')}${c.reset}${deploymentPaths.includes('cloudflare') ? ' (Cloudflare is the current default and only deployment path)' : ''}`);
  info(`Environment: ${c.bold}${workerName}${c.reset}  — resolved instances:`);

  for (const intent of resolvedIntents) {
    if (intent.kind === 'vars') continue; // aggregated below
    if (intent.kind === 'queues' || intent.kind === 'kv_namespaces') {
      const state = intent.instanceId ? `${c.green}provisioned${c.reset}` : `${c.yellow}unprovisioned${c.reset}`;
      log(`    ${c.cyan}${intent.kind}${c.reset}  ${intent.pluginId}/${intent.purpose}  →  ${c.bold}${intent.resolvedName}${c.reset}  [${state}]`);
    } else if (intent.kind === 'secrets_store_secrets') {
      const state = intent.config.store_id ? `${c.green}store resolved${c.reset}` : `${c.yellow}no store${c.reset}`;
      log(`    ${c.cyan}${intent.kind}${c.reset}  ${intent.pluginId}/${intent.purpose}  →  secret ${c.bold}${intent.config.secret_name}${c.reset}  [${state}]`);
    } else {
      log(`    ${c.cyan}${intent.kind}${c.reset}  ${intent.pluginId}/${intent.purpose}  →  (no instance)`);
    }
  }
  const varIntents = resolvedIntents.filter((i) => i.kind === 'vars');
  if (varIntents.length > 0) {
    log(`    ${c.cyan}vars${c.reset}  ${varIntents.length} plain var(s) from ${[...new Set(varIntents.map((v) => v.pluginId))].join(', ')}  →  (no instance)`);
  }

  return { mode, resolvedIntents, deploymentPaths, workerName };
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/**
 * Reproducible deploy-diff: fetches the live Worker's bindings and diffs them
 * against the locally generated wrangler.jsonc — the same diff wrangler deploy
 * prompts about, as a one-command report BEFORE the prompt. Classifies every
 * difference so the operator can review removed/changed entries once, instead
 * of adjudicating a wrangler prompt on every deploy.
 */
async function cmdCheckRemote() {
  const token = await resolveToken();
  const { runRemoteDriftCheck } = await import('./lib/binding-consistency-remote.mjs');
  const result = await runRemoteDriftCheck({ ROOT, token, accountId: readAccountId(), log, warn });
  if (result.skipped) {
    fail(`Remote drift check skipped: ${result.reason}`);
    process.exitCode = 1;
  }
}

async function cmdProvision(dryRun) {
  const result = collectAndReport();
  if (!result) return;
  if (result.mode === 'none') return;

  const unprovisioned = listUnprovisionedIntents(result.resolvedIntents);
  if (unprovisioned.length === 0) {
    ok('All provisionable intents are already provisioned for this environment.');
    return;
  }

  if (dryRun) {
    info(`Dry run — ${unprovisioned.length} instance(s) would be create-or-got:`);
    for (const intent of unprovisioned) {
      log(`    ${c.cyan}${intent.kind}${c.reset}  ${intent.resolvedName}`);
    }
    return;
  }

  const token = await resolveToken();
  if (!token) {
    warn('Skipping provisioning. Set CF_API_TOKEN and re-run:');
    warn('  npm run bindings:provision');
    process.exitCode = 1;
    return;
  }

  const accountId = readAccountId();
  if (!accountId) {
    fail('No Cloudflare account id found in wrangler.jsonc (account_id / CF_ACCOUNT_ID). Run npm run setup first.');
    process.exitCode = 1;
    return;
  }

  log('');
  info(`Provisioning ${unprovisioned.length} instance(s) for account ${accountId}…`);
  try {
    const summary = await provisionBindingIntents(result.resolvedIntents, {
      token,
      accountId,
      root: ROOT,
      workerName: result.workerName ?? 'specy',
    });
    for (const name of summary.created) ok(`  created: ${c.bold}${name}${c.reset}`);
    for (const name of summary.got) ok(`  already exists: ${c.bold}${name}${c.reset}`);
    for (const secret of summary.verifiedSecrets) ok(`  secret link verified: ${c.bold}${secret}${c.reset}`);
    for (const secret of summary.missingSecrets) {
      warn(`  secret link MISSING: ${c.bold}${secret}${c.reset} — add it to the Secrets Store (values are never in manifests):`);
      warn(`    npx wrangler secrets-store secret create <STORE_ID> --name ${secret} --scopes workers --remote`);
    }
    ok(`Ledger updated: ${c.bold}${summary.rows.length}${c.reset} resource row(s).`);

    // Publish provisioning state to the deployment-state registry.
    await recordBindingsState(result.resolvedIntents);

    // ── Consistency audit: what is converged now, what still needs work? ──
    log('');
    log(`${c.bold}Consistency check${c.reset}:`);
    const audit = auditBindingConsistency({
      plugins: scanWorkspacePlugins(),
      wranglerJsoncPath: WRANGLER_CONFIG_FILE,
      ledger: readLedgerFromPath(ROOT),
      config: null, // config is stale until the rebuild — checked by `npm run build` / bindings:check
    });
    printBindingAuditReport(audit);
    if (audit.consistent) {
      ok('Consistent — run npm run build, then deploy.');
    } else {
      info('Re-run npm run bindings:provision after resolving — the audit re-checks everything automatically.');
    }
  } catch (e) {
    fail(`Provisioning failed: ${e.message}`);
    fail('Binding provisioning failures are config-level errors — deploy is aborted before wrangler deploy.');
    process.exitCode = 1;
  }
}

async function cmdTeardown(pluginId, dryRun) {
  const plugins = scanWorkspacePlugins();
  const ledger = readLedgerFromPath(ROOT);
  if (!plugins.find((p) => p.id === pluginId)) {
    warn(`Plugin "${pluginId}" is not in the workspace — tearing down from the ledger only.`);
  }

  const token = dryRun ? null : await resolveToken();
  const accountId = readAccountId();
  if (!dryRun && (!token || !accountId)) {
    fail('CF_API_TOKEN and a Cloudflare account id are required for teardown.');
    process.exitCode = 1;
    return;
  }

  try {
    const { deleted, kept, missing } = await teardownPluginBindings(pluginId, {
      token, accountId, root: ROOT, dryRun,
    });
    if (dryRun) info(`Dry run — would delete ${deleted.length} environment-scoped instance(s):`);
    for (const d of deleted) ok(`  deleted: ${c.bold}${d.resolved_name}${c.reset} (${d.kind})`);
    for (const k of kept) warn(`  kept: ${c.bold}${k.resolved_name}${c.reset} — ${k.reason}`);
    if (!dryRun) info(`Ledger rows for "${pluginId}" removed (${kept.length} kept reported above).`);
  } catch (e) {
    fail(`Teardown failed: ${e.message}`);
    process.exitCode = 1;
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const teardownIdx = args.indexOf('--teardown');

if (args.includes('--help') || args.includes('-h')) {
  log('');
  log('Usage:');
  log('  node scripts/provision-bindings.mjs                       Create-or-get all provisioned plugin instances');
  log('  node scripts/provision-bindings.mjs --dry-run             List resolved instances, no API calls');
  log('  node scripts/provision-bindings.mjs --check-remote        Diff local generated config vs live Worker (drift report)');
  log('  node scripts/provision-bindings.mjs --teardown <plugin>   Delete env-scoped instances the plugin owns');
  log('  node scripts/provision-bindings.mjs --teardown <plugin> --dry-run');
  log('');
  log(`  Provisionable kinds: ${PROVISIONABLE_KINDS.join(', ')}`);
  log('  Environment: CF_API_TOKEN (or CLOUDFLARE_API_TOKEN), account id from wrangler.jsonc');
  log('');
} else if (args.includes('--check-remote')) {
  await cmdCheckRemote();
} else if (teardownIdx !== -1) {
  const pluginId = args[teardownIdx + 1];
  if (!pluginId) {
    fail('Usage: --teardown <plugin-id>');
    process.exitCode = 1;
  } else {
    await cmdTeardown(pluginId, dryRun);
  }
} else {
  await cmdProvision(dryRun);
}
