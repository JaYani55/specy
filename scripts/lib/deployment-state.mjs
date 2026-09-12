/**
 * scripts/lib/deployment-state.mjs
 *
 * Typed deployment/installation-state registry helpers — the writer/reader for
 * `public.deployment_state` (design: specs/plans/DEPLOYMENT-STATE-TRACKING.md).
 *
 * One state registry in the DB with a clear ownership discriminator:
 *   - `owner_kind='core'`    → plugin_id IS NULL
 *   - `owner_kind='plugin'`  → plugin_id IS NOT NULL (FK → public.plugins)
 *
 * Writers tag every row with owner + component and write ONLY after the
 * external system (Cloudflare / Supabase) confirms success — the callers below
 * perform the confirmation and then persist state here (write-after-confirm).
 *
 * Pure helpers (normalizeOwner, coreKeyToComponent, reconcileRecords, SQL
 * builders) are exported for tests; the async functions are thin executors over
 * the shared Supabase Management API facade (remote-sql.mjs).
 */

import { runSqlQuery } from './remote-sql.mjs';
import { sqlStr } from './sqlStr.mjs';

export const DEPLOYMENT_STATE_TABLE = 'public.deployment_state';

export const OWNER_KINDS = ['core', 'plugin'];

/** Component taxonomy (DEPLOYMENT-STATE-TRACKING.md §3.3). */
export const COMPONENTS = [
  'worker',
  'migrations',
  'edge_functions',
  'auth_hook',
  'bindings',
  'claims',
  'code',
  'config',
];

/** Status vocabulary for the `value.status` field. */
export const STATE_STATUSES = ['applied', 'provisioned', 'deployed', 'skipped', 'error', 'unrecorded', 'installed'];

const MIGRATION_PREFIX = 'migration:';
const FUNCTION_PREFIX = 'function:';

/**
 * Normalize the single `owner` string writers pass into the ownership pair.
 *
 *   'core'           → { ownerKind: 'core', pluginSlug: null }
 *   'plugin:<slug>'  → { ownerKind: 'plugin', pluginSlug: '<slug>' }
 *
 * @param {string} owner
 * @returns {{ ownerKind: 'core'|'plugin', pluginSlug: string|null }}
 */
export function normalizeOwner(owner) {
  if (owner === 'core') {
    return { ownerKind: 'core', pluginSlug: null };
  }
  if (typeof owner === 'string' && owner.startsWith('plugin:')) {
    const slug = owner.slice('plugin:'.length).trim();
    if (!slug) {
      throw new Error('Invalid owner "plugin:" — a plugin slug is required.');
    }
    return { ownerKind: 'plugin', pluginSlug: slug };
  }
  throw new Error(`Invalid owner "${owner}" — expected 'core' or 'plugin:<slug>'.`);
}

/**
 * Map a legacy `core_update` key onto the typed (component, key) pair
 * (DEPLOYMENT-STATE-TRACKING.md §3.3 / §5 backfill mapping).
 *
 * @param {string} key
 * @returns {{ component: string, key: string }}
 */
export function coreKeyToComponent(key) {
  const k = typeof key === 'string' ? key : String(key);
  if (k.startsWith(MIGRATION_PREFIX)) {
    return { component: 'migrations', key: k.slice(MIGRATION_PREFIX.length) };
  }
  if (k.startsWith(FUNCTION_PREFIX)) {
    return { component: 'edge_functions', key: k.slice(FUNCTION_PREFIX.length) };
  }
  if (k === 'deployment:worker') return { component: 'worker', key: 'worker' };
  if (k === 'deployment:core_commit') return { component: 'worker', key: 'core_commit' };
  if (k === 'deployment:functions') return { component: 'edge_functions', key: 'deployed' };
  return { component: 'config', key: k };
}

/**
 * Normalize an arbitrary value object into the uniform §3.2 shape.
 * Unknown/legacy fields are preserved under `meta` (nothing is lost).
 *
 * @param {object} [value]
 * @returns {{ status: string|null, version: string|null, commit: string|null,
 *             checksum: string|null, provider: string|null,
 *             deployed_at: string|null, meta: object }}
 */
export function normalizeStateValue(value = {}) {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    status: v.status ?? null,
    version: v.version ?? null,
    commit: v.commit ?? null,
    checksum: v.checksum ?? null,
    provider: v.provider ?? null,
    deployed_at: v.deployed_at ?? v.deployedAt ?? v.updatedAt ?? null,
    meta: v.meta ?? v,
  };
}

/**
 * Map a legacy core_update `{key, value}` record onto a deployment_state row.
 *
 * @param {{ key: string, value: object }} record
 * @returns {{ owner: 'core', component: string, key: string, value: object }}
 */
