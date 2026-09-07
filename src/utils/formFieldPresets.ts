import type { FormFieldType } from '../types/forms';

/**
 * Field types that only make sense in polls and must not be selectable in
 * plain forms. `participant_name` is a label-level preset over `text`, so it
 * is not a distinct field type (the UI presets handle it separately).
 */
export const POLL_ONLY_FORM_FIELD_TYPES: readonly FormFieldType[] = ['consent-poll', 'consent-vote'];

const POLL_ONLY_SET = new Set<FormFieldType>(POLL_ONLY_FORM_FIELD_TYPES);

export const isPollOnlyFormFieldType = (type: FormFieldType): boolean => POLL_ONLY_SET.has(type);

export type FormBuilderMode = 'form' | 'poll';

/**
 * True when a builder preset / field type may be added to a form of the given
 * mode. Poll-only blocks (consent poll, consent vote, participant-name
 * preset) are selectable exclusively in polls.
 */
export const isFieldPresetSelectable = (type: FormFieldType, mode: FormBuilderMode): boolean => (
  mode === 'poll' || !isPollOnlyFormFieldType(type)
);

/**
 * Returns a field key derived from `base` that does not collide with
 * `existingNames` by appending `_2`, `_3`, … as needed. Keeps schema keys
 * unique when the generic index-based naming would collide after deletions
 * (e.g. existing text_1 + text_3, next generated text_3).
 */
export const uniqueFormFieldName = (base: string, existingNames: Iterable<string>): string => {
  const taken = new Set(existingNames);
  if (!taken.has(base)) return base;

  let counter = 2;
  while (taken.has(`${base}_${counter}`)) {
    counter += 1;
  }
  return `${base}_${counter}`;
};
