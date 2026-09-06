# 2026-09-06 — Fix blank Form Editor (undefined subject identifiers)

## Summary

Editing forms produced a **blank screen**. Root cause: `src/components/forms/NotificationMessageEditor.tsx` was left in a half-applied state by the subject-line feature change (`2026-09-06-form-notification-subjects.md`): the first edit batch — the props interface extension (`initialSubject` / `defaultSubject`, new `onSave` signature), the `subject` state, `subjectInputRef` and the `insertSubjectToken` helper — was never written to the file, while all *dependent* later edits (subject input JSX, `handleSave` / `handleRestoreDefault` referencing `subject`, `setSubject`, `defaultSubject`) were. Rendering the component threw `ReferenceError: subject is not defined`, which crashed the whole Form Editor page with no error boundary.

The regression went undetected because the project's typecheck is effectively disabled:

- Bare `npx tsc --noEmit` is a **no-op**: the root `tsconfig.json` is solution-style with `files: []`, so without `--build` nothing is checked.
- `tsconfig.app.json` carries `"ignoreDeprecations": "6.0"`, which the installed TypeScript 5.8.2 rejects (`TS5103`), so even `-p tsconfig.app.json` fails before checking anything.
- `npm run build` (Vite/esbuild) transpiles without type checking.

A full check with a temporary override config (`ignoreDeprecations: "5.0"`) shows 39 pre-existing errors elsewhere in the repo and **none** in the files touched by the recent changes. The fix restores the missing declarations — no behavior changes.

## Files Added

- `specs/changes/2026-09-06-blank-form-editor-fix.md` (this document)

## Files Changed

- `src/components/forms/NotificationMessageEditor.tsx` — restored the missing declarations: props `initialSubject` / `defaultSubject` + object-based `onSave` signature, `subject` state, `subjectInputRef`, subject reset in the open-`useEffect`, and the `insertSubjectToken` helper (cursor-position token insertion into the subject input).

## Impact Analysis

### Database

- None.

### Runtime

- Form Editor renders again. No functional changes beyond repairing the intended subject editing behavior.

### API Surface

- None.

## Follow-up recommendation

Enable a real typecheck gate (e.g. `tsc --build` on the solution tsconfig with a compatible `ignoreDeprecations` value, or a CI lint/typecheck step) — the current setup cannot catch undefined-identifier regressions like this one.
