import { createHash } from 'crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { MIGRATION_ORDER_CORE } from './migration-order.mjs';
import { coreRecordsToStateRows, writeDeploymentState } from './deployment-state.mjs';

export const CORE_UPDATE_NAMESPACE = 'core_update';

export const CORE_EDGE_FUNCTIONS = [
  {
    name: 'send_email',
    requiredSecrets: ['APP_SUPABASE_SECRET_KEY', 'SECRETS_ENCRYPTION_KEY'],
  },
];

// Source of truth: scripts/lib/migration-order.mjs (validated by
// tests/coreMigrations.test.mjs). storage.sql is appended separately in
// getMigrationEntries for the supabase provider.
export const MIGRATION_ORDER = MIGRATION_ORDER_CORE;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Normalize line endings to LF before hashing.
 *
 * Checksums must be identical regardless of the checkout platform: with
 * `core.autocrlf = true` (Windows default) migration files are CRLF on disk
 * while Linux/CI checkouts see LF — a raw-content hash would report drift
 * for every migration whenever the recording and checking checkouts differ.
 * Normalizing once here makes the recorded state platform-independent.
 */
export function normalizeSqlEol(sql) {
  return String(sql).replace(/\r\n/g, '\n');
}

function escapeSqlLiteral(value) {
  return value.replaceAll("'", "''");
}

function extractRows(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && Array.isArray(payload.result)) {
    return payload.result;
  }

  return [];
}

function extractJsonColumn(payload, key) {
  const rows = extractRows(payload);
  const candidate = rows[0]?.[key];

  if (Array.isArray(candidate)) {
    return candidate;
  }

  if (typeof candidate === 'string') {
    try {
      const parsed = JSON.parse(candidate);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

export function extractProjectRef(supabaseUrl) {
  try {
    const host = new URL(supabaseUrl).hostname;
    return host.split('.')[0] || null;
  } catch {
    return null;
  }
}

export async function runSqlQuery(projectRef, pat, sql) {
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
    } catch {
      // Keep the raw response body when JSON parsing fails.
    }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }

  return res.json().catch(() => null);
}

export function getMigrationEntries(storageProvider, storageBucket) {
  return [
    ...MIGRATION_ORDER,
    ...(storageProvider === 'supabase' ? ['storage.sql'] : []),
  ].map((name) => ({
    name,
    kind: 'migration',
    sql: name === 'storage.sql'
      ? null
      : undefined,
    storageBucket,
  }));
}

export function buildMigrationManifest(root, storageProvider, storageBucket) {
  const migrationsDir = join(root, 'migrations');

  return getMigrationEntries(storageProvider, storageBucket).map((entry) => {
    let sql;

    if (entry.name === 'storage.sql') {
      sql = readFileSync(join(migrationsDir, 'storage.default.sql'), 'utf8')
        .replaceAll('REPLACE_WITH_STORAGE_BUCKET', storageBucket.trim());
    } else {
      sql = readFileSync(join(migrationsDir, entry.name), 'utf8');
    }

    return {
      id: `migration:${entry.name}`,
      type: 'migration',
      name: entry.name,
      checksum: sha256(normalizeSqlEol(sql)),
      sql,
    };
  });
}

export function buildFunctionManifest(root) {
  const configToml = readFileSync(join(root, 'functions', 'config.toml'), 'utf8');

  return CORE_EDGE_FUNCTIONS.map((definition) => {
    const source = readFileSync(join(root, 'functions', definition.name, 'index.ts'), 'utf8');
    const checksum = sha256(normalizeSqlEol(`${configToml}\n---\n${source}`));

    return {
      id: `function:${definition.name}`,
      type: 'function',
      name: definition.name,
      checksum,
      requiredSecrets: [...definition.requiredSecrets],
    };
  });
}

export async function fetchCoreUpdateState(projectRef, pat) {
  try {
    const payload = await runSqlQuery(
      projectRef,
      pat,
      `
        select coalesce(json_agg(row_to_json(t)), '[]'::json) as items
        from (
          select key, value
          from public.system_config
          where namespace = '${CORE_UPDATE_NAMESPACE}'
          order by key
        ) t;
      `,
    );

    const items = extractJsonColumn(payload, 'items');
    const state = new Map();

    for (const item of items) {
      if (!item?.key) continue;

      let value = item.value;
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {
          value = { raw: item.value };
        }
      }

      state.set(item.key, value);
    }

    return { available: true, state };
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes('relation "public.system_config" does not exist')) {
      return { available: false, state: new Map(), reason: 'system_config_missing' };
    }
    throw error;
  }
}

