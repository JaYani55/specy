# 2026-09-07 — Form/Poll Field-Type Delineation Fixes

## Summary

Two defects in the form/poll schema builder (`FormSchemaBuilder`):

1. **"Short Text" / "Participant Name" collision.** The `Participant Name`
   preset is a label-level alias over field type `text` — identical to the
   `Short Text` preset. Both preset cards used `key={preset.type}` (duplicate
   React key → merged/misbehaving card rendering, observed as
   "Short TextParticipant Name"), and both appeared as `<SelectItem
   value="text">` in the per-field "Feldtyp" dropdown, so the select could
   not distinguish them. Fixes:
   - Preset cards keyed by unique preset label, not by field type.
   - `Participant Name` removed from the type dropdown entirely (it is not a
     distinct type); the dropdown is built from presets with unique types
     only, and a fallback entry renders the current type if it is not among
     the selectable presets (e.g. legacy poll fields opened in another mode).
   - The preset now actually creates a proper participant-name field
     (`name: participant_name`, label, required, placeholder) instead of a
     generic "Text" field.
2. **Poll blocks were selectable in plain forms.** Consent Poll, Consent
   Vote, and Participant Name are poll-exclusive. The builder now receives
   the editor's `formType` (`'form' | 'poll'`) from `FormEditor` and filters
   both the preset cards and the field-type dropdown: poll-only blocks are
   selectable exclusively in polls; all standard blocks remain available in
   both modes. Existing fields of a poll-only type are still rendered (no
   data loss for legacy schemas).

Additionally, `addField` now de-duplicates generated schema keys via
`uniqueFormFieldName` (the previous index-based naming could collide after
field deletions, e.g. existing `text_1` + `text_3`, next generated `text_3`).

## Files Added

- `src/utils/formFieldPresets.ts` — pure helpers: `POLL_ONLY_FORM_FIELD_TYPES`,
  `isPollOnlyFormFieldType`, `isFieldPresetSelectable(type, mode)`,
  `uniqueFormFieldName(base, existing)`.
- `tests/formFieldPresets.test.mjs` — contract tests: poll-only types are
  selectable in polls and never in forms; standard types remain selectable in
  both modes; field-key dedupe behavior.
- `specs/changes/2026-09-07-form-poll-field-type-delineation.md` (this
  document).

## Files Changed

- `src/components/forms/FormSchemaBuilder.tsx` — `formType` prop (default
  `'form'`); preset metadata (`pollOnly`, `participantName`, `build`
  overrides); preset/type-dropdown filtering; unique React keys; name
  de-duplication in `addField`; fallback dropdown entry for existing
  non-selectable types.
- `src/pages/FormEditor.tsx` — passes `formType={type}` to the builder.

## Database impact

None. Frontend-only change; stored schemas are untouched.

## Runtime / API surface impact

None. The Worker's `VALID_FIELD_TYPES` validation is unchanged — the
restriction is a builder-UI constraint (form CRUD runs through
supabase-js/RLS, so the editor is the enforcement point).

## Verification

- `npm test` — 81/81 green (9 new tests).
- `npm run typecheck` — clean; `npm run build` — succeeds.
- Not verified in-browser (no dev environment run here): open
  *Formular-Editor* (type form) → Consent Poll/Vote/Participant-Name cards
  must be absent; *Umfrage-Editor* (type poll) → all three must be present;
  the "Feldtyp" dropdown must show "Short Text" exactly once.
