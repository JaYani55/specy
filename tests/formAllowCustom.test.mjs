import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { parseFormSchema, formFieldsToSchema } = await import('../src/utils/forms.ts');

describe('form schema allow_custom round-trip', () => {
  test('parseFormSchema keeps allow_custom on option field types', () => {
    const schema = {
      topic: {
        type: 'single-select',
        label: 'Topic',
        options: ['Sales', 'Support'],
        allow_custom: true,
      },
      tags: {
        type: 'multi-select',
        label: 'Tags',
        options: ['A', 'B'],
        allow_custom: true,
      },
      legacy: {
        type: 'select',
        label: 'Legacy',
        options: ['X'],
        allow_custom: true,
      },
      way: {
        type: 'radio',
        label: 'Way',
        options: ['Yes', 'No'],
        allow_custom: false,
      },
    };

    const result = parseFormSchema(JSON.stringify(schema));
    assert.equal(result.valid, true);
    const byName = Object.fromEntries(result.fields.map((field) => [field.name, field]));
    assert.equal(byName.topic.allow_custom, true);
    assert.equal(byName.tags.allow_custom, true);
    assert.equal(byName.legacy.allow_custom, true);
    assert.equal(byName.way.allow_custom, false);
  });

  test('parseFormSchema ignores allow_custom on non-option field types', () => {
    const schema = {
      name: { type: 'text', label: 'Name', allow_custom: true },
    };
    const result = parseFormSchema(JSON.stringify(schema));
    assert.equal(result.valid, true);
    assert.equal(result.fields[0].allow_custom, undefined);
    assert.equal(result.normalizedSchema.name.allow_custom, undefined);
  });

  test('parseFormSchema warns on non-boolean allow_custom', () => {
    const schema = {
      topic: { type: 'single-select', label: 'Topic', options: ['A'], allow_custom: 'yes' },
    };
    const result = parseFormSchema(JSON.stringify(schema));
    assert.equal(result.warnings.some((warning) => warning.includes('allow_custom')), true);
  });

  test('formFieldsToSchema emits allow_custom for option fields only', () => {
    const schema = formFieldsToSchema([
      { name: 'topic', type: 'single-select', label: 'Topic', options: ['A', 'B'], allow_custom: true },
      { name: 'plain', type: 'single-select', label: 'Plain', options: ['A', 'B'] },
      { name: 'note', type: 'text', label: 'Note', allow_custom: true },
      { name: 'choice', type: 'radio', label: 'Choice', options: ['Yes', 'No'], allow_custom: true },
    ]);

    assert.equal(schema.topic.allow_custom, true);
    assert.equal(schema.plain.allow_custom, undefined);
    assert.equal(schema.note.allow_custom, undefined);
    assert.equal(schema.choice.allow_custom, true);
  });

  test('builder → schema → parse round-trip preserves allow_custom', () => {
    const fields = [
      { name: 'topic', type: 'multi-select', label: 'Topic', options: ['A'], allow_custom: true },
      { name: 'tier', type: 'select', label: 'Tier', options: ['Basic', 'Pro'], allow_custom: false },
    ];
    const parsed = parseFormSchema(JSON.stringify(formFieldsToSchema(fields)));
    assert.equal(parsed.valid, true);
    const byName = Object.fromEntries(parsed.fields.map((field) => [field.name, field]));
    assert.equal(byName.topic.allow_custom, true);
    // `allow_custom: false` is normalized away — absence means "off".
    assert.equal(byName.tier.allow_custom, undefined);
  });

  test('switching an option field to a non-option type drops allow_custom', () => {
    // Emulates FormSchemaBuilder.updateField normalization for non-option types.
    const parsed = parseFormSchema(JSON.stringify({
      topic: { type: 'text', label: 'Topic', allow_custom: true },
    }));
    assert.equal(parsed.fields[0].allow_custom, undefined);
  });
});
