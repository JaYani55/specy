import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
      // Catalogue unification: 'service-product' normalizes to 'event'.
      assert.equal(result.patch.entity_kind, 'event');
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

  it('accepts the explicit reclassification acknowledgment only in a valid shape', () => {
    const result = parseSchemaDefinitionPatch({ expected_revision: 3, entity_kind: 'event', allow_reclassification: true, expected_page_count: 2 });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.patch.allow_reclassification, true);
      assert.equal(result.patch.expected_page_count, 2);
    }

    assert.equal(parseSchemaDefinitionPatch({ expected_revision: 3, entity_kind: 'event', allow_reclassification: false }).ok, false);
    assert.equal(parseSchemaDefinitionPatch({ expected_revision: 3, entity_kind: 'event', allow_reclassification: 'yes' }).ok, false);
    assert.equal(parseSchemaDefinitionPatch({ expected_revision: 3, entity_kind: 'event', expected_page_count: -1 }).ok, false);
    assert.equal(parseSchemaDefinitionPatch({ expected_revision: 3, entity_kind: 'event', expected_page_count: 1.5 }).ok, false);
  });

  it('reclassification with existing pages is guarded by the explicit flag and catalogue aggregate compatibility', async () => {
    const source = await readFile('api/lib/schemaDefinition.ts', 'utf8');
    assert.match(source, /assertPagesCompatibleWithEntityKind/);
    assert.match(source, /patch\.allow_reclassification !== true \|\| patch\.expected_page_count !== count/);
    assert.match(source, /'schema_conversion_required'/);
    assert.match(source, /mentorbooking_events.*select\('page_id'\)\.in\('page_id', pageIds\)/);
    assert.match(source, /mentorbooking_products.*select\('product_page_id'\)\.in\('product_page_id', pageIds\)\.is\('retired_at', null\)/);
    assert.match(source, /pages have no linked event or product record/);
    assert.match(source, /Reclassifying a schema with existing pages requires the explicit allow_reclassification flag/);
  });
});
