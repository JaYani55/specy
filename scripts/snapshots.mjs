#!/usr/bin/env node
/**
 * snapshots.mjs — npm run snapshots (and the `npm run setup` → DB Snapshots menu)
 *
 * Database snapshot & restore for the connected Supabase project.
 *
 *   create   — dump ALL application database content (every base table in
 *              every non-platform schema: public, plugin schemas, auth,
 *              storage) as a JSON snapshot file into /data/snapshots.
 *   restore  — read a local snapshot from /data/snapshots and fully restore
 *              its rows: parents-first inserts after clearing the tables.
 *   list     — show locally available snapshots.
 *
 * Snapshots carry DATA only — the schema itself stays owned by the migration
 * system (apply migrations first, then restore). Restore is destructive:
 * every restored table is emptied before its rows are re-inserted.
 *
 * Flags:
 *   --create            create a snapshot (non-interactive)
 *   --restore <file>    restore a snapshot file name from /data/snapshots
 *   --list              list local snapshots
 *   --yes               skip the destructive-restore confirmation
 *
 * Critical actions (create / restore) write an action log to /data/logs
 * (see scripts/lib/action-log.mjs).
 *
 * Contract: specs/platform/db-snapshots.md
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { pathToFileURL } from 'url';
import * as p from '@clack/prompts';
import { ensureDataDirs, createActionLog } from './lib/action-log.mjs';
import { createPatDb, getSupabaseUrl, runSqlQuery, log, info, okMsg, warn, fail } from './lib/remote-sql.mjs';
import {
  SNAPSHOT_FORMAT_VERSION,
  FETCH_PAGE_SIZE,
  INSERT_CHUNK_SIZE,
  isSnapshotSchema,
  quoteIdent,
  isInsufficientPrivilegeError,
  wrapReplicaTransaction,
  wrapReplicaSession,
  buildInsertSql,
  buildDeleteSql,
  buildSequenceResetSql,
  orderTablesForRestore,
} from './lib/db-snapshot.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const { snapshotsDir } = ensureDataDirs();

// ─── Snapshot file helpers ───────────────────────────────────────────────────

function snapshotFileName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `snapshot-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.json`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * List local snapshots with their metadata (best-effort parse).
 * @returns {{ file: string, name: string, sizeBytes: number, meta: object|null }[]}
 */
