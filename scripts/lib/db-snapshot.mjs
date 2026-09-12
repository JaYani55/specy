/**
 * db-snapshot.mjs — pure logic for database snapshots (scripts/snapshots.mjs).
 *
 * Snapshot model: a JSON file dumping ALL user-facing database content of the
 * connected Supabase project — every base table in every schema that is not a
 * platform/system schema (see SYSTEM_SCHEMA_BLOCKLIST). Rows are stored as
 * objects keyed by column name, exactly as the Supabase Management API
 * returns them. Restore re-inserts the rows into the existing schema
 * (snapshots carry DATA only — the schema itself is owned by the migrations).
 *
 * This module holds the pure, testable pieces: schema filtering, SQL literal
 * rendering, insert/delete/sequence-reset SQL generation and the FK-aware
 * table ordering used by restore. It must stay free of I/O and network calls.
 *
 * Contract: specs/platform/db-snapshots.md
 */

export const SNAPSHOT_FORMAT_VERSION = 1;

/** Rows per INSERT statement (each statement is one Management API call). */
export const INSERT_CHUNK_SIZE = 100;

/** Rows fetched per SELECT page while dumping (keeps responses small). */
export const FETCH_PAGE_SIZE = 500;

/**
 * Schemas that belong to the Supabase platform itself (or are system
 * machinery) and are NOT part of a snapshot. Application content lives in
 * `public`, plugin schemas and the managed `auth`/`storage` schemas — those
 * ARE snapshotted (public tables regularly FK into auth.users, so a full
 * restore needs auth rows back in place).
 */
export const SYSTEM_SCHEMA_BLOCKLIST = new Set([
  'information_schema',
  'pg_catalog',
  'pg_toast',
  'supabase_migrations',
  'supabase_functions',
  'supabase_attribution',
  'realtime',
  'extensions',
  'graphql',
  'graphql_public',
  'net',
  'vault',
  'pgsodium',
  'pgsodium_masks',
  'pgtle',
  'cron',
  'pgbouncer',
  'pgroonga',
]);

/** True when a schema is application content and therefore snapshotted. */
export function isSnapshotSchema(schema) {
  if (typeof schema !== 'string') return false;
  return !schema.startsWith('pg_') && !SYSTEM_SCHEMA_BLOCKLIST.has(schema);
}

/** Safe SQL identifier: "abc" → "abc", `a"b` → `a""b`. */
export function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

/** Safe SQL string literal body: O'Connor → O''Connor. */
export function quoteStringLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * SQLSTATE of a Management API error, when the message carries one
 * ("… ERROR:  42501: permission denied for table vector_indexes" → "42501").
 */
export function sqlStateOf(error) {
  const m = /\b(\d{5})\b\s*[:,]/.exec(String(error?.message ?? ''));
  return m ? m[1] : null;
}

/**
 * True when a query failed because the connecting role lacks privileges on
 * the object (SQLSTATE 42501). Some Supabase platform tables (e.g.
 * `storage.vector_indexes`) are owned by platform roles the Management API
 * connection cannot write — such tables are skipped on dump and restore
 * instead of aborting the whole snapshot run.
 */
export function isInsufficientPrivilegeError(error) {
  return sqlStateOf(error) === '42501';
}

/**
 * Render a JS value (as decoded from a snapshot JSON / Management API row)
 * as a SQL literal.
 *
 * - null/undefined       → NULL
 * - number               → as-is (non-finite → NULL)
 * - boolean              → TRUE / FALSE
 * - string               → quoted string literal
 * - Date                 → ISO string literal
 * - array / object       → jsonb literal ('…'::jsonb)
 */
export function sqlValueLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'bigint') return quoteStringLiteral(value.toString());
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return quoteStringLiteral(value.toISOString());
  if (typeof value === 'string') {
    if (value.includes('\u0000')) {
      throw new Error('NUL byte (\\u0000) in string value — PostgreSQL cannot store it.');
    }
    return quoteStringLiteral(value);
  }
  if (Array.isArray(value)) {
    // JSON array → could be a Postgres ARRAY column. Callers that know the
    // column type render via pgArrayLiteral(); the jsonb fallback covers
    // jsonb columns and is a last resort.
    return `${quoteStringLiteral(JSON.stringify(value))}::jsonb`;
  }
  return `${quoteStringLiteral(JSON.stringify(value))}::jsonb`;
}

/**
 * Render a JS array as a PostgreSQL array literal, e.g. ["a","b"] →
 * `'{"a","b"}'`. Used for columns whose data_type is 'ARRAY'.
 * Nested arrays render recursively as multi-dimensional arrays.
 */
export function pgArrayLiteral(value) {
  if (!Array.isArray(value)) return sqlValueLiteral(value);
  return `'${arrayElementsToPg(value)}'`;
}

