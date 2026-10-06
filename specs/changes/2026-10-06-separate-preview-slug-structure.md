# Separate preview slug structure & target validation DX

- **Date:** 2026-10-06
- **Scope:** Frontend-target validation, preview route separation, MCP tool descriptions, revision bumping
- **Trigger:** MCP DX feedback (Akademie Freytag project): a non-public preview route (`/preview/:slug`) could not be registered alongside the public detail route; validation rules were undocumented; unknown `integration_requirements` keys were silently accepted, suggesting `preview_slug_structure` was effective when it was not; `integration_requirements` updates did not bump `definition_revision`.

## Summary

Implements the feedback's proposals:

1. **5.1 — Separate validation of detail and preview structure.** New `integration_requirements.preview_slug_structure` key. Detail targets **without** `supports_preview` are validated against `required_slug_structure` and `route_base_path` as before. Detail targets **with** `supports_preview: true` are validated against `preview_slug_structure` when set and are **exempt from `route_base_path`** (the preview route is internal/noindex). Schemas may now register a public detail route and a separate preview route **side by side** — the DB-level "at most one enabled detail-page target" rule was relaxed to "unique `host_path` per schema" (new unique index).
2. **5.2 — Precise errors.** Validation failures name the offending target (`target "event-preview" (/preview/:slug): …`) and aggregate all mismatches into one response (`errors: []`) with a rule-chain hint, instead of aborting at the first mismatch.
3. **5.3 — Documentation.** New `specs/features/frontend-targets.md` with the authoritative rule chain, allowed target combinations, the `integration_requirements` keys actually evaluated per tool, the unknown-keys-are-ignored behavior, preview resolution order, and an error catalog with retry hints. MCP tool descriptions for `replace_frontend_targets`, `update_definition`, and `preview` now state the rules; `start_here` step 10 mentions `preview_slug_structure`.
4. **5.4 — Revision bumping.** The `bump_page_schema_definition_revision` trigger now also bumps `definition_revision` when `integration_requirements` changes, making optimistic locking effective for that field area in `specy_pages_schemas_update_definition`.

Additionally, `supports_preview` is now **honored as supplied** instead of being coerced to `true` for every detail target (`false` = public detail route, `true` = non-public preview route). Legacy single-detail registrations (coerced `true`) remain preview-capable through fallback resolution, so no data migration of existing rows is needed.

## Files Added

- `migrations/202610060002_separate_preview_slug_structure.sql` — relaxes `schema_frontend_targets_detail_unique` to `schema_frontend_targets_detail_host_unique` (unique `schema_id, host_path` where enabled detail-page); extends the revision-bump trigger to `integration_requirements`.
- `tests/previewSlugStructureValidation.test.mjs` — 9 tests: dual-route acceptance, preview namespace exemption, legacy rule, malformed template rejection, duplicate host_path, error naming/aggregation, `update_definition` template validation, migration contract.
- `specs/features/frontend-targets.md` — new feature doc (registered in `specs/features/README.md`).
- `specs/changes/2026-10-06-separate-preview-slug-structure.md` — this change record.

## Files Changed

- `api/lib/schemaRouting.ts` — `preview_slug_structure` in the requirements record + normalization; `validateSlugStructure` base-path exemption option; `validateFrontendTarget` preview-target branch.
- `api/lib/schemaRegistration.ts` — `validateSchemaFrontendTargetInputs`: target-named errors, aggregated `errors: []`, duplicate host_path detection, removed single-detail-target limit, `supports_preview` preserved as supplied; relative imports now use `.ts` specifiers for direct Node test importability; `replaceSchemaFrontendTargets` includes `errors` in the 400 body.
- `api/lib/schemaDefinition.ts` — `parseSchemaDefinitionPatch` validates the `preview_slug_structure` template (starts with `/`, `:slug` exactly once, no whitespace).
- `api/routes/mcp.ts` — preview tool: resolution prefers the dedicated `supports_preview` target, only that target resolves when `preview_slug_structure` is set, reports both `detail_target` and `preview_target` plus both structures; expanded descriptions for `replace_frontend_targets`, `update_definition`, `preview`; `start_here` step 10 updated.
- `api/lib/managedSecrets.ts` — relative import `.ts` specifier (import chain of schemaRegistration).
- `src/types/pagebuilder.ts` — `preview_slug_structure?: string | null`.
- `src/utils/schemaRouting.ts` — `getExplicitPreviewSlugStructure` / `isPreviewConfigured` use the dedicated-preview-target resolution order; `getDetailPageTarget` prefers the non-preview detail target (public URLs).
- `src/features/schema-editor/SchemaEditorPage.tsx` — `supports_preview` ("Vorschau-Ziel") checkbox for detail-page targets instead of automatic coercion.
- `specs/features/page-builder.md`, `specs/architecture/page-builder.md`, `specs/agents/mcp-exposition.md` — preview and validation documentation updates.
- `tests/frontendTargetReplacement.test.mjs` — updated to the relaxed single-detail-target rule.

## Impact analysis

- **Database:** `202610060002` must be registered and run (done in `scripts/lib/migration-order.mjs`). No column changes; index replacement is idempotent. Existing rows are unaffected; no `supports_preview` backfill required (fallback resolution covers legacy rows).
- **Runtime:** preview resolution and public detail URL building now prefer dedicated targets; validation performs one extra normalization pass.
- **API surface:** `replace_frontend_targets` accepts multiple detail targets and returns target-named aggregated errors; `update_definition` rejects malformed `preview_slug_structure`; `specy_pages_schemas_preview` reports `preview_target`/`detail_target`/`required_slug_structure` in addition to `preview_slug_structure`.

## Verification

- `npm run typecheck` / `typecheck:api` — clean for all touched files.
- `npm test` — 435 tests pass (9 new).
- `npm run build` — succeeds end to end.

## Note on remaining feedback item (5.2 request IDs)

The generic `Frontend-target update failed (522)` envelope has been eliminated at the root (in-process replacement, see `2026-10-06-mcp-frontend-targets-self-fetch-522.md`). Adding `request_id` correlation to MCP error envelopes remains a follow-up improvement and is noted in the error catalog.