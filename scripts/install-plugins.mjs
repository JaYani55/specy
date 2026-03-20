#!/usr/bin/env node
/**
 * install-plugins.mjs
 *
 * Fetches plugins registered in Supabase (public.plugins where status='registered'),
 * lets you pick which ones to install, downloads + wires them up.
 *
 * Usage:
 *   node scripts/install-plugins.mjs               # fetch from DB → interactive picker
 *   node scripts/install-plugins.mjs --all         # fetch from DB → install all (no picker, CI-safe)
 *   node scripts/install-plugins.mjs --local       # install from local plugins.json (no DB)
 *   node scripts/install-plugins.mjs --add <url>   # register a GitHub URL + install it directly
 *   node scripts/install-plugins.mjs --list        # list plugins (DB + local state)
 *   node scripts/install-plugins.mjs --help        # show usage
 *
 * Environment (.env or .env.local):
 *   VITE_SUPABASE_URL              Supabase project URL
 *   VITE_SUPABASE_PUBLISHABLE_KEY  Supabase anon/publishable key
 *   GITHUB_TOKEN                   (optional) GitHub PAT — avoids rate-limits, required for private repos
 *
 * DB operations use interactive login (email + password). No service key is stored locally.
 * Access is enforced by RLS + the custom JWT hook (admin or super-admin role required).
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
import { createClient } from '@supabase/supabase-js';

const __dirname     = dirname(fileURLToPath(import.meta.url));
const ROOT          = resolve(__dirname, '..');
const PLUGINS_JSON       = join(ROOT, 'plugins.json');
const PLUGINS_DIR        = join(ROOT, 'src', 'plugins');
const REGISTRY_FILE      = join(PLUGINS_DIR, 'registry.ts');
const PLUGIN_ROUTES_FILE = join(ROOT, 'api', 'plugin-routes.ts');
const PLUGIN_DEPS_FILE   = join(ROOT, 'plugin-deps.json');

// ─── Colours ──────────────────────────────────────────────────────────────────
const c = { reset:'\x1b[0m', bold:'\x1b[1m', red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m', cyan:'\x1b[36m' };
const log  = (...a) => console.log(...a);
const info = (m) => log(`${c.cyan}i${c.reset}  ${m}`);
const ok   = (m) => log(`${c.green}v${c.reset}  ${m}`);
const warn = (m) => log(`${c.yellow}!${c.reset}  ${m}`);
const fail = (m) => log(`${c.red}x${c.reset}  ${m}`);
const die  = (m) => { fail(m); process.exit(1); };

// ─── .env loader ─────────────────────────────────────────────────────────────
// Reads .env.local then .env; .env.local wins.
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

// ─── Supabase client (anon key — auth enforced by RLS + JWT hook) ───────────────────────
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

// Decode the roles injected by the custom_access_token_hook into the JWT claims.
function getJwtRoles(accessToken) {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString('utf8'));
    return Array.isArray(payload.user_roles) ? payload.user_roles : [];
  } catch { return []; }
}

// Prompt for a password without echoing characters.
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
      } else if (ch === '\u0003') { // Ctrl+C
        process.stdout.write('\n'); process.exit(0);
      } else if (ch === '\u007f' || ch === '\b') { // backspace
        if (pwd.length > 0) { pwd = pwd.slice(0, -1); process.stdout.write('\b \b'); }
      } else {
        pwd += ch; process.stdout.write('*');
      }
    };
    process.stdin.on('data', onData);
  });
}

// Regular line prompt — paste-friendly (no raw mode). Used for tokens that
// are never stored and don't need per-character masking.
function promptLine(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

// Interactive login: prompts for email + password, signs in, verifies role.
// Returns the authenticated supabase client, or calls die() if auth fails.
async function loginInteractive(client) {
  log('');
  log(`${c.bold}Plugin installer — Supabase login required${c.reset}`);
  info('Only users with the admin or super-admin role can install plugins.');
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
  return data.session;
}

// ─── DB helpers ──────────────────────────────────────────────────────────────
async function fetchRegisteredPlugins(supabase) {
  const { data, error } = await supabase
    .from('plugins')
    .select('slug, name, version, description, author_name, repo_url, download_url, status')
    .eq('status', 'registered')
    .order('name');
  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  return data ?? [];
}

async function markPluginInstalled(supabase, slug, version) {
  if (!supabase) return;
  const update = { status: 'installed', installed_at: new Date().toISOString() };
  if (version) update.version = version;
  const { error } = await supabase.from('plugins').update(update).eq('slug', slug);
  if (error) warn(`  Could not update DB status for "${slug}": ${error.message}`);
  else ok(`  DB status → installed`);
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

async function syncPluginConfigSchema(supabase, slug, configSchema) {
  if (!supabase) return;

  const { error } = await supabase
    .from('plugins')
    .update({ config_schema: sanitizeConfigSchema(configSchema) })
    .eq('slug', slug);

  if (error) {
    warn(`  Could not sync config schema for "${slug}": ${error.message}`);
  } else {
    ok('  DB config schema synced');
  }
}

async function markPluginError(supabase, slug, message) {
  if (!supabase) return;
  const { error } = await supabase
    .from('plugins')
    .update({ status: 'error', error_message: message })
    .eq('slug', slug);
  if (error) warn(`  Could not update DB error status for "${slug}": ${error.message}`);
}

// ─── Interactive picker ──────────────────────────────────────────────────────
async function pickPlugins(rows) {
  if (!rows.length) {
    info('No plugins with status "registered" found in the database.');
    return [];
  }

  log('');
  log(`${c.bold}Plugins registered in Supabase (status = registered):${c.reset}`);
  log('');
  rows.forEach((row, i) => {
    const local = existsSync(join(PLUGINS_DIR, row.slug))
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
  if (!existsSync(PLUGINS_JSON)) die(`plugins.json not found at ${PLUGINS_JSON}`);
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
  const h = { 'User-Agent': 'service-cms-plugin-installer/1.0', 'Accept': 'application/vnd.github+json' };
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

    ok(`  Extracted to src/plugins/${targetDir.split(/[\\/]src[\\/]plugins[\\/]/)[1]}`);
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

// ─── Registry rebuild ─────────────────────────────────────────────────────────

function rebuildRegistry(allSlugs) {
  const installed = [];
  for (const slug of allSlugs) {
    const dir = join(PLUGINS_DIR, slug);
    if (!existsSync(dir)) { warn(`src/plugins/${slug}/ not found — skipped`); continue; }

    let ep = 'src/index.tsx';
    const mp = join(dir, 'plugin.json');
    if (existsSync(mp)) {
      try { const m = JSON.parse(readFileSync(mp, 'utf8')); if (m.entrypoint) ep = m.entrypoint; } catch {}
    }
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

  ok(`Registry rebuilt: ${installed.length} plugin(s) wired up`);
  return installed;
}

// ─── Plugin API route wiring ─────────────────────────────────────────────────
// Regenerates api/plugin-routes.ts, which is imported by api/index.ts.
// Mirrors rebuildRegistry for the backend router.
function rebuildPluginRoutes(allSlugs) {
  const routes = [];
  for (const slug of allSlugs) {
    const dir = join(PLUGINS_DIR, slug);
    if (!existsSync(dir)) continue;
    const mp = join(dir, 'plugin.json');
    if (!existsSync(mp)) continue;
    let apiEp;
    try { const m = JSON.parse(readFileSync(mp, 'utf8')); apiEp = m.api_entrypoint; } catch {}
    if (!apiEp) continue;
    const fullEpPath = join(dir, apiEp);
    if (!existsSync(fullEpPath)) { warn(`api_entrypoint not found: src/plugins/${slug}/${apiEp} — skipped`); continue; }
    // Strip extension for TS import paths
    const importPath = `../src/plugins/${slug}/${apiEp.replace(/\.[^.]+$/, '')}`;
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

// ─── Supabase Management API helpers (mirrors setup.mjs) ────────────────────

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
        file: `src/plugins/${slug}/migrations/${f}`,
        sql:  readFileSync(join(migDir, f), 'utf8'),
      }));
  } catch { return []; }
}

// ─── Migration apply ──────────────────────────────────────────────────────────

async function applyPluginMigrations(slugs) {
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

  if (!process.stdin.isTTY) {
    warn('Non-interactive mode — apply migration files manually via Supabase Dashboard → SQL Editor.');
    return;
  }

  const rl1 = createInterface({ input: process.stdin, output: process.stdout });
  const doApply = await new Promise((resolve) => {
    rl1.question(`${c.yellow}?${c.reset}  Apply these migrations to Supabase now? [y/N] `, (a) => { rl1.close(); resolve(a.trim().toLowerCase()); });
  });
  if (doApply !== 'y' && doApply !== 'yes') {
    info('Skipped — apply the files manually via Supabase Dashboard → SQL Editor.');
    return;
  }

  log('');
  info('Supabase personal access token (PAT) required for the Management API.');
  log(`  Create one at: ${c.cyan}https://supabase.com/dashboard/account/tokens${c.reset}`);
  log(`  ${c.yellow}PATs start with sbp_ or sb_pat_ — do NOT use your anon/secret keys.${c.reset}`);
  log(`  The token is only used locally for this operation and is never stored.`);
  log('');
  const pat = await promptLine(`${c.cyan}Supabase PAT:${c.reset} `);
  if (!pat || pat.length < 10) {
    warn('No PAT entered — skipping migrations. Apply manually via Supabase Dashboard → SQL Editor.');
    return;
  }

  const projectRef = extractProjectRef(supabaseUrl);
  if (!projectRef) { warn('Could not extract project ref from SUPABASE_URL.'); return; }

  log('');
  for (const { file, sql } of allFiles) {
    process.stdout.write(`  Applying ${c.yellow}${file}${c.reset}… `);
    try {
      await runSqlQuery(projectRef, pat, sql);
      process.stdout.write(`${c.green}✓${c.reset}\n`);
    } catch (err) {
      process.stdout.write(`${c.red}✗${c.reset}\n`);
      warn(`  Failed: ${err.message}`);
      const rl2 = createInterface({ input: process.stdin, output: process.stdout });
      const cont = await new Promise((resolve) => {
        rl2.question(`${c.yellow}?${c.reset}  Continue with remaining migrations? [y/N] `, (a) => { rl2.close(); resolve(a.trim().toLowerCase()); });
      });
      if (cont !== 'y' && cont !== 'yes') { warn('Migrations aborted.'); return; }
    }
  }
  ok('Migrations applied ✓');
}

// ─── Core install loop ────────────────────────────────────────────────────────
// entries: array of { id, repo_url, download_url?, ref? }
// supabase: client or null (DB status updates skipped when null)
async function _doInstall(entries, supabase) {
  mkdirSync(PLUGINS_DIR, { recursive: true });
  const results = { ok: [], failed: [] };

  for (const plugin of entries) {
    log(`\n${c.bold}Installing: ${plugin.id}${c.reset}`);
    const parsed = parseGitHubUrl(plugin.repo_url);
    if (!parsed) { fail(`  Invalid repo_url: ${plugin.repo_url}`); results.failed.push(plugin.id); continue; }

    const zipUrl    = plugin.download_url ?? getZipUrl(parsed.owner, parsed.repo, plugin.ref ?? 'HEAD');
    let   activeId  = plugin.id;
    const targetDir = join(PLUGINS_DIR, activeId);
    try {
      await downloadAndExtract(zipUrl, targetDir);
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
          await syncPluginConfigSchema(supabase, activeId, m.config_schema);
          log('');
          info(`  Configuration keys for "${activeId}":`);
          m.config_schema.forEach((field) => {
            const tag = field.type === 'secret' ? ` ${c.yellow}[SECRET]${c.reset}` : '';
            const req = field.required ? ` ${c.red}(required)${c.reset}` : '';
            log(`    ${c.cyan}${field.key}${c.reset}${tag}${req}  —  ${field.description ?? field.label ?? ''}`);
          });
          log(`  → Set these in the Plugins admin UI at /plugins`);
        } else {
          await syncPluginConfigSchema(supabase, activeId, []);
        }

        // ── Update DB status ──────────────────────────────────────────────────
        await markPluginInstalled(supabase, activeId, m.version);
      }
      results.ok.push(activeId);
    } catch (e) {
      fail(`  Failed: ${e.message}`);
      await markPluginError(supabase, plugin.id, e.message);
      results.failed.push(plugin.id);
    }
  }

  // Rebuild registry and plugin API routes from ALL entries in plugins.json
  const allSlugs = (readPluginsJson().plugins ?? []).map((p) => p.id);
  rebuildRegistry(allSlugs);
  rebuildPluginRoutes(allSlugs);
  await applyPluginMigrations(results.ok);

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

  log('');
  info('Remaining manual steps:');
  log('  1. Set any required plugin config values at /plugins');
  log('  2. If migrations were skipped above: apply .sql files via Supabase Dashboard → SQL Editor');
  log('  3. Deploy  (e.g. npx wrangler deploy)');
  log('');
}

// ─── Commands ─────────────────────────────────────────────────────────────────

// List now also needs login to see full DB data; gracefully falls back if no client.
async function cmdList() {
  const client = createAnonClient();
  if (client) {
    info('Fetching plugin list from Supabase… (login required)');
    try {
      await loginInteractive(client);
      const { data: rows, error } = await client
        .from('plugins')
        .select('slug, name, version, status, installed_at')
        .order('name');
      await client.auth.signOut();
      if (error) throw error;
      if (!rows?.length) { info('No plugins in database.'); return; }
      log(`\n${c.bold}Plugins (Supabase + local):${c.reset}`);
      for (const row of rows) {
        const local   = existsSync(join(PLUGINS_DIR, row.slug)) ? `${c.green}local✔${c.reset}` : `${c.yellow}local✘${c.reset}`;
        const dbLabel = row.status === 'installed' ? `${c.green}${row.status}${c.reset}` : `${c.yellow}${row.status}${c.reset}`;
        log(`  ${c.cyan}${row.slug}${c.reset}  ${row.name}  v${row.version}  [db: ${dbLabel}]  [${local}]`);
      }
      log('');
      return;
    } catch (e) { await client.auth.signOut().catch(() => {}); warn(`Could not fetch from Supabase: ${e.message}`); }
  }
  // Fallback — local only
  const { plugins = [] } = readPluginsJson();
  if (!plugins.length) { info('No plugins registered in plugins.json.'); return; }
  log(`\n${c.bold}Registered plugins (local plugins.json):${c.reset}`);
  plugins.forEach((p) => {
    const state = existsSync(join(PLUGINS_DIR, p.id)) ? `${c.green}installed${c.reset}` : `${c.yellow}not installed${c.reset}`;
    log(`  ${c.cyan}${p.id}${c.reset}  ${p.repo_url}  [${p.ref ?? 'HEAD'}]  ${state}`);
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

  const client = createAnonClient();
  const supabase = client ? (await loginInteractive(client), client) : null;
  try {
    await _doInstall([entry], supabase);
  } finally {
    if (supabase) await supabase.auth.signOut();
  }
}

// Default: fetch from DB → interactive picker
async function cmdPickAndInstall(installAll = false) {
  const client = createAnonClient();
  if (!client) {
    fail('Supabase URL or publishable key not found in .env.');
    info('Run --local to install from plugins.json without a database connection.');
    process.exit(1);
  }

  await loginInteractive(client);

  info('Fetching registered plugins from Supabase…');
  let registered;
  try { registered = await fetchRegisteredPlugins(client); }
  catch (e) { await client.auth.signOut(); die(`Failed to fetch plugins from Supabase: ${e.message}`); }

  let selected;
  if (installAll) {
    if (!registered.length) { info('No plugins with status "registered" found.'); await client.auth.signOut(); return; }
    selected = registered;
    log('');
    info(`Installing all ${selected.length} registered plugin(s):`);
    selected.forEach((r) => log(`  ${c.cyan}+${c.reset}  ${r.name}  (${r.slug})${r.description ? '  — ' + r.description : ''}`));
    log('');
  } else {
    selected = await pickPlugins(registered);
    if (!selected || !selected.length) { await client.auth.signOut(); return; }
  }

  const entries = selected.map((row) => ({
    id:           row.slug,
    repo_url:     row.repo_url,
    download_url: row.download_url ?? undefined,
    ref:          'HEAD',
  }));

  syncToPluginsJson(entries);
  try {
    await _doInstall(entries, client);
  } finally {
    await client.auth.signOut();
    ok('Logged out.');
  }
}

// Fallback: install from plugins.json without DB login
async function cmdLocalInstall() {
  const data       = readPluginsJson();
  const allPlugins = data.plugins ?? [];
  if (!allPlugins.length) { info('No plugins in plugins.json.'); rebuildRegistry([]); return; }
  // No DB connection — pass null; DB status updates will be skipped
  await _doInstall(allPlugins, null);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  log('');
  log('Usage:');
  log('  node scripts/install-plugins.mjs               Fetch from DB → interactive picker');
  log('  node scripts/install-plugins.mjs --all         Fetch from DB → install all registered (CI-safe)');
  log('  node scripts/install-plugins.mjs --local       Install from local plugins.json (no DB required)');
  log('  node scripts/install-plugins.mjs --add <url>   Register + install a GitHub repo directly');
  log('  node scripts/install-plugins.mjs --list        List plugins (DB status + local state)');
  log('');
  log('Environment (.env or .env.local):');
  log('  VITE_SUPABASE_URL              Supabase project URL');
  log('  VITE_SUPABASE_PUBLISHABLE_KEY  Supabase anon/publishable key');
  log('  GITHUB_TOKEN                   GitHub PAT (optional, avoids rate-limits)');
  log('  Note: DB operations use interactive login — no service key needed.');
  log('');
} else if (args.includes('--list')) {
  await cmdList();
} else if (args.includes('--add')) {
  await cmdAdd(args[args.indexOf('--add') + 1]);
} else if (args.includes('--all')) {
  await cmdPickAndInstall(true);
} else if (args.includes('--local')) {
  await cmdLocalInstall();
} else {
  await cmdPickAndInstall(false);
}
