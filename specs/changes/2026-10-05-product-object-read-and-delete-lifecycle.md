# Product Object API publication and cascading Product deletion

## Summary

Separated generated Product Object API access from Page publication/revalidation. A non-retired Product's Object now follows its `object_api_enabled` and `object_requires_auth` preferences independently; published/registered Page requirements continue to govern Pages and the friendly page-slug alias, not the canonical `/api/objects/{slug}` stream.

Added explicit permanent Product deletion alongside reversible archive. Deletion removes linked active Events and their Event Pages, archived Event history, the Product's canonical Page, and generated Object in a tenant/version-checked transaction. UI and MCP both expose the irreversible action with confirmation/version requirements.

## Files Added

- `migrations/202610050002_product_delete_with_events.sql` — cascading Event/Event archive FKs and tenant/version-scoped aggregate delete RPCs.
- `migrations/202610050003_product_object_api_independent_from_pages.sql` — removes Page/schema publication gating from generated Object API settings and idempotently refreshes Product mirrors.
- `tests/productDeleteCascade.test.mjs` — cascade, REST/MCP and UI deletion contract checks.

## Files Changed

- `scripts/lib/migration-order.mjs`, `specs/platform/unified-setup-tui.md`, `specs/architecture/system-overview.md` — register/classify migrations 009/010.
- `api/routes/products.ts`, `api/lib/productAggregateService.ts`, `api/routes/mcp.ts`, `api/index.ts` — versioned REST/MCP Product delete operation.
- `src/services/productService.ts`, `src/pages/ProductCatalogue.tsx` — permanent delete controls for Website and event-planning Products, separate from archive.
- `api/routes/objects.ts`, `src/pages/ObjectDatastreams.tsx`, `src/services/objectService.ts`, `src/lib/apiCatalog.ts` — report Product retirement as the only source gate and document independent canonical Object API availability.
- `specs/features/service-products.md`, `specs/agents/product-catalogue-integration.md` — document Page/Object API separation and Product deletion semantics.

## Impact analysis

### Database

Product deletion explicitly removes tenant-linked active events first, allowing the existing Event delete trigger to remove their linked Pages, then removes event archive rows, the Product row and its Product Page. Foreign keys use `ON DELETE CASCADE` as a database-level invariant; the RPC remains the supported tenant/page aggregate path. The generated Object is removed with its Product source relation. Product API settings remain source-owned and are no longer overridden by Page publication or schema registration; retirement still disables the Object.

### Runtime

The canonical dynamic Object endpoint can be public or JWT-protected according to Datastream settings, even while the Product's editorial Page is draft/unregistered. Pages and the friendly `/api/products/{workspaceSlug}/{productSlug}` alias retain their publication/registration behavior. UI archive preserves data; hard delete warns that related Events and history are permanently removed.

### API surface

Adds authenticated `DELETE /api/products/:id` requiring `tenant_id` and `expected_version`, plus MCP `specy_products_delete` with the same identifiers. Existing `specy_products_archive` remains the reversible operation. The canonical `/api/objects/:idOrSlug` visibility criteria stay `published`, `api_enabled`, and `requires_auth`.

## Rollout

Apply migrations `202610050002` and `202610050003` after their registered predecessors before deploying the API/UI. Verify anonymous Object GET after enabling a Product Object stream, JWT-protected reads when configured, RLS isolation, and deletion rollback plus cleanup of Event Pages and archive history. No live database migration or production deletion was executed during implementation.
