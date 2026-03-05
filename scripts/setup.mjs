#!/usr/bin/env node
/**
 * scripts/setup.mjs
 *
 * Interactive first-time setup wizard for service-cms on Cloudflare Workers.
 *
 * Steps:
 *  1. Cloudflare login  (wrangler login)
 *  2. Account ID        (auto-detected or manual)
 *  3. Secrets Store     (list existing / create / enter manually)
 *  4. Patch wrangler.jsonc with the collected values
 *  5. CF_API_TOKEN      (wrangler secret put — stored in Workers secrets, not the file)
 *  6. Build             (npm run build)
 *  7. Deploy            (wrangler deploy)
 *  8. Next-steps outro  (Supabase / storage credentials via /verwaltung/connections UI)
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

// ── Step helpers ───────────────────────────────────────────────────────────

async function stepLogin() {
  const s = spinner();
  s.start('Checking Cloudflare authentication…');
  const raw = wranglerSilent('whoami', '--json');
  s.stop('');

  if (raw) {
    try {
      const data = JSON.parse(raw);
      const account = data.accounts?.[0];
      if (account) {
        log.success(
          `Already authenticated as ${pc.bold(data.email ?? 'user')}`,
        );
        const use = bailOnCancel(
          await confirm({
            message: `Use account  ${pc.cyan(account.name)}  (${pc.dim(account.id)})?`,
          }),
        );
        if (use) return account.id;
      }
    } catch { /* fall through */ }
  }

  log.step('Running ' + pc.cyan('wrangler login') + '…');
  const ok = wranglerInteractive('login');
  if (!ok) {
    log.warn('wrangler login exited with a non-zero code — continuing anyway.');
  }
  return null; // accountId will be fetched / asked below
}

async function detectAccountId(previousId) {
  if (previousId) return previousId;

  // Try to auto-detect after login
  const raw = wranglerSilent('whoami', '--json');
  if (raw) {
    try {
      const data = JSON.parse(raw);
      const account = data.accounts?.[0];
      if (account) {
        log.success(`Detected account: ${pc.bold(account.name)} (${pc.dim(account.id)})`);
        return account.id;
      }
    } catch { /* fall through */ }
  }

  return bailOnCancel(
    await text({
      message: 'Cloudflare Account ID:',
      placeholder: 'e.g. a1b2c3d4e5f6…  (dash.cloudflare.com → right sidebar)',
      validate: (v) =>
        v.trim().length < 8 ? 'Looks too short — paste the full Account ID.' : undefined,
    }),
  );
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
        message: 'Which Secrets Store should service-cms use?',
        options: [
          ...stores.map((st) => ({
            label: `${pc.bold(st.name)}  ${pc.dim(st.id)}`,
            value: st.id,
          })),
          { label: pc.cyan('+ Create a new store named "service-cms"'), value: '__new__' },
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
      message: 'No Secrets Stores found. Create one named "service-cms"?',
    }),
  );
  return doCreate ? createStore() : askStoreId();
}

async function createStore() {
  const s = spinner();
  s.start('Creating Secrets Store "service-cms" (–remote)…');
  const out = wranglerSilent('secrets-store', 'store', 'create', 'service-cms', '--remote');
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
async function stepMigrations(supabaseUrl, serviceRoleKey) {
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
  //  employers.sql             — needs user_profile
  //  user_roles.sql            — needs roles + user_profile
  //  mentor_groups.sql         — no deps
  //  products.sql              — needs set_current_timestamp_updated_at (preamble)
  //  page_schemas.sql          — needs set_current_timestamp_updated_at (preamble)
  //  mentorbooking_products.sql — needs products (FK)
  //  pages.sql                 — renames products→pages; renames FK on mentorbooking_products
  //                              (must run AFTER mentorbooking_products so the FK to rename exists)
  //  mentorbooking_events.sql  — needs employers + mentorbooking_products + event functions
  //  mentorbooking_events_archive.sql — needs employers + mentorbooking_products
  //  mentorbooking_notifications.sql  — needs user_profile
  //  agent_logs.sql            — needs page_schemas
  //  Auth/Access_hook.sql      — needs roles + user_roles (last)
  const MIGRATION_ORDER = [
    'preamble.sql',
    'user_profile.sql',
    'roles.sql',
    'employers.sql',
    'user_roles.sql',
    'mentor_groups.sql',
    'products.sql',
    'page_schemas.sql',
    'mentorbooking_products.sql',
    'pages.sql',
    'mentorbooking_events.sql',
    'mentorbooking_events_archive.sql',
    'mentorbooking_notifications.sql',
    'agent_logs.sql',
    'Auth/Access_hook.sql',
  ];

  const migrationsDir = join(ROOT, 'migrations');
  const ms = spinner();
  let aborted = false;

  for (const file of MIGRATION_ORDER) {
    if (aborted) break;

    ms.start(`Applying ${pc.yellow(file)}…`);
    let sql;
    try {
      sql = readFileSync(join(migrationsDir, file), 'utf8');
    } catch {
      ms.stop(pc.yellow(`  ${file} — file not found, skipping.`));
      continue;
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
  } else {
    log.success('Migrations complete.');
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
    pc.bgBlue(pc.white(pc.bold('  service-cms  '))) +
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
      `  ${pc.cyan('7.')} Build  →  Deploy`,
      '',
      pc.dim('You can re-run this wizard any time with  npm run setup'),
    ].join('\n'),
    'Steps',
  );

  bailOnCancel(await confirm({ message: 'Ready to begin?' }));

  // ── 1. Login ──────────────────────────────────────────────────────────────
  log.step(pc.bold('Step 1 — Cloudflare authentication'));
  const immediateAccountId = await stepLogin();

  // ── 2. Account ID ─────────────────────────────────────────────────────────
  log.step(pc.bold('Step 2 — Account ID'));
  const accountId = await detectAccountId(immediateAccountId);

  // ── 3. Secrets Store ──────────────────────────────────────────────────────
  log.step(pc.bold('Step 3 — Secrets Store'));
  const storeId = await stepSecretsStore();

  // ── 4. Patch wrangler.jsonc ───────────────────────────────────────────────
  const ps = spinner();
  ps.start('Patching wrangler.jsonc…');
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
  await stepMigrations(supabaseUrl, supabaseSecretKey);

  // ── 8. Build ──────────────────────────────────────────────────────────────
  log.step(pc.bold('Step 7 — Build'));
  await stepBuild();

  // ── 9. Deploy ─────────────────────────────────────────────────────────────
  log.step(pc.bold('Step 8 — Deploy'));
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
