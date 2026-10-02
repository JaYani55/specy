import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSchemaDefinitionPatch } from '../api/lib/schemaDefinition.ts';

describe('schema definition revision contract', () => {
  it('accepts a revisioned product schema update without reshaping its JSON', () => {
    const schema = {
      'Intro Headline': { type: 'string', 'x-renderer': { layout: 'wide' } },
      sections: { type: 'array', items: { type: 'object', properties: { token: { type: 'string' } } } },
    };
    const result = parseSchemaDefinitionPatch({
      expected_revision: 4,
      entity_kind: 'service-product',
      schema,
      editor_config: { groups: [{ key: 'content', fields: ['Intro Headline'] }] },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.patch.expected_revision, 4);
      assert.deepEqual(result.patch.schema, schema);
      assert.equal(result.patch.entity_kind, 'service-product');
    }
  });

  it('rejects stale/invalid revision shapes and unrecognized classifications', () => {
    assert.equal(parseSchemaDefinitionPatch({ expected_revision: 0, schema: {} }).ok, false);
    assert.equal(parseSchemaDefinitionPatch({ expected_revision: 1.5, schema: {} }).ok, false);
    assert.equal(parseSchemaDefinitionPatch({ expected_revision: 1, entity_kind: 'product' }).ok, false);
    assert.equal(parseSchemaDefinitionPatch({ expected_revision: 1 }).ok, false);
  });

  it('distinguishes omitted schema properties from explicitly supplied null metadata', () => {
    const result = parseSchemaDefinitionPatch({ expected_revision: 2, description: null });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(Object.hasOwn(result.patch, 'description'), true);
  });
});