function arrayElementsToPg(elements) {
  const inner = elements
    .map((el) => {
      if (el === null || el === undefined) return 'NULL';
      if (typeof el === 'number') return Number.isFinite(el) ? String(el) : 'NULL';
      if (typeof el === 'boolean') return el ? 't' : 'f';
      if (Array.isArray(el)) return arrayElementsToPg(el);
      if (el instanceof Date) return `"${el.toISOString()}"`;
      return `"${String(el).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
    })
    .join(',');
  return `{${inner}}`;
}

/**
 * Render one row value for a column, honouring the column's data_type from
 * information_schema (needed to emit native Postgres array literals).
 *
 * @param {unknown} value row value
 * @param {{ name: string, data_type?: string }} column
 */
export function sqlValueForColumn(value, column) {
  if (value === null || value === undefined) return 'NULL';
  if (column?.data_type === 'ARRAY') return pgArrayLiteral(value);
  return sqlValueLiteral(value);
}

/**
 * Build chunked INSERT statements for one table.
 *
 * @param {string} schema
 * @param {string} table
 * @param {{ name: string, data_type?: string }[]} columns columns to insert
 * @param {Record<string, unknown>[]} rows
 * @param {{ chunkSize?: number, overrideIdentity?: boolean, onConflictDoNothing?: boolean }} [options]
 *        overrideIdentity — emit OVERRIDING SYSTEM VALUE (identity columns)
 *        onConflictDoNothing — tolerate rows that already exist (fallback
 *        mode when triggers cannot be suppressed)
 * @returns {string[]} one SQL string per chunk
 */
export function buildInsertSql(schema, table, columns, rows, { chunkSize = INSERT_CHUNK_SIZE, overrideIdentity = false, onConflictDoNothing = false } = {}) {
  if (!columns.length) return [];
  const target = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  const colList = columns.map((c) => quoteIdent(c.name)).join(', ');
  const conflict = onConflictDoNothing ? ' on conflict do nothing' : '';
  const statements = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = chunk
      .map((row) => `(${columns.map((c) => sqlValueForColumn(row[c.name], c)).join(', ')})`)
      .join(',\n  ');
    statements.push(
      `insert into ${target} (${colList})${overrideIdentity ? ' OVERRIDING SYSTEM VALUE' : ''} values\n  ${values}${conflict};`,
    );
  }
  return statements;
}

/** DELETE statement that empties one table. */
export function buildDeleteSql(schema, table) {
  return `delete from ${quoteIdent(schema)}.${quoteIdent(table)};`;
}

/**
 * Trigger/FK suppression for restore statements. Triggers must be disabled
 * while restoring: the schema ships AFTER-INSERT triggers with side effects
 * (e.g. `create_default_tenant_for_profile_trigger` re-creates the default
 * workspace tenant when user_profile rows are restored), which corrupt a
 * clean restore with duplicate-key errors.
 *
 * `session_replication_role = replica` disables FK *and* user triggers for
 * the session/transaction. Transaction-local wrapping (SET LOCAL inside an
 * explicit BEGIN/COMMIT) is preferred — it cannot leak into the server-side
 * pooled connection the Management API keeps alive after the run.
 */
export const REPLICA_SET_LOCAL_SQL = 'set local session_replication_role = replica;';
export const REPLICA_SET_SESSION_SQL = 'set session_replication_role = replica;';

/** Statement wrapped in a pool-safe transaction-local replica session. */
export function wrapReplicaTransaction(sql) {
  return `begin;\n${REPLICA_SET_LOCAL_SQL}\n${sql}\ncommit;`;
}

/** Session-scoped replica setting (fallback; caller must RESET afterwards). */
export function wrapReplicaSession(sql) {
  return `${REPLICA_SET_SESSION_SQL}\n${sql}`;
}

/**
 * Sequence re-alignment statements for serial/identity columns, run AFTER
 * rows are restored so newly inserted rows continue after the restored max.
 *
 * @param {string} schema
 * @param {string} table
 * @param {{ name: string }[]} sequenceColumns
 * @returns {string[]} one statement per sequence column
 */
export function buildSequenceResetSql(schema, table, sequenceColumns) {
  const target = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  // pg_get_serial_sequence takes plain (single-quoted) names.
  const tableLiteral = quoteStringLiteral(`${schema}.${table}`);
  return sequenceColumns.map((col) => {
    const colLiteral = quoteStringLiteral(col.name);
    return `select setval(pg_get_serial_sequence(${tableLiteral}, ${colLiteral}), coalesce((select max(${quoteIdent(col.name)}) from ${target}), 0) + 1, false);`;
  });
}

/**
 * Order tables parents-first using the foreign-key graph, so restore inserts
 * satisfy FK constraints. Tables the snapshot does not contain (and
 * self-references) are ignored. Cycles cannot be ordered — those tables are
 * appended in snapshot order as a best effort (restore may fail on them and
 * surfaces a clear error).
 *
 * @param {{ schema: string, table: string, references?: [string, string][] }[]} tables
 * @returns {Array<{ schema: string, table: string }>} parents-first order
 */
export function orderTablesForRestore(tables) {
  const key = (s, t) => `${s}.${t}`;
  const index = new Map(tables.map((t) => [key(t.schema, t.table), t]));
  const name = (t) => key(t.schema, t.table);

  const indegree = new Map();
  const dependents = new Map();
  for (const t of tables) {
    indegree.set(name(t), 0);
  }
  for (const t of tables) {
    const parents = new Set(
      (t.references ?? [])
        .filter(([rs, rt]) => index.has(key(rs, rt)) && key(rs, rt) !== name(t))
        .map(([rs, rt]) => key(rs, rt)),
    );
    for (const parent of parents) {
      indegree.set(name(t), indegree.get(name(t)) + 1);
      if (!dependents.has(parent)) dependents.set(parent, new Set());
      dependents.get(parent).add(name(t));
    }
  }

  const queue = [...indegree.entries()].filter(([, d]) => d === 0).map(([k]) => k);
  const ordered = [];
  const seen = new Set();
  while (queue.length > 0) {
    const k = queue.shift();
    if (seen.has(k)) continue;
    seen.add(k);
    ordered.push(k);
    for (const dep of dependents.get(k) ?? []) {
      indegree.set(dep, indegree.get(dep) - 1);
      if (indegree.get(dep) === 0) queue.push(dep);
    }
  }
  const unresolved = tables.map(name).filter((k) => !seen.has(k)); // cycles
  return [...ordered, ...unresolved]
    .map((k) => index.get(k))
    .filter(Boolean);
}