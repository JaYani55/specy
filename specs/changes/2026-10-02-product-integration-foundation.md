# Products × Pages integration foundation

## Summary

Implemented the safe first foundation slice from `specs/plans/PRODUCT-INTEGRATION.md`:

- Schema-driven page content editing now preserves unknown JSON, explicit empty values, unsupported schema attributes, and custom/invalid blocks instead of normalizing them away.
- Schemas now have additive `entity_kind`, `definition_revision`, and non-executable `editor_config` metadata, with revision-checked REST/MCP definition updates and safe classification/tenant/scope checks.
- Added an initial service-product aggregate backed by the existing product IDs/table: atomic draft create, optimistic update, publish/unpublish, archive, idempotency, tenant RLS, and schema content validation on edits/publication.
- Added the filtered German Products entry point and connected its editor to canonical schema/page routes; product pages save through aggregate operations rather than generic page CRUD.
- Product public delivery is published-only, checks for an active same-tenant aggregate, and optionally exposes only `relations.entity` via `?include=entity`.
- Generic page writes remain rejected for product/event-classified schemas. Existing schemas default to `page`; populated schemas cannot be silently reclassified or moved.
- Product-to-page deletion uses a tenant-required atomic database function. Page deletion is restricted while product rows exist, and active/archive event references prevent hard deletion.
- The staff directory no longer falls back to an unscoped global login-role directory when the tenant registry is empty or unavailable; basic staff create/edit no longer fetches or links accounts.
- Public manifests no longer promise support for new frontend routes when that capability has not been verified.

This is **not the full plan rollout**. The live inventory/snapshot gate, legacy product conversion, staff-account link migration, curated public staff profiles/team display, optional customer CRM/event changes, event catalogue, typed external-service handoff, outbox/cache invalidation, and legacy contraction remain unimplemented. Event classification is metadata-only; event aggregate writes/public delivery are refused.

## Files Added

- `migrations/202610020001_schema_entity_contract.sql` — schema classification, editor metadata, revision trigger, and constraints.
- `migrations/202610020002_product_page_delete_safety.sql` — restrictive product/page and event-reference FKs plus transactional tenant-scoped product/page deletion RPC.
- `migrations/202610020003_service_product_aggregates.sql` — UUID product identities/versioning, the allow-listed compatibility view, transactional aggregate RPCs, and deferred product-page completeness checks.
- `migrations/202610020004_product_content_validation.sql` — database-side recursive content validation for direct update/publish RPC calls.
- `src/lib/schemaContent.ts` — lossless content state, presence, save-payload, and conflict helpers.
- `api/lib/schemaDefinition.ts` — schema definition patch validation.
- `api/lib/productAggregates.ts`, `api/lib/productAggregateService.ts`, `api/lib/schemaContentValidation.ts`, `api/lib/publicEntityProjection.ts` — shared REST/MCP product operations, request/content validation, and safe public entity includes.
- `api/routes/products.ts` — tenant-authenticated REST aggregate adapters.
- `src/services/productService.ts`, `src/pages/Products.tsx` — product aggregate client and filtered Products workflow.
- `specs/features/service-products.md`, `specs/agents/product-catalogue-integration.md` — current product contracts and rollout limits.
- `tests/schemaContentRoundTrip.test.mjs` — lossless content regression coverage.
- `tests/schemaDefinition.test.mjs` — schema definition patch contract coverage.
- `tests/productDeleteSafety.test.mjs` — FK, invoker-RPC, and tenant-required delete contract assertions.
- `tests/productIntegration.test.mjs`, `tests/publicEntityProjection.test.mjs`, `tests/schemaContentValidation.test.mjs` — product payload, public include, and recursive validation contracts.
- `specs/features/schema-contracts.md` — current schema metadata/content-editor contract and rollout boundary.

## Files Changed

