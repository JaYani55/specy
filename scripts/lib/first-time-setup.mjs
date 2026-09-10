#!/usr/bin/env node
/**
 * scripts/setup.mjs
 *
 * Interactive first-time setup wizard for service-cms on Cloudflare Workers.
 *
 * Steps:
 *  0. Worker name      (wrangler project name — default: specy)
 *  1. Cloudflare login  (wrangler login)
 *  2. Account ID        (auto-detected or manual)
 *  3. Secrets Store     (list existing / create / enter manually)
 *  4. Patch wrangler.jsonc with the collected values
 *  5. CF_API_TOKEN      (wrangler secret put — stored in Workers secrets, not the file)
 *  6. Supabase + storage credentials (Worker secret, Secrets Store, wrangler.jsonc vars)
 *  6b. Write .env with VITE_ vars so Vite bakes them into the frontend bundle
 *  7. Apply database migrations via Supabase Management API
 *  8. Sync Supabase Edge Function secrets + deploy functions/send_email
 *  8b. Provision ISIBOT_FLOWS_KV namespace for the PluraDash Isibot Flow Builder
 *      (only when the plugins/pluradash/ directory is present; the binding is
 *       patched into the generated wrangler.jsonc — wrangler.default.jsonc is
 *       never modified)
 *  9. Build             (npm run build  — consumes .env)
 * 10. Deploy            (wrangler deploy)
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
import { randomBytes } from 'crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pc from 'picocolors';
import { DEFAULT_WORKER_NAME, validateWorkerName } from './worker-name.mjs';
import { parseSecretsStoreList, findSecretIdInTable } from './secrets-stores.mjs';
import { removeSecretsStoreBinding } from './wrangler-config.mjs';
import { getMigrationOrder } from './migration-order.mjs';
import { recordWorkerDeployment } from './core-update.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..', '..');

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

function generateWorkerSecret() {
  return randomBytes(32).toString('hex');
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
  // Older wrangler versions emit JSON for `--json`; newer ones (>= 4.x) reject
  // the flag with "Unknown argument: json" and only print a table — in that
  // case re-run without the flag and parse the table instead. Note that the
  // failing invocation still exits 0 while printing the error to stderr, so a
  // non-JSON-looking result means the flag was rejected, not that the account
  // has no stores.
  let raw = wranglerSilent('secrets-store', 'store', 'list', '--remote', '--json');
  if (!raw || !/^\s*[[{]/.test(raw)) {
    raw = wranglerSilent('secrets-store', 'store', 'list', '--remote');
  }
  s.stop('');

  const stores = parseSecretsStoreList(raw);

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
    if (detail.includes('secret_name_already_exists') || detail.includes('[code: 1003]')) {
      return resolveSecretsStoreConflict(storeId, name, value);
    }
    log.warn(
      `Could not store ${pc.cyan(name)} — set it manually via the /verwaltung/connections UI.\n` +
      (detail ? `  wrangler said: ${detail}` : ''),
    );
    return false;
  }
  return true;
}

/**
 * Find the Cloudflare secret ID of a named secret within a Secrets Store.
 */
function findSecretsStoreSecretId(storeId, name) {
  const raw = wranglerSilent('secrets-store', 'secret', 'list', storeId, '--remote');
  return findSecretIdInTable(raw || '', name);
}

/**
 * Overwrite an existing Secrets Store secret's value via
 * `wrangler secrets-store secret update` (requires the secret's ID).
 */
