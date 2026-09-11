#!/usr/bin/env node
/**
 * install-plugins.mjs
 *
 * Fetches plugins registered in Supabase (public.plugins where status='registered'),
 * lets you pick which ones to install, downloads + wires them up.
 *
 * Usage:
 *   node scripts/install-plugins.mjs               # workspace plugins + DB registry → interactive picker
 *   node scripts/install-plugins.mjs --all         # install all (workspace + registered, CI-safe)
 *   node scripts/install-plugins.mjs --local       # install remote entries from plugins.json (no DB)
 *   node scripts/install-plugins.mjs --add <url>   # register a GitHub URL + install it directly
 *   node scripts/install-plugins.mjs --list        # list plugins (DB + local state)
 *   node scripts/install-plugins.mjs --help        # show usage
 *
 * Environment (.env or .env.local):
 *   VITE_SUPABASE_URL              Supabase project URL
 *   SUPABASE_ACCESS_TOKEN          Supabase PAT (optional — prompted interactively if missing)
 *   GITHUB_TOKEN                   (optional) GitHub PAT — avoids rate-limits, required for private repos
 *
 * DB operations run through the Supabase Management API (/database/query) using a
 * personal access token (PAT, prefix sbp_/sb_pat_). The PAT is read from the
 * SUPABASE_ACCESS_TOKEN env var or prompted once; it is never written to disk.
 * Management API calls execute SQL with project-owner privileges (RLS does NOT apply) —
 * keep the token local and never commit it.
 *
 * After running you MUST rebuild and redeploy:
 *   npm run build
 *   npx wrangler deploy
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { mkdir, rename, rm } from 'fs/promises';
import { spawn } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { createInterface } from 'readline';
import { rebuildWorkspacePluginArtifacts, scanWorkspacePlugins, WORKSPACE_PLUGINS_DIR, WRANGLER_CONFIG_FILE } from './lib/plugin-workspace.mjs';
import { sqlStr } from './lib/sqlStr.mjs';
import { validatePluginMigrations } from './lib/migration-validation.mjs';
import { getAllowedPluginSchemas } from './lib/migration-validation.mjs';
import { exposePluginSchema } from './lib/exposed-schemas.mjs';
import { collectManifestIntents, collectPluginIntents, findLedgerRow, listUnprovisionedIntents, readWorkerName } from './lib/binding-intents.mjs';
import { writeDeploymentState, resolvedIntentsToBindingStateRows } from './lib/deployment-state.mjs';
import { provisionBindingIntents, readLedgerFromPath } from './lib/binding-provisioner.mjs';
import { auditBindingConsistency, printBindingAuditReport } from './lib/binding-consistency.mjs';
import { parseJsoncConfig } from './lib/wrangler-config.mjs';
import { loadDotEnv } from './lib/env.mjs';
import { promptSecret } from './lib/prompts.mjs';
import {
  createPatDb,
  extractProjectRef,
  getSupabaseUrl,
  patQuery,
  runSqlQuery,
} from './lib/remote-sql.mjs';

const __dirname     = dirname(fileURLToPath(import.meta.url));
const ROOT          = resolve(__dirname, '..');
const PLUGINS_JSON       = join(ROOT, 'plugins.json');
const PLUGINS_DIR        = WORKSPACE_PLUGINS_DIR;
const PLUGIN_DEPS_FILE   = join(ROOT, 'plugin-deps.json');

// ─── Colours ──────────────────────────────────────────────────────────────────
const c = { reset:'\x1b[0m', bold:'\x1b[1m', red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m', cyan:'\x1b[36m', dim:'\x1b[2m' };
const log  = (...a) => console.log(...a);
const info = (m) => log(`${c.cyan}i${c.reset}  ${m}`);
const ok   = (m) => log(`${c.green}v${c.reset}  ${m}`);
const warn = (m) => log(`${c.yellow}!${c.reset}  ${m}`);
const fail = (m) => log(`${c.red}x${c.reset}  ${m}`);
const die  = (m) => { fail(m); process.exitCode = 1; throw new FatalError(m); };
// process.exit() after a fetch() crashes on Windows (libuv assertion, exit code 127),
// so die() throws a sentinel instead — the entry point swallows it and lets the
// event loop drain with process.exitCode = 1 already set.
class FatalError extends Error {}

// ─── plugin-deps.json helpers ────────────────────────────────────────────────
// Tracks npm packages installed by plugins, keyed by plugin id.
// Gitignored — keeps plugin deps out of the main package.json.
function readPluginDeps() {
  if (!existsSync(PLUGIN_DEPS_FILE)) return {};
  try { return JSON.parse(readFileSync(PLUGIN_DEPS_FILE, 'utf8')); } catch { return {}; }
}
function writePluginDeps(data) {
  writeFileSync(PLUGIN_DEPS_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ─── DB helpers ──────────────────────────────────────────────────────────────
async function fetchRegisteredPlugins(db) {
  if (!db) return [];
  const rows = await patQuery(
    db,
    `SELECT slug, name, version, description, author_name, repo_url, download_url, status
       FROM plugins
      WHERE status = 'registered'
      ORDER BY name`,
  );
  return rows ?? [];
}

// Upsert the plugin into the plugins table so status updates (installed /
// error) have a row to work with. Workspace-first flow: a plugin that only
// exists locally is registered here before installation completes.
async function ensurePluginRegistered(db, slug, manifest, entry) {
  if (!db) return;
  const repoUrl = entry?.repo_url ?? manifest?.repository ?? null;
  if (!repoUrl) {
    warn(`  Cannot register "${slug}" in the plugins table — no repo_url in entry or manifest.`);
    return;
  }
  try {
    await patQuery(db, `
      INSERT INTO plugins (slug, name, version, description, author_name, license, repo_url, download_url, status)
      VALUES (
        ${sqlStr(slug)},
        ${sqlStr(manifest?.name ?? slug)},
        ${sqlStr(manifest?.version ?? '0.0.0')},
        ${manifest?.description ? sqlStr(manifest.description) : 'NULL'},
        ${manifest?.author ? sqlStr(manifest.author) : 'NULL'},
        ${manifest?.license ? sqlStr(manifest.license) : 'NULL'},
        ${sqlStr(repoUrl)},
        ${manifest?.download_url ? sqlStr(manifest.download_url) : 'NULL'},
        'registered'
      )
      ON CONFLICT (slug) DO NOTHING`);
    ok('  Registered in plugins table');
  } catch (e) {
    warn(`  Could not register "${slug}" in the plugins table: ${e.message}`);
  }
}

async function markPluginInstalled(db, slug, version) {
  if (!db) return;
  try {
    const sets = [`status = 'installed'`, `installed_at = now()`];
    if (version) sets.push(`version = ${sqlStr(version)}`);
    await patQuery(db, `UPDATE plugins SET ${sets.join(', ')} WHERE slug = ${sqlStr(slug)}`);
    ok(`  DB status → installed`);
  } catch (e) {
    warn(`  Could not update DB status for "${slug}": ${e.message}`);
  }
}

function sanitizeConfigSchema(configSchema) {
  if (!Array.isArray(configSchema)) return [];

  return configSchema
    .filter((field) => field && typeof field === 'object' && typeof field.key === 'string' && typeof field.label === 'string')
    .map((field) => ({
      key: field.key.trim(),
      label: field.label.trim(),
      description: typeof field.description === 'string' ? field.description : undefined,
      type: field.type === 'textarea' || field.type === 'url' || field.type === 'secret' ? field.type : 'text',
      required: Boolean(field.required),
      placeholder: typeof field.placeholder === 'string' ? field.placeholder : undefined,
      expose_to_frontend: Boolean(field.expose_to_frontend),
    }))
    .filter((field) => field.key && field.label);
}

async function syncPluginConfigSchema(db, slug, configSchema) {
  if (!db) return;
  try {
    const json = JSON.stringify(sanitizeConfigSchema(configSchema));
    await patQuery(db, `UPDATE plugins SET config_schema = ${sqlStr(json)}::jsonb WHERE slug = ${sqlStr(slug)}`);
    ok('  DB config schema synced');
  } catch (e) {
    warn(`  Could not sync config schema for "${slug}": ${e.message}`);
  }
}

async function markPluginError(db, slug, message) {
  if (!db) return;
  try {
    await patQuery(db, `UPDATE plugins SET status = 'error', error_message = ${sqlStr(message)} WHERE slug = ${sqlStr(slug)}`);
  } catch (e) {
    warn(`  Could not update DB error status for "${slug}": ${e.message}`);
  }
}

// ─── Deployment-state publication (DEPLOYMENT-STATE-TRACKING.md) ────────────
// Write-after-confirm: these run only after the external system (Supabase) has
// already acknowledged the mutation. Non-fatal — state can be repaired later
// with `npm run state:recheck -- --sync`.

async function recordPluginCodeState(db, slug, version) {
  if (!db) return;
  try {
    await writeDeploymentState(db.projectRef, db.pat, [{
      owner: `plugin:${slug}`,
      component: 'code',
      key: 'code',
      value: { status: 'installed', version, provider: 'supabase', deployed_at: new Date().toISOString() },
    }]);
  } catch (e) {
    warn(`  Could not record deployment state for "${slug}": ${e.message}`);
  }
}

async function recordPluginClaimsState(db, slug, manifest) {
  if (!db) return;
  const declarations = manifest?.claims_declarations;
  if (!Array.isArray(declarations) || declarations.length === 0) return;
  try {
    // One top-level JWT key per plugin (claim_key = plugin id) — the registry
    // row, not the individual resolver outputs (see specs/auth/plugin-claims.md).
    await writeDeploymentState(db.projectRef, db.pat, [{
      owner: `plugin:${slug}`,
      component: 'claims',
      key: slug,
      value: { status: 'applied', provider: 'supabase', meta: { count: declarations.length } },
    }]);
  } catch (e) {
    warn(`  Could not record claims state for "${slug}": ${e.message}`);
  }
}

async function recordPluginBindingsState(db) {
  if (!db) return;
  try {
    const plugins = scanWorkspacePlugins();
    const ledger = readLedgerFromPath(ROOT);
    const { resolvedIntents } = collectPluginIntents(plugins, {
      wranglerJsoncPath: WRANGLER_CONFIG_FILE,
      ledger,
    });
    const rows = resolvedIntentsToBindingStateRows(resolvedIntents);
    if (rows.length) await writeDeploymentState(db.projectRef, db.pat, rows);
  } catch (e) {
    warn(`  Could not record binding state: ${e.message}`);
  }
}

// ─── Interactive picker ──────────────────────────────────────────────────────
async function pickPlugins(rows) {
  if (!rows.length) {
    info('No plugins available — nothing in /plugins workspace and no entries with status "registered" in the database.');
    return [];
  }

  log('');
  log(`${c.bold}Available plugins (workspace + Supabase registry):${c.reset}`);
  log('');
  rows.forEach((row, i) => {
    const local = row.local
      ? `  ${c.green}(workspace)${c.reset}`
      : existsSync(join(PLUGINS_DIR, row.slug))
        ? `  ${c.yellow}(already installed locally)${c.reset}` : '';
    const desc  = row.description ? `  — ${row.description}` : '';
    log(`  ${c.cyan}[${i + 1}]${c.reset}  ${c.bold}${row.name}${c.reset}  (${row.slug})${local}${desc}`);
  });
  log('');
  log(`  ${c.cyan}[a]${c.reset}  Install all listed above`);
  log(`  ${c.cyan}[q / Enter]${c.reset}  Abort`);
  log('');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(`${c.yellow}?${c.reset}  Enter numbers separated by commas (e.g. 1,3) or "a" for all: `, (a) => {
      rl.close();
      resolve(a.trim().toLowerCase());
    });
  });

  if (!answer || answer === 'q') { info('Aborted.'); return null; }
  if (answer === 'a' || answer === 'all') return rows;

  const indices = answer.split(/[,\s]+/)
    .map((s) => parseInt(s, 10) - 1)
    .filter((n) => !isNaN(n) && n >= 0 && n < rows.length);

  if (!indices.length) { warn('No valid selection. Aborted.'); return null; }
  return [...new Set(indices)].map((i) => rows[i]);
}

// ─── plugins.json helpers ─────────────────────────────────────────────────────

function readPluginsJson() {
  if (!existsSync(PLUGINS_JSON)) return { version: '1', description: 'Remote plugin sources for installer use.', plugins: [] };
  try { return JSON.parse(readFileSync(PLUGINS_JSON, 'utf8')); }
  catch (e) { die(`Failed to parse plugins.json: ${e.message}`); }
}

function writePluginsJson(data) {
  writeFileSync(PLUGINS_JSON, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function syncToPluginsJson(entries) {
  const data    = readPluginsJson();
  const current = data.plugins ?? [];
  let changed   = false;
  for (const entry of entries) {
    if (!current.find((p) => p.id === entry.id)) {
      const rec = { id: entry.id, repo_url: entry.repo_url };
      if (entry.download_url) rec.download_url = entry.download_url;
      if (entry.ref)          rec.ref          = entry.ref;
      current.push(rec);
      changed = true;
    }
  }
  if (changed) { data.plugins = current; writePluginsJson(data); ok('Updated plugins.json'); }
}

// ─── GitHub helpers ───────────────────────────────────────────────────────────

function parseGitHubUrl(url) {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.\s]+?)(?:\.git)?(?:\/.*)?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function getZipUrl(owner, repo, ref = 'HEAD') {
  return `https://api.github.com/repos/${owner}/${repo}/zipball/${ref}`;
}

function githubHeaders() {
  const h = { 'User-Agent': 'specy-plugin-installer/1.0', 'Accept': 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) h['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function fetchFollowRedirects(url, options = {}, maxRedirects = 8) {
  let current = url;
  for (let i = 0; i < maxRedirects; i++) {
    const res = await fetch(current, { ...options, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) die(`Redirect with no Location header from ${current}`);
      current = loc;
      continue;
    }
    return res;
  }
  die(`Too many redirects fetching ${url}`);
}

// ─── Extraction ───────────────────────────────────────────────────────────────

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts });
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`"${cmd}" exited with code ${code}`)));
    proc.on('error', reject);
  });
}

async function extractZip(zipPath, destDir) {
  await mkdir(destDir, { recursive: true });
  if (process.platform === 'win32') {
    await runCmd('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${destDir}" -Force`,
    ]);
  } else {
    try {
      await runCmd('unzip', ['-q', '-o', zipPath, '-d', destDir]);
    } catch {
      await runCmd('python3', ['-c',
        `import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])`,
        zipPath, destDir,
      ]);
    }
  }
}

async function downloadAndExtract(zipUrl, targetDir) {
  info(`  Downloading ${zipUrl}`);
  const tmpZip = join(ROOT, `.plugin-tmp-${Date.now()}.zip`);
  const tmpDir = join(ROOT, `.plugin-extract-${Date.now()}`);
  try {
    const res = await fetchFollowRedirects(zipUrl, { headers: githubHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    await pipeline(res.body, createWriteStream(tmpZip));

    await extractZip(tmpZip, tmpDir);

    const entries = readdirSync(tmpDir);
    if (entries.length !== 1) throw new Error(`Unexpected ZIP structure: ${entries.join(', ')}`);
    const innerDir = join(tmpDir, entries[0]);

    if (existsSync(targetDir)) await rm(targetDir, { recursive: true, force: true });
    await rename(innerDir, targetDir);

    ok(`  Extracted to plugins/${targetDir.split(/[\\/]plugins[\\/]/)[1]}`);
  } finally {
    if (existsSync(tmpZip)) { try { await rm(tmpZip, { force: true }); } catch {} }
    if (existsSync(tmpDir)) { try { await rm(tmpDir, { recursive: true, force: true }); } catch {} }
  }
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

function loadManifest(pluginDir) {
  const mp = join(pluginDir, 'plugin.json');
  if (!existsSync(mp)) { warn(`  plugin.json not found in ${pluginDir}`); return null; }
  try {
    const m = JSON.parse(readFileSync(mp, 'utf8'));
    const missing = ['id','name','version','author','license','repository'].filter((k) => !m[k]);
    if (missing.length) warn(`  plugin.json missing: ${missing.join(', ')}`);
    return m;
  } catch (e) { warn(`  Cannot parse plugin.json: ${e.message}`); return null; }
}

// Returns sorted up-migration SQL files (direct .sql files in migrations/, ascending).
// Down-migrations live in migrations/down/ and are handled by the uninstall script.
function collectUpMigrations(slug) {
  const migDir = join(PLUGINS_DIR, slug, 'migrations');
  if (!existsSync(migDir)) return [];
  try {
    return readdirSync(migDir)
      .filter((f) => f.endsWith('.sql') && !f.startsWith('.'))
      .sort()
      .map((f) => ({
        slug,
        file: `src/plugins/${slug}/migrations/${f}`,
        sql:  readFileSync(join(migDir, f), 'utf8'),
      }));
  } catch { return []; }
}

// ─── Migration apply ──────────────────────────────────────────────────────────

async function applyPluginMigrations(slugs, existingPat = null) {
  const allFiles = slugs.flatMap(collectUpMigrations);
  if (!allFiles.length) return;

  const env = loadDotEnv();
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? env['VITE_SUPABASE_URL']
                   ?? process.env.SUPABASE_URL      ?? env['SUPABASE_URL'];

  log('');
  warn(`Found ${allFiles.length} migration file(s) — must be applied to Supabase:`);
  allFiles.forEach(({ file }) => log(`  ${c.yellow}>${c.reset} ${file}`));

  if (!supabaseUrl) {
    warn('SUPABASE_URL not found in .env — apply the files manually via Supabase Dashboard → SQL Editor.');
    return;
  }

  if (!process.stdin.isTTY && !existingPat) {
    warn('Non-interactive mode — apply migration files manually via Supabase Dashboard → SQL Editor.');
    return;
  }

  // Create the readline interface ONLY when actually prompting — a dangling
  // interface on process.stdin keeps the event loop alive, so the process
  // would never exit (which froze the setup TUI's spawnSync at the deploy
  // instruction when a PAT was already available via existingPat).
  const doApply = existingPat ? 'y' : await new Promise((resolve) => {
    const rl1 = createInterface({ input: process.stdin, output: process.stdout });
    rl1.question(`${c.yellow}?${c.reset}  Apply these migrations to Supabase now? [y/N] `, (a) => { rl1.close(); resolve(a.trim().toLowerCase()); });
  });
  if (doApply !== 'y' && doApply !== 'yes') {
    info('Skipped — apply the files manually via Supabase Dashboard → SQL Editor.');
    return;
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
    warn('No PAT entered — skipping migrations. Apply manually via Supabase Dashboard → SQL Editor.');
    return;
  }

  const projectRef = extractProjectRef(supabaseUrl);
  if (!projectRef) { warn('Could not extract project ref from SUPABASE_URL.'); return; }

  log('');
  const applied = new Set();
  for (const { file, sql, slug } of allFiles) {
    process.stdout.write(`  Applying ${c.yellow}${file}${c.reset}… `);
    try {
      await runSqlQuery(projectRef, pat, sql);
      applied.add(slug);
      process.stdout.write(`${c.green}✓${c.reset}\n`);
    } catch (err) {
      process.stdout.write(`${c.red}✗${c.reset}\n`);
      warn(`  Failed: ${err.message}`);
      const rl2 = createInterface({ input: process.stdin, output: process.stdout });
      const cont = await new Promise((resolve) => {
        rl2.question(`${c.yellow}?${c.reset}  Continue with remaining migrations? [y/N] `, (a) => { rl2.close(); resolve(a.trim().toLowerCase()); });
      });
      if (cont !== 'y' && cont !== 'yes') { warn('Migrations aborted.'); return [...applied]; }
    }
  }
  ok('Migrations applied ✓');
  return [...applied];
}

// ─── Binding intents (BIPS — specs/platform/binding-management.md) ──────

/**
 * Validate one manifest's binding intents at install time — a plugin with
 * invalid intents fails the install with actionable errors, before any
 * registry rebuild or build (config-level failures, never deploy-level).
 * Binding management is part of a plugin: intents are declared against the
 * deployment path (cloudflare is the current default and only path).
 */
