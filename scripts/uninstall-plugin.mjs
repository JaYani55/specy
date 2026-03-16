#!/usr/bin/env node
/**
 * uninstall-plugin.mjs
 *
 * Cleanly removes an installed plugin from the CMS.
 *
 * Usage:
 *   node scripts/uninstall-plugin.mjs <plugin-id>               # remove plugin
 *   node scripts/uninstall-plugin.mjs <plugin-id> --prune-deps  # also npm uninstall its deps
 *   node scripts/uninstall-plugin.mjs --list                    # show installed plugins
 *   node scripts/uninstall-plugin.mjs --help                    # show usage
 *
 * What it does:
 *   1. Reads the plugin manifest to collect deps, api_entrypoint, and migrations
 *   2. Deletes src/plugins/{id}/
 *   3. Removes the entry from plugins.json
 *   4. Rebuilds src/plugins/registry.ts
 *   5. (--prune-deps) npm-uninstalls packages not used by any other plugin
 *   6. Prints manual cleanup steps (API route in api/index.ts, Supabase migrations)
 *
 * After running you MUST rebuild and redeploy:
 *   npm run build
 *   npx wrangler deploy
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { spawn } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __dirname          = dirname(fileURLToPath(import.meta.url));
const ROOT               = resolve(__dirname, '..');
const PLUGINS_JSON       = join(ROOT, 'plugins.json');
const PLUGINS_DIR        = join(ROOT, 'src', 'plugins');
const REGISTRY_FILE      = join(PLUGINS_DIR, 'registry.ts');
const PLUGIN_DEPS_FILE   = join(ROOT, 'plugin-deps.json');
const PLUGIN_ROUTES_FILE = join(ROOT, 'api', 'plugin-routes.ts');

// ─── .env loader ─────────────────────────────────────────────────────────────
function loadDotEnv() {
  const vars = {};
  for (const file of ['.env.local', '.env']) {
    const p = join(ROOT, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const idx = t.indexOf('=');
      if (idx === -1) continue;
      const key = t.slice(0, idx).trim();
      const val = t.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in vars)) vars[key] = val;
    }
  }
  return vars;
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────
function createAnonClient() {
  const env = loadDotEnv();
  const url = process.env.SUPABASE_URL
           ?? process.env.VITE_SUPABASE_URL
           ?? env['SUPABASE_URL']
           ?? env['VITE_SUPABASE_URL'];
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
           ?? env['VITE_SUPABASE_PUBLISHABLE_KEY'];
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function getJwtRoles(accessToken) {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString('utf8'));
    return Array.isArray(payload.user_roles) ? payload.user_roles : [];
  } catch { return []; }
}

// Regular line prompt \u2014 paste-friendly (no raw mode). Used for tokens that
// are never stored and don't need per-character masking.
function promptLine(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

function promptPassword(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const wasRaw = process.stdin.isRaw ?? false;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    let pwd = '';
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n') {
        process.stdin.setRawMode(wasRaw);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(pwd);
      } else if (ch === '\u0003') {
        process.stdout.write('\n'); process.exit(0);
      } else if (ch === '\u007f' || ch === '\b') {
        if (pwd.length > 0) { pwd = pwd.slice(0, -1); process.stdout.write('\b \b'); }
      } else {
        pwd += ch; process.stdout.write('*');
      }
    };
    process.stdin.on('data', onData);
  });
}

async function loginInteractive(client) {
  log('');
  log(`${c.bold}Plugin uninstaller \u2014 Supabase login required${c.reset}`);
  info('Only users with the admin or super-admin role can uninstall plugins.');
  log('');

  const rl    = createInterface({ input: process.stdin, output: process.stdout });
  const email = await new Promise((resolve) => rl.question(`${c.cyan}Email:${c.reset}    `, (a) => { rl.close(); resolve(a.trim()); }));
  const pwd   = await promptPassword(`${c.cyan}Password:${c.reset} `);

  const { data, error } = await client.auth.signInWithPassword({ email, password: pwd });
  if (error) die(`Login failed: ${error.message}`);

  const roles = getJwtRoles(data.session.access_token);
  if (!roles.includes('admin') && !roles.includes('super-admin')) {
    await client.auth.signOut();
    die(`Access denied. Your account (${email}) does not have the admin or super-admin role.`);
  }

  ok(`Logged in as ${email}  [roles: ${roles.join(', ')}]`);
  return client;
}

async function markPluginUninstalled(client, slug) {
  if (!client) return;
  const { error } = await client
    .from('plugins')
    .update({ status: 'registered', installed_at: null })
    .eq('slug', slug);
  if (error) warn(`  Could not update DB status for "${slug}": ${error.message}`);
  else ok(`  DB status \u2192 registered  (installed_at cleared)`);
}

// ─── Supabase Management API helpers (mirrors setup.mjs) ─────────────────────

function extractProjectRef(supabaseUrl) {
  try { return new URL(supabaseUrl).hostname.split('.')[0]; }
  catch { return null; }
}

async function runSqlQuery(projectRef, pat, sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query: sql }),
    },
  );
  if (!res.ok) {
    const rawText = await res.text().catch(() => '');
    let detail = rawText;
    try { const body = JSON.parse(rawText); detail = body.message || body.error || rawText; } catch {}
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return res.json().catch(() => null);
}

// Reads down-migration SQL files from migrations/down/ into memory BEFORE the
// directory is deleted. Returns:
//   null                          — no migrations dir at all, nothing to do
//   []                            — down/ folder exists but is empty
//   [{file, sql}]                 — explicit down-migrations found
//   [{file, sql, autoGenerated}]  — auto-generated DROP SQL from up-migrations
// Files are reverse-sorted so the newest down-migration runs first.
function collectDownMigrations(pluginDir, slug) {
  const downDir = join(pluginDir, 'migrations', 'down');
  if (existsSync(downDir)) {
    // Explicit down-migrations provided by the plugin author — use them as-is.
    try {
      const files = readdirSync(downDir)
        .filter((f) => f.endsWith('.sql') && !f.startsWith('.'))
        .sort()
        .reverse();
      return files.map((f) => ({
        file: `src/plugins/${slug}/migrations/down/${f}`,
        sql:  readFileSync(join(downDir, f), 'utf8'),
      }));
    } catch { return []; }
  }
  // No down/ directory — auto-generate DROP SQL by parsing up-migrations.
  return generateAutoDropSQL(pluginDir, slug);
}

/**
 * Parse a single up-migration SQL file and extract DROP statements.
 * Order: external triggers → functions → tables (CASCADE) → types.
 * DROP TABLE CASCADE handles: triggers on the table, indexes, policies, sequences.
 */
