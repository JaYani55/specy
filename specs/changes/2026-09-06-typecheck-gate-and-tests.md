# 2026-09-06 — Real Typecheck Gate, Unit Tests & Tests Skill

## Summary

Follow-up to `2026-09-06-blank-form-editor-fix.md`: the blank form editor
regression shipped because the repo had **no functioning typecheck** — a bare
`tsc --noEmit` checks nothing (solution-style root tsconfig with `files: []`),
`tsconfig.app.json` carried an invalid `"ignoreDeprecations": "6.0"` for the
installed TypeScript 5.8.2, and Vite/esbuild does not type check. This change
makes the typecheck real and green, gates the build on it, adds unit tests for
the recently touched pure logic, and adds an agent-facing **tests skill**
documenting the mandatory verification steps before handoff.

## Changes

### Typecheck gate

- `tsconfig.app.json` — `"ignoreDeprecations"` fixed to `"5.0"` (valid for TS
  5.8.2); `lib` bumped `ES2020 → ES2021` (code uses `String.replaceAll`).
- `tsconfig.node.json` (API, strict) — added `baseUrl`/`paths` for the `@/*`
  alias and `DOM`/`DOM.Iterable` libs (Worker-runtime globals such as
  `CryptoKey`, `FormDataEntryValue`).
- `package.json` — new scripts `typecheck` (`tsc --noEmit -p
  tsconfig.app.json`) and `typecheck:api` (`tsc --noEmit -p
  tsconfig.node.json`); `build` now runs `npm run typecheck && vite build`, so
  every build enforces the frontend typecheck.

### Pre-existing type errors fixed (frontend now fully green)

All 21 `src/` errors and 3 plugin-frontend errors resolved; several were real
runtime bugs, not just type noise:

- `api/index.ts` — root endpoint referenced an **undefined `baseUrl`**
  (ReferenceError → 500 on every request to `/`); now resolves the public URL
  like the adjacent handler.
- `src/pages/List.tsx` — called undefined `fetchEvents` in the
  MentorRequestsModal success handler → runtime crash; now `refetchEvents`.
- `src/pages/VerwaltungAllMentors.tsx` — called undefined `fetchMentorGroups`
  in `handleTraitUpdate` → runtime crash; now `fetchStaffTraits`.
- `plugins/pluradash/src/pages/IsibotFlowBuilderPage.tsx` — missing
  `fetchIsibotFlow` import (runtime crash on flow detail load; plugin workspace,
  fixed locally, belongs to the plugin repository).
- Type-level fixes: `ListTable.tsx` (duplicate `User` identifier — type import
  aliased), `PollResultsPage.tsx` (consent-vote narrowing, `entries` value
  typed `string`), `Profile.tsx` via `useProfileData.tsx` (`email`/`role`
  declared on `ProfileUser`), `EditEvent.tsx`/`EventForm.tsx` (`tenant_id` added
  to `initialValues`), `ProductSection.tsx` (`Path` cast for RHF generic),
  `SchemaEditor.tsx` (missing `editorId` on array items), `toggle-group.tsx`
  (`aria-pressed` via attribute access), `accountService.ts`/`accounts.ts`
  (supabase cast via `unknown`), `employerService.ts` (removed invalid `from`
  generics), `SeaTableProfileData.tsx` (restored missing
  `src/types/seaTableTypes.ts`), `GitHubAppsAdminPage.tsx` (duplicate Table
  import removed, Select import restored, `Map<string,string>` typing).
- API strict-mode fixes: `adminConnectionHooks.ts` (hook result cast),
  `auth.ts` (`Promise<Response>` return), `schemaRegistration.ts` (host path
  non-null after guard), `systemConfig.ts` (storage provider cast after
  type-guard), `specs.ts` (replaced undefined `updateData` with the parsed body
  field mapping — second undefined-variable runtime bug fixed),
  `isibotFlowTypes.ts` (generic `sortDescriptors`).

Remaining `tsconfig.node.json` errors (68) are exclusively inside
`plugins/pluradash/api/**` — Hono generic-variance issues in the gitignored
plugin workspace (separate repository, out of scope for the core gate).
`npm run typecheck:api` documents them for the plugin maintainers.

### Unit tests (`node --test`, TS sources imported via native type stripping)

- `tests/formMessageTemplate.test.mjs` — subject rendering (token resolution,
  `field:` tokens, unknown → `-`, whitespace collapse, 500-char cap),
  `hasUsableSubject`, sanitizing body rendering (token spans, XSS escaping,
  unknown-tag dropping, atomic token spans, text fallback), `hasUsableTemplate`.
- `tests/usernameUtils.test.mjs` — username rules (min/max boundaries,
  charset, trim behavior, localized messages) and `isUsernameTakenError`
  classification. **Caught a real rule gap during development**: the legacy
  pattern `[a-zA-Z0-9_\s-]+` allowed tabs/newlines, which corrupt the
  AuthContext `split(' ')` name derivation — tightened to literal spaces
  (`[a-zA-Z0-9_ -]`) in `src/utils/usernameUtils.ts`.
- `tests/formNotificationTemplates.test.mjs` — token registry integrity
  (unique keys, labels), `tokenDisplayLabel`, and cross-file consistency:
  default bodies/subjects only reference registered tokens; confirmation body
  omits `recipient_name`.

### Agent skill

- `.pi/skills/tests/SKILL.md` — "tests" skill documenting the mandatory gates
  (`typecheck` → `test` → `build` → dev smoke test), when to add tests
  (always import real sources, never copy logic; bug fixes need a
  red-then-green test), migration/migration-order checks, and the handoff
  checklist incl. honest reporting of what was not verifiable.

## Impact Analysis

### Database

- None.

### Runtime

- Two undefined-variable runtime crashes fixed (`/` API root, List.tsx modal
  success handler), one in the plugin workspace, plus VerwaltungAllMentors
  trait reload. Username charset rule tightened (spaces only — tabs/newlines
  were always nonsensical and validation is client-side only).
- `npm run build` now fails on frontend type errors — this is the intended
  gate.

### API Surface

- No endpoint contracts changed. `POST /api/specs/:id` (global-spec branch)
  now actually persists the submitted fields instead of throwing
  `updateData is not defined`.
