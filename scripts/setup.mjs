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
    const match = out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
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
      message: 'Secrets Store UUID:',
      placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      validate: (v) =>
        !/^[0-9a-f-]{36}$/i.test(v.trim()) ? 'Expected a UUID (32 hex chars + dashes).' : undefined,
    }),
  );
}

function patchWranglerJsonc(accountId, storeId) {
  const path = join(ROOT, 'wrangler.jsonc');
  let txt = readFileSync(path, 'utf8');
  txt = txt.replaceAll('REPLACE_WITH_YOUR_CF_ACCOUNT_ID',  accountId.trim());
  txt = txt.replaceAll('REPLACE_WITH_YOUR_SECRETS_STORE_ID', storeId.trim());
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
      `  ${pc.cyan('5.')} Build  →  Deploy`,
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

  // ── 6. Build ──────────────────────────────────────────────────────────────
  log.step(pc.bold('Step 5 — Build'));
  await stepBuild();

  // ── 7. Deploy ─────────────────────────────────────────────────────────────
  log.step(pc.bold('Step 6 — Deploy'));
  await stepDeploy();

  // ── Done ──────────────────────────────────────────────────────────────────
  outro(
    [
      pc.green(pc.bold('Setup complete!')),
      '',
      pc.bold('Next steps after deploy:'),
      `  → Open ${pc.cyan('/verwaltung/connections')} in your app`,
      `  → Set ${pc.yellow('SUPABASE_URL')} and ${pc.yellow('SUPABASE_ANON_KEY')}`,
      `  → Set ${pc.yellow('STORAGE_PROVIDER')} (${pc.dim('supabase')} or ${pc.dim('r2')}) and ${pc.yellow('STORAGE_BUCKET')}`,
      '',
      pc.dim('For R2: also uncomment r2_buckets in wrangler.jsonc and redeploy.'),
    ].join('\n'),
  );
}

main().catch((err) => {
  log.error(err?.message ?? String(err));
  process.exit(1);
});
