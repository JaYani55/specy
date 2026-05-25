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
 *   2. Deletes plugins/{id}/
 *   3. Removes the entry from plugins.json
 *   4. Rebuilds generated plugin registry artifacts
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
import { rebuildWorkspacePluginArtifacts, scanWorkspacePlugins, WORKSPACE_PLUGINS_DIR } from './lib/plugin-workspace.mjs';

const __dirname          = dirname(fileURLToPath(import.meta.url));
const ROOT               = resolve(__dirname, '..');
const PLUGINS_JSON       = join(ROOT, 'plugins.json');
const PLUGINS_DIR        = WORKSPACE_PLUGINS_DIR;
const REGISTRY_FILE      = join(PLUGINS_DIR, 'registry.ts');
const HOOKS_REGISTRY_FILE = join(PLUGINS_DIR, 'hooks-registry.ts');
const PLUGIN_DEPS_FILE   = join(ROOT, 'plugin-deps.json');
const PLUGIN_ROUTES_FILE = join(ROOT, 'api', 'plugin-routes.ts');
const PLUGIN_METADATA_FILE = join(ROOT, 'api', 'plugin-metadata.ts');

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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ');
}

function normalizeIdentifierPart(part) {
  return part.replace(/^"+|"+$/g, '');
}

function getAllowedPluginSchemas(slug) {
  return [...new Set([slug.replace(/-/g, '_'), slug])].filter(Boolean);
}

function collectSqlFiles(dir, filePrefix, reverse = false) {
  if (!existsSync(dir)) return [];
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql') && !f.startsWith('.'))
      .sort();
    if (reverse) files.reverse();
    return files.map((f) => ({
      name: f,
      file: `${filePrefix}/${f}`,
      sql: readFileSync(join(dir, f), 'utf8'),
    }));
  } catch { return []; }
}

function validateScopedObjectTarget(identifier, allowedSchemas, file, statement, issues) {
  const parts = identifier.split('.');
  if (parts.length < 2) {
    issues.push(`${file}: ${statement} must target an explicit plugin schema, found "${identifier}".`);
    return;
  }

  const schema = normalizeIdentifierPart(parts[0]);
  if (!allowedSchemas.includes(schema)) {
    issues.push(`${file}: ${statement} targets schema "${schema}", expected one of: ${allowedSchemas.join(', ')}.`);
  }
}

function validateMigrationSchemaUsage(files, slug) {
  const allowedSchemas = getAllowedPluginSchemas(slug);
  const issues = [];
  const schemaChecks = [
    {
      statement: 'CREATE/ALTER/DROP TABLE',
      regex: /\b(?:CREATE|ALTER|DROP)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:ONLY\s+)?((?:"?[\w-]+"?\.)?"?[\w-]+"?)/gi,
    },
    {
      statement: 'CREATE/ALTER/DROP VIEW',
      regex: /\b(?:CREATE(?:\s+OR\s+REPLACE)?|ALTER|DROP)\s+(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?((?:"?[\w-]+"?\.)?"?[\w-]+"?)/gi,
    },
    {
      statement: 'CREATE/DROP FUNCTION',
      regex: /\b(?:CREATE(?:\s+OR\s+REPLACE)?|DROP)\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?((?:"?[\w-]+"?\.)?"?[\w-]+"?)\s*\(/gi,
    },
    {
      statement: 'CREATE/ALTER/DROP TYPE',
      regex: /\b(?:CREATE|ALTER|DROP)\s+TYPE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?((?:"?[\w-]+"?\.)?"?[\w-]+"?)/gi,
    },
    {
      statement: 'CREATE/ALTER/DROP SEQUENCE',
      regex: /\b(?:CREATE|ALTER|DROP)\s+SEQUENCE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?((?:"?[\w-]+"?\.)?"?[\w-]+"?)/gi,
    },
    {
      statement: 'CREATE/ALTER/DROP POLICY',
      regex: /\b(?:CREATE|ALTER|DROP)\s+POLICY\s+"?[\w-]+"?\s+ON\s+((?:"?[\w-]+"?\.)?"?[\w-]+"?)/gi,
    },
    {
      statement: 'CREATE/DROP TRIGGER',
      regex: /\b(?:CREATE(?:\s+OR\s+REPLACE)?|DROP)\s+TRIGGER\s+"?[\w-]+"?\s+ON\s+((?:"?[\w-]+"?\.)?"?[\w-]+"?)/gi,
    },
    {
      statement: 'CREATE INDEX',
      regex: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:"?[\w-]+"?\s+)?ON\s+((?:"?[\w-]+"?\.)?"?[\w-]+"?)/gi,
    },
  ];

  for (const file of files) {
    const sql = stripSqlComments(file.sql);
    for (const check of schemaChecks) {
      for (const match of sql.matchAll(check.regex)) {
        validateScopedObjectTarget(match[1], allowedSchemas, file.file, check.statement, issues);
      }
    }
  }

  return issues;
}

