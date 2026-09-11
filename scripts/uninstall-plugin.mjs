#!/usr/bin/env node
/**
 * uninstall-plugin.mjs
 *
 * Cleanly removes an installed plugin from the CMS.
 *
 * Usage:
 *   node scripts/uninstall-plugin.mjs <plugin-id>               # remove plugin
 *   node scripts/uninstall-plugin.mjs <plugin-id> --keep-files  # unregister only, keep plugins/{id}/
 *   node scripts/uninstall-plugin.mjs <plugin-id> --prune-deps  # also npm uninstall its deps
 *   node scripts/uninstall-plugin.mjs --list                    # show installed plugins
 *   node scripts/uninstall-plugin.mjs --help                    # show usage
 *
 * What it does:
 *   1. Reads the plugin manifest to collect deps, api_entrypoint, and migrations
 *   2. Deletes plugins/{id}/  (--keep-files: moves it to plugins/.uninstalled/{id}/
 *      instead — unregistered but re-installable by moving the directory back)
 *   3. Removes the entry from plugins.json
 *   4. Rebuilds generated plugin registry artifacts
 *   5. (--prune-deps) npm-uninstalls packages not used by any other plugin
 *   6. Prints manual cleanup steps (API route in api/index.ts, Supabase migrations)
 *
 * After running you MUST rebuild and redeploy:
 *   npm run build
 *   npx wrangler deploy
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { cp, mkdir, rename, rm } from 'fs/promises';
import { spawn } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { rebuildWorkspacePluginArtifacts, scanWorkspacePlugins, WORKSPACE_PLUGINS_DIR } from './lib/plugin-workspace.mjs';
import { sqlStr } from './lib/sqlStr.mjs';
import { deletePluginDeploymentState } from './lib/deployment-state.mjs';
import { loadDotEnv } from './lib/env.mjs';
import { promptSecret } from './lib/prompts.mjs';
import {
  createPatDb,
  extractProjectRef,
  patQuery,
  runSqlQuery,
} from './lib/remote-sql.mjs';
import { unexposePluginSchema } from './lib/exposed-schemas.mjs';
import {
  collectSqlFiles,
  escapeRegExp,
  getAllowedPluginSchemas,
  stripSqlComments,
  validateMigrationSchemaUsage,
} from './lib/migration-validation.mjs';

const __dirname          = dirname(fileURLToPath(import.meta.url));
const ROOT               = resolve(__dirname, '..');
const PLUGINS_JSON       = join(ROOT, 'plugins.json');
const PLUGINS_DIR        = WORKSPACE_PLUGINS_DIR;
const PLUGIN_DEPS_FILE   = join(ROOT, 'plugin-deps.json');

async function markPluginUninstalled(db, slug) {
  if (!db) return;
  try {
    await patQuery(db, `UPDATE plugins SET status = 'registered', installed_at = NULL WHERE slug = ${sqlStr(slug)}`);
    ok(`  DB status \u2192 registered  (installed_at cleared)`);
  } catch (e) {
    warn(`  Could not update DB status for "${slug}": ${e.message}`);
  }
}

function inspectMigrationCompliance(pluginDir, slug) {
  const migrationsDir = join(pluginDir, 'migrations');
  if (!existsSync(migrationsDir)) {
    return { upMigrations: [], downMigrations: null, issues: [] };
  }

  const upMigrations = collectSqlFiles(migrationsDir, `src/plugins/${slug}/migrations`);
  const downDir = join(migrationsDir, 'down');
  const downMigrations = existsSync(downDir)
    ? collectSqlFiles(downDir, `src/plugins/${slug}/migrations/down`).reverse()
    : null;
  const issues = [];
  const allowedSchemas = getAllowedPluginSchemas(slug);

  if (upMigrations.length > 0) {
    if (!downMigrations) {
      issues.push(`Missing required directory: src/plugins/${slug}/migrations/down/`);
    } else {
      const downNames = new Set(downMigrations.map((migration) => migration.name));
      for (const migration of upMigrations) {
        if (!downNames.has(migration.name)) {
          issues.push(`${migration.file}: missing matching rollback at src/plugins/${slug}/migrations/down/${migration.name}`);
        }
      }
      if (!downMigrations.length) {
        issues.push(`src/plugins/${slug}/migrations/down/ is empty; explicit rollback files are required.`);
      }
    }

    const schemaDefined = upMigrations.some((migration) => {
      const sql = stripSqlComments(migration.sql);
      return allowedSchemas.some((schema) => {
        const schemaPattern = new RegExp(`\\bCREATE\\s+SCHEMA\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:AUTHORIZATION\\s+)?"?${escapeRegExp(schema)}"?\\b`, 'i');
        return schemaPattern.test(sql);
      });
    });
    if (!schemaDefined) {
      issues.push(`Missing CREATE SCHEMA for plugin schema (${allowedSchemas.join(' or ')}) in forward migrations.`);
    }
  }

  issues.push(...validateMigrationSchemaUsage(upMigrations, slug));
  if (downMigrations) issues.push(...validateMigrationSchemaUsage(downMigrations, slug));

  return { upMigrations, downMigrations, issues };
}

// Returns true if migrations were applied (or there was nothing to apply), false if skipped/failed.
async function applyDownMigrations(slug, downMigs, hasUpMigs, existingPat = null) {
  if (!hasUpMigs) return true;
  if (downMigs === null) {
    warn(`No migrations/down/ directory found for "${slug}" — manual database rollback is required.`);
    return false;
  }
  if (!downMigs.length) {
    warn(`migrations/down/ is empty for "${slug}" — manual database rollback is required.`);
    return false;
  }

  const env = loadDotEnv();
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? env['VITE_SUPABASE_URL']
                   ?? process.env.SUPABASE_URL      ?? env['SUPABASE_URL'];

  log('');
  info(`Found ${downMigs.length} down-migration(s) for "${slug}":`);
  downMigs.forEach(({ file }) => log(`  ${c.yellow}>${c.reset} ${file}`));

  if (!supabaseUrl) {
    warn('SUPABASE_URL not found in .env — apply the down-migrations manually via Supabase Dashboard → SQL Editor.');
    return false;
  }

  if (!process.stdin.isTTY && !existingPat) {
    warn('Non-interactive mode — apply down-migrations manually.');
    return false;
  }

  // Create the readline interface ONLY when actually prompting — a dangling
  // interface on process.stdin keeps the event loop alive, so the process
  // would never exit (which froze the setup TUI's spawnSync at the deploy
  // instruction when a PAT was already available via existingPat).
  const doApply = existingPat ? 'y' : await new Promise((resolve) => {
    const rl1 = createInterface({ input: process.stdin, output: process.stdout });
    rl1.question(`${c.yellow}?${c.reset}  Apply these down-migrations now? [y/N] `, (a) => { rl1.close(); resolve(a.trim().toLowerCase()); });
  });
  if (doApply !== 'y' && doApply !== 'yes') {
    info('Skipped — apply the down-migrations manually via Supabase Dashboard → SQL Editor.');
    return false;
  }

  let pat = existingPat;
  if (!pat) {
    log('');
    info('Supabase personal access token (PAT) required for the Management API.');
    log(`  Create one at: ${c.cyan}https://supabase.com/dashboard/account/tokens${c.reset}`);
    log(`  ${c.yellow}PATs start with sbp_ or sb_pat_ — do NOT use your anon/secret keys.${c.reset}`);
    log(`  The token is only used locally for this operation and is never stored.`);
    log('');
    pat = await promptSecret(`${c.cyan}Supabase PAT:${c.reset} `);
  }
  if (!pat || pat.length < 10) {
    warn('No PAT entered — skipping. Apply the down-migrations manually if needed.');
    return false;
  }

  const projectRef = extractProjectRef(supabaseUrl);
  if (!projectRef) { warn('Could not extract project ref from SUPABASE_URL.'); return false; }

  log('');
  for (const { file, sql } of downMigs) {
    process.stdout.write(`  Applying ${c.yellow}${file}${c.reset}… `);
    try {
      await runSqlQuery(projectRef, pat, sql);
      process.stdout.write(`${c.green}✓${c.reset}\n`);
    } catch (err) {
      process.stdout.write(`${c.red}✗${c.reset}\n`);
      warn(`  Failed: ${err.message}`);
      const rl2 = createInterface({ input: process.stdin, output: process.stdout });
      const cont = await new Promise((resolve) => {
        rl2.question(`${c.yellow}?${c.reset}  Continue with remaining? [y/N] `, (a) => { rl2.close(); resolve(a.trim().toLowerCase()); });
      });
      if (cont !== 'y' && cont !== 'yes') { warn('Down-migrations aborted.'); return false; }
    }
  }
  ok('Down-migrations applied ✓');
  return true;
}

// ─── plugin-deps.json helpers ─────────────────────────────────────────────────
function readPluginDeps() {
  if (!existsSync(PLUGIN_DEPS_FILE)) return {};
  try { return JSON.parse(readFileSync(PLUGIN_DEPS_FILE, 'utf8')); } catch { return {}; }
}
function writePluginDeps(data) {
  writeFileSync(PLUGIN_DEPS_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ─── Colours ──────────────────────────────────────────────────────────────────
const c = { reset:'\x1b[0m', bold:'\x1b[1m', red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m', cyan:'\x1b[36m' };
const log  = (...a) => console.log(...a);
const info = (m) => log(`${c.cyan}i${c.reset}  ${m}`);
const ok   = (m) => log(`${c.green}✓${c.reset}  ${m}`);
const warn = (m) => log(`${c.yellow}!${c.reset}  ${m}`);
const fail = (m) => log(`${c.red}✗${c.reset}  ${m}`);
const die  = (m) => { fail(m); process.exit(1); };

// ─── plugins.json helpers ─────────────────────────────────────────────────────

function readPluginsJson() {
  if (!existsSync(PLUGINS_JSON)) return { version: '1', description: 'Remote plugin sources for installer use.', plugins: [] };
  try { return JSON.parse(readFileSync(PLUGINS_JSON, 'utf8')); }
  catch (e) { die(`Failed to parse plugins.json: ${e.message}`); }
}

function writePluginsJson(data) {
  writeFileSync(PLUGINS_JSON, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ─── Manifest helpers ─────────────────────────────────────────────────────────

function loadManifest(pluginDir) {
  const mp = join(pluginDir, 'plugin.json');
  if (!existsSync(mp)) return null;
  try { return JSON.parse(readFileSync(mp, 'utf8')); }
  catch { return null; }
}

/** Collect packages from plugin-deps.json that are NOT used by any remaining plugin. */
function orphanedDeps(removedId) {
  const deps = readPluginDeps();
  const removedPkgs = Object.keys(deps[removedId] ?? {});
  if (!removedPkgs.length) return [];

  // Packages still needed by other plugins
  const stillNeeded = new Set(
    Object.entries(deps)
      .filter(([id]) => id !== removedId)
      .flatMap(([, pkgs]) => Object.keys(pkgs))
  );
  return removedPkgs.filter((pkg) => !stillNeeded.has(pkg));
}

