/**
 * scripts/lib/exposed-schemas.mjs
 *
 * Programmatic management of Supabase "API → Exposed schemas" for plugin
 * lifecycle flows: install must EXPOSE the plugin schema (development.md
 * §API exposure requirement), uninstall must UN-expose it — an exposed
 * schema whose objects were dropped/revoked wedges PostgREST's schema cache
 * (`PGRST002`: every REST query 503s "Could not query the database for the
 * schema cache").
 *
 * Two mechanisms, tried in order:
 *   1. **Management API `GET/PATCH /v1/projects/{ref}/postgrest`** — the
 *      hosted-platform configuration (what the dashboard toggles write).
 *      `db_schemas` may come back as a string or array; both normalized.
 *   2. **In-DB config GUC `pgrst.db_schemas`** (stored in pg_db_role_setting,
 *      rewritten as project owner via the Management-API SQL runner) —
 *      fallback for self-hosted/legacy projects where the API endpoint is
 *      unavailable. PostgREST v12+ reads this GUC; env-var platform config
 *      takes precedence when present.
 *
 * Both paths end with `NOTIFY pgrst, 'reload config'` / a PATCH (which
 * triggers the platform-side reload).
 */

import { runSqlQuery } from './remote-sql.mjs';

/**
 * Normalize a `db_schemas` value (string "public, pluradash" | array |
 * null) into a trimmed string[] or null.
 *
 * @param {string|string[]|null|undefined} value
 * @returns {string[]|null}
 */
export function parseExposedSchemas(value) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const list = value.map((s) => String(s).trim()).filter(Boolean);
    return list.length ? list : null;
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const list = trimmed.split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  return list.length ? list : null;
}

/**
 * Remove one schema from a schema list (string or array value).
 *
 * @param {string|string[]|null|undefined} setting current value
 * @param {string} schema schema name to remove
 * @returns {{ changed: boolean, present: boolean, newValue: string|null }}
 */
export function removeSchemaFromExposedList(setting, schema) {
  const list = parseExposedSchemas(setting);
  if (!list) return { changed: false, present: false, newValue: null };
  const normalized = schema.trim();
  const remaining = list.filter((s) => s !== normalized);
  const present = remaining.length !== list.length;
  return {
    changed: present,
    present,
    newValue: remaining.length ? remaining.join(', ') : null,
  };
}

/**
 * Add one schema to a schema list. A missing/empty value is treated as the
 * platform default (`public`) — `public` must never disappear from the
 * exposed list, otherwise core REST access breaks.
 *
 * @param {string|string[]|null|undefined} setting current value
 * @param {string} schema schema name to add
 * @returns {{ changed: boolean, present: boolean, newValue: string }}
 */
export function addSchemaToExposedList(setting, schema) {
  const base = parseExposedSchemas(setting) ?? ['public'];
  const normalized = schema.trim();
  if (base.includes(normalized)) {
    return { changed: false, present: true, newValue: base.join(', ') };
  }
  return { changed: true, present: true, newValue: [...base, normalized].join(', ') };
}

/**
 * Quote a string literal for a SQL SET value (single-quote escaping).
 *
 * @param {string} value
 * @returns {string}
 */
export function quoteSqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// ─── Executors (Management API) ──────────────────────────────────────────────

/**
 * @param {string} projectRef
 * @param {string} pat
 * @param {'GET'|'PATCH'} method
 * @param {object} [body]
 */
