#!/usr/bin/env node
/**
 * scripts/setup.mjs — npm run setup
 *
 * Unified maintenance entry point for Specy.
 *
 * It detects the repository phase and dispatches:
 *   - fresh checkout   (no generated wrangler.jsonc, or placeholders still in it)
 *                       → first-time setup wizard (scripts/lib/first-time-setup.mjs)
 *   - configured       (generated, non-placeholder wrangler.jsonc)
 *                       → interactive maintenance TUI: installation/deployment
 *                         state summary, integrity check, and one menu to reach
 *                         every mutating flow (update, deploy, provision, plugins,
 *                         migrations, auth).
 *
 * The TUI is a *launcher + integrity gate + state tracker*, not a reimplementation
 * of the engines — each menu action delegates to the existing script in
 * scripts/ so there is exactly one implementation of every operation.
 *
 * Design: specs/platform/unified-setup-tui.md
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import * as p from '@clack/prompts';
import { detectPhase, readLocalState } from './lib/state.mjs';
import { runFirstTimeSetup } from './lib/first-time-setup.mjs';
import { rebuildWorkspacePluginArtifacts, scanWorkspacePlugins, WRANGLER_CONFIG_FILE } from './lib/plugin-workspace.mjs';
import { auditBindingConsistency, printBindingAuditReport } from './lib/binding-consistency.mjs';
import { readLedgerFromPath } from './lib/binding-provisioner.mjs';
import { parseJsoncConfig } from './lib/wrangler-config.mjs';
import { createPatDb } from './lib/remote-sql.mjs';
import { fetchCoreUpdateState } from './lib/core-update.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const strip = (m) => String(m).replace(/\x1b\[[0-9;]*m/g, '');

// ─── Subprocess launchers (single implementation per operation) ─────────────

/**
 * Spawn a sibling script with the current Node binary, inheriting stdio.
 * No shell: `process.execPath` on Windows lives under a path with spaces
 * (e.g. "C:\Program Files\nodejs\node.exe") which a shell would split — spawn
 * handles the spaces correctly without it.
 */
function nodeScript(script, args = []) {
  const res = spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  return res.status === 0 || res.status === null;
}

// ─── Integrity check ─────────────────────────────────────────────────────────

function runIntegrityCheck() {
  // 1. Generated plugin artifacts (cheap, idempotent — protects against a
  //    stale checkout; also validates intents + claims at build parity).
  rebuildWorkspacePluginArtifacts();

  // 2. Binding consistency — every moving part checked against every other,
  //    each non-converged state printed with its exact fix command.
  const config = existsSync(WRANGLER_CONFIG_FILE)
    ? parseJsoncConfig(readFileSync(WRANGLER_CONFIG_FILE, 'utf8'))
    : null;

  const audit = auditBindingConsistency({
    plugins: scanWorkspacePlugins(),
    wranglerJsoncPath: WRANGLER_CONFIG_FILE,
    ledger: readLedgerFromPath(ROOT),
    config,
  });

  p.log.message('Binding consistency:');
  printBindingAuditReport(audit, { log: (m) => p.log.info(strip(m)) });
  return audit;
}

// ─── State summary ───────────────────────────────────────────────────────────

async function readRemoteDeployment(db) {
  if (!db) return null;
  try {
    const remote = await fetchCoreUpdateState(db.projectRef, db.pat);
    if (!remote.available) return null;
    const worker = remote.state.get('deployment:worker');
    const core = remote.state.get('deployment:core_commit');
    return {
      workerCommit: worker?.commit ?? null,
      workerDeployedAt: worker?.deployedAt ?? null,
      coreCommit: core?.commit ?? null,
      recordedMigrationCount: [...remote.state.keys()].filter((k) => k.startsWith('migration:')).length,
    };
  } catch {
    return null;
  }
}

