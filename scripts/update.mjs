#!/usr/bin/env node
/**
 * update.mjs — npm run update
 *
 * Combined repo update for prod deployments:
 *   1. Core update: git pull + pending core migrations + edge functions
 *      (delegates to scripts/cf-update.mjs, which verifies remote, worktree,
 *      checksum-based migration state and drift)
 *   2. Plugin update: TUI checklist — pick which workspace plugins to update
 *      (git pull, migration validation + apply via Supabase Management API)
 *   3. Optional build + deploy
 *
 * One Supabase PAT is requested up front and shared by both phases
 * (SUPABASE_ACCESS_TOKEN env passthrough — never written to disk).
 *
 * Flags (forwarded to cf-update.mjs):
 *   --skip-build --skip-deploy --skip-functions --skip-migrations --dry-run …
 *   --skip-core            Run only the plugin phase
 *   --skip-plugins         Run only the core phase
 *   --allow-dirty          Forwarded to cf-update.mjs
 */

import { spawnSync } from 'child_process';
import { join } from 'path';
import { pathToFileURL } from 'url';
import * as p from '@clack/prompts';
import {
  createPatDb,
  getSupabaseUrl,
  patQuery,
  resolvePat,
  info,
  okMsg,
  warn,
} from './lib/remote-sql.mjs';
import { sqlStr } from './lib/sqlStr.mjs';
import {
  checkGitUpdate,
  detectUpdatablePlugins,
  updatePlugin,
} from './update-plugins.mjs';
import { rebuildWorkspacePluginArtifacts, scanWorkspacePlugins, WRANGLER_CONFIG_FILE } from './lib/plugin-workspace.mjs';
import { auditBindingConsistency, printBindingAuditReport } from './lib/binding-consistency.mjs';
import { readLedgerFromPath } from './lib/binding-provisioner.mjs';

const ROOT = join(import.meta.dirname, '..');

const args = process.argv.slice(2);
const options = {
  skipCore: args.includes('--skip-core'),
  skipPlugins: args.includes('--skip-plugins'),
  dryRun: args.includes('--dry-run'),
};

const forwardArgs = args.filter(
  (a) => !['--skip-core', '--skip-plugins', '--dry-run'].includes(a),
);