- `scripts/lib/migration-order.mjs`, `tests/coreMigrations.test.mjs` — registered all four migrations and taught migration dependency checks to recognize views.
- `src/types/pagebuilder.ts`, `src/services/pageService.ts`, `src/pages/SchemaEditor.tsx` — schema metadata, revisioned REST updates, entity classification UI, and schema/page/workspace tuple checks.
- `src/components/pagebuilder/SchemaPageBuilderForm.tsx`, `JsonImporter.tsx`, `StandaloneContentBlockEditor.tsx`, `PageBuilderForm.tsx`, `src/pages/PageBuilder.tsx` — lossless content editing/import, block conflict display, and safe schema route loading.
- `src/services/events/productService.ts`, `src/pages/VerwaltungAllProducts.tsx` — legacy product deletion now uses the atomic restrictive RPC with explicit workspace context.
- `src/App.tsx`, `src/components/layout/AppSidebar.tsx`, `src/pages/PagesSchemaDetail.tsx` — Products navigation, product-aware page editor/publication actions, and safe no-delete UI for product pages.
- `src/services/staffRegistryService.ts`, `src/pages/VerwaltungAddMentor.tsx` — removed global role/account fallback, require a selected tenant for directory/record access, and stop fetching/linking accounts as part of basic staff creation/editing. Legacy inline account IDs remain for existing consumers until the account-link migration/cutover is completed.
- `api/lib/frontendManifest.ts`, `api/lib/schemaCreation.ts`, `api/lib/productAggregateService.ts`, `api/routes/products.ts`, `api/routes/schemas.ts`, `api/routes/mcp.ts`, `api/index.ts` — schema metadata/revision APIs, shared product REST/MCP operations, entity-aware public delivery, classified generic-write rejection, and honest new-route capability reporting. MCP tools now invoke the caller-scoped aggregate service directly rather than making an internal HTTP hop.
- `src/lib/apiCatalog.ts`, `tests/schemaAgentTools.test.mjs`, `specs/architecture/page-builder.md`, `specs/architecture/system-overview.md`, `specs/features/README.md`, `specs/agents/README.md`, `specs/agents/mcp-exposition.md`, `specs/agents/agent-system-prompt.md`, `specs/agents/frontend-integration-manifest.md` — contract and discovery documentation.

## Impact analysis

### Database

Four additive, idempotent migrations are registered. They add schema metadata/revisions; change product/page and event/archive FKs to restrictive behavior with a `SECURITY INVOKER` atomic delete; add UUID product IDs, versions, idempotency, an allow-listed `service_products` compatibility view, transactional aggregate functions, and a deferred page/product completeness trigger; and validate content inside update/publish RPCs. Historical integer product IDs/tables are retained, and no legacy product data is transformed. A live database, RLS persona matrix, rollback rehearsal, and data/constraint inventory were not available; apply and verify these migrations in snapshot-backed staging before production.

### Runtime

Known and unknown page JSON is retained through load/edit/save. False, zero, null, empty strings/arrays/objects are presence-based values. Unsupported/malformed block data is visible and remains unchanged unless explicitly removed. Products create one draft aggregate/page and edit/publish/archive atomically; schema changes are versioned, stale product writes conflict, and public product delivery requires publication plus an active product relation. Product hard delete is tenant-required and atomic; event-referenced products fail closed. Direct update/publish RPCs validate content and lock both business/schema versions. Staff directory emptiness remains empty rather than exposing role accounts.

### API surface

Added authenticated `PATCH /api/schemas/:apiSlug/definition` and MCP `specy_pages_schemas_update_definition`, both revision-checked. Added authenticated list/get/create/update/publish/archive `/api/products` routes and six `specy_products_*` MCP tools, all using caller JWT/RLS and transaction-backed RPCs. Create returns the canonical editor URL and uses replay-safe idempotency. Product public delivery is published-only; `?include=entity` adds an allow-listed opaque UUID relation without modifying content. Event delivery remains unavailable. The manifest reports `supports_new_routes: null` until verified. Deletion and aggregate RPCs execute as the caller and remain subject to RLS.

## Verification

- `npm test`: passed (356 tests, including product aggregate, public relation, validation, and delete-safety contracts).
- `npm run typecheck`: passed.
- `npm run build`: passed; Vite emitted existing chunk-size/dynamic-import warnings.
- `npm run typecheck:api`: core API files report no errors, but the full command exits non-zero on existing errors in the gitignored `plugins/pluradash` workspace and generated plugin metadata; no plugin files were changed.
- `npm run dev:api -- --port 8799` reached Wrangler's Ready state within the 20-second startup cap. No database-backed route was called to avoid touching the configured remote Supabase project.
- Browser workflow smoke tests and live database/RLS/migration/rollback integration tests were not available and remain required before production rollout.
