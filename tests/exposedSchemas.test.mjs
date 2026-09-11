import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addSchemaToExposedList,
  parseExposedSchemas,
  quoteSqlLiteral,
  removeSchemaFromExposedList,
} from '../scripts/lib/exposed-schemas.mjs';

test('parseExposedSchemas: trims whitespace and empty entries', () => {
  assert.deepEqual(parseExposedSchemas('public, pluradash'), ['public', 'pluradash']);
  assert.deepEqual(parseExposedSchemas('public'), ['public']);
  assert.deepEqual(parseExposedSchemas(' public , , pluradash ,'), ['public', 'pluradash']);
  assert.deepEqual(parseExposedSchemas(''), null);
  assert.deepEqual(parseExposedSchemas('   '), null);
  assert.deepEqual(parseExposedSchemas(null), null);
  assert.deepEqual(parseExposedSchemas(undefined), null);
});

test('removeSchemaFromExposedList: removes the schema, preserves the rest', () => {
  const r = removeSchemaFromExposedList('public, pluradash', 'pluradash');
  assert.equal(r.changed, true);
  assert.equal(r.present, true);
  assert.equal(r.newValue, 'public');
});

test('removeSchemaFromExposedList: keeps public when removing from a single-entry list', () => {
  // pluradash listed BEFORE public must still remove only pluradash
  const r = removeSchemaFromExposedList('pluradash, public', 'pluradash');
  assert.equal(r.changed, true);
  assert.equal(r.newValue, 'public');
});

test('removeSchemaFromExposedList: schema not in list → no change', () => {
  const r = removeSchemaFromExposedList('public', 'yatda');
  assert.equal(r.changed, false);
  assert.equal(r.present, false);
  assert.equal(r.newValue, 'public');
});

test('removeSchemaFromExposedList: unset GUC → nothing to do', () => {
  assert.deepEqual(removeSchemaFromExposedList(null, 'pluradash'), {
    changed: false,
    present: false,
    newValue: null,
  });
});

test('removeSchemaFromExposedList: matches without surrounding whitespace', () => {
  const r = removeSchemaFromExposedList('public,pluradash', 'pluradash');
  assert.equal(r.changed, true);
  assert.equal(r.newValue, 'public');
});

test('quoteSqlLiteral: escapes single quotes', () => {
  assert.equal(quoteSqlLiteral("public"), "'public'");
  assert.equal(quoteSqlLiteral("o'brien"), "'o''brien'");
});

// ─── addSchemaToExposedList (install-side exposure) ──────────────────────────

test('addSchemaToExposedList: appends to an existing list', () => {
  const r = addSchemaToExposedList('public', 'pluradash');
  assert.equal(r.changed, true);
  assert.equal(r.newValue, 'public, pluradash');
});

test('addSchemaToExposedList: unset GUC falls back to public + schema', () => {
  // Critical: public must NEVER disappear from the exposed list.
  const r = addSchemaToExposedList(null, 'pluradash');
  assert.equal(r.changed, true);
  assert.equal(r.newValue, 'public, pluradash');
  assert.deepEqual(parseExposedSchemas(r.newValue), ['public', 'pluradash']);
});

test('addSchemaToExposedList: already exposed → no change', () => {
  const r = addSchemaToExposedList('public, pluradash', 'pluradash');
  assert.equal(r.changed, false);
  assert.equal(r.present, true);
  assert.equal(r.newValue, 'public, pluradash');
});

test('addSchemaToExposedList: empty list value still keeps public', () => {
  const r = addSchemaToExposedList('', 'pluradash');
  assert.equal(r.changed, true);
  assert.equal(r.newValue, 'public, pluradash');
});
