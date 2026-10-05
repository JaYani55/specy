import test from 'node:test';
import assert from 'node:assert/strict';
import { getProductSchemaDesign } from '../src/utils/productSchemaDesign.ts';

test('product schema design summarizes required fields, options and nested structures', () => {
  const design = getProductSchemaDesign({
    title: { type: 'string', required: true, description: 'Public product title' },
    category: { type: 'string', enum: ['workshop', 'consulting'] },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string', required: true },
        },
      },
    },
  });

  assert.deepEqual(design.map(({ name, type, required }) => ({ name, type, required })), [
    { name: 'title', type: 'string', required: true },
    { name: 'category', type: 'string', required: false },
    { name: 'sections', type: 'array of object', required: false },
  ]);
  assert.equal(design[0].description, 'Public product title');
  assert.deepEqual(design[1].enumValues, ['workshop', 'consulting']);
  assert.deepEqual(design[2].children.map(({ name, required }) => ({ name, required })), [
    { name: 'heading', required: true },
  ]);
});

test('product schema design tolerates malformed field definitions without dropping their names', () => {
  const design = getProductSchemaDesign({ title: null, details: { type: 'object', properties: [] } });

  assert.equal(design[0].name, 'title');
  assert.equal(design[0].type, 'json');
  assert.equal(design[1].children.length, 0);
});