function validatePluginBindingIntents(manifest, pluginId) {
  const { mode, intents, errors, warnings, deploymentPath, intentCount } = collectManifestIntents(manifest, pluginId);
  return { ok: errors.length === 0, mode, errors, warnings, deploymentPath, intentCount, intents };
}

/**
 * Read the Cloudflare account id from the generated wrangler.jsonc
 * (top-level account_id or the CF_ACCOUNT_ID var; placeholders ignored).
 */
function readCfAccountId() {
  if (!existsSync(WRANGLER_CONFIG_FILE)) return null;
  try {
    const raw = readFileSync(WRANGLER_CONFIG_FILE, 'utf8');
    const top = /"account_id"\s*:\s*"([^"]+)"/.exec(raw)?.[1] ?? null;
    const varId = /"CF_ACCOUNT_ID"\s*:\s*"([^"]+)"/.exec(raw)?.[1] ?? null;
    if (top && !top.startsWith('REPLACE_')) return top;
    if (varId && !varId.startsWith('REPLACE_')) return varId;
    return null;
  } catch { return null; }
}

/**
 * Provision plugin binding instances for this deployment (create-or-get via
 * the Cloudflare API, recorded in the resource ledger). Non-fatal: when no
 * CF_API_TOKEN is available the operator is pointed at the provision CLI.
 *
 * Runs over the FULL workspace (declarative reconcile — the ledger reflects
 * the final declared state alone, not just the newly installed plugins), then
 * rebuilds the registry artifacts so provisioned ids (kv) land in wrangler.jsonc.
 */