async function postgrestConfigRequest(projectRef, pat, method, body) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/postgrest`, {
    method,
    headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    let detail = raw;
    try { detail = JSON.parse(raw).message || raw; } catch { /* keep raw */ }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return res.status === 204 ? null : res.json();
}

/** Read the effective exposed-schemas list via the platform API. */
export async function readExposedSchemasViaApi(projectRef, pat) {
  const config = await postgrestConfigRequest(projectRef, pat, 'GET');
  return parseExposedSchemas(config?.db_schemas ?? null);
}

/** Write the exposed-schemas list via the platform API (triggers reload). */
export async function writeExposedSchemasViaApi(projectRef, pat, newValue) {
  await postgrestConfigRequest(projectRef, pat, 'PATCH', { db_schemas: newValue });
}

// ─── Executors (in-DB GUC fallback) ──────────────────────────────────────────

async function readExposedSchemasViaGuc(projectRef, pat) {
  const rows = await runSqlQuery(
    projectRef,
    pat,
    "select current_setting('pgrst.db_schemas', true) as setting;",
  );
  return parseExposedSchemas(rows?.[0]?.setting ?? null);
}

/**
 * Rewrite every `pgrst.db_schemas` entry in pg_db_role_setting (database- and
 * role-level rows) and notify PostgREST. Project owner (superuser) required.
 */
async function writeExposedSchemasViaGuc(projectRef, pat, newValue) {
  const elementValue = newValue === null ? '' : `pgrst.db_schemas=${newValue}`;
  const literal = quoteSqlLiteral(elementValue);

  const statements = [
    `update pg_db_role_setting s
        set setconfig = (
          select coalesce(array_agg(
            case when el like 'pgrst.db\\_schemas=%' then ${literal} else el end
          ), '{}')
          from unnest(s.setconfig) el
        )
      where exists (
        select 1 from unnest(s.setconfig) el where el like 'pgrst.db\\_schemas=%'
      );`,
  ];
  if (newValue === null) {
    statements.push('alter database postgres reset pgrst.db_schemas;');
  }
  statements.push("notify pgrst, 'reload config';");

  for (const sql of statements) {
    await runSqlQuery(projectRef, pat, sql);
  }
}

// ─── Public flow API (install / uninstall) ───────────────────────────────────

/**
 * Expose `schema` (add to the project's exposed schemas). Tries the platform
 * API first, then the in-DB GUC. Verifies the result and reports which
 * mechanism was used.
 *
 * @param {string} projectRef
 * @param {string} pat
 * @param {string} schema
 * @returns {Promise<{ status: 'already-exposed'|'added'|'failed', via?: 'api'|'guc', newValue?: string, error?: string }>}
 */
export async function exposePluginSchema(projectRef, pat, schema) {
  let current = null;
  let via = null;
  try {
    current = await readExposedSchemasViaApi(projectRef, pat);
    via = 'api';
  } catch {
    try {
      current = await readExposedSchemasViaGuc(projectRef, pat);
      via = 'guc';
    } catch (e) {
      return { status: 'failed', error: `read failed: ${e.message}` };
    }
  }

  const { changed, newValue } = addSchemaToExposedList(current, schema);
  if (!changed) return { status: 'already-exposed', via, newValue };

  try {
    if (via === 'api') {
      await writeExposedSchemasViaApi(projectRef, pat, newValue);
      const verify = await readExposedSchemasViaApi(projectRef, pat);
      if ((verify ?? []).includes(schema.trim())) return { status: 'added', via, newValue };
      return { status: 'failed', error: 'schema missing after API update', newValue };
    }
    await writeExposedSchemasViaGuc(projectRef, pat, newValue);
    const verify = await readExposedSchemasViaGuc(projectRef, pat);
    if ((verify ?? []).includes(schema.trim())) return { status: 'added', via, newValue };
    return { status: 'failed', error: 'schema missing after GUC update', newValue };
  } catch (error) {
    return { status: 'failed', error: String(error?.message ?? error), newValue };
  }
}

/**
 * Symmetric cleanup: remove `schema` from the exposed schemas. Tries the
 * platform API first, then the in-DB GUC.
 *
 * @param {string} projectRef
 * @param {string} pat
 * @param {string} schema
 * @returns {Promise<{ status: 'not-exposed'|'removed'|'failed', via?: 'api'|'guc', newValue?: string|null, error?: string }>}
 */
export async function unexposePluginSchema(projectRef, pat, schema) {
  let current = null;
  let via = null;
  try {
    current = await readExposedSchemasViaApi(projectRef, pat);
    via = 'api';
  } catch {
    try {
      current = await readExposedSchemasViaGuc(projectRef, pat);
      via = 'guc';
    } catch (e) {
      return { status: 'failed', error: `read failed: ${e.message}` };
    }
  }

  const { changed, newValue } = removeSchemaFromExposedList(current, schema);
  if (!changed) return { status: 'not-exposed', via, newValue };

  try {
    if (via === 'api') {
      await writeExposedSchemasViaApi(projectRef, pat, newValue);
      const verify = await readExposedSchemasViaApi(projectRef, pat);
      if (!(verify ?? []).includes(schema.trim())) return { status: 'removed', via, newValue };
      return { status: 'failed', error: 'schema still present after API update', newValue };
    }
    await writeExposedSchemasViaGuc(projectRef, pat, newValue);
    const verify = await readExposedSchemasViaGuc(projectRef, pat);
    if (!(verify ?? []).includes(schema.trim())) return { status: 'removed', via, newValue };
    return { status: 'failed', error: 'schema still present after GUC update', newValue };
  } catch (error) {
    return { status: 'failed', error: String(error?.message ?? error), newValue };
  }
}