export function coreRecordToStateRow(record) {
  const { component, key } = coreKeyToComponent(record.key);
  return {
    owner: 'core',
    component,
    key,
    value: coreValueToStateValue(record.value, component),
  };
}

/**
 * Map an array of legacy core_update records.
 *
 * @param {{ key: string, value: object }[]} records
 * @returns {object[]}
 */
export function coreRecordsToStateRows(records) {
  return (records ?? []).map(coreRecordToStateRow);
}

/**
 * Convert a legacy core_update value into the §3.2 state value.
 *
 * @param {object} value
 * @param {string} component
 * @returns {object}
 */
export function coreValueToStateValue(value, component) {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return normalizeStateValue({
    status: component === 'worker' ? 'deployed' : 'applied',
    version: v.version ?? null,
    commit: v.commit ?? null,
    checksum: v.checksum ?? null,
    provider: 'supabase',
    deployed_at: v.deployedAt ?? v.updatedAt ?? null,
    meta: v,
  });
}

/**
 * Build a plugin-state row descriptor. `pluginId` may be a UUID (already
 * resolved) or a slug string (resolved via subquery at write time).
 *
 * @param {{ owner: string, component: string, key: string, value: object,
 *           pluginId?: string|null }} input
 * @returns {object}
 */
export function toStateRow({ owner, component, key, value, pluginId = null }) {
  const { ownerKind, pluginSlug } = normalizeOwner(owner);
  return {
    ownerKind,
    pluginSlug: pluginSlug ?? (pluginId && !isUuid(pluginId) ? pluginId : null),
    pluginId: pluginId && isUuid(pluginId) ? pluginId : null,
    component,
    key,
    value: normalizeStateValue(value),
  };
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Map resolved binding intents (binding-intents.mjs Layer C output) onto
 * `bindings` deployment-state rows — used by install-plugins.mjs and
 * provision-bindings.mjs to publish provisioning state after the Cloudflare
 * API confirms.
 *
 * @param {object[]} resolvedIntents
 * @returns {object[]}
 */
export function resolvedIntentsToBindingStateRows(resolvedIntents) {
  const rows = [];
  for (const intent of resolvedIntents ?? []) {
    if (!['queues', 'kv_namespaces', 'secrets_store_secrets'].includes(intent.kind)) continue;
    const provisioned = intent.kind === 'secrets_store_secrets'
      ? Boolean(intent.config?.store_id)
      : Boolean(intent.instanceId);
    rows.push({
      owner: `plugin:${intent.pluginId}`,
      component: 'bindings',
      key: intent.purpose,
      value: {
        status: provisioned ? 'provisioned' : 'pending',
        provider: 'cloudflare',
        meta: {
          kind: intent.kind,
          binding: intent.binding,
          resolved_name: intent.resolvedName ?? null,
          scope: intent.scope,
        },
      },
    });
  }
  return rows;
}

function escapeJson(value) {
  return sqlStr(JSON.stringify(value));
}

/**
 * Build the UPSERT statement for core rows (`plugin_id IS NULL`).
 * Returns null when there are no core rows.
 *
 * @param {object[]} rows normalized rows (ownerKind === 'core')
 * @returns {string|null}
 */
export function buildCoreUpsertSql(rows) {
  const coreRows = rows.filter((r) => r.ownerKind === 'core');
  if (coreRows.length === 0) return null;

  const values = coreRows.map((r) =>
    `('core', NULL, ${sqlStr(r.component)}, ${sqlStr(r.key)}, ${escapeJson(r.value)}::jsonb)`,
  ).join(',\n        ');

  return `
      insert into public.deployment_state (owner_kind, plugin_id, component, key, value)
      values
        ${values}
      on conflict (component, key) where plugin_id is null
      do update set
        value = excluded.value,
        updated_at = now();`;
}

/**
 * Build the UPSERT statement for plugin rows (`plugin_id IS NOT NULL`).
 * Slugs resolve to the registry UUID via subquery. Returns null when empty.
 *
 * @param {object[]} rows normalized rows (ownerKind === 'plugin')
 * @returns {string|null}
 */
export function buildPluginUpsertSql(rows) {
  const pluginRows = rows.filter((r) => r.ownerKind === 'plugin');
  if (pluginRows.length === 0) return null;

  const values = pluginRows.map((r) => {
    const pluginId = r.pluginId
      ? sqlStr(r.pluginId)
      : `(select id from public.plugins where slug = ${sqlStr(r.pluginSlug)})`;
    return `('plugin', ${pluginId}, ${sqlStr(r.component)}, ${sqlStr(r.key)}, ${escapeJson(r.value)}::jsonb)`;
  }).join(',\n        ');

  return `
      insert into public.deployment_state (owner_kind, plugin_id, component, key, value)
      values
        ${values}
      on conflict (plugin_id, component, key) where plugin_id is not null
      do update set
        value = excluded.value,
        updated_at = now();`;
}

/**
 * Build the DELETE statement that removes all of a plugin's state rows by slug.
 *
 * @param {string} pluginSlug
 * @returns {string}
 */
export function buildPluginDeleteSql(pluginSlug) {
  return `
      delete from public.deployment_state
      where plugin_id in (select id from public.plugins where slug = ${sqlStr(pluginSlug)});`;
}

/**
 * Build the DELETE statement that removes all of a plugin's state rows by the
 * registry UUID (used by recheck for stale rows whose slug join is gone).
 *
 * @param {string} pluginId
 * @returns {string}
 */
export function buildPluginDeleteByIdSql(pluginId) {
  return `
      delete from public.deployment_state
      where plugin_id = ${sqlStr(pluginId)};`;
}

/**
 * Build the SELECT statement that reads all deployment_state rows (joined with
 * the plugin slug for readability).
 *
 * @returns {string}
 */
export function buildSelectSql() {
  return `
      select ds.owner_kind, ds.plugin_id, p.slug as plugin_slug,
             ds.component, ds.key, ds.value
      from public.deployment_state ds
      left join public.plugins p on p.id = ds.plugin_id
      order by ds.owner_kind, ds.plugin_id, ds.component, ds.key;`;
}

// ─── Executors (thin — the actual SQL is built by the pure helpers above) ─────

/**
 * Write (upsert) deployment-state rows. Partitioned into core/plugin so each
 * partial unique index gets its own conflict target.
 *
 * @param {string} projectRef Supabase project ref.
 * @param {string} pat Supabase PAT.
 * @param {object[]} rows Raw row descriptors (see toStateRow).
 * @returns {Promise<void>}
 */
export async function writeDeploymentState(projectRef, pat, rows) {
  const normalized = rows.map((r) => (r.ownerKind ? r : toStateRow(r)));
  const coreSql = buildCoreUpsertSql(normalized);
  const pluginSql = buildPluginUpsertSql(normalized);

  try {
    if (coreSql) await runSqlQuery(projectRef, pat, coreSql);
    if (pluginSql) await runSqlQuery(projectRef, pat, pluginSql);
  } catch (error) {
    // Shim window: the deployment_state table is created by its own migration.
    // Writers that run before that migration is applied (e.g. migrate.mjs
    // applying the core chain, or a plugin install on an un-migrated project)
    // fall back to the legacy system_config write only — the table's own
    // backfill (§5) plus `npm run state:recheck --sync` converge it later.
    if (String(error?.message || error).includes('relation "public.deployment_state" does not exist')) {
      return;
    }
    throw error;
  }
}

/**
 * Read all deployment-state rows.
 *
 * @param {string} projectRef
 * @param {string} pat
 * @returns {Promise<{ available: boolean, rows: object[], reason?: string }>}
 */
export async function readDeploymentState(projectRef, pat) {
  try {
    const payload = await runSqlQuery(projectRef, pat, buildSelectSql());
    const raw = extractRows(payload);
    const rows = raw.map(normalizeRow).filter(Boolean);
    return { available: true, rows };
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes('relation "public.deployment_state" does not exist')) {
      return { available: false, rows: [], reason: 'deployment_state_missing' };
    }
    throw error;
  }
}

