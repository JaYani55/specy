#!/usr/bin/env node
/**
 * scripts/setup.mjs
 *
 * Interactive first-time setup wizard for specy on Cloudflare Workers.
 *
 * Steps:
 *  1. Cloudflare login  (wrangler login)
 *  2. Account ID        (auto-detected or manual)
 *  3. Secrets Store     (list existing / create / enter manually)
 *  4. Patch wrangler.jsonc with the collected values
 *  5. CF_API_TOKEN      (wrangler secret put — stored in Workers secrets, not the file)
 *  6. Supabase + storage credentials (Worker secret, Secrets Store, wrangler.jsonc vars)
 *  6b. Write .env with VITE_ vars so Vite bakes them into the frontend bundle
 *  7. Apply database migrations via Supabase Management API
 *  8. Build             (npm run build  — consumes .env)
 *  9. Deploy            (wrangler deploy)
 */

import {
  intro,
  outro,
  text,
  password,
  select,
  confirm,
  spinner,
  note,
  log,
  isCancel,
  cancel,
} from '@clack/prompts';
import { execSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pc from 'picocolors';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Run a command silently (stderr captured), return stdout or null on error.
 */
function run(cmd) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Run a wrangler command with fully inherited stdio (interactive).
 * Uses npx for cross-platform compatibility.
 */
function wranglerInteractive(...args) {
  const result = spawnSync('npx', ['wrangler', ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  return result.status === 0;
}

/**
 * Run wrangler silently and return combined stdout output or null on error.
 */
function wranglerSilent(...args) {
  try {
    return execSync(
      `npx wrangler ${args.join(' ')}`,
      { encoding: 'utf8', cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], shell: true },
    ).trim();
  } catch {
    return null;
  }
}

function bailOnCancel(value) {
  if (isCancel(value)) {
    cancel('Setup cancelled.');
    process.exit(0);
  }
  return value;
}

function parseWhoamiAccounts(raw) {
  if (!raw) return { email: null, accounts: [] };

  try {
    const data = JSON.parse(raw);
    return {
      email: data.email ?? null,
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
    };
  } catch {
    return { email: null, accounts: [] };
  }
}

async function promptForAccount(accounts, message) {
  if (accounts.length === 0) return null;

  if (accounts.length === 1) {
    const account = accounts[0];
    log.success(`Detected account: ${pc.bold(account.name)} (${pc.dim(account.id)})`);
    return account.id;
  }

  return bailOnCancel(
    await select({
      message,
      options: [
        ...accounts.map((account) => ({
          label: `${pc.bold(account.name)}  ${pc.dim(account.id)}`,
          value: account.id,
        })),
        { label: pc.dim('✏  Enter Account ID manually'), value: '__manual__' },
      ],
    }),
  );
}

async function askAccountId() {
  return bailOnCancel(
    await text({
      message: 'Cloudflare Account ID:',
      placeholder: 'e.g. a1b2c3d4e5f6…  (dash.cloudflare.com → right sidebar)',
      validate: (v) =>
        v.trim().length < 8 ? 'Looks too short — paste the full Account ID.' : undefined,
    }),
  );
}

// ── Step helpers ───────────────────────────────────────────────────────────

async function stepLogin() {
  const s = spinner();
  s.start('Checking Cloudflare authentication…');
  const raw = wranglerSilent('whoami', '--json');
  s.stop('');

  if (raw) {
    const { email } = parseWhoamiAccounts(raw);
    log.success(`Already authenticated as ${pc.bold(email ?? 'user')}`);

    const reuse = bailOnCancel(
      await confirm({
        message: 'Reuse this Cloudflare login?',
        initialValue: true,
      }),
    );

    if (reuse) return;
  }

  log.step('Running ' + pc.cyan('wrangler login') + '…');
  const ok = wranglerInteractive('login');
  if (!ok) {
    log.warn('wrangler login exited with a non-zero code — continuing anyway.');
  }
}

async function prepareWranglerConfigForAccount(accountId) {
  patchWranglerJsonc(accountId, 'REPLACE_WITH_YOUR_SECRETS_STORE_ID');
}

async function detectAccountId() {
  // Try to auto-detect after login
  const raw = wranglerSilent('whoami', '--json');
  if (raw) {
    const { accounts } = parseWhoamiAccounts(raw);
    const choice = await promptForAccount(
      accounts,
      'Which Cloudflare account should this installation use?',
    );

    if (choice && choice !== '__manual__') return choice;
  }

  return askAccountId();
}

async function stepSecretsStore() {
  const s = spinner();
  s.start('Fetching Secrets Stores…');
  const raw = wranglerSilent('secrets-store', 'store', 'list', '--remote', '--json');
  s.stop('');

  let stores = [];
  if (raw) {
    try { stores = JSON.parse(raw); } catch { /* ignore */ }
  }

  if (stores.length > 0) {
    const choice = bailOnCancel(
      await select({
        message: 'Which Secrets Store should specy use?',
        options: [
          ...stores.map((st) => ({
            label: `${pc.bold(st.name)}  ${pc.dim(st.id)}`,
            value: st.id,
          })),
          { label: pc.cyan('+ Create a new store named "specy"'), value: '__new__' },
          { label: pc.dim('✏  Enter Store ID manually'),              value: '__manual__' },
        ],
      }),
    );
    if (choice === '__new__')    return createStore();
    if (choice === '__manual__') return askStoreId();
    return choice;
  }

  const doCreate = bailOnCancel(
    await confirm({
      message: 'No Secrets Stores found. Create one named "specy"?',
    }),
  );
  return doCreate ? createStore() : askStoreId();
}

async function createStore() {
  const s = spinner();
  s.start('Creating Secrets Store "specy" (–remote)…');
  const out = wranglerSilent('secrets-store', 'store', 'create', 'specy', '--remote');
  s.stop('');

  if (out) {
    const match = out.match(/[0-9a-f]{32}/i);
    if (match) {
      log.success(`Store created — ID: ${pc.bold(match[0])}`);
      return match[0];
    }
    log.warn('Could not auto-detect store ID from output:\n' + out);
  } else {
    log.warn('wrangler secrets-store create returned no output.');
  }

  return askStoreId();
}

async function askStoreId() {
  return bailOnCancel(
    await text({
      message: 'Secrets Store ID:',
      placeholder: 'e.g. xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      validate: (v) =>
        v.trim().length < 8 ? 'Looks too short — paste the full Store ID.' : undefined,
    }),
  );
}

async function putSecretsStoreSecret(storeId, name, value) {
  const result = spawnSync(
    'npx',
    [
      'wrangler', 'secrets-store', 'secret', 'create', storeId,
      '--name',   name,
      '--value',  value.trim(),
      '--scopes', 'workers',
      '--remote',
    ],
    {
      cwd:      ROOT,
      encoding: 'utf8',
      stdio:    ['ignore', 'pipe', 'pipe'],
      shell:    true,
    },
  );

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    log.warn(
      `Could not store ${pc.cyan(name)} — set it manually via the /verwaltung/connections UI.\n` +
      (detail ? `  wrangler said: ${detail}` : ''),
    );
    return false;
  }
  return true;
}

/**
 * Store a value as an encrypted Worker secret via `wrangler secret put`.
 * Returns true on success.
 */
function putWorkerSecret(name, value) {
  const result = spawnSync(
    'npx',
    ['wrangler', 'secret', 'put', name],
    {
      input: value.trim() + '\n',
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    log.warn(
      `Could not store Worker secret ${pc.cyan(name)} \u2014 run manually: npx wrangler secret put ${name}\n` +
      (detail ? `  wrangler said: ${detail}` : ''),
    );
    return false;
  }
  return true;
}

async function stepSupabaseSecrets(storeId) {
  note(
    [
      'Find these values at:',
      pc.cyan('  supabase.com/dashboard → your project → Settings → API'),
      '',
      `  ${pc.bold('Publishable key')}  ${pc.dim('(safe for client / Worker — like the old anon key)')}`,
      `  ${pc.bold('Secret key')}       ${pc.dim('(server-side only, bypasses RLS — like the old service role key)')}`,
    ].join('\n'),
    'Supabase credentials',
  );

  const supabaseUrl = bailOnCancel(
    await text({
      message: 'SUPABASE_URL:',
      placeholder: 'https://xxxxxxxxxxxx.supabase.co',
      validate: (v) =>
        !v.trim().startsWith('https://') ? 'Should start with https://' : undefined,
    }),
  );

  const supabasePublishableKey = bailOnCancel(
    await password({
      message: 'SUPABASE_PUBLISHABLE_KEY (input hidden):',
      placeholder: 'sb_publishable_...',
      validate: (v) =>
        v.trim().length < 10 ? 'Key looks too short.' : undefined,
    }),
  );

  const storageProvider = bailOnCancel(
    await select({
      message: 'Storage provider:',
      options: [
        { label: 'Supabase Storage  ' + pc.dim('(uses existing credentials)'), value: 'supabase' },
        { label: 'Cloudflare R2', value: 'r2' },
      ],
    }),
  );

  const storageBucket = bailOnCancel(
    await text({
      message: 'Storage bucket name:',
      placeholder: storageProvider === 'supabase' ? 'booking_media' : 'my-r2-bucket',
      initialValue: storageProvider === 'supabase' ? 'booking_media' : '',
    }),
  );

  let r2PublicUrl = '';
  if (storageProvider === 'r2') {
    r2PublicUrl = bailOnCancel(
      await text({
        message: 'R2 public URL:',
        placeholder: 'https://pub-xxx.r2.dev',
        validate: (v) =>
          !v.trim().startsWith('https://') ? 'Should start with https://' : undefined,
      }),
    );
  }

  note(
    [
      'The Secret Key is needed to apply database migrations.',
      pc.cyan('  supabase.com/dashboard → your project → Settings → API → secret'),
      pc.dim('  Keep this secret — it bypasses Row Level Security.'),
    ].join('\n'),
    'Secret Key',
  );

  const supabaseSecretKey = bailOnCancel(
    await password({
      message: 'SUPABASE_SECRET_KEY (input hidden):',
      placeholder: 'sb_secret_...',
      validate: (v) =>
        v.trim().length < 10 ? 'Key looks too short.' : undefined,
    }),
  );

  const secrets = [
    // Only SUPABASE_SECRET_KEY goes into the Secrets Store.
    // SUPABASE_URL + storage values → wrangler vars (written by patchWranglerVars).
    // SUPABASE_PUBLISHABLE_KEY → Worker secret (wrangler secret put).
  ];

  // ── Store SUPABASE_PUBLISHABLE_KEY as an encrypted Worker secret ────────
  const ws = spinner();
  ws.start(`Storing ${pc.yellow('SUPABASE_PUBLISHABLE_KEY')} as Worker secret…`);
  const wpOk = putWorkerSecret('SUPABASE_PUBLISHABLE_KEY', supabasePublishableKey);
  if (wpOk) {
    ws.stop(pc.green('SUPABASE_PUBLISHABLE_KEY stored as Worker secret ✓'));
  } else {
    ws.stop(pc.yellow('Skipped — run manually: npx wrangler secret put SUPABASE_PUBLISHABLE_KEY'));
  }

  // ── Store SUPABASE_SECRET_KEY in Secrets Store ──────────────────────────
  const ss2 = spinner();
  ss2.start(`Storing ${pc.yellow('SUPABASE_SECRET_KEY')} in Secrets Store…`);
  const ssOk = await putSecretsStoreSecret(storeId, 'SUPABASE_SECRET_KEY', supabaseSecretKey);
  if (ssOk) {
    ss2.stop(pc.green('SUPABASE_SECRET_KEY stored in Secrets Store ✓'));
  } else {
    ss2.stop(pc.yellow('Skipped — set it via /verwaltung/connections after deploy.'));
  }

  if (storageProvider === 'r2') {
    note(
      [
        'You chose R2 as the storage provider.',
        'Remember to uncomment the ' + pc.yellow('r2_buckets') + ' section in wrangler.jsonc',
        'and replace the bucket name before deploying.',
      ].join('\n'),
      'R2 reminder',
    );
  }

  // ── Write .env for Vite build-time substitution ────────────────────────
  const ev = spinner();
  ev.start('Writing .env with VITE_ vars for Vite build…');
  writeEnvFile(supabaseUrl, supabasePublishableKey);
  ev.stop(pc.green('.env written ✓  (VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY)'));

  // ── Write .dev.vars for local `wrangler dev` ───────────────────────────
  const dv = spinner();
  dv.start('Writing .dev.vars for local wrangler dev…');
  writeDevVarsFile(supabasePublishableKey);
  dv.stop(pc.green('.dev.vars written ✓  (SUPABASE_PUBLISHABLE_KEY)'));

  return { supabaseUrl, supabaseSecretKey, storageProvider, storageBucket, r2PublicUrl };
}

function patchWranglerJsonc(accountId, storeId) {
  const templatePath = join(ROOT, 'wrangler.default.jsonc');
  const outputPath   = join(ROOT, 'wrangler.jsonc');
  let txt = readFileSync(templatePath, 'utf8');
  txt = txt.replaceAll('REPLACE_WITH_YOUR_CF_ACCOUNT_ID',    accountId.trim());
  txt = txt.replaceAll('REPLACE_WITH_YOUR_SECRETS_STORE_ID', storeId.trim());
  writeFileSync(outputPath, txt, 'utf8');
}

/**
 * Patch the Supabase + storage vars into the already-generated wrangler.jsonc.
 * Called after stepSupabaseSecrets so all values are available.
 */
function patchWranglerVars(supabaseUrl, storageProvider, storageBucket, r2PublicUrl) {
  const path = join(ROOT, 'wrangler.jsonc');
  let txt = readFileSync(path, 'utf8');
  txt = txt.replaceAll('REPLACE_WITH_SUPABASE_URL',     supabaseUrl.trim());
  txt = txt.replaceAll('REPLACE_WITH_STORAGE_PROVIDER', storageProvider.trim());
  txt = txt.replaceAll('REPLACE_WITH_STORAGE_BUCKET',   storageBucket.trim());
  if (r2PublicUrl) {
    txt = txt.replace('"R2_PUBLIC_URL":    ""', `"R2_PUBLIC_URL":    "${r2PublicUrl.trim()}"`);
  }
  writeFileSync(path, txt, 'utf8');
}

/**
 * Step: register a first super-admin user directly via the Supabase Admin API.
 * - Creates the auth user with email_confirm:true (no email verification).
 * - Upserts the 'super-admin' role with app=["mentorbooking"].
 * - Creates the user_profile row.
 * - Assigns the role in user_roles.
 */
async function stepFirstAdmin(supabaseUrl, supabaseSecretKey) {
  const skip = bailOnCancel(
    await confirm({
      message: 'Create a first super-admin account now?',
      initialValue: true,
    }),
  );
  if (!skip) {
    log.info('Skipping first-admin setup — create a user manually after deploy.');
    return;
  }

  const adminEmail = bailOnCancel(
    await text({
      message: 'Admin email:',
      placeholder: 'admin@example.com',
      validate: (v) => (!v.includes('@') ? 'Enter a valid email address.' : undefined),
    }),
  );

  const adminPassword = bailOnCancel(
    await password({
      message: 'Admin password (min 8 chars, input hidden):',
      validate: (v) => (v.trim().length < 8 ? 'Password must be at least 8 characters.' : undefined),
    }),
  );

  const headers = {
    apikey:          supabaseSecretKey.trim(),
    Authorization:   `Bearer ${supabaseSecretKey.trim()}`,
    'Content-Type':  'application/json',
  };

  // ── 1. Create auth user (email_confirm:true = no verification mail) ────────
  const s1 = spinner();
  s1.start('Creating auth user…');
  const authRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method:  'POST',
    headers,
    body: JSON.stringify({
      email:         adminEmail.trim(),
      password:      adminPassword.trim(),
      email_confirm: true,
    }),
  });

  if (!authRes.ok) {
    const body = await authRes.json().catch(() => ({}));
    s1.stop(pc.red('Failed to create auth user.'));
    log.warn(body.message || body.msg || JSON.stringify(body));
    return;
  }
  const authUser = await authRes.json();
  const userId   = authUser.id;
  s1.stop(pc.green(`Auth user created ✓  (${pc.dim(userId)})`));

  // ── 2. Upsert super-admin role ────────────────────────────────────────────
  const s2 = spinner();
  s2.start('Creating super-admin role…');
  const roleInsertRes = await fetch(`${supabaseUrl}/rest/v1/roles`, {
    method:  'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      name:        'super-admin',
      description: 'Full system access',
      app:         ['mentorbooking'],
    }),
  });

  let roleId = null;
  if (roleInsertRes.ok) {
    const roleData = await roleInsertRes.json().catch(() => null);
    roleId = Array.isArray(roleData) ? roleData[0]?.id : roleData?.id;
  }

  // Fall back to reading the existing row if the insert returned no ID
  if (!roleId) {
    const qRes = await fetch(
      `${supabaseUrl}/rest/v1/roles?name=eq.super-admin&select=id`,
      { headers },
    );
    const qData = await qRes.json().catch(() => []);
    roleId = qData[0]?.id;
  }

  if (!roleId) {
    s2.stop(pc.yellow('Could not create or locate super-admin role — role assignment skipped.'));
  } else {
    s2.stop(pc.green(`super-admin role ready ✓  ${pc.dim('(id: ' + roleId + ')')})`));
  }

  // ── 3. Create user_profile row ────────────────────────────────────────────
  const s3 = spinner();
  s3.start('Creating user_profile…');
  const profileRes = await fetch(`${supabaseUrl}/rest/v1/user_profile`, {
    method:  'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      user_id:  userId,
      Username: adminEmail.trim().split('@')[0],
    }),
  });

  if (!profileRes.ok) {
    const body = await profileRes.json().catch(() => ({}));
    s3.stop(pc.yellow('Could not insert user_profile.'));
    log.warn(body.message || JSON.stringify(body));
  } else {
    s3.stop(pc.green('user_profile created ✓'));
  }

  // ── 4. Assign super-admin role ────────────────────────────────────────────
  if (roleId) {
    const s4 = spinner();
    s4.start('Assigning super-admin role in user_roles…');
    const assignRes = await fetch(`${supabaseUrl}/rest/v1/user_roles`, {
      method:  'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ user_id: userId, role_id: roleId }),
    });

    if (!assignRes.ok) {
      const body = await assignRes.json().catch(() => ({}));
      s4.stop(pc.yellow('Could not assign role.'));
      log.warn(body.message || JSON.stringify(body));
    } else {
      s4.stop(pc.green('super-admin role assigned ✓'));
      log.success(
        `First admin ready — log in with: ${pc.bold(adminEmail.trim())}`,
      );
    }
  }
}

