# Website-Produkte UI removed; single product workflow

## Summary

The Products overview previously listed two product "types" side by side: **Website-Produkte** (schema-backed service products with their own creation/management page at `/products/schemas`) and **Veranstaltungsprodukte** (the products actually used by the event-planning workflow). Both surfaces read the same underlying `mentorbooking_products` rows (the `service_products` view projects `product_page_id as page_id`), so the same product appeared twice under two different schema perspectives. The Website-Produkte flow was the wrong schema path and was unused.

The Website-Produkte UI is now removed. The remaining product workflow is: create a product → connect it to a schema (canonical Product page via `product_page_id`) → create events for the product → the event workflow generates the event pages.

## Files Added

- `specs/changes/2026-10-06-remove-website-products-ui.md` — this change record.

## Files Changed

- `src/pages/ProductCatalogue.tsx` — simplified to a single product list (event-planning products) with search, "Produkt anlegen", "Weitere Verwaltung" and the tenant custom-fields dialog; the Website-Produkte section, Website-Produkt anlegen button, service-product archiving and schema-preview affordances were removed.
- `src/pages/Products.tsx` — deleted. The dedicated Website-Produkte creation/management page is gone.
- `src/components/products/ProductSchemaPreview.tsx` — deleted; it was only used by the removed Website-Produkte surfaces.
- `src/utils/productSchemaDesign.ts` — deleted; only consumed by the removed schema preview.
- `src/services/productService.ts` — removed the now-unused frontend wrappers `listServiceProducts`, `createServiceProduct`, `changeServiceProductSchema`, and `deleteServiceProduct`; the remaining wrappers (`getServiceProductByPage`, `updateServiceProduct`, `setServiceProductPublication`, `archiveServiceProduct`) stay in use by the PageBuilder, SchemaContentEditor and PagesSchemaDetail.
- `src/App.tsx` — removed the `Products` route component; `/products/schemas` now redirects to `/products/manage`.
- `src/components/navigation/Breadcrumb.tsx` — removed the `/products/schemas` breadcrumb entry.
- `src/features/page-builder/PageBuilderPage.tsx` — error card no longer links to `/products/schemas`.
- `src/pages/PagesSchemaDetail.tsx` — the "Produkte öffnen" action for `service-product` schemas now opens `/products/manage`.
- `src/pages/VerwaltungAllProducts.tsx` — permission fallback and "Schemata bearbeiten" button no longer target `/products/schemas` (now `/products/manage` and `/pages`).
- `src/pages/VerwaltungCreateProduct.tsx` — permission fallback now targets `/products/manage`.
- `tests/productSchemaReassignment.test.mjs` — asserts the Website-Produkte overview is retired and `/products/schemas` redirects to `/products/manage`; aggregate PATCH route assertions unchanged.
- `tests/productSchemaDesign.test.mjs` — deleted together with the schema-preview utility it covered.
- `specs/features/service-products.md` — dashboard entry points describe the single product workflow and the retirement of the Website-Produkte UI.
- `specs/agents/product-catalogue-integration.md` — notes that the `/products/schemas` dashboard overview was retired while the PATCH schema-reassignment endpoint remains.

## Impact analysis

### Database

None. No migrations. The `service_products` projection, aggregate RPCs and the `product_page_id` relation are unchanged — the schema connection for products still exists and powers the event-page workflow.

### Runtime

- `/products/schemas` now redirects to `/products/manage`; old bookmarks keep working.
- The Products overview shows only event-planning products; duplicate presentation of the same product under two schema sections is gone.
- Product creation remains available via "Produkt anlegen" (`/products/manage/new`); schema connection happens through the product page relation, and events are created from the product detail/event workflow.

### API surface

No API changes. `POST /api/products`, `PATCH /api/products/:id/schema`, archive/publish endpoints and the `specy_products_*` MCP tools remain available for programmatic use; only the dashboard UI entry points were removed.

## Verification

- `npm run typecheck` — passed.
- `npm test` — passed.
- `npm run build` — to be run before commit (prebuild runs `ensure-registry.mjs`).
