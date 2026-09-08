import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATION_ORDER_CORE, getMigrationOrder } from '../scripts/lib/migration-order.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(ROOT, 'migrations');

/**
 * Read a migration's SQL. `storage.sql` is generated at runtime from the
 * committed template storage.default.sql (bucket name substituted), so the
 * template is what gets checked.
 */
function readMigrationSql(file) {
  const source = file === 'storage.sql' ? 'storage.default.sql' : file;
  return readFileSync(join(MIGRATIONS_DIR, source), 'utf8');
}

/**
 * Strip SQL comments so references inside comments don't count as
 * dependencies. `--` line comments and /* block *\/ comments.
 */
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

/**
 * Tables (public.<name>) created by a migration — including via
 * `ALTER TABLE public.old RENAME TO new` (e.g. pages.sql renames products →
 * pages), which makes the migration the creator of the new name.
 */
function findCreatedTables(sql) {
  const tables = new Set();
  const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-zA-Z0-9_]+)/gi;
  const renameRe = /alter\s+table\s+(?:if\s+exists\s+)?public\.[a-zA-Z0-9_]+\s+rename\s+to\s+(?:public\.)?([a-zA-Z0-9_]+)/gi;
  let m;
  while ((m = createRe.exec(sql)) !== null) tables.add(m[1].toLowerCase());
  while ((m = renameRe.exec(sql)) !== null) tables.add(m[1].toLowerCase());
  return tables;
}

/**
 * Tables (public.<name>) referenced by a migration via common SQL patterns:
 * ALTER TABLE / FROM / JOIN / INTO / UPDATE / REFERENCES / ON (policies,
 * triggers, indexes). Function calls (e.g. `SELECT public.current_user_id()`)
 * are deliberately NOT matched.
 */
function findReferencedTables(sql) {
  const tables = new Set();
  const patterns = [
    /alter\s+table\s+(?:if\s+exists\s+)?public\.([a-zA-Z0-9_]+)/gi,
    /\b(?:from|join|into|update)\s+public\.([a-zA-Z0-9_]+)/gi,
    /\breferences\s+public\.([a-zA-Z0-9_]+)/gi,
    /\bon\s+public\.([a-zA-Z0-9_]+)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(sql)) !== null) tables.add(m[1].toLowerCase());
  }
  return tables;
}

describe('core migration order', () => {
  const order = getMigrationOrder('supabase');

  it('applies storage.sql last and only for the supabase provider', () => {
    const r2 = getMigrationOrder('r2');
    assert.ok(!r2.includes('storage.sql'), 'r2 order must not contain storage.sql');
    assert.equal(order[order.length - 1], 'storage.sql');
  });

  it('contains no duplicate files', () => {
    const dupes = order.filter((f, i) => order.indexOf(f) !== i);
    assert.deepEqual(dupes, []);
  });

  it('runs preamble.sql first (trigger functions used by nearly every migration)', () => {
    assert.equal(order[0], 'preamble.sql');
  });

  it('every ordered migration exists in migrations/ (storage template included)', () => {
    const missing = order.filter((f) => {
      const source = f === 'storage.sql' ? 'storage.default.sql' : f;
      return !existsSync(join(MIGRATIONS_DIR, source));
    });
    assert.deepEqual(missing, [], 'missing migration files');
  });

  it('every migration referencing public.<table> has it created in the same or an earlier migration', () => {
    // Tables that exist before any migration (created by Supabase itself or
    // outside the core migration chain). Each entry needs a reason.
    const preExisting = new Set([
      // created by migrations/plugins outside this chain — extend with a reason
    ]);

    const creators = new Map(); // table -> index of first creator
    const problems = [];

    order.forEach((file, index) => {
      const sql = stripSqlComments(readMigrationSql(file));

      for (const table of findReferencedTables(sql)) {
        if (creators.has(table)) continue;              // created earlier
        if (findCreatedTables(sql).has(table)) continue; // created here
        if (preExisting.has(table)) continue;            // exists before migrations
        problems.push(`${file}: references public.${table} — no earlier migration creates it`);
      }

      for (const table of findCreatedTables(sql)) {
        if (!creators.has(table)) creators.set(table, index);
      }
    });

    assert.deepEqual(problems, []);
  });

  it('objects.sql runs before every migration that references public.objects', () => {
    const objectsIdx = order.indexOf('objects.sql');
    assert.ok(objectsIdx !== -1, 'objects.sql must be part of the order');
    // Violations = migrations ordered BEFORE objects.sql that reference the
    // table (the 202605240002 regression this test guards against).
    const earlyReferencing = order.filter((file, i) => {
      if (i >= objectsIdx) return false;
      const sql = stripSqlComments(readMigrationSql(file));
      return /alter\s+table\s+(?:if\s+exists\s+)?public\.objects\b/i.test(sql)
        || /\bon\s+public\.objects\b/i.test(sql)
        || /\b(?:from|join|into|update)\s+public\.objects\b/i.test(sql)
        || /\breferences\s+public\.objects\b/i.test(sql);
    });
    assert.deepEqual(earlyReferencing, [], 'migrations referencing public.objects must be ordered after objects.sql');
  });

  it('exposes the core list without storage.sql', () => {
    assert.ok(!MIGRATION_ORDER_CORE.includes('storage.sql'));
  });
});
