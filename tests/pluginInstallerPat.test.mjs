import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlStr } from '../scripts/lib/sqlStr.mjs';

test('sqlStr escapes single quotes (standard PostgreSQL doubling)', () => {
  assert.equal(sqlStr("it's"), `'it''s'`);
  assert.equal(sqlStr("a'b'c"), `'a''b''c'`);
});

test('sqlStr blocks quote-breakout injection in slugs', () => {
  const malicious = "x'); DROP TABLE plugins;--";
  const sql = `UPDATE plugins SET status = 'error' WHERE slug = ${sqlStr(malicious)}`;
  assert.equal(sql, `UPDATE plugins SET status = 'error' WHERE slug = 'x''); DROP TABLE plugins;--'`);
  // The injected payload stays inside the literal — no unquoted ')' or ';'
  assert.ok(!sql.replace(/''/g, '').match(/'\);/));
});

test('sqlStr keeps quotes balanced for any input', () => {
  const inputs = ["'", "''", "\\'", "'; --", "émoji ' 🚀", "line\nbreak"];
  for (const input of inputs) {
    const literal = sqlStr(input);
    const inner = literal.slice(1, -1);
    // Counting unescaped quotes: after doubling, every quote pair is a literal
    // quote — the count of single quotes in the escaped content must be even.
    assert.equal((inner.match(/'/g) ?? []).length % 2, 0, `unbalanced for: ${input}`);
  }
});

test('sqlStr coerces non-string values', () => {
  assert.equal(sqlStr(42), `'42'`);
  assert.equal(sqlStr(null), `'null'`);
});
