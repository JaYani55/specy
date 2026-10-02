import test from 'node:test';
import assert from 'node:assert/strict';
import { groupPresentedSchemaFields, humanizeSchemaFieldName, resolveSchemaEditorPresentation } from '../src/features/page-builder/editorPresentation.ts';

test('schema field names get readable content-editor labels without changing content keys', () => {
  assert.equal(humanizeSchemaFieldName('productTitle', 'en'), 'Product Title');
  assert.equal(humanizeSchemaFieldName('über_uns-description', 'de'), 'Über uns description');
});

test('page-builder hints localize labels and group/order fields while preserving schema keys', () => {
  const fields = [
    { name: 'details_text', type: 'string', required: true, description: 'Long details' },
    { name: 'public_name', type: 'string', required: true },
    { name: 'internal_note', type: 'string', required: false },
  ];
  const editorConfig = {
    page_builder: {
      groups: {
        profile: { label: { en: 'Profile', de: 'Profil' }, order: 2 },
        basics: { label: { en: 'Basics', de: 'Grundlagen' }, order: 1 },
      },
      fields: {
        public_name: { label: { en: 'Display name', de: 'Anzeigename' }, group: 'basics', order: 2 },
        details_text: { label: { en: 'Details', de: 'Details' }, group: 'profile', order: 1 },
      },
    },
  };

  const resolved = resolveSchemaEditorPresentation(fields, editorConfig, 'de');
  assert.deepEqual(resolved.map(({ field }) => field.name), ['public_name', 'details_text', 'internal_note']);
  assert.equal(resolved[0].label, 'Anzeigename');
  assert.equal(resolved[0].groupLabel, 'Grundlagen');
  assert.equal(resolved[1].helpText, 'Long details');
  assert.deepEqual(groupPresentedSchemaFields(resolved).map(({ key }) => key), ['basics', 'profile', 'content']);
  assert.deepEqual(fields.map(({ name }) => name), ['details_text', 'public_name', 'internal_note']);
});

test('malformed or absent editor hints fall back to safe labels and default content grouping', () => {
  const [resolved] = resolveSchemaEditorPresentation(
    [{ name: 'hero_headline', type: 'string' }],
    { page_builder: { fields: { hero_headline: { label: 42, group: [] } } } },
    'en',
  );

  assert.equal(resolved.label, 'Hero headline');
  assert.equal(resolved.groupKey, 'content');
  assert.equal(resolved.groupLabel, 'Content');
});
