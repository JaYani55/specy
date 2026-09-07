import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const {
  POLL_ONLY_FORM_FIELD_TYPES,
  isPollOnlyFormFieldType,
  isFieldPresetSelectable,
  uniqueFormFieldName,
} = await import('../src/utils/formFieldPresets.ts');

describe('isPollOnlyFormFieldType / isFieldPresetSelectable', () => {
  test('consent poll and consent vote are poll-only', () => {
    assert.deepEqual([...POLL_ONLY_FORM_FIELD_TYPES], ['consent-poll', 'consent-vote']);
    assert.equal(isPollOnlyFormFieldType('consent-poll'), true);
    assert.equal(isPollOnlyFormFieldType('consent-vote'), true);
  });

  test('standard field types are not poll-only', () => {
    for (const type of ['text', 'textarea', 'help-text', 'email', 'number', 'file-upload', 'image', 'checkbox', 'single-select', 'multi-select', 'date']) {
      assert.equal(isPollOnlyFormFieldType(type), false, `${type} must be selectable in forms`);
    }
  });

  test('poll-only types are selectable in polls but never in forms', () => {
    for (const type of POLL_ONLY_FORM_FIELD_TYPES) {
      assert.equal(isFieldPresetSelectable(type, 'poll'), true, `${type} must be selectable in polls`);
      assert.equal(isFieldPresetSelectable(type, 'form'), false, `${type} must NOT be selectable in forms`);
    }
  });

  test('standard types are selectable in both modes', () => {
    assert.equal(isFieldPresetSelectable('text', 'form'), true);
    assert.equal(isFieldPresetSelectable('text', 'poll'), true);
    assert.equal(isFieldPresetSelectable('help-text', 'poll'), true);
  });
});

describe('uniqueFormFieldName', () => {
  test('returns the base when unused', () => {
    assert.equal(uniqueFormFieldName('text_1', []), 'text_1');
  });

  test('appends _2 for a single collision', () => {
    assert.equal(uniqueFormFieldName('participant_name', ['participant_name']), 'participant_name_2');
  });

  test('skips existing suffixes', () => {
    assert.equal(
      uniqueFormFieldName('text', ['text', 'text_2', 'text_3']),
      'text_4',
    );
  });

  test('reuses a free gap in the suffix sequence', () => {
    assert.equal(uniqueFormFieldName('text', ['text', 'text_3']), 'text_2');
  });

  test('independent of entry order', () => {
    assert.equal(uniqueFormFieldName('text_3', ['text_3', 'text_1']), 'text_3_2');
  });
});