// ─── npm uninstall ────────────────────────────────────────────────────────────

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts });
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`"${cmd}" exited with code ${code}`)));
    proc.on('error', reject);
  });
}

async function pruneDeps(removedId) {
  const toRemove = orphanedDeps(removedId);
  if (!toRemove.length) { info('  No orphaned packages to uninstall.'); return; }

  const deps = readPluginDeps();
  const shared = Object.keys(deps[removedId] ?? {}).filter((p) => !toRemove.includes(p));
  if (shared.length) warn(`  Keeping packages used by other plugins: ${shared.join(', ')}`);

  info(`  Uninstalling orphaned packages: ${toRemove.join(', ')}`);
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    await runCmd(npmCmd, ['uninstall', ...toRemove], { cwd: ROOT });
    ok('  Orphaned packages removed');
  } catch (e) {
    warn(`  npm uninstall failed: ${e.message}`);
    warn(`  Remove manually: npm uninstall ${toRemove.join(' ')}`);
  }
}

// ─── Interactive confirmation ─────────────────────────────────────────────────

function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${c.yellow}?${c.reset}  ${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ─── Commands ───────────────────────────────────────────────────────────────

const RETRYABLE_FS_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EXDEV']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Move a directory with Windows-safe fallbacks.
 *
 * `rename()` on Windows fails with EBUSY/EPERM when ANY file inside the tree
 * has an open handle (editor file watchers, a running `npm run dev`, the
 * search indexer). Strategy:
 *   1. retry the rename a few times — the handles are often transient
 *   2. fall back to recursive copy + delete (copying tolerates read handles)
 *   3. if even the delete fails, remove the copy again and throw — the caller
 *      aborts BEFORE un-registering anything, so no half-registered state
 *
 * @returns {'rename'|'copy'} which strategy succeeded
 */
async function moveDirKeepFiles(src, dest) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await rename(src, dest);
      return 'rename';
    } catch (e) {
      if (!RETRYABLE_FS_CODES.has(e.code) || attempt === 5) break;
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
  await cp(src, dest, { recursive: true, force: true });
  try {
    await rm(src, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    return 'copy';
  } catch (e) {
    // Undo the copy — otherwise the plugin would exist twice and, worse,
    // remain registered from its original location. Retry a little, then warn.
    try {
      await rm(dest, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch {
      warn(`Could not remove the partial copy at ${dest} — it will be overwritten by the next attempt.`);
    }
    throw e;
  }
}

async function cmdList() {
  const plugins = scanWorkspacePlugins();
  if (!plugins.length) { info('No workspace plugins found in /plugins.'); return; }
  log(`\n${c.bold}Workspace plugins:${c.reset}`);
  plugins.forEach((plugin) => {
    log(`  ${c.cyan}${plugin.id}${c.reset}  plugins/${plugin.dirName}`);
  });
  log('');
}

async function cmdUninstall(pluginId, pruneDepsFlag, keepFiles = false) {
  const data    = readPluginsJson();
  const plugins = data.plugins ?? [];
  const entry   = plugins.find((p) => p.id === pluginId) ?? null;
  const pluginDir = join(PLUGINS_DIR, pluginId);

  if (!entry && !existsSync(pluginDir)) {
    die(`Plugin "${pluginId}" not found in /plugins or plugins.json.\nRun --list to see workspace plugins.`);
  }

  // ── Supabase access (best-effort — local cleanup proceeds even without a PAT) ─
  let db = null;
  try {
    db = await createPatDb();
  } catch (e) {
    warn(`Supabase access skipped (${e.message}) \u2014 DB status will not be updated.`);
  }

  const manifest  = existsSync(pluginDir) ? loadManifest(pluginDir) : null;

  // ── Summary ────────────────────────────────────────────────────────────────
  log('');
  log(`${c.bold}Removing plugin: ${pluginId}${c.reset}`);
  if (manifest) {
    log(`  ${manifest.name ?? pluginId}  v${manifest.version ?? '?'}  by ${manifest.author ?? '?'}`);
  }
  log('');

  if (!process.argv.includes('--yes') && !process.argv.includes('-y')) {
    const question = keepFiles
      ? `Unregister "${pluginId}" and move plugins/${pluginId}/ out of the registry (files kept)?`
      : `Remove "${pluginId}" and delete plugins/${pluginId}/?`;
    const confirmed = await confirm(question);
    if (!confirmed) { info('Aborted.'); process.exitCode = 0; return; }
  }

  // ── 1. Collect manual-cleanup info before deleting the directory ───────────
  const apiEntrypoint  = manifest?.api_entrypoint ?? null;
  const migrations     = manifest?.migrations ?? [];
  const migrationCompliance = inspectMigrationCompliance(pluginDir, pluginId);
  const hasUpMigs = migrationCompliance.upMigrations.length > 0;
  const downMigs = migrationCompliance.downMigrations;

  if (migrationCompliance.issues.length > 0) {
    log('');
    warn('Migration compliance issues detected before uninstall:');
    migrationCompliance.issues.forEach((issue) => log(`  ${c.yellow}-${c.reset} ${issue}`));
    warn('This legacy plugin does not meet the current migration rules. Filesystem uninstall will continue, but database cleanup must be reviewed manually.');
  }

  // ── 2. Remove the directory from the workspace registry ──────────────────
  // The generated registries (src/plugins/registry.ts, api/plugin-routes.ts, …)
  // are built from every plugins/<dir> with a manifest — removing the
  // plugins.json entry alone never unregisters anything. Full uninstall
  // deletes the directory; --keep-files moves it to plugins/.uninstalled/<id>/
  // (gitignored via plugins/*/), so the code survives and can be re-installed
  // by moving it back into plugins/.
  if (existsSync(pluginDir)) {
    if (keepFiles) {
      const parkedDir = join(PLUGINS_DIR, '.uninstalled', pluginId);
      try {
        await mkdir(dirname(parkedDir), { recursive: true });
        const strategy = await moveDirKeepFiles(pluginDir, parkedDir);
        ok(`Moved plugins/${pluginId}/ → plugins/.uninstalled/${pluginId}/  (kept for re-install, via ${strategy})`);
      } catch (e) {
        die(`Could not move plugins/${pluginId}/ to plugins/.uninstalled/ (${e.code ?? e.message}).\n`
          + `A process still holds the directory open — close editors, dev servers (npm run dev),\n`
          + `and terminals with a CWD inside plugins/${pluginId}/, then retry.\n`
          + `Aborting — nothing was unregistered.`);
      }
    } else {
      await rm(pluginDir, { recursive: true, force: true });
      ok(`Deleted plugins/${pluginId}/`);
    }
  } else {
    warn(`plugins/${pluginId}/ not found — already deleted?`);
  }

  // ── 3. Remove from plugins.json ────────────────────────────────────────────
  if (entry) {
    data.plugins = plugins.filter((p) => p.id !== pluginId);
    writePluginsJson(data);
    ok(`Removed "${pluginId}" from plugins.json`);
  }

  // ── 4. Rebuild registry + plugin API routes ────────────────────────────────
  rebuildWorkspacePluginArtifacts();

  // ── 5. Clean plugin-deps.json ──────────────────────────────────────────────
  // --keep-files keeps the npm packages installed (re-install readiness);
  // --prune-deps combined with --keep-files is ignored with a notice.
  const effectivePrune = keepFiles ? false : pruneDepsFlag;
  if (keepFiles && pruneDepsFlag) {
    warn('--prune-deps ignored in --keep-files mode — packages stay installed for re-install.');
  }
  const pluginDeps = readPluginDeps();
  if (pluginDeps[pluginId]) {
    const pkgNames = Object.keys(pluginDeps[pluginId]);
    delete pluginDeps[pluginId];
    writePluginDeps(pluginDeps);
    ok(`Removed "${pluginId}" from plugin-deps.json`);

    // ── 6. Optional: prune orphaned npm deps ──────────────────────────────────
    if (effectivePrune) {
      await pruneDeps(pluginId);
    } else if (pkgNames.length > 0) {
      warn(`npm packages from this plugin were NOT removed (pass --prune-deps to remove them):`);
      pkgNames.forEach((p) => log(`    ${c.yellow}-${c.reset} ${p}`));
    }
  } else if (pruneDepsFlag) {
    // Fallback: check manifest directly if plugin-deps.json entry is missing
    const pkgs = manifest?.required_npm_dependencies ? Object.keys(manifest.required_npm_dependencies) : [];
    if (pkgs.length) {
      warn(`"${pluginId}" not in plugin-deps.json — attempting prune from manifest`);
      await pruneDeps(pluginId);
    }
  }

  // ── 5b. Un-expose the plugin schema BEFORE the down-migrations drop it ────
  // PostgREST exposure: the install flow exposes the plugin schema in the
  // Supabase API settings (pgrst.db_schemas / platform config). Down-migrations
  // drop the schema — if it is still exposed at that moment, PostgREST's
  // schema-cache reload fails (PGRST002: all REST queries 503) until the
  // exposure is removed. Clean up FIRST so there is no wedge window.
  let exposedCleanupDone = false;
  if (migrations.length > 0 && hasUpMigs) {
    const pluginSchema = getAllowedPluginSchemas(pluginId)[0] ?? pluginId;
    if (db) {
      try {
        const result = await unexposePluginSchema(db.projectRef, db.pat, pluginSchema);
        if (result.status === 'removed') {
          ok(`  Removed "${pluginSchema}" from API exposed schemas (via ${result.via}) — PostgREST config reloaded.`);
          exposedCleanupDone = true;
        } else if (result.status === 'not-exposed') {
          exposedCleanupDone = true; // nothing to clean up
        } else {
          warn(`  Could not remove "${pluginSchema}" from exposed schemas: ${result.error}`);
        }
      } catch (e) {
        warn(`  Could not clean up exposed schemas: ${e.message}`);
      }
    }
    if (!exposedCleanupDone) {
      warn(`If "${pluginId}" was exposed in Supabase API settings (Exposed schemas), REMOVE it now:`);
      log(`  Dashboard → Project Settings → API → Exposed schemas → uncheck "${pluginSchema}"`);
      log(`  An exposed schema without access/objects wedges PostgREST's schema-cache reload (PGRST002, all REST 503).`);
    }
  }

  // ── 6. Apply down-migrations ─────────────────────────────────────────────
  const migrationsDropped = await applyDownMigrations(pluginId, downMigs, hasUpMigs, db?.pat ?? null);

  // ── 6b. Delete plugin state + claims (clean uninstall, DEPLOYMENT-STATE-
  //        TRACKING.md §6): explicit teardown of DB state; the FK cascade on
  //        plugins(id) is the backstop for hard-deletes. ─────────────────────
  if (db) {
    try {
      await deletePluginDeploymentState(db.projectRef, db.pat, pluginId);
      ok(`  Deployment-state rows for "${pluginId}" removed.`);
    } catch (e) {
      warn(`  Could not delete deployment-state rows for "${pluginId}": ${e.message}`);
    }
    try {
      await patQuery(db, `DELETE FROM public.plugin_claims WHERE plugin_id = ${sqlStr(pluginId)}`);
      ok(`  Claim registry rows for "${pluginId}" removed.`);
    } catch (e) {
      warn(`  Could not delete claim registry rows for "${pluginId}": ${e.message}`);
    }
  }

  // ── 7. Update Supabase status ─────────────────────────────────────────────
  await markPluginUninstalled(db, pluginId);

  // ── 7b. Plugin binding instances (BIPS — specs/platform/binding-management.md) ─
  // The ledger records the per-environment instances the plugin owns. Offer
  // teardown of environment-scoped instances (the downmigration analog for
  // bindings); shared-scoped instances are never deleted — other deployments
  // may link them.
  try {
    const { readLedgerFromPath } = await import('./lib/binding-provisioner.mjs');
    const ledger = readLedgerFromPath(ROOT);
    const rows = (ledger?.resources ?? []).filter((r) => r.plugin_id === pluginId);
    if (rows.length > 0) {
      log('');
      info(`This plugin owns ${rows.length} recorded cloud resource instance(s) in the binding ledger:`);
      for (const row of rows) {
        const scope = row.scope === 'shared' ? 'shared (kept)' : 'environment';
        log(`    ${c.cyan}${row.kind}${c.reset}  ${c.bold}${row.resolved_name}${c.reset}  [${scope}]`);
      }
      warn('Teardown of environment-scoped instances is interactive — run:');
      warn(`  npm run bindings:provision -- --teardown ${pluginId}`);
      warn('Shared-scoped instances are never deleted (other deployments may link them).');
    }
  } catch { /* ledger module/absence is non-fatal for uninstall */ }

  // ── 8. Manual steps summary ────────────────────────────────────────────────
  log('');
  log(`${c.bold}Manual cleanup required:${c.reset}`);

  if (apiEntrypoint) {
    ok(`API route wiring updated — api/plugin-routes.ts rebuilt automatically`);
  } else {
    ok('No API route to remove from api/index.ts');
  }

  if (migrationCompliance.issues.length > 0) {
    warn('Plugin migrations are non-compliant with current uninstall requirements.');
    log('  Review the saved migration files manually and clean up only objects in the plugin schema.');
  }

  if (migrations.length > 0 && !migrationsDropped) {
    warn(`Database tables from this plugin were NOT dropped.`);
      log(`  Apply the plugin's explicit rollback files from migrations/down/ manually via Supabase Dashboard → SQL Editor.`);
  } else if (migrations.length > 0) {
    ok('Database objects dropped successfully');
  } else {
    ok('No database migrations to clean up');
  }

  log('');
  info('Next steps:');
  log('  1. Complete any manual cleanup listed above');
  log('  2. npm run build');
  log('  3. Deploy  (e.g. npx wrangler deploy)');
  if (keepFiles) {
    log('');
    log(`${c.bold}Re-install later:${c.reset}`);
    log(`  1. Move plugins/.uninstalled/${pluginId} back to plugins/${pluginId}`);
    log('  2. npm run build — the generated registries pick it up automatically');
    log('     (re-install re-writes plugins.json, state/claims/bindings rows; migrations are idempotent)');
  }
  log('');
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  log('');
  log('Usage:');
  log('  node scripts/uninstall-plugin.mjs <plugin-id>               Remove a plugin');
  log('  node scripts/uninstall-plugin.mjs <plugin-id> --keep-files  Unregister only — moves plugins/<id>/ to');
  log('                                                              plugins/.uninstalled/<id>/ (files kept, re-installable)');
  log('  node scripts/uninstall-plugin.mjs <plugin-id> --prune-deps  Remove + uninstall its npm packages');
  log('  node scripts/uninstall-plugin.mjs <plugin-id> --yes         Skip confirmation prompt');
  log('  node scripts/uninstall-plugin.mjs --list                    List registered plugins');
  log('');
  log('Examples:');
  log('  node scripts/uninstall-plugin.mjs yatda');
  log('  node scripts/uninstall-plugin.mjs yatda --prune-deps --yes');
  log('');
} else if (args.includes('--list')) {
  await cmdList();
} else {
  const pluginId   = args.find((a) => !a.startsWith('--') && a !== '-y');
  const pruneDeps  = args.includes('--prune-deps');
  const keepFiles  = args.includes('--keep-files');
  if (!pluginId) die('No plugin ID provided. Usage: node scripts/uninstall-plugin.mjs <plugin-id>');
  await cmdUninstall(pluginId, pruneDeps, keepFiles);
}
