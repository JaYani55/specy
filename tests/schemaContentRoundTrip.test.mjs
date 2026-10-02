import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSchemaContent,
  fieldValueTypeConflict,
  hasOwnKey,
  initializeSchemaContent,
  mergeSchemaContent,
} from '../src/lib/schemaContent.ts';

const fields = [
  { name: 'enabled', type: 'boolean' },
  { name: 'count', type: 'number' },
  { name: 'nullable', type: 'string' },
  { name: 'blank', type: 'string' },
  { name: 'emptyList', type: 'array' },
  { name: 'emptyObject', type: 'object' },
  { name: 'team', type: 'array' },
];

describe('lossless schema content editor helpers', () => {
  it('preserves present false, zero, null and deliberately empty values', () => {
    const initial = {
      enabled: false,
      count: 0,
      nullable: null,
      blank: '',
      emptyList: [],
      emptyObject: {},
      extension: { nested: ['untouched'] },
    };
    const active = new Set(['enabled', 'count', 'nullable', 'blank', 'emptyList', 'emptyObject']);
    const content = buildSchemaContent(initial, initial, fields, active, new Set());

    assert.deepEqual(content, initial);
    assert.equal(hasOwnKey(content, 'nullable'), true);
    assert.equal(content.enabled, false);
    assert.equal(content.count, 0);
  });

  it('keeps unknown keys and nested extension data when editing a known field', () => {
    const initial = {
      title: 'Old title',
      custom_key: { 'punctuation / key': ['keep', 0, false, null] },
      developerBlock: [{ variant: 'bespoke', editor: { tokens: [] } }],
    };
    const current = { ...initial, title: 'Updated title' };
    const content = buildSchemaContent(initial, current, [{ name: 'title', type: 'string', required: true }], new Set(), new Set());

    assert.deepEqual(content, { ...initial, title: 'Updated title' });
  });

  it('treats optional activation by own-key presence, not truthiness', () => {
    const initial = { enabled: false, count: 0, blank: '', nothing: null, empty: [] };
    assert.equal(hasOwnKey(initial, 'enabled'), true);
    assert.equal(hasOwnKey(initial, 'notThere'), false);
    assert.deepEqual(initializeSchemaContent({ enabled: true, count: 10 }, initial), initial);
  });

  it('imports extension fields without discarding current content', () => {
    const merged = mergeSchemaContent({ current: 'value', existingExtension: 1 }, {
      current: 'imported',
      unknownExtension: { keep: true },
    });
    assert.deepEqual(merged, {
      current: 'imported',
      existingExtension: 1,
      unknownExtension: { keep: true },
    });
  });

  it('requires explicit removal before an optional value disappears', () => {
    const initial = { team: [] };
    const stillPresent = buildSchemaContent(initial, initial, fields, new Set(['team']), new Set());
    const explicitlyRemoved = buildSchemaContent(initial, initial, fields, new Set(), new Set(['team']));
    assert.deepEqual(stillPresent, initial);
    assert.equal(Object.hasOwn(explicitlyRemoved, 'team'), false);
  });

  it('flags incompatible loaded values rather than coercing them', () => {
    assert.equal(fieldValueTypeConflict({ name: 'count', type: 'number' }, '0'), true);
    assert.equal(fieldValueTypeConflict({ name: 'image', type: 'media' }, { src: '/asset.png' }), true);
    assert.equal(fieldValueTypeConflict({ name: 'enabled', type: 'boolean' }, false), false);
    assert.equal(fieldValueTypeConflict({ name: 'nullable', type: 'string' }, null), true);
    assert.equal(fieldValueTypeConflict({ name: 'nullable', type: 'string', nullable: true }, null), false);
  });
});