export async function provisionPluginBindingIntents() {
  const status = {
    mode: 'none',
    workerName: null,
    checked: [],        // { kind, name, pluginId, state, detail, command? }
    attempted: false,
    provisioned: [],    // created or found this run
    pending: [],        // { kind, resolvedName, command }
    ok: false,
  };

  const plugins = scanWorkspacePlugins();
  if (!plugins.length) return status;

  const ledger = readLedgerFromPath(ROOT);
  const { mode, resolvedIntents, errors, warnings } = collectPluginIntents(plugins, {
    wranglerJsoncPath: WRANGLER_CONFIG_FILE,
    ledger,
  });

  if (errors.length > 0) {
    fail('Binding intent errors detected (the build will fail):');
    for (const error of errors) fail(`  ${error}`);
    for (const intent of resolvedIntents) {
      status.checked.push({ kind: intent.kind, pluginId: intent.pluginId, resolvedName: intent.resolvedName, state: 'invalid', detail: 'intent validation failed (see errors above)' });
    }
    return status;
  }
  if (mode !== 'intents') {
    const legacyCount = plugins.filter((p) => p.manifest?.wrangler_bindings && !p.manifest?.wrangler_intents).length;
    if (legacyCount > 0) {
      warn(`${legacyCount} plugin(s) use legacy wrangler_bindings (concrete instances) — injected verbatim, no per-environment provisioning.`);
    }
    return status; // no wrangler_intents declared — nothing to provision
  }

  const workerName = readWorkerName(WRANGLER_CONFIG_FILE);
  status.mode = 'intents';
  status.workerName = workerName;

  log('');
  info(`Binding pipeline (cloudflare, environment ${c.bold}${workerName}${c.reset}) — step detection:`);
  for (const warning of warnings) log(`    ${c.yellow}!${c.reset}  ${warning}`);

  // ── Step detection: classify every intent's completion state ──
  for (const intent of resolvedIntents) {
    if (intent.kind === 'queues' || intent.kind === 'kv_namespaces') {
      if (intent.instanceId) {
        status.checked.push({ kind: intent.kind, pluginId: intent.pluginId, resolvedName: intent.resolvedName, state: 'done', detail: 'provisioned (ledger)', command: null });
      } else {
        status.checked.push({ kind: intent.kind, pluginId: intent.pluginId, resolvedName: intent.resolvedName, state: 'pending', detail: 'not provisioned for this environment', command: 'npm run bindings:provision' });
      }
    } else if (intent.kind === 'secrets_store_secrets') {
      // Detection: a ledger row with a store_id means the link was verified in a
      // previous run; without one, the link needs API verification (token).
      const ledgerRow = findLedgerRow(ledger, intent.pluginId, 'secrets_store_secrets', intent.purpose);
      const verified = Boolean(ledgerRow?.wiring?.store_id && intent.config.store_id === ledgerRow.wiring.store_id);
      status.checked.push({
        kind: 'secrets_store_secrets', pluginId: intent.pluginId, resolvedName: intent.config.secret_name,
        state: verified ? 'done' : (intent.config.store_id ? 'check' : 'pending'),
        detail: verified ? 'secret link verified (ledger)'
          : intent.config.store_id ? 'link not yet verified against the Secrets Store'
          : 'no Secrets Store resolved (set SECRETS_STORE_ID or declare store_id)',
        command: verified ? null : 'npm run bindings:provision',
      });
    } else {
      status.checked.push({ kind: intent.kind, pluginId: intent.pluginId, resolvedName: null, state: 'none', detail: 'no instance needed', command: null });
    }
  }

  const unprovisioned = listUnprovisionedIntents(resolvedIntents);
  const secretsToCheck = status.checked.filter((s) => s.kind === 'secrets_store_secrets' && s.state === 'check');
  if (!unprovisioned.length && !secretsToCheck.length) {
    status.ok = true;
    ok('All plugin binding instances are provisioned for this environment.');
    for (const step of status.checked) {
      if (step.state === 'done') log(`    ${c.green}v${c.reset} ${step.kind}: ${c.bold}${step.resolvedName ?? '(no instance)'}${c.reset}  — ${step.detail}`);
    }
    return status;
  }

  log('');
  info(`Binding steps incomplete for this environment: ${unprovisioned.length} instance(s), ${secretsToCheck.length} secret link(s) to verify:`);
  for (const step of status.checked) {
    if (step.state === 'done') {
      log(`    ${c.green}v${c.reset} ${step.kind}: ${c.bold}${step.resolvedName ?? '(no instance)'}${c.reset}  — ${step.detail}`);
    } else if (step.state !== 'none') {
      log(`    ${c.yellow}!${c.reset} ${step.kind}: ${c.bold}${step.resolvedName ?? '(unknown)'}${c.reset}  — ${step.detail}`);
    }
  }

  const env = loadDotEnv();
  const token = process.env.CF_API_TOKEN
    ?? process.env.CLOUDFLARE_API_TOKEN
    ?? env['CF_API_TOKEN']
    ?? env['CLOUDFLARE_API_TOKEN'];
  if (!token) {
    warn('No CF_API_TOKEN found (env or .env) — provisioning skipped. Run manually:');
    warn('  npm run bindings:provision   (prompts for the token interactively)');
    status.pending.push(...status.checked
      .filter((s) => s.state !== 'done' && s.state !== 'none')
      .map((s) => ({ kind: s.kind, resolvedName: s.resolvedName, command: s.command ?? 'npm run bindings:provision' })));
    return status;
  }

  const accountId = readCfAccountId();
  if (!accountId) {
    warn('No Cloudflare account id in wrangler.jsonc — provisioning skipped. Run npm run setup first.');
    status.pending.push(...status.checked
      .filter((s) => s.state !== 'done' && s.state !== 'none')
      .map((s) => ({ kind: s.kind, resolvedName: s.resolvedName, command: s.command ?? 'npm run bindings:provision' })));
    return status;
  }

  status.attempted = true;
  try {
    const summary = await provisionBindingIntents(resolvedIntents, { token, accountId, root: ROOT, workerName });
    for (const name of summary.created) {
      status.provisioned.push(name);
      ok(`  created: ${c.bold}${name}${c.reset}`);
      const step = status.checked.find((s) => s.resolvedName === name);
      if (step) { step.state = 'done'; step.detail = 'provisioned this run (created)'; step.command = null; }
    }
    for (const name of summary.got) {
      status.provisioned.push(name);
      ok(`  already exists: ${c.bold}${name}${c.reset}`);
      const step = status.checked.find((s) => s.resolvedName === name);
      if (step) { step.state = 'done'; step.detail = 'provisioned this run (already existed)'; step.command = null; }
    }
    for (const secret of summary.verifiedSecrets) {
      const step = status.checked.find((s) => s.kind === 'secrets_store_secrets' && s.resolvedName === secret);
      if (step) { step.state = 'done'; step.detail = 'secret link verified'; }
    }
    for (const secret of summary.missingSecrets) {
      status.pending.push({
        kind: 'secrets_store_secrets',
        resolvedName: secret,
        command: `npx wrangler secrets-store secret create <STORE_ID> --name ${secret} --scopes workers --remote`,
      });
    }
    status.pending.push(...status.checked
      .filter((s) => s.state !== 'done' && s.state !== 'none' && s.kind !== 'secrets_store_secrets')
      .map((s) => ({ kind: s.kind, resolvedName: s.resolvedName, command: s.command ?? 'npm run bindings:provision' })));

    ok(`Binding ledger updated (${summary.rows.length} resource row(s)).`);

    // Rebuild so provisioned ids (kv namespace ids from the ledger) are
    // injected into the generated wrangler.jsonc section.
    rebuildWorkspacePluginArtifacts();
    status.ok = status.pending.length === 0;
    if (status.ok) {
      ok('Plugin binding instances provisioned and wrangler.jsonc resolved.');
    } else {
      warn(`${status.pending.length} binding step(s) still pending (see below).`);
    }
  } catch (e) {
    fail(`Provisioning failed: ${e.message}`);
    warn('Fix the error and re-run: npm run bindings:provision');
    for (const step of status.checked) {
      if (step.state !== 'done' && step.state !== 'none' && !step.command) {
        step.state = 'pending'; step.detail = 'aborted (provisioning error)'; step.command = 'npm run bindings:provision';
      }
    }
  }

  return status;
}