export async function detectLegacyCoreInstall(projectRef, pat) {
  const payload = await runSqlQuery(
    projectRef,
    pat,
    `
      select coalesce(json_agg(table_name order by table_name), '[]'::json) as tables
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'user_profile',
          'roles',
          'objects',
          'page_schemas',
          'pages',
          'system_config'
        );
    `,
  );
  const tables = extractJsonColumn(payload, 'tables');

  return {
    hasCoreSchema: tables.length > 0,
    tables,
  };
}

// ─── Bootstrap baseline verification ────────────────────────────────────────

/**
 * Public tables a migration creates (CREATE TABLE, incl. via
 * `ALTER TABLE … RENAME TO`). Mirrors the creator logic of
 * tests/coreMigrations.test.mjs so tooling and test agree on the semantics.
 */
export function migrationCreatedTables(sql) {
  const tables = new Set();
  const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-zA-Z0-9_]+)/gi;
  const renameRe = /alter\s+table\s+(?:if\s+exists\s+)?public\.[a-zA-Z0-9_]+\s+rename\s+to\s+(?:public\.)?([a-zA-Z0-9_]+)/gi;
  let m;
  while ((m = createRe.exec(sql)) !== null) tables.add(m[1].toLowerCase());
  while ((m = renameRe.exec(sql)) !== null) tables.add(m[1].toLowerCase());
  return tables;
}

/**
 * Split a migration manifest for a bootstrap baseline into migrations that can
 * safely be recorded as applied and those that almost certainly never ran.
 *
 * A migration whose created tables are ALL missing from the live schema is
 * marked `applyInstead` — recording it as a baseline would mark SQL as applied
 * that never executed (the silent-skip failure mode this guard exists for).
 * Migrations that create no tables (functions, policies, grants, ALTERs)
 * cannot be probed this way and are treated as baseline — their idempotent
 * SQL can be re-applied explicitly via `--replay`.
 *
 * @param {{ name: string, sql: string }[]} migrations
 * @param {string[]} existingPublicTables table names from information_schema
 * @returns {{ baseline: typeof migrations, applyInstead: typeof migrations }}
 */
export function planBaseline(migrations, existingPublicTables) {
  const existing = new Set((existingPublicTables ?? []).map((t) => String(t).toLowerCase()));
  const baseline = [];
  const applyInstead = [];

  for (const migration of migrations) {
    const created = migrationCreatedTables(normalizeSqlEol(migration.sql ?? ''));
    const verify = [...created].filter((t) => !existing.has(t));
    if (created.size > 0 && verify.length === created.size) {
      applyInstead.push(migration);
    } else {
      baseline.push(migration);
    }
  }

  return { baseline, applyInstead };
}

export function analyzeCoreUpdates(migrations, functions, remoteState) {
  const pendingMigrations = [];
  const driftedMigrations = [];
  const pendingFunctions = [];
  const driftedFunctions = [];

  for (const migration of migrations) {
    const current = remoteState.get(migration.id);
    if (!current) {
      pendingMigrations.push(migration);
      continue;
    }

    if (current.checksum !== migration.checksum) {
      driftedMigrations.push({
        name: migration.name,
        recordedChecksum: current.checksum || null,
        currentChecksum: migration.checksum,
      });
    }
  }

  for (const fn of functions) {
    const current = remoteState.get(fn.id);
    if (!current) {
      pendingFunctions.push(fn);
      continue;
    }

    if (current.checksum !== fn.checksum) {
      driftedFunctions.push({
        name: fn.name,
        recordedChecksum: current.checksum || null,
        currentChecksum: fn.checksum,
      });
      pendingFunctions.push(fn);
    }
  }

  return {
    pendingMigrations,
    driftedMigrations,
    pendingFunctions,
    driftedFunctions,
    bootstrapRequired: remoteState.size === 0,
  };
}

export async function upsertCoreUpdateRecords(projectRef, pat, records) {
  if (records.length === 0) return;

  const values = records.map((record) => {
    const key = escapeSqlLiteral(record.key);
    const value = escapeSqlLiteral(JSON.stringify(record.value));
    return `('${CORE_UPDATE_NAMESPACE}', '${key}', '${value}')`;
  }).join(',\n          ');

  await runSqlQuery(
    projectRef,
    pat,
    `
      insert into public.system_config(namespace, key, value)
      values
          ${values}
      on conflict (namespace, key)
      do update set
        value = excluded.value,
        updated_at = now();
    `,
  );

  // Dual-write to the typed deployment_state registry (write-after-confirm —
  // this function is only called after the external system confirmed). The
  // system_config rows remain as a read shim until prod re-check converges.
  await writeDeploymentState(projectRef, pat, coreRecordsToStateRows(records));
}