async function runCoreUpdate() {
  p.log.step('Phase 1/3 — Core update (git pull, migrations, edge functions)');
  const cfUpdate = join(ROOT, 'scripts', 'cf-update.mjs');
  const res = spawnSync(process.execPath, [cfUpdate, ...forwardArgs], {
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) {
    p.log.error(`Core update failed (exit ${res.status}). Aborting — plugin phase skipped.`);
    return false;
  }
  return true;
}

async function runPluginUpdate(db) {
  p.log.step('Phase 2/3 — Plugin updates');

  const detected = detectUpdatablePlugins();
  if (!detected.length) {
    p.log.info('No updatable plugins found — skipping.');
    return true;
  }

  // Behind-status for the checklist hints
  const items = [];
  for (const item of detected) {
    let hint = '';
    if (item.source === 'git') {
      const status = checkGitUpdate(item.dir);
      hint = status.error
        ? status.error
        : status.behind
          ? `${status.behind} commit(s) behind — v${item.before ?? '?'}`
          : `up to date — v${item.before ?? '?'}`;
    } else if (item.source === 'registry') {
      hint = 'registry-only (not installed locally)';
    } else {
      hint = `local, no git — v${item.before ?? '?'}`;
    }
    items.push({ value: item.id, label: item.id, hint });
  }

  if (options.dryRun) {
    for (const item of items) {
      p.log.info(`${item.label}: ${item.hint}`);
    }
    p.log.info('Dry run — no changes applied.');
    return true;
  }

  const selected = await p.multiselect({
    message: 'Which plugins should be updated? (space = toggle, a = all, enter = confirm)',
    options: items,
    required: false,
  });
  if (p.isCancel(selected)) {
    p.cancel('Plugin update cancelled.');
    return true;
  }
  if (!selected.length) {
    p.log.info('No plugins selected — skipping plugin phase.');
    return true;
  }

  const spinner = p.spinner();
  const summary = [];
  for (const id of selected) {
    const item = detected.find((d) => d.id === id);
    spinner.start(`Updating ${id}…`);
    try {
      const result = await updatePlugin(item, db);
      if (result.error) {
        spinner.stop(`${id}: failed`, 1);
        p.log.error(`${id}: ${result.error}`);
        summary.push(`${id}: FAILED — ${result.error.split('\n')[0]}`);
      } else if (result.skipped) {
        spinner.stop(`${id}: ${result.skipped}`);
        summary.push(`${id}: ${result.skipped}`);
      } else {
        spinner.stop(`${id}: ${result.updated ? 'updated' : 'processed'} → v${result.version ?? '?'}` +
          (result.migrations?.length ? `, ${result.migrations.length} migration(s)` : ''));
        summary.push(`${id}: v${result.version ?? '?'}${result.migrations?.length ? `, ${result.migrations.length} migration(s) applied` : ''}`);
        for (const w of result.warnings ?? []) p.log.warn(`${id}: ${w}`);
      }
    } catch (e) {
      spinner.stop(`${id}: failed`, 1);
      p.log.error(`${id}: ${e.message}`);
      summary.push(`${id}: FAILED — ${e.message.split('\n')[0]}`);
    }
  }

  rebuildWorkspacePluginArtifacts();
  p.log.info('Plugin registry artifacts rebuilt.');

  // ── Binding pipeline: provision + full consistency audit (dynamic, no manual steps) ──
  // Updated manifests may declare new/changed wrangler_intents — provision any
  // un-provisioned instances for this environment, then audit ALL moving parts.
  try {
    const { provisionPluginBindingIntents } = await import('./install-plugins.mjs');
    await provisionPluginBindingIntents();
  } catch (e) {
    p.log.warn(`Binding provisioning step failed: ${e.message} — continuing with the audit.`);
  }

  p.log.step('Binding consistency check');
  try {
    const { parseJsoncConfig } = await import('./lib/wrangler-config.mjs');
    const { existsSync, readFileSync } = await import('fs');
    const audit = auditBindingConsistency({
      plugins: scanWorkspacePlugins(),
      wranglerJsoncPath: WRANGLER_CONFIG_FILE,
      ledger: readLedgerFromPath(ROOT),
      // The registry rebuild just re-synced the config — audit it fully.
      config: existsSync(WRANGLER_CONFIG_FILE) ? parseJsoncConfig(readFileSync(WRANGLER_CONFIG_FILE, 'utf8')) : null,
    });
    printBindingAuditReport(audit, { log: (m) => p.log.info(m.replace(/\x1b\[[0-9;]*m/g, '')) });
    if (audit.consistent) {
      p.log.success('All binding moving parts consistent.');
    } else {
      p.log.warn('Pending binding items above — run npm run bindings:provision, then rebuild. The build & deploy phase re-audits automatically.');
    }
  } catch (e) {
    p.log.warn(`Binding consistency check failed: ${e.message}`);
  }

  p.log.message(
    'Plugin update summary:\n' + summary.map((line) => `  • ${line}`).join('\n'),
  );
  return true;
}

async function runBuildAndDeploy() {
  p.log.step('Phase 3/3 — Build & deploy');

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  const build = await p.confirm({ message: 'Run `npm run build` now?' });
  if (!p.isCancel(build) && build) {
    const res = spawnSync(npmCmd, ['run', 'build'], { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' });
    if (res.status !== 0) {
      p.log.error('Build failed — deploy skipped.');
      return;
    }
  } else {
    p.log.warn('Skipped build — remember it before deploying.');
  }

  // Pre-deploy remote drift check — the same diff wrangler deploy prompts about,
  // reported first so the deploy prompt holds no surprises. Non-fatal when the
  // token is unavailable.
  try {
    const { runRemoteDriftCheck } = await import('./lib/binding-consistency-remote.mjs');
    await runRemoteDriftCheck({ ROOT, log: (m) => p.log.info(m) });
  } catch (e) {
    p.log.warn(`Remote drift check skipped: ${e.message}`);
  }

  const deploy = await p.confirm({ message: 'Deploy with `npx wrangler deploy`?' });
  if (!p.isCancel(deploy) && deploy) {
    spawnSync('npx', ['wrangler', 'deploy'], { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' });
  }
}

async function main() {
  p.intro('Specy update — core + plugins');

  if (!getSupabaseUrl()) {
    p.log.error('SUPABASE_URL not found in .env — cannot run updates.');
    process.exitCode = 1;
    return;
  }

  // One PAT for both phases (cf-update reads SUPABASE_ACCESS_TOKEN).
  const pat = await resolvePat();
  if (pat) process.env.SUPABASE_ACCESS_TOKEN = pat;
  const db = pat ? await createPatDb() : null;
  if (pat && !db) {
    p.log.warn('PAT verification failed — proceeding, but migration phases will skip DB work.');
  }

  let coreOk = true;
  if (options.skipCore) {
    p.log.info('Core phase skipped (--skip-core).');
  } else {
    coreOk = await runCoreUpdate();
  }

  if (!coreOk) {
    p.outro('Update aborted after core phase.');
    process.exitCode = 1;
    return;
  }

  if (options.skipPlugins) {
    p.log.info('Plugin phase skipped (--skip-plugins).');
  } else {
    await runPluginUpdate(db);
  }

  if (options.dryRun) {
    p.outro('Dry run complete — nothing changed.');
    return;
  }

  await runBuildAndDeploy();
  p.outro('Update finished.');
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}