/**
 * Run the binding consistency audit and print the verdict. Returns the audit
 * plus the grouped pending commands for the manual-steps summary.
 */
function runBindingAudit() {
  const plugins = scanWorkspacePlugins();
  const ledger = readLedgerFromPath(ROOT);
  const config = parseJsoncConfig(existsSync(WRANGLER_CONFIG_FILE) ? readFileSync(WRANGLER_CONFIG_FILE, 'utf8') : null);

  const audit = auditBindingConsistency({
    plugins,
    wranglerJsoncPath: WRANGLER_CONFIG_FILE,
    ledger,
    config,
  });

  return audit;
}

// ─── Core install loop ───────────────────────────────────────────────
// entries: array of { id, repo_url, download_url?, ref? }
// db: PAT DB facade or null (DB status updates skipped when null)
async function _doInstall(entries, db) {
  mkdirSync(PLUGINS_DIR, { recursive: true });
  const results = { ok: [], failed: [] };

  for (const plugin of entries) {
    log(`\n${c.bold}Installing: ${plugin.id}${c.reset}`);
    const targetDir = join(PLUGINS_DIR, plugin.id);
    const isLocal   = plugin.local && existsSync(targetDir);
    const parsed    = parseGitHubUrl(plugin.repo_url);
    if (!parsed && !isLocal) { fail(`  Invalid repo_url: ${plugin.repo_url ?? '(none)'}`); results.failed.push(plugin.id); continue; }

    const zipUrl    = parsed ? (plugin.download_url ?? getZipUrl(parsed.owner, parsed.repo, plugin.ref ?? 'HEAD')) : null;
    let   activeId  = plugin.id;
    try {
      if (isLocal) {
        info(`  Workspace plugin — using existing plugins/${activeId}/ folder (no download)`);
      } else {
        await downloadAndExtract(zipUrl, targetDir);
      }
      const m = loadManifest(targetDir);
      if (m) {
        ok(`  ${m.name} v${m.version} by ${m.author} (${m.license})`);

        // ── ID reconciliation ─────────────────────────────────────────────────
        if (m.id && m.id !== activeId && /^[a-z0-9-]+$/.test(m.id)) {
          const newDir = join(PLUGINS_DIR, m.id);
          if (!existsSync(newDir)) {
            await rename(join(PLUGINS_DIR, activeId), newDir);
            const oldId    = activeId;
            activeId       = m.id;
            const jsonData = readPluginsJson();
            const idx = (jsonData.plugins ?? []).findIndex((p) => p.id === oldId);
            if (idx !== -1) { jsonData.plugins[idx].id = m.id; writePluginsJson(jsonData); }
            ok(`  Directory renamed → src/plugins/${m.id}/ (matched plugin.json id)`);
          } else {
            warn(`  src/plugins/${m.id}/ already exists — keeping slug "${activeId}"`);
          }
        }

        // ── Ensure DB registration (workspace-first flow) ────────────────
        await ensurePluginRegistered(db, activeId, m, plugin);

        info('  Validating migrations…');
        const migrationValidation = validatePluginMigrations(PLUGINS_DIR, activeId);
        if (!migrationValidation.ok) {
          throw new Error(`Migration validation failed:\n- ${migrationValidation.errors.join('\n- ')}`);
        }
        ok('  Migrations validated');

        // ── Binding intent validation (BIPS) ──────
        info('  Validating binding intents…');
        const intentValidation = validatePluginBindingIntents(m, activeId);
        if (!intentValidation.ok) {
          throw new Error(`Binding intent validation failed:\n- ${intentValidation.errors.join('\n- ')}`);
        }
        if (intentValidation.mode === 'intents') {
          ok(`  Binding intents validated (${intentValidation.intentCount} intent(s), deployment path: ${intentValidation.deploymentPath})`);
        } else if (intentValidation.mode === 'legacy') {
          warn('  Uses legacy wrangler_bindings (concrete instances) — migrate to wrangler_intents for per-environment provisioning.');
          for (const warning of intentValidation.warnings) warn(`  ${warning}`);
        }

        // ── npm dependencies ──────────────────────────────────────────────────
        if (m.required_npm_dependencies && Object.keys(m.required_npm_dependencies).length > 0) {
          const allDeps = m.required_npm_dependencies;

          // Skip packages already present in node_modules (from main project or
          // another plugin) to avoid version-range conflicts at install time.
          const missing = Object.entries(allDeps)
            .filter(([name]) => !existsSync(join(ROOT, 'node_modules', name)));
          const present = Object.keys(allDeps)
            .filter((name) => existsSync(join(ROOT, 'node_modules', name)));

          if (present.length > 0) {
            info(`  Already provided by main project: ${present.join(', ')}`);
          }

          if (missing.length > 0) {
            const pkgs = missing.map(([n, v]) => `${n}@${v}`);
            info(`  Installing ${pkgs.length} new package(s)…`);
            pkgs.forEach((p) => log(`    ${c.cyan}+${c.reset} ${p}`));
            try {
              const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
              // --no-package-lock: resolve fresh from registry, not constrained by the
              // CMS lockfile. Without this, npm's conservative lockfile-aware resolution
              // picks the minimum satisfying version (e.g. 8.0.0 instead of 8.21.3),
              // which can pull in unpublished transitive deps from early releases.
              await runCmd(npmCmd, ['install', '--no-save', '--legacy-peer-deps', '--no-package-lock', ...pkgs], { cwd: ROOT });
              ok(`  npm dependencies installed (tracked in plugin-deps.json)`);
            } catch (e) {
              warn(`  npm install failed: ${e.message}`);
              warn(`  Install manually: npm install --no-save --legacy-peer-deps --no-package-lock ${pkgs.join(' ')}`);
            }
          } else {
            info(`  All npm dependencies already available.`);
          }

          // Always record ALL declared deps so ensure-registry can reinstall
          // them on a fresh clone (where node_modules won't have any of them).
          const deps = readPluginDeps();
          deps[activeId] = allDeps;
          writePluginDeps(deps);
        }

        // ── config schema reminder ────────────────────────────────────────────
        if (Array.isArray(m.config_schema) && m.config_schema.length > 0) {
          await syncPluginConfigSchema(db, activeId, m.config_schema);
          log('');
          info(`  Configuration keys for "${activeId}":`);
          m.config_schema.forEach((field) => {
            const tag = field.type === 'secret' ? ` ${c.yellow}[SECRET]${c.reset}` : '';
            const req = field.required ? ` ${c.red}(required)${c.reset}` : '';
            log(`    ${c.cyan}${field.key}${c.reset}${tag}${req}  —  ${field.description ?? field.label ?? ''}`);
          });
          log(`  → Set these in the Plugins admin UI at /plugins`);
        } else {
          await syncPluginConfigSchema(db, activeId, []);
        }

        // ── Update DB status ──────────────────────────────────────────────────
        await markPluginInstalled(db, activeId, m.version);
        await recordPluginCodeState(db, activeId, m.version);
        await recordPluginClaimsState(db, activeId, m);
      }
      results.ok.push(activeId);
    } catch (e) {
      fail(`  Failed: ${e.message}`);
      const failedDir = join(PLUGINS_DIR, activeId);
      if (existsSync(failedDir)) {
        if (plugin.local && existsSync(failedDir)) {
          // Workspace plugins are the user's source of truth (separate git repo)
          // — never delete them on failure, only downloaded artifacts.
          warn(`  Kept workspace folder plugins/${activeId}/ — fix the errors above and re-run.`);
        } else {
          try {
            await rm(failedDir, { recursive: true, force: true });
            warn(`  Removed invalid plugin directory: src/plugins/${activeId}/`);
          } catch {}
        }
      }
      await markPluginError(db, plugin.id, e.message);
      results.failed.push(plugin.id);
    }
  }

  // Rebuild generated plugin artifacts from the current /plugins workspace folder.
  rebuildWorkspacePluginArtifacts();
  const appliedSlugs = await applyPluginMigrations(results.ok, db?.pat ?? null) ?? [];

  // ── Expose plugin schemas for PostgREST (development.md §API exposure
  //    requirement, automated; symmetric to the uninstall cleanup). Only for
  //    plugins whose migrations were actually applied — the schema is created
  //    by migration 001, and exposing a not-yet-existing schema wedges
  //    PostgREST's cache reload (PGRST002). ──
  for (const slug of results.ok) {
    if (collectUpMigrations(slug).length === 0) continue; // no schema to expose
    const pluginSchema = getAllowedPluginSchemas(slug)[0] ?? slug;
    if (!db || !appliedSlugs.includes(slug)) {
      warn(`  Schema "${pluginSchema}" (${slug}) could not be auto-exposed — migrations were not applied via PAT.`);
      log('    Dashboard → Project Settings → API → Exposed schemas → check the schema (after applying migrations)');
      continue;
    }
    try {
      const exposure = await exposePluginSchema(db.projectRef, db.pat, pluginSchema);
      if (exposure.status === 'added') {
        ok(`  Exposed "${pluginSchema}" schema in the API settings (via ${exposure.via}) — PostgREST config reloaded.`);
      } else if (exposure.status === 'already-exposed') {
        info(`  Schema "${pluginSchema}" is already exposed in the API settings.`);
      } else {
        warn(`  Could not expose "${pluginSchema}": ${exposure.error} — add it manually:`);
        log('    Dashboard → Project Settings → API → Exposed schemas → check the schema');
      }
    } catch (e) {
      warn(`  Could not expose the plugin schema: ${e.message} — add it manually:`);
      log('    Dashboard → Project Settings → API → Exposed schemas → check the schema');
    }
  }

  // Provision plugin binding instances for this deployment (BIPS Layer 3),
  // then reconcile the generated wrangler.jsonc against provisioned ids.
  await provisionPluginBindingIntents();

  // Publish binding state to the deployment-state registry (declarative,
  // idempotent — mirrors the ledger).
  await recordPluginBindingsState(db);

  // ── Full consistency audit over ALL moving parts (dynamic, zero manual checks) ──
  // Covers: intent validity, provisioning completeness, Secrets Store resolution,
  // ledger freshness (stale/orphan rows), and generated-config sync.
  const audit = runBindingAudit();

  log(`\n${c.bold}Done${c.reset}`);
  if (results.ok.length)     ok(`  Installed : ${results.ok.join(', ')}`);
  if (results.failed.length) fail(`  Failed    : ${results.failed.join(', ')}`);

  if (results.ok.length > 0) {
    log('');
    info('Building…');
    try {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      await runCmd(npmCmd, ['run', 'build'], { cwd: ROOT });
      ok('Build complete.');
    } catch (e) {
      warn(`Build failed: ${e.message}`);
      warn('Run `npm run build` manually before deploying.');
    }
  }

  // ── Consistency verdict + dynamic manual steps ──
  log('');
  log(`${c.bold}Consistency check${c.reset} (environment: ${c.bold}${audit.workerName ?? 'specy'}${c.reset}):`);
  const { pendingCommands, allClear } = printBindingAuditReport(audit, { log: (m) => log(`  ${m}`) });

  log('');
  info('Remaining manual steps:');
  let stepNo = 1;
  log(`  ${stepNo++}. Set any required plugin config values at /plugins`);
  log(`  ${stepNo++}. If migrations were skipped above: apply .sql files via Supabase Dashboard → SQL Editor`);

  if (audit.consistent) {
    ok(`All moving parts consistent — ready to deploy.`);
  } else {
    log(`  ${stepNo++}. Resolve the pending binding items above — run:`);
    for (const [command, targets] of pendingCommands) {
      log(`       ${c.cyan}${command}${c.reset}`);
      for (const target of targets) log(`       ${c.dim}→ ${target}${c.reset}`);
    }
    log(`     …then re-run ${c.cyan}npm run build${c.reset} — the audit re-checks everything automatically.`);
  }

  log(`  ${stepNo++}. Deploy  (e.g. npx wrangler deploy)`);
  log('');
}

