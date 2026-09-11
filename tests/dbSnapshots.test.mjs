/**
 * dbSnapshots.test.mjs — unit tests for the database snapshot tooling.
 *
 * Covers the pure logic in scripts/lib/db-snapshot.mjs (schema filtering,
 * SQL literal rendering, insert/delete/sequence SQL, FK-aware restore
 * ordering) and the /data workspace contract in scripts/lib/action-log.mjs
 * (dynamic directory creation, log file layout).
 */

import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  SNAPSHOT_FORMAT_VERSION,
  SYSTEM_SCHEMA_BLOCKLIST,
  isSnapshotSchema,
  quoteIdent,
  sqlValueLiteral,
  pgArrayLiteral,
  sqlValueForColumn,
  buildInsertSql,
  buildDeleteSql,
  buildSequenceResetSql,
  orderTablesForRestore,
  sqlStateOf,
  isInsufficientPrivilegeError,
  REPLICA_SET_LOCAL_SQL,
  REPLICA_SET_SESSION_SQL,
  wrapReplicaTransaction,
  wrapReplicaSession,
} from '../scripts/lib/db-snapshot.mjs';
import { ensureDataDirs, createActionLog, timestampSlug } from '../scripts/lib/action-log.mjs';

const tempRoot = mkdtempSync(join(tmpdir(), 'specy-snapshots-test-'));

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

// ─── Schema filtering ────────────────────────────────────────────────────────

describe('isSnapshotSchema', () => {
  it('snapshots application content', () => {
    for (const schema of ['public', 'forms_plugin', 'my_plugin', 'auth', 'storage', 'tenant_1']) {
      assert.equal(isSnapshotSchema(schema), true, schema);
    }
  });

  it('excludes platform and system schemas', () => {
    for (const schema of [...SYSTEM_SCHEMA_BLOCKLIST, 'pg_toast', 'pg_temp_3']) {
      assert.equal(isSnapshotSchema(schema), false, schema);
    }
    assert.equal(isSnapshotSchema('information_schema'), false);
  });

  it('rejects non-string input', () => {
    assert.equal(isSnapshotSchema(null), false);
    assert.equal(isSnapshotSchema(undefined), false);
  });
});

// ─── SQL literal rendering ───────────────────────────────────────────────────

describe('sqlValueLiteral', () => {
  it('renders null and undefined as NULL', () => {
    assert.equal(sqlValueLiteral(null), 'NULL');
    assert.equal(sqlValueLiteral(undefined), 'NULL');
  });

  it('renders numbers, booleans and non-finite values', () => {
    assert.equal(sqlValueLiteral(42), '42');
    assert.equal(sqlValueLiteral(1.5), '1.5');
    assert.equal(sqlValueLiteral(true), 'TRUE');
    assert.equal(sqlValueLiteral(false), 'FALSE');
    assert.equal(sqlValueLiteral(NaN), 'NULL');
    assert.equal(sqlValueLiteral(Infinity), 'NULL');
  });

  it('escapes single quotes in strings', () => {
    assert.equal(sqlValueLiteral("O'Connor"), `'O''Connor'`);
    assert.equal(sqlValueLiteral(''), `''`);
  });

  it('rejects NUL bytes', () => {
    assert.throws(() => sqlValueLiteral('bad\u0000value'), /NUL byte/);
  });

  it('renders objects and arrays as jsonb literals', () => {
    assert.equal(sqlValueLiteral({ a: 1 }), `'{"a":1}'::jsonb`);
    assert.equal(sqlValueLiteral([1, 2]), `'[1,2]'::jsonb`);
  });

  it('escapes quotes inside jsonb payloads', () => {
    assert.equal(sqlValueLiteral({ s: "it's" }), `'{"s":"it''s"}'::jsonb`);
  });
});