function listLocalSnapshots() {
  if (!existsSync(snapshotsDir)) return [];
  return readdirSync(snapshotsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .map((name) => {
      const file = join(snapshotsDir, name);
      let meta = null;
      try {
        meta = JSON.parse(readFileSync(file, 'utf8')).meta ?? null;
      } catch { /* unreadable file — still list it */ }
      return { file, name, sizeBytes: statSync(file).size, meta };
    });
}

function showLocalSnapshots() {
  const snapshots = listLocalSnapshots();
  if (snapshots.length === 0) {
    info(`No local snapshots in ${snapshotsDir}`);
    return snapshots;
  }
  info(`Local snapshots in ${snapshotsDir}:`);
  for (const s of snapshots) {
    const summary = s.meta?.counts ? `${s.meta.counts.tables} tables, ${s.meta.counts.rows} rows` : 'metadata unreadable';
    log(`    ${s.name}  (${formatSize(s.sizeBytes)} · ${summary})`);
  }
  return snapshots;
}

// ─── Database introspection ──────────────────────────────────────────────────

/** All snapshottable base tables with their columns. */
async function introspectTables(db) {
  const res = await runSqlQuery(db.projectRef, db.pat, `
    select c.table_schema, c.table_name, c.column_name, c.data_type,
           c.is_identity, c.column_default,
           (c.is_generated <> 'NEVER') as is_generated
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where t.table_type = 'BASE TABLE'
    order by c.table_schema, c.table_name, c.ordinal_position;
  `);
  const tables = new Map();
  for (const row of res ?? []) {
    if (!isSnapshotSchema(row.table_schema)) continue;
    const key = `${row.table_schema}.${row.table_name}`;
    if (!tables.has(key)) tables.set(key, { schema: row.table_schema, table: row.table_name, columns: [] });
    tables.get(key).columns.push({
      name: row.column_name,
      data_type: row.data_type,
      is_identity: row.is_identity === 'YES',
      has_default: row.column_default !== null,
      is_generated: row.is_generated === true,
    });
  }
  return [...tables.values()];
}

/** FK edges (child schema.table → parent schema.table) among user schemas. */
async function introspectForeignKeys(db) {
  const res = await runSqlQuery(db.projectRef, db.pat, `
    select ns.nspname as schema, rel.relname as table,
           rns.nspname as ref_schema, rrel.relname as ref_table
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    join pg_class rrel on rrel.oid = c.confrelid
    join pg_namespace rns on rns.oid = rrel.relnamespace
    where c.contype = 'f'
      and ns.nspname not like 'pg\\_%'
      and rns.nspname not like 'pg\\_%';
  `);
  return (res ?? []).map((r) => [r.schema, r.table, r.ref_schema, r.ref_table]);
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Dump all application database content into a JSON snapshot file.
 * @returns {Promise<string>} path of the written snapshot
 */
async function createSnapshot(db, actionLog) {
  info('Reading database structure…');
  const tables = await introspectTables(db);
  const fkEdges = await introspectForeignKeys(db);

  const snapshotTables = [];
  const skippedTables = [];
  for (const t of tables) {
    const target = `${quoteIdent(t.schema)}.${quoteIdent(t.table)}`;
    const rows = [];
    let offset = 0;
    try {
      for (;;) {
        const page = await runSqlQuery(db.projectRef, db.pat, `select * from ${target} limit ${FETCH_PAGE_SIZE} offset ${offset};`);
        const fetched = Array.isArray(page) ? page : [];
        rows.push(...fetched);
        if (fetched.length < FETCH_PAGE_SIZE) break;
        offset += FETCH_PAGE_SIZE;
      }
    } catch (e) {
      if (isInsufficientPrivilegeError(e)) {
        // Platform-managed table (e.g. storage.vector_indexes) — the connecting
        // role cannot read it. Skip instead of aborting; record the omission.
        warn(`  Skipping ${t.schema}.${t.table} — platform-managed (insufficient privileges).`);
        skippedTables.push({ schema: t.schema, table: t.table, reason: 'insufficient_privilege' });
        actionLog.entry(`SKIPPED ${t.schema}.${t.table}: insufficient privileges`);
        continue;
      }
      throw e;
    }
    const references = fkEdges
      .filter(([s, tbl]) => s === t.schema && tbl === t.table)
      .map(([, , refSchema, refTable]) => [refSchema, refTable]);
    snapshotTables.push({
      schema: t.schema,
      table: t.table,
      // Generated columns are computed — never dumped, never restored.
      columns: t.columns.filter((c) => !c.is_generated).map(({ name, data_type, is_identity }) => ({ name, data_type, is_identity })),
      references,
      row_count: rows.length,
      rows,
    });
    log(`    ${t.schema}.${t.table}: ${rows.length} row${rows.length === 1 ? '' : 's'}`);
    actionLog.entry(`${t.schema}.${t.table}: ${rows.length} rows dumped`);
  }

  const totalRows = snapshotTables.reduce((sum, t) => sum + t.row_count, 0);
  const payload = {
    format: SNAPSHOT_FORMAT_VERSION,
    meta: {
      created_at: new Date().toISOString(),
      project_ref: db.projectRef,
      tool: 'scripts/snapshots.mjs',
      counts: { tables: snapshotTables.length, rows: totalRows, skipped: skippedTables.length },
      skipped_tables: skippedTables,
    },
    tables: snapshotTables,
  };

  const file = join(snapshotsDir, snapshotFileName());
  writeFileSync(file, JSON.stringify(payload), 'utf8');
  const size = formatSize(statSync(file).size);
  okMsg(`Snapshot saved: ${file}`);
  okMsg(`${snapshotTables.length} tables, ${totalRows} rows, ${size}.`);
  if (skippedTables.length > 0) {
    warn(`${skippedTables.length} platform-managed table(s) skipped (insufficient privileges): ${skippedTables.map((t) => `${t.schema}.${t.table}`).join(', ')}`);
  }
  actionLog.entry(`snapshot written: ${basename(file)} (${snapshotTables.length} tables, ${totalRows} rows, ${size}, ${skippedTables.length} skipped)`);
  return file;
}

// ─── Restore ─────────────────────────────────────────────────────────────────

/**
 * Probe trigger/FK suppression for the restore session. Prefer the
 * pool-safe transaction-local form (SET LOCAL inside BEGIN/COMMIT); fall
 * back to a session-scoped SET (caller resets it afterwards); if the role
 * is not privileged enough, restore runs with triggers active and uses the
 * conflict-tolerant insert fallback.
 *
 * @returns {Promise<'transaction'|'session'|null>}
 */
async function probeTriggerSuppression(db) {
  try {
    await runSqlQuery(db.projectRef, db.pat, 'begin; set local session_replication_role = replica; select 1; commit;');
    return 'transaction';
  } catch { /* endpoint may not allow explicit transactions — try session */ }
  try {
    await runSqlQuery(db.projectRef, db.pat, 'set session_replication_role = replica;');
    return 'session';
  } catch {
    return null;
  }
}

/**
 * Fully restore a local snapshot: empties every snapshotted table that still
 * exists, re-inserts rows parents-first, re-aligns sequences.
 * @returns {Promise<boolean>} true when the restore completed
 */
async function restoreSnapshot(db, snapshotFile, actionLog, { force = false } = {}) {
  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8'));
  } catch (e) {
    fail(`Snapshot is not readable JSON: ${e.message}`);
    return false;
  }
  if (snapshot?.format !== SNAPSHOT_FORMAT_VERSION || !Array.isArray(snapshot.tables)) {
    fail(`Unsupported snapshot format — expected format ${SNAPSHOT_FORMAT_VERSION}.`);
    return false;
  }
  const meta = snapshot.meta ?? {};
  info(`Snapshot: ${basename(snapshotFile)}  ·  project ${meta.project_ref ?? '?'}  ·  ${snapshot.tables.length} tables, ${meta.counts?.rows ?? '?'} rows  ·  created ${meta.created_at ?? '?'}`);
  if (meta.project_ref && meta.project_ref !== db.projectRef) {
    warn(`Snapshot was taken from project ${meta.project_ref}, restoring into ${db.projectRef}.`);
  }

  // Only tables that still exist in the target schema can be restored.
  const current = await introspectTables(db);
  const currentMap = new Map(current.map((t) => [`${t.schema}.${t.table}`, t]));
  const restorePlan = snapshot.tables
    .filter((t) => currentMap.has(`${t.schema}.${t.table}`))
    .map((t) => {
      const live = currentMap.get(`${t.schema}.${t.table}`);
      // Restore only columns that exist now and are not generated.
      const columns = (t.columns ?? [])
        .filter((c) => !c.is_generated)
        .map((c) => {
          const liveCol = live.columns.find((lc) => lc.name === c.name);
          return liveCol ? { name: c.name, data_type: c.data_type ?? liveCol.data_type } : null;
        })
        .filter(Boolean);
      return {
        schema: t.schema,
        table: t.table,
        references: t.references ?? [],
        columns,
        sequenceColumns: live.columns.filter((c) => c.is_identity || (c.column_default ?? '').startsWith('nextval')),
        rows: t.rows ?? [],
        row_count: t.row_count ?? (t.rows?.length ?? 0),
      };
    });
  const missing = snapshot.tables.filter((t) => !currentMap.has(`${t.schema}.${t.table}`));
  if (missing.length > 0) {
    warn(`Tables missing in the target database (apply migrations first) — cannot restore ${missing.length} table(s):`);
    for (const t of missing.slice(0, 10)) log(`    ${t.schema}.${t.table}`);
  }

  const ordered = orderTablesForRestore(restorePlan);
  const totalRows = restorePlan.reduce((sum, t) => sum + t.row_count, 0);

  // Triggers must be suppressed while restoring — schema triggers with side
  // effects (e.g. default-tenant creation on user_profile insert) otherwise
  // re-create rows mid-restore and break it with duplicate-key errors.
  const suppression = await probeTriggerSuppression(db);
  if (suppression === 'transaction') {
    okMsg('Triggers disabled during restore (transaction-local session_replication_role).');
  } else if (suppression === 'session') {
    warn('Triggers disabled during restore (session-scoped) — resetting after the run.');
  } else {
    warn('Triggers could NOT be disabled (insufficient privileges) — restoring with schema triggers active, using conflict-tolerant inserts.');
  }
  actionLog.entry(`trigger suppression: ${suppression ?? 'unavailable'}`);
  const wrap = (sql) => (suppression === 'transaction' ? wrapReplicaTransaction(sql)
    : suppression === 'session' ? wrapReplicaSession(sql)
    : sql);

  if (!force) {
    if (!process.stdin.isTTY) {
      fail('Refusing to restore non-interactively without --yes.');
      return false;
    }
    warn(
      'Restore is NOT atomic: each statement runs as its own transaction. An abort mid-way\n' +
      '  leaves the database partially cleared. Recommended: create a fresh snapshot immediately\n' +
      '  before restoring — it is your rollback path if the restore fails halfway.',
    );
    const proceed = await p.confirm({
      message: `Restore will DELETE all rows in ${restorePlan.length} tables and re-insert ${totalRows} rows. This cannot be undone. Continue?`,
      initialValue: false,
    });
    if (p.isCancel(proceed) || !proceed) {
      warn('Restore aborted.');
      actionLog.entry('restore aborted by user');
      actionLog.finish('aborted');
      return false;
    }
  }

  // 1. Clear tables children-first so FK constraints allow the delete.
  //    Platform-managed tables (insufficient privileges) are skipped — they
  //    keep their rows, which usually keeps FKs from restored children valid.
  const skippedKeys = new Set();
  for (const t of [...ordered].reverse()) {
    process.stdout.write(`  Clearing ${t.schema}.${t.table}… `);
    try {
      await runSqlQuery(db.projectRef, db.pat, wrap(buildDeleteSql(t.schema, t.table)));
      process.stdout.write('ok\n');
    } catch (e) {
      if (isInsufficientPrivilegeError(e)) {
        process.stdout.write('SKIPPED (platform-managed)\n');
        skippedKeys.add(`${t.schema}.${t.table}`);
        actionLog.entry(`SKIPPED ${t.schema}.${t.table}: insufficient privileges`);
        continue;
      }
      process.stdout.write('FAILED\n');
      fail(`  Could not clear ${t.schema}.${t.table}: ${e.message}`);
      actionLog.entry(`FAILED clearing ${t.schema}.${t.table}: ${e.message}`);
      actionLog.finish('failed', `clear ${t.schema}.${t.table}`);
      return false;
    }
  }

  // 2. Re-insert parents-first, chunked.
  let restoredRows = 0;
  for (const t of ordered) {
    if (t.rows.length === 0) continue;
    if (skippedKeys.has(`${t.schema}.${t.table}`)) continue;
    process.stdout.write(`  Restoring ${t.schema}.${t.table} (${t.rows.length} rows)… `);
    const overrideIdentity = t.columns.some((c) => t.sequenceColumns.some((s) => s.name === c.name));
    const statements = buildInsertSql(t.schema, t.table, t.columns, t.rows, {
      chunkSize: INSERT_CHUNK_SIZE,
      overrideIdentity,
      onConflictDoNothing: suppression === null,
    }).map(wrap);
    try {
      for (const statement of statements) {
        await runSqlQuery(db.projectRef, db.pat, statement);
      }
      process.stdout.write('ok\n');
      restoredRows += t.rows.length;
      actionLog.entry(`restored ${t.schema}.${t.table}: ${t.rows.length} rows`);
    } catch (e) {
      process.stdout.write('FAILED\n');
      fail(`  Could not restore ${t.schema}.${t.table}: ${e.message}`);
      actionLog.entry(`FAILED restoring ${t.schema}.${t.table}: ${e.message}`);
      actionLog.finish('failed', `insert ${t.schema}.${t.table}`);
      return false;
    }
  }

  // 3. Verify: every restored table should now hold exactly its snapshot rows.
  let countMismatches = 0;
  for (const t of ordered) {
    if (skippedKeys.has(`${t.schema}.${t.table}`)) continue;
    try {
      const res = await runSqlQuery(db.projectRef, db.pat, `select count(*)::int as n from ${quoteIdent(t.schema)}.${quoteIdent(t.table)};`);
      const actual = Array.isArray(res) ? Number(res[0]?.n ?? NaN) : NaN;
      if (actual !== t.rows.length) {
        warn(`  Row count mismatch for ${t.schema}.${t.table}: snapshot ${t.rows.length}, database ${actual}${suppression === null ? ' (triggers active — trigger-created rows or conflicted inserts possible)' : ''}.`);
        countMismatches += 1;
        actionLog.entry(`row count mismatch ${t.schema}.${t.table}: snapshot ${t.rows.length}, database ${actual}`);
      }
    } catch (e) {
      warn(`  Row count verification for ${t.schema}.${t.table} failed: ${e.message}`);
    }
  }

  // 4. Re-align identity/serial sequences with the restored max values.
  let sequenceFixes = 0;
  for (const t of ordered) {
    if (t.sequenceColumns.length === 0 || t.rows.length === 0) continue;
    if (skippedKeys.has(`${t.schema}.${t.table}`)) continue;
    try {
      for (const statement of buildSequenceResetSql(t.schema, t.table, t.sequenceColumns)) {
        await runSqlQuery(db.projectRef, db.pat, statement);
      }
      sequenceFixes += t.sequenceColumns.length;
    } catch (e) {
      warn(`  Sequence re-alignment for ${t.schema}.${t.table} failed: ${e.message}`);
      actionLog.entry(`sequence re-alignment failed for ${t.schema}.${t.table}: ${e.message}`);
    }
  }

  if (suppression === 'session') {
    try {
      await runSqlQuery(db.projectRef, db.pat, 'reset session_replication_role;');
    } catch (e) {
      warn(`  Could not reset session_replication_role: ${e.message}`);
    }
  }

  okMsg(`Restore complete — ${restoredRows} rows across ${ordered.length - skippedKeys.size} tables, ${sequenceFixes} sequence(s) re-aligned.${countMismatches > 0 ? ` ${countMismatches} row count mismatch(es) — see warnings above.` : ''}`);
  if (skippedKeys.size > 0) {
    warn(`${skippedKeys.size} platform-managed table(s) left untouched (insufficient privileges): ${[...skippedKeys].join(', ')}`);
  }
  actionLog.entry(`restore complete: ${restoredRows} rows across ${ordered.length - skippedKeys.size} tables, ${skippedKeys.size} skipped`);
  actionLog.finish('restored');
  return true;
}

// ─── Flows ───────────────────────────────────────────────────────────────────

async function connectDb() {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) {
    fail('SUPABASE_URL not found in .env — cannot connect.');
    process.exitCode = 1;
    return null;
  }
  const db = await createPatDb();
  if (!db) {
    fail('No Supabase PAT — snapshots cannot be created or restored.');
    process.exitCode = 1;
    return null;
  }
  return db;
}

