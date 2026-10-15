# 2026-10-15 — Forms: Fix Non-Functional "Allow Custom Answer (Other)" Toggle

## Summary

The *Eigene Antwort erlauben ("Sonstiges")* switch in the form editor was non-functional: toggling it changed the in-memory builder field only, but the flag was silently dropped on every persistence boundary. As a result:

- the schema saved to `public.forms.schema` never contained `allow_custom`,
- reloading a form lost the choice,
- the share page never received the flag (API schema normalization stripped it), so the "Other..." answer option never rendered,
- API answer validation rejected any value outside `options` even when the author had intended to allow custom answers.

`allow_custom` is now preserved end-to-end (builder → schema JSON → database → API → share page → submission validation) and the "Other" affordance is consistently implemented for every option-bearing field type (`select`, `radio`, `single-select`, `multi-select`).

## Root Causes

1. `formFieldsToSchema` (`src/utils/forms.ts`) did not emit `allow_custom` when serializing builder fields into the schema JSON — the editor saves `parsedSchema.normalizedSchema`, so the flag never reached the database.
2. `parseFieldEntry` (`src/utils/forms.ts`) did not parse `allow_custom` when loading a schema, so the flag could not survive the builder ↔ JSON round-trip.
3. `normalizeSchema` (`api/routes/forms.ts`) did not parse `allow_custom`, so the public form definition returned to the share page lacked the flag and submission validation rejected custom values.
4. The builder only showed the switch for `single-select`/`multi-select`/`select` — `radio` (also an option field) had no toggle.
5. Share page multi-select "Other" checkbox could never be checked: its `onCheckedChange` handler was a no-op for `checked=true`, and the free-text input was only rendered when the (impossible) checked state was reached — a deadlock. It also read DOM state via `document.getElementById` during render.

## Files Changed

- `src/utils/forms.ts`
  - Added `OPTION_FORM_FIELD_TYPES` (`select`, `radio`, `single-select`, `multi-select`).
  - `parseFieldEntry` now parses `allow_custom` (boolean only; warning on non-boolean; ignored on non-option types).
  - `formFieldsToSchema` now emits `allow_custom: true` for option fields only.
- `src/components/forms/FormSchemaBuilder.tsx`
  - "Other" switch now shown for all option field types (incl. `radio`).
  - `updateField` clears `allow_custom` when the type no longer supports options.
  - Field card shows an *Eigene Antwort erlaubt* / *Custom answer allowed* badge while the flag is active.
- `api/routes/forms.ts`
  - `normalizeSchema` preserves `allow_custom: true` on option field types; shared form definitions and answer validation now honor it.
- `src/pages/FormSharePage.tsx`
  - Added `customToggles` component state to track an explicitly chosen "Other..." entry.
  - Single-choice fields (`select`, `radio`, `single-select`): the "Please specify" input now appears only when *Sonstiges...* is selected (or a custom value is present) instead of whenever the answer is empty; selecting a real option closes it again.
  - `multi-select`: the *Sonstiges...* checkbox is now functional (state-driven, no `document.getElementById` in render); checking it reveals the free-text input, unchecking removes non-option values.
  - Submission payload filters empty-string placeholders out of multi-select answers (untyped "Other" is not submitted).
  - Client-side required check now treats an empty multi-select array as missing (previously passed validation and failed only server-side).

## Files Added

- `tests/formAllowCustom.test.mjs` — unit tests for the `allow_custom` parse/serialize round-trip (option vs. non-option types, non-boolean warning, builder→schema→parse preservation).

## Documentation

- `specs/features/forms.md` — documented `allow_custom` in the field property table and added a *Custom Answers ("Other")* section (builder, share page, API validation contract).

## Impact Analysis

- **Database**: none — `allow_custom` lives inside the existing `forms.schema` JSONB; no migration.
- **Runtime**: form editor and share page behavior only. Forms saved before this fix keep their schema; the flag simply was not stored and must be re-enabled per field.
- **API surface**: `GET /api/forms/...` and share definitions now include `allow_custom` on option fields; submission validation now accepts out-of-option values exactly when the flag is set (previously custom answers were always rejected even if authored intentionally). No endpoint or route changes.

## Verification

- `npm run typecheck` — pass.
- `npm test` — 493 + 6 new tests pass.
- `npm run build` — pass.
- `npm run typecheck:api` — no new errors in `api/routes/forms.ts` (remaining non-plugin errors are pre-existing in generated `api/plugin-metadata.ts`).