function extractDrops(sql) {
  const drops = [];
  let m;

  // Triggers on external schema tables (e.g. auth.users) — not removed by DROP TABLE CASCADE.
  const extTrigRe = /\bCREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(\w+)\b[\s\S]*?\bON\s+((?:auth|extensions)\.\w+)/gi;
  while ((m = extTrigRe.exec(sql)) !== null) drops.push(`DROP TRIGGER IF EXISTS ${m[1]} ON ${m[2]};`);

  // Functions — CASCADE also removes any trigger that calls the function.
  const funcRe = /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(\w+)\s*\(/gi;
  while ((m = funcRe.exec(sql)) !== null) drops.push(`DROP FUNCTION IF EXISTS ${m[1]} CASCADE;`);

  // Tables — CASCADE drops triggers on the table, indexes, policies, FK-dependent rows.
  const tableRe = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("[\w]+"|\w+)/gi;
  while ((m = tableRe.exec(sql)) !== null) drops.push(`DROP TABLE IF EXISTS ${m[1]} CASCADE;`);

  // Types — after tables since tables reference them; CASCADE handles dependents.
  const typeRe = /\bCREATE\s+TYPE\s+("[\w]+"|\w+)\b/gi;
  while ((m = typeRe.exec(sql)) !== null) drops.push(`DROP TYPE IF EXISTS ${m[1]} CASCADE;`);

  return drops;
}

/**
 * Auto-generate DROP SQL by reverse-parsing the plugin's up-migrations.
 * Returns [{file, sql, autoGenerated: true}] or null if nothing found.
 */
function generateAutoDropSQL(pluginDir, slug) {
  const migrationsDir = join(pluginDir, 'migrations');
  if (!existsSync(migrationsDir)) return null;

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('.'))
    .sort()
    .reverse(); // reverse: drop objects from the last migration first

  if (!files.length) return null;

  const lines = [
    `-- Auto-generated DROP statements for plugin: ${slug}`,
    `-- Generated by uninstall-plugin.mjs (no migrations/down/ directory was found)`,
    `-- Review carefully before applying.`,
    '',
  ];
  let anyDrops = false;

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const drops = extractDrops(sql);
    if (drops.length) {
      lines.push(`-- ${file}`);
      lines.push(...drops);
      lines.push('');
      anyDrops = true;
    }
  }

  if (!anyDrops) return null;
  return [{ file: '[auto-generated from up-migrations]', sql: lines.join('\n'), autoGenerated: true }];
}

