import { createHash } from 'crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

export const CORE_UPDATE_NAMESPACE = 'core_update';

export const CORE_EDGE_FUNCTIONS = [
  {
    name: 'send_email',
    requiredSecrets: ['APP_SUPABASE_SECRET_KEY', 'SECRETS_ENCRYPTION_KEY'],
  },
];

export const MIGRATION_ORDER = [
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
  'page_schema_templates.sql',
  'managed_secrets.sql',
  'system_config.sql',
  'forms.sql',
  'forms_answers.sql',
  'forms_notifications.sql',
  'forms_notification_recipient_rls_fix.sql',
  'mail_delivery.sql',
  'forms_published_default.sql',
  'plugins.sql',
  'plugins_config_schema.sql',
  'mentorbooking_products.sql',
  'llm_specs.sql',
  'page_schema_specs.sql',
  'llm_specs_default_specy_schema_docs.sql',
  'pages.sql',
  'mentorbooking_events.sql',
  'mentorbooking_events_archive.sql',
  'mentorbooking_notifications.sql',
  'agent_logs.sql',
  'agent_logs_hardening.sql',
  'Auth/Access_hook.sql',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
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
      checksum: sha256(sql),
      sql,
    };
  });
}

export function buildFunctionManifest(root) {
  const configToml = readFileSync(join(root, 'functions', 'config.toml'), 'utf8');

  return CORE_EDGE_FUNCTIONS.map((definition) => {
    const source = readFileSync(join(root, 'functions', definition.name, 'index.ts'), 'utf8');
    const checksum = sha256(`${configToml}\n---\n${source}`);

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