/**
 * Write a .env file so Vite bakes VITE_ variables into the frontend bundle
 * at build time. Worker vars/secrets are server-side only and never visible
 * to the browser bundle — the .env file bridges that gap.
 * The file is git-ignored and regenerated on every setup run.
 */
function writeEnvFile(supabaseUrl, supabasePublishableKey) {
  const envPath = join(ROOT, '.env');
  const contents = [
    '# Generated by npm run setup — do not commit (git-ignored)',
    `VITE_SUPABASE_URL=${supabaseUrl.trim()}`,
    `VITE_SUPABASE_PUBLISHABLE_KEY=${supabasePublishableKey.trim()}`,
  ].join('\n') + '\n';
  writeFileSync(envPath, contents, 'utf8');
}

/**
 * Write .dev.vars so `wrangler dev` can access Worker secrets locally.
 * Mirrors the values stored via `wrangler secret put` in production.
 * The file is git-ignored and regenerated on every setup run.
 */
function writeDevVarsFile(supabasePublishableKey) {
  const devVarsPath = join(ROOT, '.dev.vars');
  const contents = [
    '# Local secrets for `wrangler dev` — do not commit (git-ignored)',
    '# These mirror the Worker secrets set via `wrangler secret put` in production.',
    '# See: https://developers.cloudflare.com/workers/testing/local-development/#secrets',
    `SUPABASE_PUBLISHABLE_KEY=${supabasePublishableKey.trim()}`,
  ].join('\n') + '\n';
  writeFileSync(devVarsPath, contents, 'utf8');
}