describe('pgArrayLiteral', () => {
  it('renders native Postgres array literals', () => {
    assert.equal(pgArrayLiteral(['a', 'b']), `'{"a","b"}'`);
    assert.equal(pgArrayLiteral([1, 2, 3]), `'{1,2,3}'`);
    assert.equal(pgArrayLiteral(['a"b', 'c\\d']), `'{"a\\"b","c\\\\d"}'`);
  });

  it('handles null elements and nesting', () => {
    assert.equal(pgArrayLiteral(['x', null]), `'{"x",NULL}'`);
    assert.equal(pgArrayLiteral([[1, 2], [3, 4]]), `'{{1,2},{3,4}}'`);
  });

  it('falls back to sqlValueLiteral for non-arrays', () => {
    assert.equal(pgArrayLiteral('x'), `'x'`);
    assert.equal(pgArrayLiteral(null), 'NULL');
  });
});

describe('sqlValueForColumn', () => {
  it('uses native array literals for ARRAY columns', () => {
    assert.equal(
      sqlValueForColumn(['a', 'b'], { name: 'tags', data_type: 'ARRAY' }),
      `'{"a","b"}'`,
    );
  });

  it('uses jsonb for ordinary objects', () => {
    assert.equal(
      sqlValueForColumn({ a: 1 }, { name: 'meta', data_type: 'jsonb' }),
      `'{"a":1}'::jsonb`,
    );
  });
});

describe('isInsufficientPrivilegeError', () => {
  it('detects SQLSTATE 42501 in Management API error messages', () => {
    const err = new Error(
      'HTTP 400: Failed to run sql query: ERROR:  42501: permission denied for table vector_indexes',
    );
    assert.equal(isInsufficientPrivilegeError(err), true);
    assert.equal(sqlStateOf(err), '42501');
  });

  it('does not flag other SQL errors as privilege issues', () => {
    assert.equal(isInsufficientPrivilegeError(new Error('HTTP 400: … 42P01: relation "x" does not exist')), false);
    assert.equal(isInsufficientPrivilegeError(new Error('HTTP 401: unauthorized')), false);
    assert.equal(isInsufficientPrivilegeError(new Error('connection refused')), false);
    assert.equal(isInsufficientPrivilegeError(null), false);
    assert.equal(sqlStateOf(new Error('no state here')), null);
  });
});

// ─── SQL statement builders ──────────────────────────────────────────────────

describe('buildInsertSql', () => {
  const columns = [{ name: 'id' }, { name: 'title' }, { name: 'tags', data_type: 'ARRAY' }];

  it('quotes identifiers and honours chunk size', () => {
    const rows = [
      { id: 1, title: 'one', tags: ['x'] },
      { id: 2, title: "tw'o", tags: null },
      { id: 3, title: 'three', tags: ['y', 'z'] },
    ];
    const [first, second] = buildInsertSql('public', 'posts', columns, rows, { chunkSize: 2 });
    assert.match(first, /^insert into "public"\."posts" \("id", "title", "tags"\) values/);
    assert.match(first, /\(1, 'one', '\{"x"\}'\)/);
    assert.match(first, /\(2, 'tw''o', NULL\)/);
    assert.match(second, /\(3, 'three', '\{"y","z"\}'\)/);
    assert.doesNotMatch(first, /OVERRIDING/);
  });

  it('emits OVERRIDING SYSTEM VALUE on request', () => {
    const sql = buildInsertSql('public', 't', [{ name: 'id' }], [{ id: 1 }], { overrideIdentity: true });
    assert.match(sql[0], /insert into "public"\."t" \("id"\) OVERRIDING SYSTEM VALUE values/);
  });

  it('returns no statements for empty rows or empty columns', () => {
    assert.deepEqual(buildInsertSql('public', 't', columns, []), []);
    assert.deepEqual(buildInsertSql('public', 't', [], [{ id: 1 }]), []);
  });

  it('appends on conflict do nothing in fallback mode', () => {
    const sql = buildInsertSql('public', 't', [{ name: 'id' }], [{ id: 1 }], { onConflictDoNothing: true });
    assert.match(sql[0], /values\s+\(1\) on conflict do nothing;/);
    const plain = buildInsertSql('public', 't', [{ name: 'id' }], [{ id: 1 }]);
    assert.doesNotMatch(plain[0], /on conflict/);
  });

  it('renders exactly one statement per chunk boundary', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: i, title: null, tags: null }));
    assert.equal(buildInsertSql('public', 't', columns, rows, { chunkSize: 3 }).length, 3);
  });
});

