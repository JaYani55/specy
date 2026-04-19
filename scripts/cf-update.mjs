#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { dirname, join, normalize, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { confirm, isCancel, password } from '@clack/prompts';
import {
  analyzeCoreUpdates,
  buildFunctionManifest,
  buildMigrationManifest,
  CORE_EDGE_FUNCTIONS,
  deployEdgeFunction,
  extractProjectRef,
  fetchCoreUpdateState,
  registerAuthHook,
  runSqlQuery,
  syncEdgeFunctionSecrets,
  upsertCoreUpdateRecords,
} from './lib/core-update.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const EXPECTED_REMOTE = 'https://github.com/JaYani55/specy.git';

const args = new Set(process.argv.slice(2));
const options = {
  allowDirty: args.has('--allow-dirty'),
  dryRun: args.has('--dry-run'),
  skipPull: args.has('--skip-pull'),
  skipInstall: args.has('--skip-install'),
  skipLint: args.has('--skip-lint'),
  skipBuild: args.has('--skip-build'),
  skipDeploy: args.has('--skip-deploy'),
  skipMigrations: args.has('--skip-migrations'),
  skipFunctions: args.has('--skip-functions'),
  help: args.has('--help') || args.has('-h'),
};

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function color(code, text) {
  return `${code}${text}${colors.reset}`;
}

function info(message) {
  console.log(`  ${color(colors.cyan, '[INFO]')}  ${message}`);
}

function ok(message) {
  console.log(`  ${color(colors.green, '[OK]')}    ${message}`);
}

function warn(message) {
  console.warn(`  ${color(colors.yellow, '[WARN]')}  ${message}`);
}

function fail(message, exitCode = 1) {
  console.error(`  ${color(colors.red, '[ERROR]')} ${message}`);
  process.exit(exitCode);
}

function printHeader() {
  console.log('');
  console.log(`  ${color(colors.bold, 'specy Cloudflare updater')}`);
  console.log('  ------------------------');
  console.log('');
}

function bailOnCancel(value, message) {
  if (isCancel(value)) {
    warn(message);
    process.exit(0);
  }

  return value;
}

function printHelp() {
  printHeader();
  console.log('  Usage: node scripts/cf-update.mjs [options]');
  console.log('');
  console.log('  Options:');
  console.log('    --allow-dirty   Continue even when tracked git files are modified');
  console.log('    --dry-run       Preview Supabase/core update actions and stop before build/deploy');
  console.log('    --skip-pull     Skip git fetch/pull and only run integrity checks/deploy');
  console.log('    --skip-install  Skip npm install');
  console.log('    --skip-lint     Skip npm run lint');
  console.log('    --skip-migrations  Skip Supabase core migration checks and apply');
  console.log('    --skip-functions   Skip Supabase Edge Function checks and deploy');
  console.log('    --skip-build    Skip npm run build and dist verification');
  console.log('    --skip-deploy   Stop after integrity checks and build');
  console.log('    --help, -h      Show this help');
  console.log('');
}

function run(command, commandArgs, extra = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...extra,
  });

  if (result.error) {
    fail(`Failed to start ${command}: ${result.error.message}`);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    fail(`Command failed: ${command} ${commandArgs.join(' ')}`, result.status || 1);
  }
}

function capture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  if (result.error) {
    fail(`Failed to start ${command}: ${result.error.message}`);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const detail = stderr ? `\n${stderr}` : '';
    fail(`Command failed: ${command} ${commandArgs.join(' ')}${detail}`, result.status || 1);
  }

  return (result.stdout || '').trim();
}