// ─── Commands ─────────────────────────────────────────────────────────────────

// List reads DB data via the Supabase PAT; gracefully falls back if no PAT is available.
async function cmdList() {
  const db = await createPatDb();
  if (db) {
    try {
      const rows = await patQuery(
        db,
        `SELECT slug, name, version, status, installed_at FROM plugins ORDER BY name`,
      );
      if (!rows?.length) { info('No plugins in database.'); return; }
      log(`\n${c.bold}Plugins (Supabase + local):${c.reset}`);
      for (const row of rows) {
        const local   = existsSync(join(PLUGINS_DIR, row.slug)) ? `${c.green}local✔${c.reset}` : `${c.yellow}local✘${c.reset}`;
        const dbLabel = row.status === 'installed' ? `${c.green}${row.status}${c.reset}` : `${c.yellow}${row.status}${c.reset}`;
        log(`  ${c.cyan}${row.slug}${c.reset}  ${row.name}  v${row.version}  [db: ${dbLabel}]  [${local}]`);
      }
      log('');
      return;
    } catch (e) { warn(`Could not fetch from Supabase: ${e.message}`); }
  }
  // Fallback — local only
  const plugins = scanWorkspacePlugins();
  if (!plugins.length) { info('No workspace plugins found in /plugins.'); return; }
  log(`\n${c.bold}Workspace plugins:${c.reset}`);
  plugins.forEach((plugin) => {
    log(`  ${c.cyan}${plugin.id}${c.reset}  plugins/${plugin.dirName}`);
  });
  log('');
}