async function updateSecretsStoreSecret(storeId, name, value) {
  const s = spinner();
  s.start(`Looking up ${name} in the Secrets Store…`);
  const secretId = findSecretsStoreSecretId(storeId, name);
  if (!secretId) {
    s.stop(pc.yellow(`Could not find ${name} in the Secrets Store listing.`));
    log.warn(
      `Could not overwrite ${pc.cyan(name)} — update it manually via the /verwaltung/connections UI.`,
    );
    return false;
  }
  s.start(`Updating ${name} in the Secrets Store…`);
  const result = spawnSync(
    'npx',
    [
      'wrangler', 'secrets-store', 'secret', 'update', storeId,
      '--secret-id', secretId,
      '--value',     value.trim(),
      '--scopes',    'workers',
      '--remote',
    ],
    {
      cwd:      ROOT,
      encoding: 'utf8',
      stdio:    ['ignore', 'pipe', 'pipe'],
      shell:    true,
    },
  );
  s.stop('');

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    log.warn(
      `Could not update ${pc.cyan(name)} — set it manually via the /verwaltung/connections UI.\n` +
      (detail ? `  wrangler said: ${detail}` : ''),
    );
    return false;
  }
  log.success(`Secrets Store secret ${pc.cyan(name)} updated ✓`);
  return true;
}

/**
 * A secret with this name already exists in the Secrets Store (API code 1003).
 * Ask how to proceed. Default: store as a Worker secret instead — useful for
 * a dev instance pointing at a different Supabase project than production.
 */