function ensureCommand(command, versionArgs = ['--version']) {
  const result = spawnSync(command, versionArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  if (result.error || result.status !== 0) {
    fail(`${command} is required but was not found in PATH.`);
  }

  const output = (result.stdout || result.stderr || '').trim().split(/\r?\n/)[0] || 'available';
  ok(`${command} ${output}`);
}

function ensureGitRepo() {
  const root = capture('git', ['rev-parse', '--show-toplevel']);
  const normalizedRoot = normalize(resolve(root));
  const normalizedExpected = normalize(resolve(ROOT));
  if (normalizedRoot !== normalizedExpected) {
    fail(`Expected git root ${ROOT} but found ${root}. Run this script from the repository checkout.`);
  }
  ok('Git repository root verified.');
}

function ensureRemote() {
  const remote = capture('git', ['remote', 'get-url', 'origin']);
  if (remote !== EXPECTED_REMOTE) {
    fail(`origin points to ${remote}, expected ${EXPECTED_REMOTE}. Refusing to pull from the wrong repository.`);
  }
  ok(`origin remote verified: ${remote}`);
}

function ensureCleanWorktree() {
  const status = capture('git', ['status', '--porcelain', '--untracked-files=no']);
  if (status && !options.allowDirty) {
    fail('Tracked git changes detected. Commit or stash them first, or rerun with --allow-dirty.');
  }

  if (status) {
    warn('Tracked git changes detected, continuing because --allow-dirty was provided.');
  } else {
    ok('Tracked git state is clean.');
  }
}

function ensureWranglerConfig() {
  const configPath = join(ROOT, 'wrangler.jsonc');
  if (!existsSync(configPath)) {
    fail('wrangler.jsonc is missing. Run the setup flow first so the deployment target is configured.');
  }

  const raw = readFileSync(configPath, 'utf8');
  const uncommented = raw
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

  if (uncommented.includes('REPLACE_WITH')) {
    fail('wrangler.jsonc still contains placeholder values. Complete setup before running the updater.');
  }

  ok('wrangler.jsonc looks configured.');
}

function readConfiguredVar(rawConfig, key) {
  const uncommented = rawConfig
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

  const match = uncommented.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`));
  return match?.[1]?.trim() || '';
}

function readSupabaseConfig() {
  const raw = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8');
  const supabaseUrl = process.env.SUPABASE_URL || readConfiguredVar(raw, 'SUPABASE_URL');
  const storageProvider = process.env.STORAGE_PROVIDER || readConfiguredVar(raw, 'STORAGE_PROVIDER') || 'supabase';
  const storageBucket = process.env.STORAGE_BUCKET || readConfiguredVar(raw, 'STORAGE_BUCKET') || 'booking_media';

  return {
    supabaseUrl,
    storageProvider,
    storageBucket,
  };
}

async function promptForSupabasePat() {
  const existing = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
  if (existing) {
    ok('Using Supabase PAT from SUPABASE_ACCESS_TOKEN.');
    return existing;
  }

  const token = bailOnCancel(
    await password({
      message: 'Supabase personal access token (sbp_... / sb_pat_...):',
      validate: (value) => {
        const trimmed = value.trim();
        if (trimmed.length < 10) {
          return 'Token looks too short.';
        }
        if (!trimmed.startsWith('sbp_') && !trimmed.startsWith('sb_pat_')) {
          return 'Use a Supabase PAT, not the publishable or secret key.';
        }
        return undefined;
      },
    }),
    'Supabase update check cancelled.',
  );

  return token.trim();
}

function printSupabasePlan(plan) {
  if (plan.bootstrapRequired) {
    warn('No core update metadata found in Supabase. This run will treat current core migrations/functions as a bootstrap sync.');
  }

  if (plan.pendingMigrations.length > 0) {
    info(`Pending migrations (${plan.pendingMigrations.length}): ${plan.pendingMigrations.map((item) => item.name).join(', ')}`);
  } else {
    ok('No pending core migrations.');
  }

  if (plan.pendingFunctions.length > 0) {
    info(`Pending Edge Functions (${plan.pendingFunctions.length}): ${plan.pendingFunctions.map((item) => item.name).join(', ')}`);
  } else {
    ok('No pending Supabase Edge Function updates.');
  }

  if (plan.driftedMigrations.length > 0) {
    warn(`Historical migration drift detected: ${plan.driftedMigrations.map((item) => item.name).join(', ')}`);
  }
}

function buildStateRecord(item, head) {
  return {
    key: item.id,
    value: {
      name: item.name,
      checksum: item.checksum,
      updatedAt: new Date().toISOString(),
      commit: head,
    },
  };
}

async function applyPendingMigrations(plan, projectRef, pat, head) {
  for (const migration of plan.pendingMigrations) {
    info(`Applying migration ${migration.name}...`);
    await runSqlQuery(projectRef, pat, migration.sql);
    await upsertCoreUpdateRecords(projectRef, pat, [buildStateRecord(migration, head)]);
    ok(`Applied ${migration.name}.`);
  }

  if (plan.pendingMigrations.length > 0) {
    ok('Recorded migration update state.');
    try {
      await registerAuthHook(projectRef, pat);
      ok('Supabase auth hook registration verified.');
    } catch (error) {
      warn(`Auth hook registration check failed: ${error.message}`);
    }
  }
}

async function applyPendingFunctions(plan, projectRef, pat, head) {
  if (plan.pendingFunctions.length === 0) {
    return;
  }

  const supabaseSecretKey = (process.env.SUPABASE_SECRET_KEY || '').trim();
  const encryptionKey = (process.env.SECRETS_ENCRYPTION_KEY || '').trim();
  const canSyncSecrets = Boolean(supabaseSecretKey && encryptionKey);

  if (canSyncSecrets) {
    info('Syncing Supabase Edge Function secrets before deploy...');
    await syncEdgeFunctionSecrets(ROOT, projectRef, pat, {
      APP_SUPABASE_SECRET_KEY: supabaseSecretKey,
      SECRETS_ENCRYPTION_KEY: encryptionKey,
    });
    ok('Supabase Edge Function secrets synced.');
  } else {
    warn('Skipping Edge Function secret sync because SUPABASE_SECRET_KEY and/or SECRETS_ENCRYPTION_KEY are not set in the local environment.');
  }

  for (const fn of plan.pendingFunctions) {
    info(`Deploying Supabase Edge Function ${fn.name}...`);
    await deployEdgeFunction(ROOT, fn.name, projectRef, pat);
    await upsertCoreUpdateRecords(projectRef, pat, [{
      key: fn.id,
      value: {
        name: fn.name,
        checksum: fn.checksum,
        requiredSecrets: fn.requiredSecrets,
        updatedAt: new Date().toISOString(),
        commit: head,
      },
    }]);
    ok(`Deployed ${fn.name}.`);
  }

  ok('Recorded Edge Function update state.');
}

async function runSupabaseUpdatePhase() {
  if (options.skipMigrations && options.skipFunctions) {
    warn('Skipping all Supabase update checks as requested.');
    return { shouldStop: false };
  }

  const { supabaseUrl, storageProvider, storageBucket } = readSupabaseConfig();
  if (!supabaseUrl) {
    warn('SUPABASE_URL is not configured in wrangler.jsonc. Skipping Supabase update checks.');
    return { shouldStop: false };
  }

  const projectRef = extractProjectRef(supabaseUrl);
  if (!projectRef) {
    warn('Could not derive the Supabase project ref from SUPABASE_URL. Skipping Supabase update checks.');
    return { shouldStop: false };
  }

  const pat = await promptForSupabasePat();
  const migrations = options.skipMigrations
    ? []
    : buildMigrationManifest(ROOT, storageProvider, storageBucket);
  const functions = options.skipFunctions
    ? []
    : buildFunctionManifest(ROOT);

  info(`Checking Supabase core state for project ${projectRef}...`);
  const remote = await fetchCoreUpdateState(projectRef, pat);
  const plan = analyzeCoreUpdates(migrations, functions, remote.state);
  printSupabasePlan(plan);

  if (plan.driftedMigrations.length > 0) {
    fail('Refusing to continue because historical core migrations were modified after being recorded in this instance. Review the migration drift before deploying.');
  }

  if (plan.pendingMigrations.length === 0 && plan.pendingFunctions.length === 0) {
    return { shouldStop: options.dryRun };
  }

  if (options.dryRun) {
    warn('Dry run requested. Stopping before applying Supabase, build, or deploy changes.');
    return { shouldStop: true };
  }

  const proceed = bailOnCancel(
    await confirm({
      message: 'Apply the pending Supabase core updates before build/deploy?',
      initialValue: true,
    }),
    'Supabase update phase cancelled.',
  );

  if (!proceed) {
    warn('Supabase core updates were not applied. Stopping before build/deploy.');
    return { shouldStop: true };
  }

  const head = capture('git', ['rev-parse', 'HEAD']);
  await applyPendingMigrations(plan, projectRef, pat, head);
  await applyPendingFunctions(plan, projectRef, pat, head);
  await upsertCoreUpdateRecords(projectRef, pat, [
    {
      key: 'deployment:core_commit',
      value: {
        commit: head,
        updatedAt: new Date().toISOString(),
      },
    },
    {
      key: 'deployment:functions',
      value: {
        functions: CORE_EDGE_FUNCTIONS.map((item) => item.name),
        updatedAt: new Date().toISOString(),
      },
    },
  ]);

  ok('Supabase core update phase completed.');
  return { shouldStop: false };
}

function updateFromGit() {
  const branch = capture('git', ['branch', '--show-current']);
  if (!branch) {
    fail('Could not determine the current git branch.');
  }

  info(`Fetching latest changes from origin/${branch}...`);
  run('git', ['fetch', 'origin', branch]);

  info(`Pulling latest fast-forward changes for ${branch}...`);
  run('git', ['pull', '--ff-only', 'origin', branch]);

  const head = capture('git', ['rev-parse', '--short', 'HEAD']);
  ok(`Repository updated at commit ${head}.`);
}

function installDependencies() {
  info('Installing dependencies...');
  run('npm', ['install']);
  ok('Dependencies are up to date.');
}

function runLint() {
  info('Running lint integrity check...');
  run('npm', ['run', 'lint']);
  ok('Lint passed.');
}

function runBuild() {
  info('Building frontend assets...');
  run('npm', ['run', 'build']);

  const distDir = join(ROOT, 'dist');
  const indexHtml = join(distDir, 'index.html');
  if (!existsSync(distDir) || !existsSync(indexHtml)) {
    fail('Build completed but dist/index.html was not generated.');
  }

  ok('Build output verified in dist/.');
}

function deploy() {
  info('Deploying to Cloudflare with Wrangler...');
  run('npm', ['run', 'deploy']);
  ok('Cloudflare deploy finished successfully.');
}

async function main() {
  if (options.help) {
    printHelp();
    return;
  }

  printHeader();

  ensureCommand('node');
  ensureCommand('npm');
  ensureCommand('npx');
  ensureCommand('git');

  ensureGitRepo();
  ensureRemote();
  ensureCleanWorktree();
  ensureWranglerConfig();

  if (!options.skipPull) {
    updateFromGit();
  } else {
    warn('Skipping git pull as requested.');
  }

  if (!options.skipInstall) {
    installDependencies();
  } else {
    warn('Skipping npm install as requested.');
  }

  if (!options.skipLint) {
    runLint();
  } else {
    warn('Skipping lint as requested.');
  }

  const supabasePhase = await runSupabaseUpdatePhase();
  if (supabasePhase.shouldStop) {
    console.log('');
    ok('Update analysis completed.');
    console.log('');
    return;
  }

  if (!options.skipBuild) {
    runBuild();
  } else {
    warn('Skipping build as requested.');
  }

  if (!options.skipDeploy) {
    deploy();
  } else {
    warn('Skipping deploy as requested.');
  }

  console.log('');
  ok('Update flow completed.');
  console.log('');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});