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
import { detectPhase, readLocalState, readUncommittedMigrations, formatGitStatusLine } from './lib/state.mjs';
import { runFirstTimeSetup } from './lib/first-time-setup.mjs';
import { rebuildWorkspacePluginArtifacts, scanWorkspacePlugins, WRANGLER_CONFIG_FILE } from './lib/plugin-workspace.mjs';
import { auditBindingConsistency, printBindingAuditReport } from './lib/binding-consistency.mjs';
import { readLedgerFromPath } from './lib/binding-provisioner.mjs';
import { parseJsoncConfig } from './lib/wrangler-config.mjs';
import { createPatDb } from './lib/remote-sql.mjs';
import { fetchCoreUpdateState } from './lib/core-update.mjs';
import { readDeploymentState, summarizeDeploymentRows } from './lib/deployment-state.mjs';

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

  // 3. Tooling unit tests — the suites that guard the systems this integrity
  //    check itself inspects (registries, bindings, claims, state, migrations,
  //    wrangler config). Runs the full suites; on failure only a condensed
  //    report is printed (full output via `npm test`).
  runIntegrityTests();
  return audit;
}

// ─── Integrity test gate ─────────────────────────────────────────────────────

/**
 * Test suites covering the tooling systems the integrity check reports on.
 * Kept as an explicit list (not a glob) so the TUI gate stays deterministic
 * and fast; extend when a new tooling suite lands.
 */
const INTEGRITY_TEST_SUITES = [
  'bindingConsistency',
  'bindingDrift',
  'bindingIntents',
  'coreMigrations',
  'deploymentState',
  'exposedSchemas',
  'pluginClaimsRegistry',
  'pluginClaimMatching',
  'pluginInstallerPat',
  'secretsStores',
  'secretsStoreSecretId',
  'state',
  'updateTooling',
  'workerName',
  'wranglerConfig',
]
  .map((name) => join(ROOT, 'tests', `${name}.test.mjs`))
  .filter((file) => existsSync(file));

