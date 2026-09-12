---
name: tests
description: Quality gates and required tests to run before handing off any task in the Specy CMS repository. Use this skill whenever you changed code (frontend, API, edge functions, migrations, or scripts) and before declaring a task complete.
---

# Testing & Verification Before Handoff

This repo has **no working "it compiles, therefore it works" shortcut**:
`vite build` transpiles without type checking, and a bare `tsc --noEmit` is a
no-op (solution-style root `tsconfig.json` with `files: []`). A regression that
crashes a page at runtime (e.g. a ReferenceError from a half-applied edit) is
only caught by explicitly running the gates below. A blank/white screen in the
dashboard almost always means an uncaught runtime error in a component tree —
check for undefined identifiers first.

## Required gates (run all of them, in this order)

### 1. Typecheck — `npm run typecheck`

- Runs `tsc --noEmit -p tsconfig.app.json` (frontend `src/` **plus** plugin
  frontend pages pulled in via the generated `src/plugins/registry.ts`).
- Must exit **0**. Do not hand off with new type errors.
- Note: this gate is wired into `npm run build`, so a full build also enforces it.
- API variant: `npm run typecheck:api` (`tsconfig.node.json`, strict). The core
  `api/` is clean, but errors reported inside `plugins/*/api/**` come from the
  gitignored plugin workspace (separate repositories) and are **not** your
  responsibility to fix in this repo — verify the files *you* touched are clean.

### 2. Unit tests — `npm test`

- Runs `node --test tests/**/*.test.mjs` (Node's built-in runner, Node ≥ 24
  strips TS types natively, so tests can import `.ts` sources directly with an
  explicit `.ts` extension — no transpiler needed).
- All tests must pass. If you added or changed pure logic, **add tests** for it
  (see "When to add tests" below).

### 3. Full build — `npm run build`

- `prebuild` regenerates the plugin registries (`ensure-registry.mjs`), then
  typecheck runs, then `vite build`. Must succeed end to end.

### 4. Migration order — when touching migrations

- **Whenever you add a migration to `scripts/lib/migration-order.mjs` (or edit
  any file in `migrations/`), `tests/coreMigrations.test.mjs` is part of
  `npm test` and must pass.** It enforces:
  - every ordered file exists in `migrations/` (no dangling entries),
  - no duplicates, `preamble.sql` first,
  - **dependency ordering**: any migration referencing `public.<table>` must
    have that table created in the same or an earlier migration (creators are
    derived from `CREATE TABLE` and `ALTER TABLE … RENAME TO`),
  - `storage.sql` stays last and only applies to the `supabase` provider.
- Place a new migration AFTER everything it references (tables, functions,
  types). If the test fails, the assertion message names the offending file
  and the missing table — move the migration (or its dependency), don't
  disable the test.

## When to add tests

Add tests to `tests/*.test.mjs` (Node `node:test` + `node:assert/strict`) for:

- **Pure utility logic** you created or modified — validation rules, token/
  template rendering, normalization, formatting (e.g. `src/utils/**`,
  `api/lib/**`). Import the actual TS source, never copy-paste the logic into
  the test (copied logic can drift — the test would then verify the copy).
- **Behavior contracts** worth locking in: boundary values (min/max lengths),
  error classifications (e.g. Postgres error codes), sanitization/XSS rules,
  and cross-file consistency (e.g. "default templates only reference registered
  tokens").
- **Bug fixes**: first write a test that reproduces the bug (red), then fix
  (green). Keep the test as a regression guard.
- **Migration ordering**: every new entry in
  `scripts/lib/migration-order.mjs` is validated by `tests/coreMigrations.test.mjs`
  (see gate 4 above) — no extra test file needed, but make sure it passes.

Do not add tests for trivial JSX/markup, generated files
(`src/plugins/registry.ts`, `api/plugin-routes.ts`, …) or plugin-internal code
(plugins are separate repositories with their own repos/tests).

## If the page you touched renders in a browser

Beyond the automated gates, smoke-test the affected flow with `npm run dev`
(frontend) / `npm run dev:api` (API): open the page, perform the primary action
(open modals, save forms, submit), and check the browser console for uncaught
errors. The build does **not** execute your code — runtime errors such as
referenced-but-undeclared variables, bad imports or hook-order violations only
surface here.

## If you changed the API or edge functions

- `npm run dev:api` must start without errors.
- Endpoints you touched: exercise at least the happy path and one error path
  (e.g. invalid payload → 400) with curl or the MCP/API catalog.
- Edge functions (`functions/**`) are not covered by `tsc` gates — check them
  manually (deno check or a deployment smoke test) when you modify them.

## If you added a migration

- The migration must be idempotent (see AGENTS.md §5) and registered in
  `scripts/lib/migration-order.mjs` → `MIGRATION_ORDER_CORE` at the correct
  dependency position.
- Verify it runs twice without error against a local database when possible.

## Handoff checklist

1. `npm run typecheck` → exit 0
2. `npm test` → all green
3. `npm run build` → succeeds
4. Dev smoke test of every user-visible flow you touched
5. Change documented in `specs/changes/YYYY-MM-DD-<description>.md`; feature
   docs updated in the matching `specs/` folder
6. Report honestly in the handoff which gates you ran and what you could not
   verify (e.g. live mail delivery, provider-dependent behavior)
