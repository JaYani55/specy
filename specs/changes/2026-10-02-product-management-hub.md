# Product management hub and route consolidation

## Summary

Consolidated product navigation under `/products`. The page now presents separate menu cards for the established event-product management interface and the schema-backed product workflow. The legacy interface is available under `/products/manage`, and the schema-backed workflow has moved to `/products/schemas`. Removed product cards from the Administration landing page while retaining redirects for previously shared `/admin` product URLs.

## Files Added

- `src/pages/ProductsHome.tsx` — new product-area hub with accessible navigation cards.

## Files Changed

- `src/App.tsx` — added hub and subroutes; added redirects for legacy product URLs.
- `src/pages/Products.tsx` — now serves the schema-backed workflow at `/products/schemas` and links back to the product hub.
- `src/pages/Verwaltung.tsx` — removed product-management cards and updated the administration summary.
- `src/pages/VerwaltungAllProducts.tsx` — moved internal navigation to the `/products/manage` route family.
- `src/pages/VerwaltungCreateProduct.tsx` — moved create/cancel/back navigation to the consolidated product routes.
- `src/pages/ProductDetail.tsx` — updated product detail navigation to the new management route.
- `src/pages/PagesSchemaDetail.tsx` — product-schema action now opens `/products/schemas`.
- `src/components/navigation/Breadcrumb.tsx` — added breadcrumb labels for the new product routes.
- `specs/features/service-products.md` — documented the product dashboard entry points and legacy boundary.

## Impact analysis

### Database

No database changes or migrations.

### Runtime

`/products` is now a navigation hub. The legacy product UI and schema-backed product workflow remain separate and continue using their existing data services. Existing `/admin/all-products`, `/admin/create-product`, and `/admin/product/:productId` URLs redirect to `/products/manage`, `/products/manage/new`, and `/products/manage/:productId` respectively. The Administration landing page no longer advertises product management.

### API surface

No API or MCP changes. The legacy workflow continues using the existing event-product service; the schema-backed workflow continues using the service-product aggregate REST API.

## Verification

- `npm run typecheck` — passed.
- `npm test` — passed (357 tests).
- `npm run build` — passed; existing plugin dynamic-import and bundle-size warnings remain.
- `npm run dev` — started successfully; Vite served the SPA root, the `/products/manage` deep route, and the transformed hub module. An authenticated browser interaction/visual smoke test was not available in this environment.