async function cmdAdd(repoUrl) {
  if (!repoUrl) die('Usage: --add <github-url>  e.g. https://github.com/owner/repo');
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) die(`Not a valid GitHub URL: ${repoUrl}`);

  const data    = readPluginsJson();
  const plugins = data.plugins ?? [];
  const id      = `${parsed.owner}-${parsed.repo}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const entry   = { id, repo_url: `https://github.com/${parsed.owner}/${parsed.repo}`, ref: 'HEAD' };

  if (plugins.find((p) => p.id === id)) {
    warn(`"${id}" already in plugins.json — re-running install`);
  } else {
    plugins.push(entry);
    writePluginsJson({ ...data, plugins });
    ok(`Added "${id}" to plugins.json`);
  }

  const db = await createPatDb();
  await _doInstall([entry], db);
}

// Default: workspace plugins first, then DB-registered entries → interactive picker
async function cmdPickAndInstall(installAll = false) {
  if (!getSupabaseUrl()) {
    warn('SUPABASE_URL not found — installing from the /plugins workspace only.');
  }
  const db = getSupabaseUrl() ? await createPatDb() : null;

  // 1. Workspace plugins (plugins/*/plugin.json) take precedence.
  const workspace = scanWorkspacePlugins();
  const wsCandidates = workspace.map(({ id, manifest }) => ({
    slug: id,
    name: manifest.name ?? id,
    description: manifest.description ?? null,
    repo_url: manifest.repository ?? null,
    download_url: manifest.download_url ?? undefined,
    local: true,
  }));

  // 2. DB-registered plugins as an additional source.
  let registered = [];
  if (db) {
    info('Fetching registered plugins from Supabase…');
    try { registered = await fetchRegisteredPlugins(db); }
    catch (e) { warn(`Could not fetch plugins from Supabase: ${e.message}`); }
  }

  // 3. Merge — workspace entries first, DB-only entries after.
  const wsIds = new Set(wsCandidates.map((w) => w.slug));
  const merged = [...wsCandidates, ...registered.filter((r) => !wsIds.has(r.slug))];

  if (!merged.length) {
    info('No plugins found — no valid plugin folders in /plugins and no entries with status "registered" in the database.');
    return;
  }

  let selected;
  if (installAll) {
    selected = merged;
    log('');
    info(`Installing all ${selected.length} plugin(s):`);
    merged.forEach((r) => log(`  ${c.cyan}+${c.reset}  ${r.name}  (${r.slug})${r.local ? '  [workspace]' : ''}${r.description ? '  — ' + r.description : ''}`));
    log('');
  } else {
    selected = await pickPlugins(merged);
    if (!selected || !selected.length) return;
  }

  const entries = selected.map((row) => ({
    id:           row.slug,
    repo_url:     row.repo_url,
    download_url: row.download_url ?? undefined,
    ref:          'HEAD',
    local:        row.local ?? false,
  }));

  // plugins.json tracks remote sources only — workspace plugins live on disk.
  syncToPluginsJson(entries.filter((e) => !e.local));
  await _doInstall(entries, db);
}

