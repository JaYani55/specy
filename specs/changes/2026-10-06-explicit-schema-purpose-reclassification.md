# Explicit schema purpose reclassification

## Summary

The schema editor previously locked the **Schema-Zweck** field permanently for any schema with existing pages and displayed "Der Zweck kann erst nach einer ausdrücklichen Umstellung geändert werden." — but that explicit conversion did not exist anywhere. Operators with a mis- or re-purposed schema (for example an Event schema that should become a Product schema) had no path forward.

The explicit reclassification is now implemented end to end:

- The editor keeps the purpose field locked but offers a **Zweck ändern…** action that opens a confirmation dialog (current purpose, new purpose, per-target compatibility hints).
- The API accepts the reclassification only with an explicit `allow_reclassification: true` and a caller-confirmed `expected_page_count` that matches the schema's actual page count.
- Reclassification is only accepted when every existing page keeps a matching aggregate: `event` targets require a linked `mentorbooking_events` row per page, `service-product` targets require a non-retired `mentorbooking_products` row per page, and a demotion to an ordinary `page` schema is always allowed. Incompatible schemas are rejected with `schema_conversion_required` and a count of the unlinked pages.
- Product and event schemas always save with `page-collection` content scope: the editor now restores a previously misconfigured `single-page` scope automatically on save instead of blocking with an error.

## Files Added

- `specs/changes/2026-10-06-explicit-schema-purpose-reclassification.md` — this change record.

## Files Changed

- `api/lib/schemaDefinition.ts` — patch contract extended with `allow_reclassification` and `expected_page_count`; guarded reclassification with per-page aggregate compatibility checks (`assertPagesCompatibleWithEntityKind`).
- `api/routes/mcp.ts` — `specy_pages_schemas_update_definition` exposes the same explicit reclassification parameters to agents.
- `src/features/schema-editor/SchemaEditorPage.tsx` — "Zweck ändern…" confirmation dialog; automatic `page-collection` scope restoration for product/event schemas on save (with an info toast instead of a blocking error).
- `src/services/pageService.ts` — `updateSchema` input accepts `allow_reclassification` and `expected_page_count`.
- `tests/schemaDefinition.test.mjs` — parse-shape coverage for the new fields and source-level guard assertions.
- `specs/features/schema-editor.md` — documents the explicit reclassification flow and the scope auto-restoration.

## Impact analysis

### Database

None. No migrations. The reclassification only updates `page_schemas.entity_kind` (which bumps `definition_revision` via the existing trigger); page rows and their aggregates are untouched. Compatibility is validated read-only before the update.

### Runtime

- Schemas with pages can now be reclassified through an explicit, confirmed flow when their pages are aggregate-compatible; otherwise the operator gets a precise error naming the unlinked pages.
- Event/product schemas that were saved with a `single-page` content scope (which silently excluded them from the event catalogue and product flows) are repaired on the next editor save.
- Workspace assignment rules are unchanged: product/event schemas must belong to a workspace, and moving them between workspaces remains blocked (`schema_tenant_migration_required`).

### API surface

- `PATCH /api/schemas/:slug/definition` and the MCP tool `specy_pages_schemas_update_definition` accept `allow_reclassification` and `expected_page_count`. Without them, the previous `schema_conversion_required` behavior applies (now with an actionable error message).

## Verification

- `npm run typecheck` — passed.
- `npm test` — passed (412 tests).
- `tsc --noEmit -p tsconfig.node.json` — the touched API files (`api/lib/schemaDefinition.ts`, `api/routes/mcp.ts`) are clean; remaining errors are pre-existing generated-plugin issues.
