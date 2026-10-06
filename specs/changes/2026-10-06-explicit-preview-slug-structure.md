# Explicit preview slug structure

- **Date:** 2026-10-06
- **Scope:** PageBuilder preview, `/pages` menu preview indicator, MCP preview tooling

## Summary

Page previews across the pages feature are now driven exclusively by an **explicitly set preview slug structure**: an enabled `detail-page` frontend target whose `host_path` contains the `:slug` token, combined with a registered `frontend_url`. The previous implicit fallbacks (schema `slug_structure`, frontend contract `required_slug_structure`) were removed from preview URL construction.

- **Works without previews:** schemas without preview configuration keep full functionality — editing, saving, publishing, revalidation, and collection-slot rendering are unaffected.
- **Errors out the preview view:** when the structure is unset, the PageBuilder shows an explicit error with guidance (no preview button), the schema detail page withholds the published-page preview button, and the new MCP tool fails with `preview_not_configured`.
- **`/pages` menu indicator:** every schema card now shows a `Preview set`/`Vorschau gesetzt` or `No preview`/`Keine Vorschau` badge; the schema detail page reports the preview state and the configured structure in the Frontend Contract card.
- **MCP:** `start_here` documents how previews work and how to set them; the new `specy_pages_schemas_preview` tool reports the preview configuration and resolves a page preview URL.

The database constraint from `202608020001_schema_frontend_targets.sql` already guarantees that `detail-page` targets contain `:slug` exactly once; no migration was needed.

## Files Added

- `tests/previewSlugStructure.test.mjs` — unit tests for explicit preview slug structure resolution and preview URL building.
- `specs/changes/2026-10-06-explicit-preview-slug-structure.md` — this change record.

## Files Changed

- `src/utils/schemaRouting.ts` — added `getExplicitPreviewSlugStructure()` and `isPreviewConfigured()`; switched the runtime import to a relative `.ts` specifier for direct Node test importability.
- `src/features/page-builder/SchemaContentEditor.tsx` — preview URL is built only from the explicit preview slug structure (no `getExpectedSlugStructure` fallback); save feedback shows a destructive error state with setup guidance when unset, and the frontend-URL-missing state separately; the admin slug URL display uses the explicit structure.
- `src/pages/Pages.tsx` — `Preview set`/`No preview` badge on both schema card renderings (TLD groups and onboarding "Available Schemas").
- `src/pages/PagesSchemaDetail.tsx` — published-page preview button requires explicit preview configuration; Frontend Contract card shows a `Preview` row with state and structure.
- `src/services/pageService.ts` — `getSchemas()` embeds `schema_frontend_targets` so the `/pages` list can compute preview state without per-schema requests.
- `api/routes/mcp.ts` — registered `specy_pages_schemas_preview` in both tool name lists; new tool with preview configuration inspection + page preview URL resolution (`preview_not_configured` failure when unset); `start_here` gained workflow step 10 and an important note about preview setup.
- `specs/features/page-builder.md` — new "Preview (explicit slug structure)" section.
- `specs/agents/mcp-exposition.md` — added the preview tool to the `specy-pages > schemas` family and documented the contract.

## Impact analysis

- **Database:** none. Existing `schema_frontend_targets` constraints already enforce `:slug` in `detail-page` host paths. No migration.
- **Runtime:** `getSchemas()` now performs one PostgREST embed for `schema_frontend_targets` (RLS-protected, authenticated select). PageBuilder/schema-detail rendering branches on explicit preview configuration only.
- **API surface:** one new authenticated MCP tool (`specy_pages_schemas_preview`) registered in the authenticated tool sets; anonymous tool surface unchanged. `start_here` output extended.

## Verification

- `npm run typecheck` — clean.
- `npm test` — 423 tests pass (5 new).
- `npm run build` — succeeds end to end.
- `npm run typecheck:api` — clean for `api/routes/mcp.ts`; remaining errors originate from the gitignored `plugins/pluradash` workspace (separate repository).