// Fallback: install from plugins.json without DB login
async function cmdLocalInstall() {
  const data       = readPluginsJson();
  const allPlugins = data.plugins ?? [];
  if (!allPlugins.length) { info('No plugins in plugins.json.'); rebuildWorkspacePluginArtifacts(); return; }
  // No DB connection — pass null; DB status updates will be skipped
  await _doInstall(allPlugins, null);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

// Wraps command dispatch so die()'s FatalError sentinel exits cleanly (exit code
// already set to 1) instead of surfacing as an unhandled rejection — see die().
async function runCommand(fn) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof FatalError) return;
    throw e;
  }
}

// Only dispatch when invoked directly — importing this module (e.g. from
// update.mjs for the binding-provisioning step) must be side-effect free.
import { pathToFileURL } from 'url';
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  log('');
  log('Usage:');
  log('  node scripts/install-plugins.mjs               Workspace plugins + DB registry → interactive picker');
  log('  node scripts/install-plugins.mjs --all         Install all (workspace + DB registry, CI-safe)');
  log('  node scripts/install-plugins.mjs --local       Install remote entries from plugins.json (no DB required)');
  log('  node scripts/install-plugins.mjs --add <url>   Register + install a GitHub repo directly');
  log('  node scripts/install-plugins.mjs --list        List plugins (DB status + local state)');
  log('');
  log('Environment (.env or .env.local):');
  log('  VITE_SUPABASE_URL              Supabase project URL');
  log('  SUPABASE_ACCESS_TOKEN          Supabase PAT (optional — prompted if missing)');
  log('  GITHUB_TOKEN                   GitHub PAT (optional, avoids rate-limits)');
  log('  Note: DB operations use a Supabase PAT via the Management API — never stored.');
  log('');
} else if (args.includes('--list')) {
  await runCommand(() => cmdList());
} else if (args.includes('--add')) {
  await runCommand(() => cmdAdd(args[args.indexOf('--add') + 1]));
} else if (args.includes('--all')) {
  await runCommand(() => cmdPickAndInstall(true));
} else if (args.includes('--local')) {
  await runCommand(() => cmdLocalInstall());
} else {
  await runCommand(() => cmdPickAndInstall(false));
}
}