function showStateSummary(local, remote) {
  const lines = [
    `Worker        ${local.workerName}`,
    `Phase         ${local.phase === 'fresh' ? 'fresh (first-time setup pending)' : 'configured'}`,
    `Account ID    ${local.accountId ?? '— (not configured)'}`,
    `Supabase URL  ${local.supabaseUrl ?? '— (not configured)'}`,
    `Git head      ${local.gitHead ?? '— (not a git checkout)'}`,
    `Plugins       ${local.workspacePlugins.length} workspace / ${local.pluginSources.length} source${local.pluginSources.length === 1 ? '' : 's'}`,
    `Cloud ledger  ${local.ledgerRows} resource row${local.ledgerRows === 1 ? '' : 's'}`,
  ];
  if (remote) {
    lines.push(
      `Worker commit ${remote.workerCommit ?? '— (never recorded)'}${remote.workerDeployedAt ? `  (${remote.workerDeployedAt})` : ''}`,
      `Core commit   ${remote.coreCommit ?? '—'}`,
      `Migrations    ${remote.recordedMigrationCount} recorded applied`,
    );
  } else {
    lines.push('Deployment    — (Supabase not reachable — no PAT / no SUPABASE_URL)');
  }
  p.log.message('Installation & deployment state:\n' + lines.map((l) => `  • ${l}`).join('\n'));
}

// ─── Maintenance menu ────────────────────────────────────────────────────────

const MENU = [
  { value: 'integrity', label: 'Integrity check (registries + binding consistency)', hint: 're-run the audit' },
  { value: 'update', label: 'Update core + plugins + build + deploy', hint: 'npm run update' },
  { value: 'update:core', label: 'Update core only', hint: 'npm run update:core' },
  { value: 'update:plugins', label: 'Update plugins only', hint: 'npm run update:plugins -- --all' },
  { value: 'install', label: 'Install a plugin', hint: 'npm run plugin:install' },
  { value: 'remove', label: 'Remove a plugin', hint: 'npm run plugin:remove' },
  { value: 'provision', label: 'Provision plugin bindings', hint: 'npm run bindings:provision' },
  { value: 'drift', label: 'Check remote binding drift', hint: 'npm run bindings:check' },
  { value: 'state', label: 'Re-check deployment states', hint: 'npm run state:recheck' },
  { value: 'migrations', label: 'Apply pending core migrations', hint: 'npm run migrations' },
  { value: 'deploy', label: 'Deploy to Cloudflare', hint: 'npm run deploy' },
  { value: 'auth', label: 'Diagnose auth hook', hint: 'npm run auth:check' },
  { value: 'resetup', label: 'Re-run first-time setup (reconfigure)', hint: 'rewrites wrangler.jsonc' },
  { value: 'quit', label: 'Quit', hint: undefined },
];

async function runMaintenanceTui() {
  p.intro('Specy — setup & maintenance');

  let db = null;
  try {
    db = await createPatDb();
    // Retain the PAT in-memory for the rest of the session so repeated
    // state refreshes / delegated sub-processes don't re-prompt.
    if (db) process.env.SUPABASE_ACCESS_TOKEN = db.pat;
  } catch {
    db = null;
  }

  for (;;) {
    const local = readLocalState();
    const remote = await readRemoteDeployment(db);
    showStateSummary(local, remote);
    runIntegrityCheck();

    const action = await p.select({
      message: 'What would you like to do?',
      options: MENU,
    });

    if (p.isCancel(action) || action === 'quit') break;

    switch (action) {
      case 'integrity':
        runIntegrityCheck();
        break;
      case 'update':
        nodeScript('update.mjs');
        db = await createPatDb();
        break;
      case 'update:core':
        nodeScript('cf-update.mjs');
        break;
      case 'update:plugins':
        nodeScript('update-plugins.mjs', ['--all']);
        break;
      case 'install':
        nodeScript('install-plugins.mjs');
        break;
      case 'remove':
        nodeScript('uninstall-plugin.mjs');
        break;
      case 'provision':
        nodeScript('provision-bindings.mjs');
        break;
      case 'drift':
        nodeScript('provision-bindings.mjs', ['--check-remote']);
        break;
      case 'state':
        nodeScript('state-recheck.mjs');
        break;
      case 'migrations':
        nodeScript('migrate.mjs');
        break;
      case 'deploy':
        nodeScript('deploy.mjs');
        break;
      case 'auth':
        nodeScript('auth-diagnostics.mjs');
        break;
      case 'resetup':
        await runFirstTimeSetup();
        break;
    }
  }

  p.outro('Done — re-run `npm run setup` any time.');
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  const phase = detectPhase();

  if (phase === 'fresh') {
    p.intro('Specy — first-time setup');
    p.note(
      'No deployment is configured yet (wrangler.jsonc missing or still contains placeholders).\nStarting the first-time setup wizard.',
      'Fresh checkout detected',
    );
    await runFirstTimeSetup();
  } else {
    await runMaintenanceTui();
  }
}

// Only dispatch when invoked directly — importing this module (e.g. from tests)
// must be side-effect free, matching the other scripts in scripts/.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}
