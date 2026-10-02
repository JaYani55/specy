# Product management as the default overview

## Summary

Changed `/products` to route directly to the standard legacy product-management overview at `/products/manage`. Added an **Edit schemas** button to that overview, linking to `/products/schemas`. Removed the intermediate product-area card hub.

## Files Added

- None.

## Files Changed

- `src/App.tsx` — `/products` now redirects to `/products/manage`; removed the hub component route/import.
- `src/pages/ProductsHome.tsx` — removed the intermediate card hub.
- `src/pages/VerwaltungAllProducts.tsx` — added the schema-edit navigation button and directed users without legacy-product permission to the schema workflow.
- `src/pages/Products.tsx` — updated the schema-workflow back button to return to product management.
- `src/pages/VerwaltungCreateProduct.tsx` — routes users without legacy-product permission to the schema workflow.
- `specs/features/service-products.md` — documented the default overview and schema-edit entry point.

## Impact analysis

### Database

No database changes or migrations.

### Runtime

The Products navigation now opens the established product-management list by default. The **Edit schemas** button opens the schema-backed workflow. The two workflows continue to use their separate data models and services. `/products` remains a supported entry point and redirects to `/products/manage`.

### API surface

No REST or MCP changes.

## Verification

- `npm run typecheck` — passed.
- `npm test` — passed (358 tests).
- `npm run build` — passed; existing plugin dynamic-import and bundle-size warnings remain.
- Vite served `/products`, `/products/manage`, and the transformed legacy and schema-backed product pages. An authenticated browser interaction was not available.