function inspectMigrationCompliance(pluginDir, slug) {
  const migrationsDir = join(pluginDir, 'migrations');
  if (!existsSync(migrationsDir)) {
    return { upMigrations: [], downMigrations: null, issues: [] };
  }

  const upMigrations = collectSqlFiles(migrationsDir, `src/plugins/${slug}/migrations`);
  const downDir = join(migrationsDir, 'down');
  const downMigrations = existsSync(downDir)
    ? collectSqlFiles(downDir, `src/plugins/${slug}/migrations/down`, true)
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
async function applyDownMigrations(slug, downMigs, hasUpMigs) {
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

  if (!process.stdin.isTTY) {
    warn('Non-interactive mode — apply down-migrations manually.');
    return false;
  }

  const rl1 = createInterface({ input: process.stdin, output: process.stdout });
  const doApply = await new Promise((resolve) => {
    rl1.question(`${c.yellow}?${c.reset}  Apply these down-migrations now? [y/N] `, (a) => { rl1.close(); resolve(a.trim().toLowerCase()); });
  });
  if (doApply !== 'y' && doApply !== 'yes') {
    info('Skipped — apply the down-migrations manually via Supabase Dashboard → SQL Editor.');
    return false;
  }

  log('');
  info('Supabase personal access token (PAT) required for the Management API.');
  log(`  Create one at: ${c.cyan}https://supabase.com/dashboard/account/tokens${c.reset}`);
  log(`  ${c.yellow}PATs start with sbp_ or sb_pat_ — do NOT use your anon/secret keys.${c.reset}`);
  log(`  The token is only used locally for this operation and is never stored.`);
  log('');
  const pat = await promptLine(`${c.cyan}Supabase PAT:${c.reset} `);
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

function rebuildHookRegistry() {
  const data = readPluginsJson();
  const slugs = (data.plugins ?? []).map((p) => p.id);
  const installed = [];

  for (const slug of slugs) {
    const dir = join(PLUGINS_DIR, slug);
    if (!existsSync(dir)) { warn(`src/plugins/${slug}/ not found — skipped in hook registry`); continue; }

    let ep = 'src/index.tsx';
    const manifest = loadManifest(dir);
    if (manifest?.entrypoint) ep = manifest.entrypoint;

    if (!existsSync(join(dir, ep))) { warn(`Entrypoint missing: src/plugins/${slug}/${ep} — skipped in hook registry`); continue; }
    installed.push({ slug, ep });
  }

  const imports = installed.map((p, i) => `import plugin${i} from './${p.slug}/${p.ep}';`).join('\n');
  const items = installed.map((_, i) => `  ...(plugin${i}.hooks ?? []),`).join('\n');

  writeFileSync(HOOKS_REGISTRY_FILE, `/**
 * AUTO-GENERATED by scripts/install-plugins.mjs — do not edit manually.
 *
 * This file is regenerated every time install-plugins.mjs runs.
 * It flattens build-time hook contributions from installed plugins.
 */

import type { PluginHookContribution } from '@/types/plugin';

${imports || '// (no plugins installed)'}

const registeredHooks: PluginHookContribution[] = [
${items || '  // (no plugin hooks installed)'}
];

export default registeredHooks;
`, 'utf8');

  ok(`Hook registry rebuilt: ${installed.length} plugin(s) remaining`);
}

function rebuildPluginMetadata() {
  const data = readPluginsJson();
  const slugs = (data.plugins ?? []).map((p) => p.id);
  const entries = [];

  for (const slug of slugs) {
    const dir = join(PLUGINS_DIR, slug);
    if (!existsSync(dir)) continue;

    const manifest = loadManifest(dir);
    if (!manifest) continue;

    entries.push({
      pluginId: manifest.id ?? slug,
      hookMetadata: Array.isArray(manifest.hook_metadata) ? manifest.hook_metadata : [],
      apiMetadata: manifest.api_metadata ?? null,
      capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : [],
    });
  }

  writeFileSync(PLUGIN_METADATA_FILE, `// AUTO-GENERATED by scripts/install-plugins.mjs — do not edit manually.
// Re-run \`npm run plugin:install\` to regenerate.
import type { PluginApiMetadata, PluginCapabilityDescriptor, PluginHookDescriptor } from '@/types/plugin';

export interface RegisteredPluginMetadata {
  pluginId: string;
  hookMetadata: PluginHookDescriptor[];
  apiMetadata: PluginApiMetadata | null;
  capabilities: PluginCapabilityDescriptor[];
}

const registeredPluginMetadata: RegisteredPluginMetadata[] = ${JSON.stringify(entries, null, 2)};

export function getRegisteredPluginMetadata(): RegisteredPluginMetadata[] {
  return registeredPluginMetadata;
}
`, 'utf8');

  ok(`Plugin metadata rebuilt: ${entries.length} plugin(s) described`);
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
  const plugins = scanWorkspacePlugins();
  if (!plugins.length) { info('No workspace plugins found in /plugins.'); return; }
  log(`\n${c.bold}Workspace plugins:${c.reset}`);
  plugins.forEach((plugin) => {
    log(`  ${c.cyan}${plugin.id}${c.reset}  plugins/${plugin.dirName}`);
  });
  log('');
}

async function cmdUninstall(pluginId, pruneDepsFlag) {
  const data    = readPluginsJson();
  const plugins = data.plugins ?? [];
  const entry   = plugins.find((p) => p.id === pluginId) ?? null;
  const pluginDir = join(PLUGINS_DIR, pluginId);

  if (!entry && !existsSync(pluginDir)) {
    die(`Plugin "${pluginId}" not found in /plugins or plugins.json.\nRun --list to see workspace plugins.`);
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

  const manifest  = existsSync(pluginDir) ? loadManifest(pluginDir) : null;

  // ── Summary ────────────────────────────────────────────────────────────────
  log('');
  log(`${c.bold}Removing plugin: ${pluginId}${c.reset}`);
  if (manifest) {
    log(`  ${manifest.name ?? pluginId}  v${manifest.version ?? '?'}  by ${manifest.author ?? '?'}`);
  }
  log('');

  if (!process.argv.includes('--yes') && !process.argv.includes('-y')) {
    const confirmed = await confirm(`Remove "${pluginId}" and delete plugins/${pluginId}/?`);
    if (!confirmed) { info('Aborted.'); process.exit(0); }
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

  // ── 2. Delete directory ────────────────────────────────────────────────────
  if (existsSync(pluginDir)) {
    await rm(pluginDir, { recursive: true, force: true });
    ok(`Deleted plugins/${pluginId}/`);
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