async function stepApiToken() {
  note(
    [
      'Create a token at ' + pc.cyan('dash.cloudflare.com/profile/api-tokens'),
      '',
      'Required permission:',
      pc.bold('  Account → Secrets Store → Edit'),
      '',
      'The token is stored as a Worker secret (not in wrangler.jsonc).',
    ].join('\n'),
    'CF API Token',
  );

  const token = bailOnCancel(
    await password({
      message: 'Paste CF_API_TOKEN (input hidden):',
      validate: (v) =>
        v.trim().length < 10 ? 'Token looks too short — please paste the full token.' : undefined,
    }),
  );

  const s = spinner();
  s.start('Setting CF_API_TOKEN via wrangler secret put…');

  const result = spawnSync(
    'npx',
    ['wrangler', 'secret', 'put', 'CF_API_TOKEN'],
    {
      input: token.trim() + '\n',
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    },
  );

  if (result.status !== 0) {
    s.stop(pc.yellow('Warning: wrangler secret put exited non-zero — you may need to run it manually.'));
    if (result.stderr) log.warn(result.stderr.trim());
  } else {
    s.stop(pc.green('CF_API_TOKEN stored as Worker secret ✓'));
  }
}

// ── Migration helpers ─────────────────────────────────────────────────────

/**
 * Extract the Supabase project ref from the project URL.
 * e.g. https://abcdefghij.supabase.co  →  abcdefghij
 */