async function resolveSecretsStoreConflict(storeId, name, value) {
  log.warn(`A secret named ${pc.cyan(name)} already exists in the Secrets Store.`);
  const choice = bailOnCancel(
    await select({
      message: 'How should the secret be stored?',
      options: [
        {
          label: `${pc.bold('Worker secret')} — store on this Worker only ${pc.dim('(wrangler secret put)')}`,
          value: 'worker',
        },
        {
          label: `${pc.bold('Secrets Store')} — overwrite the existing value`,
          value: 'overwrite',
        },
        {
          label: 'Keep the existing Secrets Store value (skip)',
          value: 'keep',
        },
      ],
      initialValue: 'worker',
    }),
  );

  if (choice === 'keep') {
    log.info(`Keeping the existing Secrets Store value for ${pc.cyan(name)}.`);
    return true;
  }

  if (choice === 'overwrite') {
    return updateSecretsStoreSecret(storeId, name, value);
  }

  // choice === 'worker'
  const ok = putWorkerSecret(name, value);
  if (!ok) return false;
  // The runtime prefers the Secrets Store binding (SS_<NAME>) over the plain
  // Worker secret — remove the binding so the Worker secret takes effect.
  const cfgPath = join(ROOT, 'wrangler.jsonc');
  const { text, removed } = removeSecretsStoreBinding(readFileSync(cfgPath, 'utf8'), `SS_${name}`);
  if (removed) {
    writeFileSync(cfgPath, text, 'utf8');
    log.info(
      `Removed the ${pc.cyan('SS_' + name)} binding from wrangler.jsonc so the Worker secret takes effect.\n` +
      `  Note: the /verwaltung/connections UI tracks this secret only via the Secrets Store — it will show as unset.`,
    );
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
      placeholder: storageProvider === 'supabase' ? 'booking_media' : 'pluraconr2',
      initialValue: storageProvider === 'supabase' ? 'booking_media' : 'pluraconr2',
    }),
  );

  let r2PublicUrl = '';
  if (storageProvider === 'r2') {
    r2PublicUrl = bailOnCancel(
      await text({
        message: 'R2 public URL / custom domain (optional):',
        placeholder: 'https://assets.example.com',
        validate: (v) => {
          const trimmed = v.trim();
          if (!trimmed) return undefined;
          return !trimmed.startsWith('https://') ? 'Should start with https://' : undefined;
        },
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

  // ── Generate and store SECRETS_ENCRYPTION_KEY as Worker secret ─────────
  const generateEncryptionKey = bailOnCancel(
    await confirm({
      message: 'Generate a random SECRETS_ENCRYPTION_KEY now?',
      initialValue: true,
    }),
  );

  if (!generateEncryptionKey) {
    cancel('SECRETS_ENCRYPTION_KEY is required to encrypt managed secrets. Re-run setup and generate one to continue.');
    process.exit(1);
  }

  const encryptionKey = generateWorkerSecret();
  note(
    [
      pc.yellow(pc.bold('IMPORTANT — copy and store this encryption key securely.')),
      pc.yellow('You will need the same key to decrypt existing managed secrets.'),
      '',
      pc.bold(encryptionKey),
      '',
      pc.dim('Do not commit this key or share it publicly. Changing it later makes existing managed secrets unreadable.'),
    ].join('\n'),
    'SECRETS_ENCRYPTION_KEY',
  );

  bailOnCancel(
    await confirm({
      message: 'Have you copied SECRETS_ENCRYPTION_KEY to a secure password manager or secrets vault?',
      initialValue: true,
    }),
  );

  const ek = spinner();
  ek.start(`Storing ${pc.yellow('SECRETS_ENCRYPTION_KEY')} as Worker secret…`);
  const ekOk = putWorkerSecret('SECRETS_ENCRYPTION_KEY', encryptionKey);
  if (ekOk) {
    ek.stop(pc.green('SECRETS_ENCRYPTION_KEY stored as Worker secret ✓'));
  } else {
    ek.stop(pc.yellow('Could not store automatically — run manually: npx wrangler secret put SECRETS_ENCRYPTION_KEY'));
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
        'The setup template binds the Worker bucket ' + pc.yellow('MEDIA_BUCKET') + ' to ' + pc.yellow('pluraconr2') + '.',
        'Make sure the R2 bucket exists in your Cloudflare account before deploying.',
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
  writeDevVarsFile(supabasePublishableKey, encryptionKey);
  dv.stop(pc.green('.dev.vars written ✓  (SUPABASE_PUBLISHABLE_KEY + SECRETS_ENCRYPTION_KEY)'));

  return {
    supabaseUrl,
    supabasePublishableKey,
    supabasePublishableKeyStored: wpOk,
    supabaseSecretKey,
    storageProvider,
    storageBucket,
    r2PublicUrl,
    encryptionKey,
    encryptionKeyStored: ekOk,
  };
}

/**
 * Prompt for the Worker name (wrangler project name).
 * Defaults to 'specy'. Validated against Cloudflare Worker naming rules.
 */
async function promptWorkerName() {
  const name = bailOnCancel(
    await text({
      message: 'Worker name (wrangler project name, used in `wrangler deploy`):',
      placeholder: DEFAULT_WORKER_NAME,
      defaultValue: DEFAULT_WORKER_NAME,
      validate: (v) => validateWorkerName(v || DEFAULT_WORKER_NAME),
    }),
  );
  return (name || DEFAULT_WORKER_NAME).trim();
}

function patchWranglerJsonc(accountId, storeId, workerName) {
  const templatePath = join(ROOT, 'wrangler.default.jsonc');
  const outputPath   = join(ROOT, 'wrangler.jsonc');
  let txt = readFileSync(templatePath, 'utf8');
  txt = txt.replaceAll('REPLACE_WITH_YOUR_CF_ACCOUNT_ID',    accountId.trim());
  txt = txt.replaceAll('REPLACE_WITH_YOUR_SECRETS_STORE_ID', storeId.trim());
  if (workerName) {
    txt = txt.replace(/"name":\s*"[^"]*"/, `"name": "${workerName.trim()}"`);
  }
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
  txt = txt.replace('"R2_PUBLIC_URL":    ""', `"R2_PUBLIC_URL":    "${r2PublicUrl.trim()}"`);
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
function writeDevVarsFile(supabasePublishableKey, encryptionKey) {
  const devVarsPath = join(ROOT, '.dev.vars');
  const contents = [
    '# Local secrets for `wrangler dev` — do not commit (git-ignored)',
    '# These mirror the Worker secrets set via `wrangler secret put` in production.',
    '# See: https://developers.cloudflare.com/workers/testing/local-development/#secrets',
    `SUPABASE_PUBLISHABLE_KEY=${supabasePublishableKey.trim()}`,
    `SECRETS_ENCRYPTION_KEY=${encryptionKey.trim()}`,
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

  return {
    token: token.trim(),
    stored: result.status === 0,
  };
}

async function retryWorkerSecretsAfterDeploy(secretEntries, deploySucceeded) {
  const pending = secretEntries.filter((entry) => !entry.stored);
  if (pending.length === 0) return;

  if (!deploySucceeded) {
    log.warn(
      'Some Worker secrets were not stored before deploy. Because the initial deploy did not complete, ' +
      'retry them manually or re-run npm run setup after the Worker exists.',
    );
    return;
  }

  log.step(pc.bold('Post-deploy Worker secret retry'));
  const recovered = [];

  for (const entry of pending) {
    const s = spinner();
    s.start(`Retrying Worker secret ${pc.yellow(entry.name)} after initial deploy…`);
    const ok = putWorkerSecret(entry.name, entry.value);
    if (ok) {
      s.stop(pc.green(`${entry.name} stored after initial deploy ✓`));
      recovered.push(entry.name);
    } else {
      s.stop(pc.yellow(`${entry.name} still not stored — set it manually or re-run setup.`));
    }
  }

  if (recovered.length === 0) return;

  log.step('Redeploying so the newly stored Worker secrets are bound to the live deployment…');
  const ok = wranglerInteractive('deploy');
  if (!ok) {
    log.warn('Redeploy after post-deploy secret retry exited with a non-zero code.');
  } else {
    log.success(`Redeployed successfully after storing: ${recovered.join(', ')}`);
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

async function promptForSupabasePat() {
  note(
    [
      'The next setup steps use the Supabase Management API and CLI.',
      'Create a personal access token (PAT) at:',
      pc.cyan('  supabase.com/dashboard/account/tokens'),
      '',
      pc.bold('  ⚠️  Use a PAT — NOT your publishable or secret key.'),
      pc.dim('  PATs start with  sb_pat_  or  sbp_  and are never stored by this setup script.'),
    ].join('\n'),
    'Supabase access token',
  );

  return bailOnCancel(
    await password({
      message: 'Supabase personal access token (input hidden):',
      validate: (v) => {
        const t = v.trim();
        if (t.length < 10) return 'Token looks too short — paste the full token.';
        if (!t.startsWith('sbp_') && !t.startsWith('sb_pat_')) {
          return 'This does not look like a PAT (should start with sbp_ or sb_pat_). '
            + 'Do not use your publishable or secret key here.';
        }
      },
    }),
  );
}

function runSupabaseCli(args, envOverrides = {}, options = {}) {
  return spawnSync(
    'npx',
    ['-y', 'supabase', ...args],
    {
      cwd: options.cwd ?? ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env, ...envOverrides },
    },
  );
}

function stageEdgeFunctionWorkdir(functionName) {
  const deployRoot = mkdtempSync(join(tmpdir(), 'service-cms-supabase-'));
  const supabaseRoot = join(deployRoot, 'supabase');
  const stagedFunctionRoot = join(supabaseRoot, 'functions', functionName);

  mkdirSync(stagedFunctionRoot, { recursive: true });
  cpSync(join(ROOT, 'functions', 'config.toml'), join(supabaseRoot, 'config.toml'));
  cpSync(join(ROOT, 'functions', functionName), stagedFunctionRoot, { recursive: true });

  return deployRoot;
}

/**
 * Step: apply the SQL migration files in the correct dependency order.
 * Uses the Supabase Management API (requires a personal access token).
 */
async function stepMigrations(supabaseUrl, serviceRoleKey, storageProvider, storageBucket, projectRef, pat) {
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

  if (!projectRef) {
    log.warn('Could not extract project ref from SUPABASE_URL — skipping migrations.');
    return;
  }

  // ── 3. Ordered migration files ─────────────────────────────────────────
  // The ordered list lives in scripts/lib/migration-order.mjs (shared with
  // tests/coreMigrations.test.mjs, which enforces existence, uniqueness and
  // cross-referenced dependency ordering). Storage RLS policies (storage.sql)
  // are only needed for Supabase Storage — Cloudflare R2 manages its own
  // permissions outside of Supabase.
  const MIGRATION_ORDER = getMigrationOrder(storageProvider);

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

      // Offer retry/skip/abort so a single failing migration does not force
      // re-running the whole setup. Retry loops until the migration succeeds,
      // the user skips, or aborts — the SQL is already loaded and migrations
      // are idempotent, so retrying after a manual fix is safe.
      let resolved = false;
      while (!resolved) {
        const action = bailOnCancel(
          await select({
            message: `Migration ${pc.yellow(file)} failed. What do you want to do?`,
            options: [
              { label: 'Retry this migration (fix the cause first, e.g. in the Supabase SQL editor)', value: 'retry' },
              { label: 'Skip and continue with the remaining migrations', value: 'skip' },
              { label: 'Abort the migration step', value: 'abort' },
            ],
            initialValue: 'retry',
          }),
        );

        if (action === 'abort') {
          aborted = true;
          resolved = true;
        } else if (action === 'skip') {
          log.warn(`Skipped ${pc.yellow(file)} — later migrations may fail if they depend on it.`);
          resolved = true;
        } else {
          ms.start(`Retrying ${pc.yellow(file)}…`);
          try {
            await runSqlQuery(projectRef, pat.trim(), sql);
            ms.stop(pc.green(`  ${file} ✓ (retry succeeded)`));
            resolved = true;
          } catch (retryErr) {
            ms.stop(pc.red(`  ${file} — retry failed: ${retryErr.message}`));
          }
        }
      }
    }
  }

  if (aborted) {
    log.warn(
      'Migration step aborted. Applied migrations persist (all are idempotent) —\n' +
      '  re-run  npm run setup  to continue from where it stopped.',
    );
    return;
  }

  log.success('Migrations complete.');

  // ── 3b. Configure the mail queue cron trigger ─────────────────────────
  // The 202609070001_mail_queue_retry.sql migration creates a pg_cron job that
  // invokes the send_email edge function once per minute (rate-limit-aware
  // queue processing). The deployment-specific function URL is stored in
  // system_config (namespace `mail`). The API key stays unset: send_email is
  // deployed with verify_jwt = false, and operators can optionally add a
  // publishable key via mail.edge_function_key for defense in depth.
  const cronCfg = spinner();
  cronCfg.start('Configuring mail queue cron trigger (system_config)…');
  try {
    const functionUrl = `${supabaseUrl.trim().replace(/\/+$/, '')}/functions/v1/send_email`;
    const escapeLiteral = (value) => value.replace(/'/g, "''");
    const cronSql = [
      "insert into public.system_config (namespace, key, value) values",
      `  ('mail', 'edge_function_url', '${escapeLiteral(functionUrl)}')`,
      "on conflict (namespace, key) do update set value = excluded.value, updated_at = now();",
    ].join('\n');
    await runSqlQuery(projectRef, pat.trim(), cronSql);
    cronCfg.stop(pc.green(`Mail queue cron configured (edge_function_url = ${functionUrl}) ✓`));
  } catch (err) {
    cronCfg.stop(pc.yellow(`Mail queue cron configuration failed: ${err.message}`));
    log.warn(
      'Queued mail will still be retried on manual re-dispatch, but the automatic\n' +
      '  minute-by-minute cron needs system_config mail.edge_function_url to point at\n' +
      `  ${supabaseUrl.trim()}/functions/v1/send_email. Set it via the Connections page or SQL.`,
    );
  }

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

async function stepEdgeFunctionDeployment(projectRef, pat, supabaseUrl, supabaseSecretKey, encryptionKey) {
  if (!projectRef) {
    log.warn('Could not extract project ref from SUPABASE_URL — skipping Supabase Edge Function deployment.');
    return;
  }

  const stagedWorkdir = stageEdgeFunctionWorkdir('send_email');

  try {

  const syncSecrets = spinner();
  syncSecrets.start('Syncing Supabase Edge Function secrets…');

  const secretsResult = runSupabaseCli([
    'secrets', 'set',
    `APP_SUPABASE_SECRET_KEY=${supabaseSecretKey.trim()}`,
    `SECRETS_ENCRYPTION_KEY=${encryptionKey.trim()}`,
    '--project-ref', projectRef,
    '--workdir', stagedWorkdir,
  ], {
    SUPABASE_ACCESS_TOKEN: pat.trim(),
  }, {
    cwd: stagedWorkdir,
  });

  if (secretsResult.status !== 0) {
    const detail = (secretsResult.stderr || secretsResult.stdout || '').trim();
    syncSecrets.stop(pc.red('Failed to sync Supabase Edge Function secrets.'));
    throw new Error(detail || 'Supabase secrets set failed.');
  }

  syncSecrets.stop(pc.green('Supabase Edge Function secrets synced ✓'));

  const deployFn = spinner();
  deployFn.start('Deploying Supabase Edge Function send_email…');

  const deployResult = runSupabaseCli([
    'functions', 'deploy', 'send_email',
    '--use-api',
    '--project-ref', projectRef,
    '--workdir', stagedWorkdir,
  ], {
    SUPABASE_ACCESS_TOKEN: pat.trim(),
  }, {
    cwd: stagedWorkdir,
  });

  if (deployResult.status !== 0) {
    const detail = (deployResult.stderr || deployResult.stdout || '').trim();
    deployFn.stop(pc.red('Failed to deploy Supabase Edge Function send_email.'));
    throw new Error(detail || 'Supabase functions deploy failed.');
  }

  deployFn.stop(pc.green('Supabase Edge Function send_email deployed ✓'));
  } finally {
    rmSync(stagedWorkdir, { recursive: true, force: true });
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
    return false;
  }

  log.step('Deploying — this may take ~30 seconds…');
  const ok = wranglerInteractive('deploy');
  if (!ok) {
    log.warn('Deploy exited with a non-zero code. Check the output above.');
  } else {
    log.success('Deployed successfully ✓');
  }

  return ok;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.clear();

  intro(
    pc.bgBlue(pc.white(pc.bold('  service-cms  '))) +
    pc.dim('  first-time setup'),
  );

  note(
    [
      pc.bold('This wizard will guide you through:'),
      '',
      `  ${pc.cyan('1.')} Worker name  ${pc.dim('(default: specy)')}`,
      `  ${pc.cyan('2.')} Cloudflare login`,
      `  ${pc.cyan('3.')} Account ID  +  Secrets Store selection`,
      `  ${pc.cyan('4.')} Patch ${pc.yellow('wrangler.jsonc')} with your values`,
      `  ${pc.cyan('5.')} Set ${pc.yellow('CF_API_TOKEN')} as a Worker secret`,
      `  ${pc.cyan('6.')} Supabase URL ${pc.dim('(var)')} + publishable key ${pc.dim('(Worker secret)')} + secret key ${pc.dim('(Secrets Store)')} + storage`,
      `  ${pc.cyan('7.')} Apply database migrations via Supabase Management API`,
      `  ${pc.cyan('8.')} Sync Supabase Edge Function secrets + deploy ${pc.yellow('send_email')}`,
      `  ${pc.cyan('9.')} Register first super-admin user`,
      `  ${pc.cyan('10.')} Build  →  Deploy`,
      '',
      pc.dim('You can re-run this wizard any time with  npm run setup'),
    ].join('\n'),
    'Steps',
  );

  bailOnCancel(await confirm({ message: 'Ready to begin?' }));

  // ── 0. Worker name ──────────────────────────────────────────────────────────
  const workerName = await promptWorkerName();

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
  patchWranglerJsonc(accountId, storeId, workerName);
  ps.stop(pc.green('wrangler.jsonc updated ✓'));

  note(
    [
      `${pc.bold('Worker name')}      = ${pc.cyan(workerName)}`,
      `${pc.bold('CF_ACCOUNT_ID')}    = ${pc.cyan(accountId)}`,
      `${pc.bold('SECRETS_STORE_ID')} = ${pc.cyan(storeId)}`,
    ].join('\n'),
    'Values written to wrangler.jsonc',
  );

  // ── 5. CF_API_TOKEN ───────────────────────────────────────────────────────
  log.step(pc.bold('Step 4 — CF_API_TOKEN'));
  const apiTokenState = await stepApiToken();

  // ── 6. Supabase + Storage credentials ────────────────────────────────────
  log.step(pc.bold('Step 5 — Supabase & storage credentials'));
  const {
    supabaseUrl,
    supabasePublishableKey,
    supabasePublishableKeyStored,
    supabaseSecretKey,
    storageProvider,
    storageBucket,
    r2PublicUrl,
    encryptionKey,
    encryptionKeyStored,
  } = await stepSupabaseSecrets(storeId);

  // Patch wrangler.jsonc vars with Supabase + storage values
  const vs = spinner();
  vs.start('Patching wrangler.jsonc with Supabase & storage vars…');
  patchWranglerVars(supabaseUrl, storageProvider, storageBucket, r2PublicUrl);
  vs.stop(pc.green('wrangler.jsonc vars updated ✓'));

  const projectRef = extractProjectRef(supabaseUrl);
  const supabasePat = await promptForSupabasePat();

  // ── 7. Database migrations ────────────────────────────────────────────────
  log.step(pc.bold('Step 6 — Database migrations'));
  await stepMigrations(supabaseUrl, supabaseSecretKey, storageProvider, storageBucket, projectRef, supabasePat);

  // ── 8. Supabase Edge Function deployment ─────────────────────────────────
  log.step(pc.bold('Step 7 — Supabase Edge Function deployment'));
  await stepEdgeFunctionDeployment(projectRef, supabasePat, supabaseUrl, supabaseSecretKey, encryptionKey);

  // ── 9. First super-admin user ─────────────────────────────────────────────
  log.step(pc.bold('Step 8 — First super-admin user'));
  await stepFirstAdmin(supabaseUrl, supabaseSecretKey);

  // ── 10. Build ─────────────────────────────────────────────────────────────
  log.step(pc.bold('Step 9 — Build'));
  await stepBuild();

  // ── 11. Deploy ────────────────────────────────────────────────────────────
  log.step(pc.bold('Step 10 — Deploy'));
  const deploySucceeded = await stepDeploy();

  await retryWorkerSecretsAfterDeploy([
    { name: 'CF_API_TOKEN', value: apiTokenState.token, stored: apiTokenState.stored },
    { name: 'SUPABASE_PUBLISHABLE_KEY', value: supabasePublishableKey, stored: supabasePublishableKeyStored },
    { name: 'SECRETS_ENCRYPTION_KEY', value: encryptionKey, stored: encryptionKeyStored },
  ], deploySucceeded);

  // ── Record the live Worker's commit into the deployment-state registry ────
  // (closes the "is core deployed?" gap — see specs/platform/unified-setup-tui.md)
  if (projectRef && supabasePat) {
    try {
      await recordWorkerDeployment(projectRef, supabasePat.trim(), run('git rev-parse --short HEAD'), { workerName });
      log.success('Recorded worker deployment state.');
    } catch (err) {
      log.warn(`Could not record worker deployment state: ${err.message}`);
    }
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  outro(
    [
      pc.green(pc.bold('Setup complete!')),
      '',
      'Cloudflare runtime secrets and Supabase Edge Function secrets have been synced.',
      `You can update them any time via ${pc.cyan('/verwaltung/connections')} in your app.`,
    ].join('\n'),
  );
}

export async function runFirstTimeSetup() {
  await main();
}