/**
 * Record a successful Cloudflare Worker deploy into the deployment-state
 * registry (public.system_config, namespace `core_update`).
 *
 * This closes the "is core deployed?" gap: migration + edge-function state was
 * already tracked (`migration:*`, `function:*`, `deployment:core_commit`), but
 * the live Worker's commit was not. `deployment:worker` now records the git
 * commit that is actually running on the Worker, written only AFTER wrangler
 * reports success (the external system confirms before we persist state).
 *
 * @param {string} projectRef Supabase project ref.
 * @param {string} pat Supabase PAT.
 * @param {string|null} commit Short git SHA deployed.
 * @param {{ workerName?: string|null }} [extra]
 */
export async function recordWorkerDeployment(projectRef, pat, commit, extra = {}) {
  await upsertCoreUpdateRecords(projectRef, pat, [
    {
      key: 'deployment:worker',
      value: {
        commit: commit ?? null,
        workerName: extra.workerName ?? null,
        deployedAt: new Date().toISOString(),
      },
    },
  ]);
}

export async function registerAuthHook(projectRef, pat) {
  const hookRes = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${pat}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hook_custom_access_token_enabled: true,
        hook_custom_access_token_uri: 'pg-functions://postgres/public/custom_access_token_hook',
      }),
    },
  );

  if (!hookRes.ok) {
    const raw = await hookRes.text().catch(() => '');
    let detail = raw;
    try {
      detail = JSON.parse(raw).message || raw;
    } catch {
      // Keep raw body.
    }
    throw new Error(`HTTP ${hookRes.status}: ${detail}`);
  }

  // Record auth-hook state in the deployment-state registry (write-after-
  // confirm: the Supabase auth config PATCH succeeded before we persist).
  await writeDeploymentState(projectRef, pat, [
    {
      owner: 'core',
      component: 'auth_hook',
      key: 'custom_access_token_hook',
      value: {
        status: 'deployed',
        provider: 'supabase',
        deployed_at: new Date().toISOString(),
      },
    },
  ]);
}

export function runSupabaseCli(root, args, envOverrides = {}, options = {}) {
  return spawnSync(
    'npx',
    ['-y', 'supabase', ...args],
    {
      cwd: options.cwd ?? root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env, ...envOverrides },
    },
  );
}

export function stageEdgeFunctionWorkdir(root, functionName) {
  const deployRoot = mkdtempSync(join(tmpdir(), 'service-cms-supabase-'));
  const supabaseRoot = join(deployRoot, 'supabase');
  const stagedFunctionRoot = join(supabaseRoot, 'functions', functionName);

  mkdirSync(stagedFunctionRoot, { recursive: true });
  cpSync(join(root, 'functions', 'config.toml'), join(supabaseRoot, 'config.toml'));
  cpSync(join(root, 'functions', functionName), stagedFunctionRoot, { recursive: true });

  return deployRoot;
}

export async function deployEdgeFunction(root, functionName, projectRef, pat) {
  const stagedWorkdir = stageEdgeFunctionWorkdir(root, functionName);

  try {
    const deployResult = runSupabaseCli(
      root,
      [
        'functions', 'deploy', functionName,
        '--use-api',
        '--project-ref', projectRef,
        '--workdir', stagedWorkdir,
      ],
      { SUPABASE_ACCESS_TOKEN: pat.trim() },
      { cwd: stagedWorkdir },
    );

    if (deployResult.status !== 0) {
      const detail = (deployResult.stderr || deployResult.stdout || '').trim();
      throw new Error(detail || `Supabase functions deploy failed for ${functionName}.`);
    }
  } finally {
    rmSync(stagedWorkdir, { recursive: true, force: true });
  }
}

export async function syncEdgeFunctionSecrets(root, projectRef, pat, secrets) {
  const stagedWorkdir = stageEdgeFunctionWorkdir(root, CORE_EDGE_FUNCTIONS[0].name);

  try {
    const args = ['secrets', 'set'];
    for (const [name, value] of Object.entries(secrets)) {
      args.push(`${name}=${value.trim()}`);
    }
    args.push('--project-ref', projectRef, '--workdir', stagedWorkdir);

    const result = runSupabaseCli(
      root,
      args,
      { SUPABASE_ACCESS_TOKEN: pat.trim() },
      { cwd: stagedWorkdir },
    );

    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || '').trim();
      throw new Error(detail || 'Supabase secrets set failed.');
    }
  } finally {
    rmSync(stagedWorkdir, { recursive: true, force: true });
  }
}