/**
 * Delete all state rows for a plugin (by slug).
 *
 * @param {string} projectRef
 * @param {string} pat
 * @param {string} pluginSlug
 * @returns {Promise<void>}
 */
export async function deletePluginDeploymentState(projectRef, pat, pluginSlug) {
  await runSqlQuery(projectRef, pat, buildPluginDeleteSql(pluginSlug));
}

// ─── Recheck reconciliation (pure) ────────────────────────────────────────────

/**
 * Reconcile local ("what should be") items against recorded ("what is") items.
 *
 * @param {{ owner: string, component: string, key: string,
 *           checksum?: string|null, version?: string|null,
 *           commit?: string|null }[]} local
 * @param {{ owner: string, component: string, key: string,
 *           value: object }[]} recorded
 * @returns {{ unrecorded: object[], drifted: {local: object, recorded: object}[],
 *             stale: object[], converged: {local: object, recorded: object}[] }}
 */
export function reconcileRecords(local, recorded) {
  const unrecorded = [];
  const drifted = [];
  const stale = [];
  const converged = [];

  const recordedByKey = new Map();
  for (const r of recorded ?? []) {
    recordedByKey.set(reconcileKey(r), r);
  }

  for (const l of local ?? []) {
    const key = reconcileKey(l);
    const r = recordedByKey.get(key);
    if (!r) {
      unrecorded.push(l);
      continue;
    }
    recordedByKey.delete(key);
    if (isDrifted(l, r)) drifted.push({ local: l, recorded: r });
    else converged.push({ local: l, recorded: r });
  }

  for (const r of recordedByKey.values()) stale.push(r);

  return { unrecorded, drifted, stale, converged };
}