async function runCreate(db) {
  const actionLog = createActionLog('snapshot-create', { meta: { project: db.projectRef } });
  try {
    await createSnapshot(db, actionLog);
    actionLog.finish('created');
  } catch (e) {
    fail(`Snapshot creation failed: ${e.message}`);
    actionLog.entry(`FAILED: ${e.message}`);
    actionLog.finish('failed', e.message);
    process.exitCode = 1;
  }
}

async function runRestore(db, snapshotFile, { force = false } = {}) {
  const actionLog = createActionLog('snapshot-restore', { meta: { project: db.projectRef, snapshot: basename(snapshotFile) } });
  const restored = await restoreSnapshot(db, snapshotFile, actionLog, { force });
  if (!restored) process.exitCode = 1;
}

async function interactiveMode() {
  p.intro('Specy — DB Snapshots');
  const action = await p.select({
    message: 'DB Snapshots — what would you like to do?',
    options: [
      { value: 'create', label: 'Create Snapshot', hint: 'dump all database content into /data/snapshots' },
      { value: 'restore', label: 'Restore Snapshot', hint: 'fully restore a local snapshot (destructive)' },
      { value: 'list', label: 'List Snapshots', hint: 'show locally available snapshots' },
    ],
  });
  if (p.isCancel(action)) return;

  if (action === 'list') {
    showLocalSnapshots();
    return;
  }

  const db = await connectDb();
  if (!db) return;

  if (action === 'create') {
    await runCreate(db);
    return;
  }

  const snapshots = listLocalSnapshots();
  if (snapshots.length === 0) {
    warn('No local snapshots found — create one first.');
    return;
  }
  const selected = await p.select({
    message: 'Which snapshot should be restored?',
    options: snapshots.map((s) => ({
      value: s.name,
      label: s.name,
      hint: `${formatSize(s.sizeBytes)}${s.meta?.counts ? ` · ${s.meta.counts.tables} tables · ${s.meta.counts.rows} rows` : ''}`,
    })),
  });
  if (p.isCancel(selected)) return;
  await runRestore(db, join(snapshotsDir, selected));
}

async function main() {
  log('');
  log('Database snapshots — Supabase content ↔ /data/snapshots');

  const mode = flag('--create') ? 'create' : flag('--restore') ? 'restore' : flag('--list') ? 'list' : null;
  if (!mode) {
    await interactiveMode();
    return;
  }

  if (mode === 'list') {
    showLocalSnapshots();
    return;
  }

  const db = await connectDb();
  if (!db) return;

  if (mode === 'create') {
    await runCreate(db);
    return;
  }

  const name = argValue('--restore');
  if (!name) {
    fail('--restore requires a snapshot file name (see: npm run snapshots -- --list).');
    process.exitCode = 1;
    return;
  }
  const file = join(snapshotsDir, name.endsWith('.json') ? name : `${name}.json`);
  if (!existsSync(file)) {
    fail(`Snapshot not found: ${file}`);
    process.exitCode = 1;
    return;
  }
  await runRestore(db, file, { force: flag('--yes') });
}

// Only dispatch when invoked directly — importing this module (e.g. from tests)
// must be side-effect free, matching the other scripts in scripts/.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}