function extractProjectRef(supabaseUrl) {
  try {
    const host = new URL(supabaseUrl).hostname; // abcdefghij.supabase.co
    return host.split('.')[0];
  } catch {
    return null;
  }
}

/**
 * Check whether the `pages` table already exists by querying the Supabase
 * REST API with the service role key.
 * Returns true (exists), false (does not exist), or null (unknown / auth error).
 */
async function checkTablesExist(supabaseUrl, serviceRoleKey) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/pages?select=id&limit=1`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    if (res.ok) return true;
    const body = await res.json().catch(() => ({}));
    if (body.code === '42P01') return false; // relation does not exist
    return null;
  } catch {
    return null;
  }
}

/**
 * Execute a SQL string against the project via the Supabase Management API.
 * Requires a personal access token (PAT) from supabase.com/dashboard/account/tokens.
 */
async function runSqlQuery(projectRef, pat, sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!res.ok) {
    const rawText = await res.text().catch(() => '');
    let detail = rawText;
    try {
      const body = JSON.parse(rawText);
      detail = body.message || body.error || body.msg || rawText;
    } catch { /* use rawText */ }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return res.json().catch(() => null);
}

/**
 * Step: apply the SQL migration files in the correct dependency order.
 * Uses the Supabase Management API (requires a personal access token).
 */
async function stepMigrations(supabaseUrl, serviceRoleKey, storageProvider, storageBucket) {
  // ── 1. Check if schema is already present ──────────────────────────────
  const s = spinner();
  s.start('Checking if database schema already exists…');
  const exists = await checkTablesExist(supabaseUrl, serviceRoleKey);
  s.stop('');

  if (exists === true) {
    log.success('Database schema detected — tables already exist.');
    const rerun = bailOnCancel(
      await confirm({
        message: 'Run migrations anyway?  ' + pc.dim('(safe to re-run — DROP IF EXISTS guards are in place)'),
        initialValue: false,
      }),
    );
    if (!rerun) {
      log.info('Skipping migrations.');
      return;
    }
  } else if (exists === null) {
    log.warn('Could not verify schema status — will attempt migrations anyway.');
  } else {
    log.info('No schema found — will apply all migrations.');
  }

  // ── 2. Ask for Supabase personal access token ──────────────────────────
  note(
    [
      'Migrations are applied via the Supabase Management API.',
      'Create a personal access token (PAT) at:',
      pc.cyan('  supabase.com/dashboard/account/tokens'),
      '',
      pc.bold('  ⚠️  Use a PAT — NOT your publishable or secret key.'),
      pc.dim('  PATs start with  sb_pat_  or  sbp_  and are created in your account settings.'),
      pc.dim('  The token is only used locally during setup and is never stored.'),
    ].join('\n'),
    'Supabase Management API token',
  );

  const pat = bailOnCancel(
    await password({
      message: 'Supabase personal access token (input hidden):',
      validate: (v) => {
        const t = v.trim();
        if (t.length < 10) return 'Token looks too short \u2014 paste the full token.';
        if (!t.startsWith('sbp_') && !t.startsWith('sb_pat_')) {
          return 'This does not look like a PAT (should start with sbp_ or sb_pat_). '
            + 'Do not use your publishable or secret key here.';
        }
      },
    }),
  );

  const projectRef = extractProjectRef(supabaseUrl);
  if (!projectRef) {
    log.warn('Could not extract project ref from SUPABASE_URL — skipping migrations.');
    return;
  }

  // ── 3. Ordered migration files ─────────────────────────────────────────
  // Dependency order (each file must come after everything it references):
  //
  //  preamble.sql              — app_enum type + all trigger functions
  //  user_profile.sql          — no deps
  //  roles.sql                 — needs app_enum (preamble)
  //  employers.sql             — legacy employer table, still used by auth helpers
  //  companies.sql             — needs user_profile + employers (legacy backfill)
  //  user_roles.sql            — needs roles + user_profile
  //  mentor_groups.sql         — no deps
  //  staff_registry.sql        — needs roles + user_roles + user_profile + mentor_groups
  //  products.sql              — needs set_current_timestamp_updated_at (preamble)
  //  page_schemas.sql          — needs set_current_timestamp_updated_at (preamble)
  //  forms.sql                 — needs set_current_timestamp_updated_at (preamble)
  //  forms_answers.sql         — needs forms
  //  forms_published_default.sql — converts legacy drafts and updates forms status default/check
  //  plugins.sql               — needs set_current_timestamp_updated_at (preamble)
  //  plugins_config_schema.sql — additive update for existing installations
  //  mentorbooking_products.sql — needs products (FK)
  //  pages.sql                 — renames products→pages; renames FK on mentorbooking_products
  //                              (must run AFTER mentorbooking_products so the FK to rename exists)
  //  mentorbooking_events.sql  — needs companies + staff_registry + mentorbooking_products + event functions
  //  mentorbooking_events_archive.sql — needs companies + staff_registry + mentorbooking_products
  //  mentorbooking_notifications.sql  — needs user_profile
  //  agent_logs.sql            — needs page_schemas
  //  agent_logs_hardening.sql  — tightens agent_logs RLS after base table setup
  //  Auth/Access_hook.sql      — needs roles + user_roles (last)
  // Storage RLS policies are only needed for Supabase Storage.
  // Cloudflare R2 manages its own permissions outside of Supabase.
  const MIGRATION_ORDER = [
    'preamble.sql',
    'user_profile.sql',
    'roles.sql',
    'employers.sql',
    'user_roles.sql',
    'mentor_groups.sql',
    'companies.sql',
    'staff_registry.sql',
    'products.sql',
    'page_schemas.sql',
    'forms.sql',
    'forms_answers.sql',
    'forms_published_default.sql',
    'plugins.sql',
    'plugins_config_schema.sql',
    'mentorbooking_products.sql',
    'pages.sql',
    'mentorbooking_events.sql',
    'mentorbooking_events_archive.sql',
    'mentorbooking_notifications.sql',
    'agent_logs.sql',
    'agent_logs_hardening.sql',
    'Auth/Access_hook.sql',
    // storage.sql is generated from storage.default.sql at runtime using the
    // user-chosen bucket name — only applies when STORAGE_PROVIDER = 'supabase'.
    ...(storageProvider === 'supabase' ? ['storage.sql'] : []),
  ];

  const migrationsDir = join(ROOT, 'migrations');
  const ms = spinner();
  let aborted = false;

  for (const file of MIGRATION_ORDER) {
    if (aborted) break;

    ms.start(`Applying ${pc.yellow(file)}…`);
    let sql;
    if (file === 'storage.sql') {
      // Read the template and substitute the user-chosen bucket name.
      try {
        sql = readFileSync(join(migrationsDir, 'storage.default.sql'), 'utf8')
          .replaceAll('REPLACE_WITH_STORAGE_BUCKET', storageBucket.trim());
      } catch {
        ms.stop(pc.yellow(`  ${file} — template storage.default.sql not found, skipping.`));
        continue;
      }
    } else {
      try {
        sql = readFileSync(join(migrationsDir, file), 'utf8');
      } catch {
        ms.stop(pc.yellow(`  ${file} — file not found, skipping.`));
        continue;
      }
    }

    try {
      await runSqlQuery(projectRef, pat.trim(), sql);
      ms.stop(pc.green(`  ${file} ✓`));
    } catch (err) {
      ms.stop(pc.red(`  ${file} — failed: ${err.message}`));

      const keepGoing = await confirm({
        message: `Migration ${pc.yellow(file)} failed. Continue with remaining migrations?`,
        initialValue: false,
      });
      if (isCancel(keepGoing) || !keepGoing) {
        aborted = true;
      }
    }
  }

  if (aborted) {
    log.warn('Migrations aborted. Fix the failing migration and re-run  npm run setup.');
    return;
  }

  log.success('Migrations complete.');

  // ── 4. Register the JWT claims hook in Supabase Auth ───────────────────
  // The function was just created by Auth/Access_hook.sql.
  // This PATCH call enables it as the "Customize Access Token (JWT) Claims"
  // hook in Supabase Auth → Auth Hooks (schema: public, fn: custom_access_token_hook).
  const hs = spinner();
  hs.start('Registering custom_access_token_hook in Supabase Auth Hooks…');
  try {
    const hookRes = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
      {
        method: 'PATCH',
        headers: {
          Authorization:  `Bearer ${pat.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hook_custom_access_token_enabled: true,
          hook_custom_access_token_uri:
            'pg-functions://postgres/public/custom_access_token_hook',
        }),
      },
    );
    if (!hookRes.ok) {
      const raw = await hookRes.text().catch(() => '');
      let detail = raw;
      try { detail = JSON.parse(raw).message || raw; } catch { /* ignore */ }
      hs.stop(pc.yellow(`Auth hook registration failed (HTTP ${hookRes.status}): ${detail}`));
      log.warn(
        'Enable it manually: Supabase dashboard → Authentication → Auth Hooks\n' +
        '  Type: Postgres function  |  Schema: public  |  Function: custom_access_token_hook',
      );
    } else {
      hs.stop(pc.green('custom_access_token_hook registered as JWT claims hook ✓'));
    }
  } catch (err) {
    hs.stop(pc.yellow(`Auth hook registration error: ${err.message}`));
    log.warn(
      'Enable it manually: Supabase dashboard → Authentication → Auth Hooks\n' +
      '  Type: Postgres function  |  Schema: public  |  Function: custom_access_token_hook',
    );
  }
}