function reconcileKey(item) {
  return `${item.owner}|${item.component}|${item.key}`;
}

/**
 * Aggregate deployment-state rows into a compact summary for the TUI state
 * footer (`scripts/setup.mjs` → showStateSummary). Pure — unit-tested.
 *
 * Core rows count migrations/edge functions and surface the worker/core
 * commit; plugin rows are grouped per plugin slug with recorded version,
 * migration, binding, and claim counts.
 *
 * @param {object[]} rows Normalized rows from readDeploymentState()
 * @returns {{ coreMigrations: number, edgeFunctions: number,
 *             workerCommit: string|null, workerDeployedAt: string|null,
 *             coreCommit: string|null,
 *             plugins: {slug: string, version: string|null, migrations: number,
 *                       bindings: number, claims: boolean}[] }}
 */
export function summarizeDeploymentRows(rows) {
  const summary = {
    coreMigrations: 0,
    edgeFunctions: 0,
    workerCommit: null,
    workerDeployedAt: null,
    coreCommit: null,
    plugins: [],
  };
  const byOwner = new Map();

  for (const row of rows ?? []) {
    if (row.ownerKind === 'plugin') {
      let entry = byOwner.get(row.owner);
      if (!entry) {
        entry = {
          slug: row.pluginSlug ?? row.owner.replace(/^plugin:/, ''),
          version: null,
          migrations: 0,
          bindings: 0,
          claims: false,
        };
        byOwner.set(row.owner, entry);
      }
      if (row.component === 'code' && row.key === 'code') entry.version = row.value?.version ?? null;
      else if (row.component === 'migrations') entry.migrations += 1;
      else if (row.component === 'bindings') entry.bindings += 1;
      else if (row.component === 'claims') entry.claims = true;
      continue;
    }
    if (row.ownerKind !== 'core') continue;
    if (row.component === 'migrations') summary.coreMigrations += 1;
    else if (row.component === 'edge_functions') summary.edgeFunctions += 1;
    else if (row.component === 'worker' && row.key === 'worker') {
      summary.workerCommit = row.value?.commit ?? null;
      summary.workerDeployedAt = row.value?.deployed_at ?? null;
    } else if (row.component === 'worker' && row.key === 'core_commit') {
      summary.coreCommit = row.value?.commit ?? null;
    }
  }

  summary.plugins = [...byOwner.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  return summary;
}

/**
 * Drift = a recorded checksum/version/commit differs from the local value.
 *
 * @param {object} local
 * @param {object} recorded
 * @returns {boolean}
 */
/**
 * Fields in which `local` and `recorded` differ. A row is anchored on the
 * strongest comparable field it carries (precedence: `checksum` > `version`
 * > `commit`); only that field is compared:
 *
 * - `checksum` rows (migrations, edge_functions) are **content-anchored**: the
 *   checksum is the drift truth. A moved git `commit` alone is NOT drift —
 *   otherwise every repo commit would flag all migration rows as drifted even
 *   though the SQL content is byte-identical.
 * - `version` rows (plugin `code`) drift on version.
 * - `commit`-only rows (`worker`) drift on commit — "which build is live" is
 *   the question there.
 *
 * If the stronger field is missing on either side, comparison falls through to
 * the next one (uncomparable → not drift).
 *
 * @returns {('checksum'|'version'|'commit')[]} differing field names
 */
export function driftFields(local, recorded) {
  const value = recorded?.value ?? {};
  if (local.checksum != null && value.checksum != null) {
    return local.checksum !== value.checksum ? ['checksum'] : [];
  }
  if (local.version != null && value.version != null) {
    return local.version !== value.version ? ['version'] : [];
  }
  if (local.commit != null && value.commit != null) {
    return local.commit !== value.commit ? ['commit'] : [];
  }
  return [];
}

export function isDrifted(local, recorded) {
  return driftFields(local, recorded).length > 0;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.result)) return payload.result;
  return [];
}

function parseJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeRow(row) {
  if (!row?.component) return null;
  const value = parseJson(row.value) ?? {};
  return {
    ownerKind: row.owner_kind,
    pluginId: row.plugin_id ?? null,
    pluginSlug: row.plugin_slug ?? null,
    owner: row.owner_kind === 'plugin'
      ? (row.plugin_slug ? `plugin:${row.plugin_slug}` : `plugin:${row.plugin_id ?? ''}`)
      : 'core',
    component: row.component,
    key: row.key,
    value,
  };
}