function runIntegrityTests() {
  p.log.message('Unit tests (tooling integrity suites):');
  const res = spawnSync(process.execPath, ['--test', ...INTEGRITY_TEST_SUITES], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 120_000,
  });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  // Anchor at line end: the `ℹ tests 26` / `ℹ pass 26` summary lines end with
  // the number, while test names are followed by `(duration)`. The m-flag +
  // `$` anchor keeps a passing test named like "tests 5" from polluting counts.
  const count = (label) => {
    const m = output.match(new RegExp(`${label}\\s+(\\d+)\\s*$`, 'm'));
    return m ? Number(m[1]) : null;
  };

  if (res.status === 0 && !res.error) {
    const pass = count('pass') ?? count('tests') ?? '?';
    p.log.success(`  all tooling suites passed (${pass} tests)`);
    return true;
  }

  const timedOut = res.error?.code === 'ETIMEDOUT';
  p.log.error(timedOut
    ? '  tooling suites timed out (120s) — run `npm test` for details'
    : `  tooling suites FAILED (${count('pass') ?? 0} passed, ${count('fail') ?? '?'} failed) — run \`npm test\` for the full output`);

  const failedFiles = [...new Set([...output.matchAll(/(tests[\\/][^\s"']+\.test\.mjs)/g)].map((m) => m[1].replaceAll('\\', '/')))];
  const failing = [...new Set([...output.matchAll(/^\s*✖\s+(.+)$/gm)].map((m) => m[1].trim()))];
  if (failedFiles.length) p.log.message(`  affected: ${failedFiles.slice(0, 8).join(', ')}${failedFiles.length > 8 ? ' …' : ''}`);
  if (failing.length) p.log.message(`  failing: ${failing.slice(0, 8).join(' · ')}${failing.length > 8 ? ' …' : ''}`);
  return false;
}

// ─── State summary ───────────────────────────────────────────────────────────

/**
 * Read the recorded remote deployment truth for the state footer.
 *
 * Primary source is the typed `public.deployment_state` registry (core AND
 * plugin rows, see specs/changes/2026-09-11-setup-tui-state-summary.md).
 * Falls back to the legacy `system_config.core_update` shim when the table
 * does not exist yet (pre-migration projects) — that store is core-only by
 * construction, so `plugins` is empty there.
 *
 * @returns {null | { source: 'deployment_state'|'legacy',
 *            coreMigrations: number, edgeFunctions: number,
 *            workerCommit: string|null, workerDeployedAt: string|null,
 *            coreCommit: string|null,
 *            plugins: {slug, version, migrations, bindings, claims}[] }}
 */
async function readRemoteDeployment(db) {
  if (!db) return null;
  try {
    const ds = await readDeploymentState(db.projectRef, db.pat);
    if (ds.available) {
      return { source: 'deployment_state', ...summarizeDeploymentRows(ds.rows) };
    }
  } catch {
    // fall through to the legacy shim
  }
  try {
    const remote = await fetchCoreUpdateState(db.projectRef, db.pat);
    if (!remote.available) return null;
    const worker = remote.state.get('deployment:worker');
    const core = remote.state.get('deployment:core_commit');
    const functions = remote.state.get('deployment:functions');
    return {
      source: 'legacy',
      workerCommit: worker?.commit ?? null,
      workerDeployedAt: worker?.deployedAt ?? null,
      coreCommit: core?.commit ?? null,
      edgeFunctions: functions ? 1 : 0,
      coreMigrations: [...remote.state.keys()].filter((k) => k.startsWith('migration:')).length,
      plugins: [],
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
    `Git          ${formatGitStatusLine(local.git)}`,
    `Plugins       ${local.workspacePlugins.length} workspace / ${local.pluginSources.length} source${local.pluginSources.length === 1 ? '' : 's'}`,
    `Cloud ledger  ${local.ledgerRows} resource row${local.ledgerRows === 1 ? '' : 's'}`,
  ];
  if (remote) {
    lines.push(
      `Worker commit ${remote.workerCommit ?? '— (never recorded)'}${remote.workerDeployedAt ? `  (${remote.workerDeployedAt})` : ''}`,
      `Core commit   ${remote.coreCommit ?? '—'}`,
      `Migrations    ${remote.coreMigrations ?? 0} recorded applied`,
      `Edge funcs    ${remote.edgeFunctions ?? 0} recorded`,
    );
    if (remote.plugins.length) {
      for (const plugin of remote.plugins) {
        const parts = [
          plugin.version ? `v${plugin.version}` : 'version not recorded',
          `${plugin.migrations} migration${plugin.migrations === 1 ? '' : 's'} recorded`,
          `${plugin.bindings} binding${plugin.bindings === 1 ? '' : 's'} recorded`,
        ];
        if (plugin.claims) parts.push('claims recorded');
        lines.push(`Plugin state ${plugin.slug}  ·  ${parts.join(' · ')}`);
      }
    } else if (remote.source === 'deployment_state') {
      lines.push('Plugin state  — (none recorded — run npm run state:recheck --sync to backfill)');
    }
  } else {
    lines.push('Deployment    — (Supabase not reachable — no PAT / no SUPABASE_URL)');
  }
  p.log.message('Installation & deployment state:\n' + lines.map((l) => `  • ${l}`).join('\n'));
}

// ─── Migration guards ───────────────────────────────────────────────────────

/**
 * Pre-flight guard before applying core migrations: refuse to silently apply
 * uncommitted migration SQL. Applying a migration that exists only on disk
 * (not in git) records its state in the DB while the file can be lost on a
 * checkout — divergence the state tracker would then report forever.
 */
async function runMigrationsWithGuards() {
  const uncommitted = readUncommittedMigrations();
  if (uncommitted.length > 0) {
    p.log.warning(`Uncommitted migration files (${uncommitted.length}):`);
    for (const { status, path } of uncommitted.slice(0, 10)) {
      p.log.message(`    ${status === '??' ? '+' : '~'} ${path}  (${status})`);
    }
    if (uncommitted.length > 10) p.log.message(`    … and ${uncommitted.length - 10} more`);
    const proceed = await p.confirm({
      message: 'Apply migrations anyway? Commit or stash the files first for a clean state trail.',
      initialValue: false,
    });
    if (p.isCancel(proceed) || !proceed) {
      p.log.info('Aborted — commit the migration files first (see specs/plugins/development.md and AGENTS.md §5).');
      return;
    }
  }
  nodeScript('migrate.mjs');
}

// ─── Maintenance menu ────────────────────────────────────────────────────────

const MENU = [
  { value: 'integrity', label: 'Integrity check (registries + binding consistency)', hint: 're-run the audit' },
  { value: 'update', label: 'Update core + plugins + build + deploy', hint: 'npm run update' },
  { value: 'update:core', label: 'Update core only', hint: 'npm run update:core' },
  { value: 'update:plugins', label: 'Update plugins only', hint: 'npm run update:plugins -- --all' },
  { value: 'install', label: 'Install a plugin', hint: 'npm run plugin:install' },
  { value: 'remove', label: 'Remove a plugin', hint: 'unregister (keep files) or full uninstall' },
  { value: 'provision', label: 'Provision plugin bindings', hint: 'npm run bindings:provision' },
  { value: 'drift', label: 'Check remote binding drift', hint: 'npm run bindings:check' },
  { value: 'state', label: 'Re-check deployment states', hint: 'dry-run or repair (--sync)' },
  { value: 'migrations', label: 'Apply pending core migrations', hint: 'npm run migrations' },
  { value: 'snapshots', label: 'DB Snapshots', hint: 'create / restore database snapshots (/data/snapshots)' },
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
      case 'remove': {
        const plugins = scanWorkspacePlugins();
        const sources = readLocalState().pluginSources;
        const options = [
          ...plugins.map((pl) => ({
            value: pl.id,
            label: `${pl.id}  (workspace)`,
            hint: `plugins/${pl.dirName}${pl.manifest?.version ? ` · v${pl.manifest.version}` : ''}`,
          })),
          ...sources
            .filter((s) => !plugins.some((pl) => pl.id === s.id))
            .map((s) => ({ value: s.id, label: `${s.id}  (source)`, hint: s.repo_url ?? undefined })),
        ];
        if (options.length === 0) {
          p.log.info('No plugins installed — nothing to remove.');
          break;
        }
        const target = await p.select({
          message: 'Which plugin should be removed?',
          options,
        });
        if (p.isCancel(target)) break;
        const mode = await p.select({
          message: `How should "${target}" be removed?`,
          options: [
            { value: 'keep', label: 'Unregister (keep files)', hint: 'cleanly unregistered — re-installable by moving the folder back' },
            { value: 'full', label: 'Full uninstall (delete files)', hint: 'also deletes plugins/<id>/ from disk' },
          ],
        });
        if (p.isCancel(mode)) break;
        nodeScript('uninstall-plugin.mjs', mode === 'keep' ? [target, '--keep-files'] : [target]);
        break;
      }
      case 'provision':
        nodeScript('provision-bindings.mjs');
        break;
      case 'drift':
        nodeScript('provision-bindings.mjs', ['--check-remote']);
        break;
      case 'state': {
        const mode = await p.select({
          message: 'Re-check deployment states — how should it run?',
          options: [
            { value: 'report', label: 'Report only (dry-run)', hint: 'list unrecorded / drifted / stale rows — no writes' },
            { value: 'sync', label: 'Repair (sync)', hint: 'backfill unrecorded, re-record drifted, delete stale plugin rows' },
          ],
        });
        if (p.isCancel(mode)) break;
        nodeScript('state-recheck.mjs', mode === 'sync' ? ['--sync'] : []);
        break;
      }
      case 'migrations':
        await runMigrationsWithGuards();
        break;
      case 'snapshots':
        nodeScript('snapshots.mjs');
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