// Returns true if migrations were applied (or there was nothing to apply), false if skipped/failed.
async function applyDownMigrations(slug, downMigs, hasUpMigs) {
  // null — no migrations folder at all, nothing to drop
  if (downMigs === null) return true;

  // Empty explicit down/ folder
  if (!downMigs.length) {
    if (hasUpMigs) warn(`migrations/down/ is empty \u2014 drop tables manually if needed.`);
    return false;
  }

  const autoGenerated = downMigs[0].autoGenerated === true;
  const env = loadDotEnv();
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? env['VITE_SUPABASE_URL']
                   ?? process.env.SUPABASE_URL      ?? env['SUPABASE_URL'];

  log('');
  if (autoGenerated) {
    info(`No down-migrations found for "${slug}" — auto-generated DROP SQL from up-migrations:`);
    log('');
    log(c.yellow + downMigs[0].sql + c.reset);
    warn('The SQL above will DROP all plugin objects (tables, functions, triggers, types).');
  } else {
    info(`Found ${downMigs.length} down-migration(s) for "${slug}":`);
    downMigs.forEach(({ file }) => log(`  ${c.yellow}>${c.reset} ${file}`));
  }

  if (!supabaseUrl) {
    warn('SUPABASE_URL not found in .env \u2014 apply the SQL manually via Supabase Dashboard \u2192 SQL Editor.');
    return false;
  }

  if (!process.stdin.isTTY) {
    warn('Non-interactive mode \u2014 apply down-migrations manually.');
    return false;
  }

  const promptText = autoGenerated
    ? `Apply auto-generated DROP SQL for "${slug}"? [y/N] `
    : `Apply these down-migrations (DROP tables) now? [y/N] `;
  const rl1 = createInterface({ input: process.stdin, output: process.stdout });
  const doApply = await new Promise((resolve) => {
    rl1.question(`${c.yellow}?${c.reset}  ${promptText}`, (a) => { rl1.close(); resolve(a.trim().toLowerCase()); });
  });
  if (doApply !== 'y' && doApply !== 'yes') {
    info('Skipped \u2014 apply the SQL manually via Supabase Dashboard \u2192 SQL Editor if you want to drop tables.');
    return false;
  }

  log('');
  info('Supabase personal access token (PAT) required for the Management API.');
  log(`  Create one at: ${c.cyan}https://supabase.com/dashboard/account/tokens${c.reset}`);
  log(`  ${c.yellow}PATs start with sbp_ or sb_pat_ \u2014 do NOT use your anon/secret keys.${c.reset}`);
  log(`  The token is only used locally for this operation and is never stored.`);
  log('');
  const pat = await promptLine(`${c.cyan}Supabase PAT:${c.reset} `);
  if (!pat || pat.length < 10) {
    warn('No PAT entered \u2014 skipping. Apply the SQL manually if needed.');
    return false;
  }

  const projectRef = extractProjectRef(supabaseUrl);
  if (!projectRef) { warn('Could not extract project ref from SUPABASE_URL.'); return false; }

  log('');
  for (const { file, sql } of downMigs) {
    process.stdout.write(`  Applying ${c.yellow}${file}${c.reset}\u2026 `);
    try {
      await runSqlQuery(projectRef, pat, sql);
      process.stdout.write(`${c.green}\u2713${c.reset}\n`);
    } catch (err) {
      process.stdout.write(`${c.red}\u2717${c.reset}\n`);
      warn(`  Failed: ${err.message}`);
      const rl2 = createInterface({ input: process.stdin, output: process.stdout });
      const cont = await new Promise((resolve) => {
        rl2.question(`${c.yellow}?${c.reset}  Continue with remaining? [y/N] `, (a) => { rl2.close(); resolve(a.trim().toLowerCase()); });
      });
      if (cont !== 'y' && cont !== 'yes') { warn('Down-migrations aborted.'); return false; }
    }
  }
  ok('Down-migrations applied \u2713');
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
  if (!existsSync(PLUGINS_JSON)) die(`plugins.json not found at ${PLUGINS_JSON}`);
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

// ─── Registry rebuild (mirrors install-plugins.mjs) ──────────────────────────

function rebuildRegistry() {
  const data = readPluginsJson();
  const slugs = (data.plugins ?? []).map((p) => p.id);
  const installed = [];

  for (const slug of slugs) {
    const dir = join(PLUGINS_DIR, slug);
    if (!existsSync(dir)) { warn(`src/plugins/${slug}/ not found — skipped in registry`); continue; }

    let ep = 'src/index.tsx';
    const m = loadManifest(dir);
    if (m?.entrypoint) ep = m.entrypoint;

    if (!existsSync(join(dir, ep))) { warn(`Entrypoint missing: src/plugins/${slug}/${ep} — skipped`); continue; }
    installed.push({ slug, ep });
  }

  const imports = installed.map((p, i) => `import plugin${i} from './${p.slug}/${p.ep}';`).join('\n');
  const items   = installed.map((_, i) => `  plugin${i},`).join('\n');

  writeFileSync(REGISTRY_FILE, `/**
 * AUTO-GENERATED by scripts/install-plugins.mjs — do not edit manually.
 *
 * This file is regenerated every time install-plugins.mjs runs.
 * It imports each installed plugin's default export (a PluginDefinition)
 * and collects them into a single array for the loader to consume.
 *
 * To add a plugin: run \`node scripts/install-plugins.mjs --add <github-url>\`
 * then rebuild and redeploy.
 */

import type { PluginDefinition } from '@/types/plugin';

// ─── Installed Plugin Imports ─────────────────────────────────────────────────
${imports || '// (no plugins installed)'}


// ─── Registry ─────────────────────────────────────────────────────────────────
const registeredPlugins: PluginDefinition[] = [
${items || '  // (no plugins installed)'}
];

export default registeredPlugins;
`, 'utf8');

  ok(`Registry rebuilt: ${installed.length} plugin(s) remaining`);
}

function rebuildPluginRoutes() {
  const data   = readPluginsJson();
  const slugs  = (data.plugins ?? []).map((p) => p.id);
  const routes = [];

  for (const slug of slugs) {
    const dir = join(PLUGINS_DIR, slug);
    if (!existsSync(dir)) continue;
    const m = loadManifest(dir);
    if (!m?.api_entrypoint) continue;
    const fullEpPath = join(dir, m.api_entrypoint);
    if (!existsSync(fullEpPath)) { warn(`api_entrypoint not found: src/plugins/${slug}/${m.api_entrypoint} — skipped`); continue; }
    const importPath = `../src/plugins/${slug}/${m.api_entrypoint.replace(/\.[^.]+$/, '')}`;
    const varName    = slug.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + 'Plugin';
    routes.push({ slug, varName, importPath });
  }

  const imports = routes.map((r) => `import ${r.varName} from '${r.importPath}';`).join('\n');
  const mounts  = routes.map((r) => `  app.route('/api/plugin/${r.slug}', ${r.varName});`).join('\n');

  writeFileSync(PLUGIN_ROUTES_FILE, `// AUTO-GENERATED by scripts/install-plugins.mjs — do not edit manually.
// Re-run \`npm run plugin:install\` to regenerate.
import type { Hono } from 'hono';
import type { Env } from './lib/supabase';

${imports || '// (no plugins with API routes installed)'}

export function mountPluginRoutes(app: Hono<{ Bindings: Env }>): void {
${mounts || '  // (no plugins with API routes installed)'}
}
`, 'utf8');

  ok(`Plugin routes rebuilt: api/plugin-routes.ts (${routes.length} route(s))`);
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

// ─── Commands ─────────────────────────────────────────────────────────────────

async function cmdList() {
  const { plugins = [] } = readPluginsJson();
  if (!plugins.length) { info('No plugins registered in plugins.json.'); return; }
  log(`\n${c.bold}Registered plugins:${c.reset}`);
  plugins.forEach((p) => {
    const installed = existsSync(join(PLUGINS_DIR, p.id))
      ? `${c.green}installed${c.reset}` : `${c.yellow}not installed${c.reset}`;
    log(`  ${c.cyan}${p.id}${c.reset}  ${p.repo_url ?? ''}  [${p.ref ?? 'HEAD'}]  ${installed}`);
  });
  log('');
}

async function cmdUninstall(pluginId, pruneDepsFlag) {
  const data    = readPluginsJson();
  const plugins = data.plugins ?? [];
  const entry   = plugins.find((p) => p.id === pluginId);

  if (!entry) {
    die(`Plugin "${pluginId}" not found in plugins.json.\nRun --list to see registered plugins.`);
  }

  // ── Supabase auth (best-effort — local cleanup proceeds even if login fails) ─
  let supabaseClient = null;
  const anonClient = createAnonClient();
  if (anonClient) {
    try {
      supabaseClient = await loginInteractive(anonClient);
    } catch (e) {
      warn(`Supabase login skipped (${e.message}) \u2014 DB status will not be updated.`);
    }
  } else {
    warn('Supabase credentials not found \u2014 DB status will not be updated.');
  }

  const pluginDir = join(PLUGINS_DIR, pluginId);
  const manifest  = existsSync(pluginDir) ? loadManifest(pluginDir) : null;

  // ── Summary ────────────────────────────────────────────────────────────────
  log('');
  log(`${c.bold}Removing plugin: ${pluginId}${c.reset}`);
  if (manifest) {
    log(`  ${manifest.name ?? pluginId}  v${manifest.version ?? '?'}  by ${manifest.author ?? '?'}`);
  }
  log('');

  if (!process.argv.includes('--yes') && !process.argv.includes('-y')) {
    const confirmed = await confirm(`Remove "${pluginId}" and delete src/plugins/${pluginId}/?`);
    if (!confirmed) { info('Aborted.'); process.exit(0); }
  }

  // ── 1. Collect manual-cleanup info before deleting the directory ───────────
  const apiEntrypoint  = manifest?.api_entrypoint ?? null;
  const migrations     = manifest?.migrations ?? [];
  // Read down-migration SQL into memory NOW, before the directory is deleted.
  const hasUpMigs = existsSync(join(pluginDir, 'migrations')) &&
    readdirSync(join(pluginDir, 'migrations')).some((f) => f.endsWith('.sql'));
  const downMigs = collectDownMigrations(pluginDir, pluginId);

  // ── 2. Delete directory ────────────────────────────────────────────────────
  if (existsSync(pluginDir)) {
    await rm(pluginDir, { recursive: true, force: true });
    ok(`Deleted src/plugins/${pluginId}/`);
  } else {
    warn(`src/plugins/${pluginId}/ not found — already deleted?`);
  }

  // ── 3. Remove from plugins.json ────────────────────────────────────────────
  data.plugins = plugins.filter((p) => p.id !== pluginId);
  writePluginsJson(data);
  ok(`Removed "${pluginId}" from plugins.json`);

  // ── 4. Rebuild registry + plugin API routes ────────────────────────────────
  rebuildRegistry();
  rebuildPluginRoutes();

  // ── 5. Clean plugin-deps.json ──────────────────────────────────────────────
  const pluginDeps = readPluginDeps();
  if (pluginDeps[pluginId]) {
    const pkgNames = Object.keys(pluginDeps[pluginId]);
    delete pluginDeps[pluginId];
    writePluginDeps(pluginDeps);
    ok(`Removed "${pluginId}" from plugin-deps.json`);

    // ── 6. Optional: prune orphaned npm deps ──────────────────────────────────
    if (pruneDepsFlag) {
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

  // ── 6. Apply down-migrations ─────────────────────────────────────────────
  const migrationsDropped = await applyDownMigrations(pluginId, downMigs, hasUpMigs);

  // ── 7. Update Supabase status ─────────────────────────────────────────────
  await markPluginUninstalled(supabaseClient, pluginId);

  // ── 8. Manual steps summary ────────────────────────────────────────────────
  log('');
  log(`${c.bold}Manual cleanup required:${c.reset}`);

  if (apiEntrypoint) {
    ok(`API route wiring updated — api/plugin-routes.ts rebuilt automatically`);
  } else {
    ok('No API route to remove from api/index.ts');
  }

  if (migrations.length > 0 && !migrationsDropped) {
    warn(`Database tables from this plugin were NOT dropped.`);
    log(`  Apply the generated DROP SQL manually via Supabase Dashboard \u2192 SQL Editor.`);
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
  log('');
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  log('');
  log('Usage:');
  log('  node scripts/uninstall-plugin.mjs <plugin-id>               Remove a plugin');
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
  if (!pluginId) die('No plugin ID provided. Usage: node scripts/uninstall-plugin.mjs <plugin-id>');
  await cmdUninstall(pluginId, pruneDeps);
}