async function stepBuild() {
  const go = bailOnCancel(
    await confirm({
      message: 'Build the project?  ' + pc.dim('(npm run build)'),
      initialValue: true,
    }),
  );
  if (!go) return;

  const s = spinner();
  s.start('Building…');

  const result = spawnSync('npm', ['run', 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });

  if (result.status !== 0) {
    s.stop(pc.red('Build failed.'));
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    const cont = bailOnCancel(
      await confirm({ message: 'Build failed — continue with deploy anyway?', initialValue: false }),
    );
    if (!cont) {
      cancel('Stopped after build failure. Fix the errors, then run npm run setup again.');
      process.exit(1);
    }
  } else {
    s.stop(pc.green('Build complete ✓'));
  }
}

async function stepDeploy() {
  const go = bailOnCancel(
    await confirm({
      message: 'Deploy to Cloudflare Workers?  ' + pc.dim('(wrangler deploy)'),
      initialValue: true,
    }),
  );
  if (!go) {
    log.info('Skipped deploy. Run ' + pc.cyan('npm run deploy') + ' when ready.');
    return;
  }

  log.step('Deploying — this may take ~30 seconds…');
  const ok = wranglerInteractive('deploy');
  if (!ok) {
    log.warn('Deploy exited with a non-zero code. Check the output above.');
  } else {
    log.success('Deployed successfully ✓');
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.clear();

  intro(
    pc.bgBlue(pc.white(pc.bold('  specy  '))) +
    pc.dim('  first-time setup'),
  );

  note(
    [
      pc.bold('This wizard will guide you through:'),
      '',
      `  ${pc.cyan('1.')} Cloudflare login`,
      `  ${pc.cyan('2.')} Account ID  +  Secrets Store selection`,
      `  ${pc.cyan('3.')} Patch ${pc.yellow('wrangler.jsonc')} with your values`,
      `  ${pc.cyan('4.')} Set ${pc.yellow('CF_API_TOKEN')} as a Worker secret`,
      `  ${pc.cyan('5.')} Supabase URL ${pc.dim('(var)')} + publishable key ${pc.dim('(Worker secret)')} + secret key ${pc.dim('(Secrets Store)')} + storage`,
      `  ${pc.cyan('6.')} Apply database migrations via Supabase Management API`,
      `  ${pc.cyan('7.')} Register first super-admin user`,
      `  ${pc.cyan('8.')} Build  →  Deploy`,
      '',
      pc.dim('You can re-run this wizard any time with  npm run setup'),
    ].join('\n'),
    'Steps',
  );

  bailOnCancel(await confirm({ message: 'Ready to begin?' }));

  // ── 1. Login ──────────────────────────────────────────────────────────────
  log.step(pc.bold('Step 1 — Cloudflare authentication'));
  await stepLogin();

  // ── 2. Account ID ─────────────────────────────────────────────────────────
  log.step(pc.bold('Step 2 — Account ID'));
  const accountId = await detectAccountId();

  const ac = spinner();
  ac.start('Preparing wrangler.jsonc for the selected Cloudflare account…');
  await prepareWranglerConfigForAccount(accountId);
  ac.stop(pc.green('wrangler.jsonc prepared with selected account ✓'));

  // ── 3. Secrets Store ──────────────────────────────────────────────────────
  log.step(pc.bold('Step 3 — Secrets Store'));
  const storeId = await stepSecretsStore();

  // ── 4. Patch wrangler.jsonc ───────────────────────────────────────────────
  const ps = spinner();
  ps.start('Writing the selected Secrets Store to wrangler.jsonc…');
  patchWranglerJsonc(accountId, storeId);
  ps.stop(pc.green('wrangler.jsonc updated ✓'));

  note(
    [
      `${pc.bold('CF_ACCOUNT_ID')}    = ${pc.cyan(accountId)}`,
      `${pc.bold('SECRETS_STORE_ID')} = ${pc.cyan(storeId)}`,
    ].join('\n'),
    'Values written to wrangler.jsonc',
  );

  // ── 5. CF_API_TOKEN ───────────────────────────────────────────────────────
  log.step(pc.bold('Step 4 — CF_API_TOKEN'));
  await stepApiToken();

  // ── 6. Supabase + Storage credentials ────────────────────────────────────
  log.step(pc.bold('Step 5 — Supabase & storage credentials'));
  const { supabaseUrl, supabaseSecretKey, storageProvider, storageBucket, r2PublicUrl } = await stepSupabaseSecrets(storeId);

  // Patch wrangler.jsonc vars with Supabase + storage values
  const vs = spinner();
  vs.start('Patching wrangler.jsonc with Supabase & storage vars…');
  patchWranglerVars(supabaseUrl, storageProvider, storageBucket, r2PublicUrl);
  vs.stop(pc.green('wrangler.jsonc vars updated ✓'));

  // ── 7. Database migrations ────────────────────────────────────────────────
  log.step(pc.bold('Step 6 — Database migrations'));
  await stepMigrations(supabaseUrl, supabaseSecretKey, storageProvider, storageBucket);

  // ── 8. First super-admin user ─────────────────────────────────────────────
  log.step(pc.bold('Step 7 — First super-admin user'));
  await stepFirstAdmin(supabaseUrl, supabaseSecretKey);

  // ── 9. Build ──────────────────────────────────────────────────────────────
  log.step(pc.bold('Step 8 — Build'));
  await stepBuild();

  // ── 10. Deploy ────────────────────────────────────────────────────────────
  log.step(pc.bold('Step 9 — Deploy'));
  await stepDeploy();

  // ── Done ──────────────────────────────────────────────────────────────────
  outro(
    [
      pc.green(pc.bold('Setup complete!')),
      '',
      'All secrets have been stored in the Secrets Store.',
      `You can update them any time via ${pc.cyan('/verwaltung/connections')} in your app.`,
    ].join('\n'),
  );
}

main().catch((err) => {
  log.error(err?.message ?? String(err));
  process.exit(1);
});