describe('buildDeleteSql', () => {
  it('empties exactly the target table', () => {
    assert.equal(buildDeleteSql('public', 'posts'), 'delete from "public"."posts";');
    assert.equal(buildDeleteSql('my_plugin', 't"x'), 'delete from "my_plugin"."t""x";');
  });
});

describe('buildSequenceResetSql', () => {
  it('aligns each sequence with the restored max', () => {
    const sql = buildSequenceResetSql('public', 'posts', [{ name: 'id' }]);
    assert.equal(sql.length, 1);
    assert.match(sql[0], /setval\(pg_get_serial_sequence\('public\.posts', 'id'\)/);
    assert.match(sql[0], /select max\("id"\) from "public"\."posts"/);
    assert.match(sql[0], /coalesce\(\(select/, 'uses coalesce for empty tables');
  });
});

// ─── FK-aware restore ordering ───────────────────────────────────────────────

describe('orderTablesForRestore', () => {
  const t = (schema, table, references = []) => ({ schema, table, references });

  it('orders parents before children (linear chain)', () => {
    const ordered = orderTablesForRestore([
      t('public', 'comments', [['public', 'posts']]),
      t('public', 'posts', [['public', 'users']]),
      t('public', 'users'),
    ]);
    const names = ordered.map((x) => x.table);
    assert.deepEqual(names, ['users', 'posts', 'comments']);
  });

  it('ignores references to tables outside the snapshot', () => {
    const ordered = orderTablesForRestore([
      t('public', 'profiles', [['auth', 'users']]),
      t('public', 'accounts'),
    ]);
    assert.equal(ordered.length, 2);
    assert.ok(ordered.every((x) => x.table !== 'users'));
  });

  it('ignores self references', () => {
    const ordered = orderTablesForRestore([t('public', 'comments', [['public', 'comments']])]);
    assert.deepEqual(ordered.map((x) => x.table), ['comments']);
  });

  it('deduplicates multiple FKs to the same parent', () => {
    const ordered = orderTablesForRestore([
      t('public', 'child', [['public', 'p1'], ['public', 'p1']]),
      t('public', 'p1'),
    ]);
    assert.deepEqual(ordered.map((x) => x.table), ['p1', 'child']);
  });

  it('appends cyclic tables best-effort instead of hanging', () => {
    const ordered = orderTablesForRestore([
      t('public', 'a', [['public', 'b']]),
      t('public', 'b', [['public', 'a']]),
      t('public', 'c'),
    ]);
    assert.equal(ordered.length, 3);
    assert.equal(ordered.find((x) => x.table === 'c') !== undefined, true);
  });

  it('handles multiple FK levels tenant → org → root', () => {
    const ordered = orderTablesForRestore([
      t('public', 'page_blocks', [['public', 'pages']]),
      t('public', 'pages', [['public', 'tenants']]),
      t('public', 'tenants', [['public', 'organizations']]),
      t('public', 'organizations'),
    ]);
    const names = ordered.map((x) => x.table);
    assert.ok(names.indexOf('organizations') < names.indexOf('tenants'));
    assert.ok(names.indexOf('tenants') < names.indexOf('pages'));
    assert.ok(names.indexOf('pages') < names.indexOf('page_blocks'));
  });
});

// ─── /data workspace + action logs ──────────────────────────────────────────

describe('ensureDataDirs', () => {
  it('creates /data, /data/snapshots and /data/logs dynamically', () => {
    const root = join(tempRoot, 'data-creation');
    assert.equal(existsSync(join(root, 'data')), false);
    const dirs = ensureDataDirs(root);
    assert.equal(existsSync(dirs.dataDir), true);
    assert.equal(existsSync(dirs.snapshotsDir), true);
    assert.equal(existsSync(dirs.logsDir), true);
    assert.equal(dirs.snapshotsDir, join(root, 'data', 'snapshots'));
    assert.equal(dirs.logsDir, join(root, 'data', 'logs'));
  });

  it('is idempotent on existing directories', () => {
    const root = join(tempRoot, 'data-creation');
    const again = ensureDataDirs(root);
    assert.equal(existsSync(again.dataDir), true);
  });
});

describe('createActionLog', () => {
  it('writes header, entries and final status to /data/logs', () => {
    const root = join(tempRoot, 'action-log');
    const startedLog = createActionLog('test-action', { root, meta: { project: 'ref_123' } });
    assert.equal(startedLog.file, join(root, 'data', 'logs', `${timestampSlug()}_test-action.log`));
    startedLog.entry('did something');
    startedLog.entry('did something else');
    startedLog.finish('applied', '2 steps');

    const content = readFileSync(startedLog.file, 'utf8');
    assert.match(content, /^action:   test-action\n/);
    assert.match(content, /started:  \d{4}-\d{2}-\d{2}T/);
    assert.match(content, /project   ref_123/);
    assert.match(content, /did something\n/);
    assert.match(content, /status:   applied — 2 steps/);
  });

  it('appends incrementally (entry visible before finish)', () => {
    const root = join(tempRoot, 'action-log-incremental');
    const log = createActionLog('incremental', { root });
    log.entry('step 1');
    const mid = readFileSync(log.file, 'utf8');
    assert.match(mid, /step 1/);
    assert.doesNotMatch(mid, /status:/);
    log.finish('done');
  });

  it('creates the /data tree on demand for log writing', () => {
    const root = join(tempRoot, 'action-log-fresh');
    const log = createActionLog('fresh', { root });
    assert.equal(existsSync(log.file), true);
  });

  it('uses Windows-safe file names (no colons)', () => {
    const slug = timestampSlug();
    assert.doesNotMatch(slug, /:/);
    assert.match(slug, /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
  });
});

// ─── Snapshot file naming/format constants ──────────────────────────────────

describe('snapshot format', () => {
  it('pins the format version the restore validates against', () => {
    assert.equal(typeof SNAPSHOT_FORMAT_VERSION, 'number');
    assert.ok(SNAPSHOT_FORMAT_VERSION >= 1);
  });
});

// ─── Wiring: setup menu + package script (cross-file consistency) ────────────

describe('setup integration', () => {
  it('setup menu exposes DB Snapshots and delegates to scripts/snapshots.mjs', async () => {
    const setupSource = readFileSync(new URL('../scripts/setup.mjs', import.meta.url), 'utf8');
    assert.match(setupSource, /value: 'snapshots', label: 'DB Snapshots'/);
    assert.match(setupSource, /nodeScript\('snapshots\.mjs'\)/);
    assert.match(setupSource, /case 'snapshots':/);
  });

  it('npm run snapshots script is registered in package.json', async () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(pkg.scripts.snapshots, 'node scripts/snapshots.mjs');
  });

  it('/data is gitignored', async () => {
    const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
    assert.match(gitignore, /^\/data\/$/m);
  });
});
// ─── Trigger suppression wrapping ────────────────────────────────────────────

describe('trigger suppression wrapping', () => {
  it('transaction wrapper uses SET LOCAL inside BEGIN/COMMIT (pool-safe)', () => {
    const wrapped = wrapReplicaTransaction('insert into "public"."t" values (1);');
    assert.match(wrapped, /^begin;\n/);
    assert.match(wrapped, /set local session_replication_role = replica;/);
    assert.match(wrapped, /insert into "public"\."t" values \(1\);/);
    assert.match(wrapped, /\ncommit;$/);
    assert.ok(wrapped.indexOf('begin;') < wrapped.indexOf('set local'));
  });

  it('does not use session-scoped SET inside the transaction wrapper (would leak into the pooled connection)', () => {
    const wrapped = wrapReplicaTransaction('select 1;');
    assert.match(wrapped, /^begin;\nset local /);
    assert.doesNotMatch(wrapped, /\nset session_replication_role/);
  });

  it('session wrapper is the fallback and callers reset it afterwards', () => {
    assert.match(wrapReplicaSession('select 1;'), /^set session_replication_role = replica;\nselect 1;/);
    assert.equal(REPLICA_SET_LOCAL_SQL, 'set local session_replication_role = replica;');
    assert.equal(REPLICA_SET_SESSION_SQL, 'set session_replication_role = replica;');
  });
});
