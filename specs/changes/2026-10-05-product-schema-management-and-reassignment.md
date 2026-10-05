# Product schema management and reassignment

## Summary

Added a visible **Website-Schemata** path from `/products/manage`. Product schema assignment and reassignment are available from `/products/schemas`; changing an existing Product's schema preserves its Page identity/content and returns a published Page to draft so the content can be reviewed against the new schema. The Schema Editor now uses an explicit schema-purpose selector instead of describing Event classification as “set through integration.” Unused Event schemas can be changed to Product schemas; schemas with existing Pages remain protected pending an explicit conversion.

## Files Added

- `migrations/202610050004_product_schema_reassignment.sql` — tenant/version/revision-checked Product schema reassignment RPC, page guard support, and aggregate version bump for schema changes.
- `tests/productSchemaReassignment.test.mjs` — migration ordering, aggregate/API/UI and schema-purpose regression checks.
- `specs/changes/2026-10-05-product-schema-management-and-reassignment.md` — this record.

## Files Changed

- `src/pages/ProductCatalogue.tsx` — add an obvious link to the Website schema overview.
- `src/pages/Products.tsx` — add Product schema reassignment from the schema overview, with target-schema preview and a review-before-republish warning.
- `src/features/schema-editor/SchemaEditorPage.tsx` — make Page, Product, and Event purpose explicit; remove the integration-forced Event label and allow safe reclassification when no Pages exist.
- `src/services/productService.ts`, `api/routes/products.ts`, `api/lib/productAggregateService.ts` — add authenticated Product schema reassignment service and REST route.
- `scripts/lib/migration-order.mjs`, `specs/platform/unified-setup-tui.md` — register and classify the new migration.
- `src/lib/apiCatalog.ts` — document `PATCH /api/products/:id/schema`.
- `specs/features/service-products.md`, `specs/features/schema-editor.md` — document schema selection/reassignment and schema-purpose semantics.

## Impact analysis

### Database

Adds `change_service_product_schema_aggregate`, running as `SECURITY INVOKER`. It checks caller RLS, Product tenant/version, target schema tenant/classification/scope/revision, and changes the canonical Page's `schema_id` transactionally. Existing content and Page ID are retained; a published page becomes a draft. Product aggregate version increments through its Page update trigger. No data is migrated automatically.

### Runtime

The main Products overview links to `/products/schemas`. Operators can change a Product's associated schema there and are taken to its canonical PageBuilder after the move. The PageBuilder receives the target schema and retained content; required fields can be reviewed before republishing. Schema classification is explicit; an Event schema with existing Pages cannot be changed in place because those Pages are event-owned aggregates.

### API surface

Adds authenticated `PATCH /api/products/:id/schema` requiring `{ tenant_id, expected_version, schema_id, expected_definition_revision }`. It returns the updated Product aggregate. No new MCP tool is added.

## Verification

- `npm run typecheck` — passed.
- `npm test` — passed (412 tests), including migration-order and schema-reassignment contract checks.
- `npm run build` — passed; existing dynamic-import and bundle-size warnings remain.
- `npm run dev` smoke check — `/products/manage`, `/products/schemas`, and transformed ProductCatalogue, Products, and SchemaEditorPage modules returned HTTP 200.
- `npm run typecheck:api` — did not pass because of existing generated plugin metadata and `plugins/pluradash/api/**` type errors; no errors referenced the touched core API files.
- `npm run dev:api` started successfully; an unauthenticated `GET /api/products` correctly returned 401. The local Worker was stopped after the smoke check. An authenticated browser/REST happy-path and live database/RLS verification remain pending; no live migration was applied.
