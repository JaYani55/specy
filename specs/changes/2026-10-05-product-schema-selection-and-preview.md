# Product schema selection and preview

## Summary

Website product creation and schema assignment now happen on `/products/schemas`. The Products overview links directly to this page and opens its creation form, where the operator selects an existing eligible Product schema in the active workspace. The form previews the selected schema's fields and connected frontend targets before creating the Product Page. Product lists identify the schema each Website product uses and provide the same schema-design preview.

The preview describes the content contract and configured frontend routes; it does not attempt to render the external website's visual design.

## Files Added

- `src/components/products/ProductSchemaPreview.tsx` — reusable schema and frontend-target preview dialog.
- `src/utils/productSchemaDesign.ts` — safe schema field outline helper.
- `tests/productSchemaDesign.test.mjs` — field, nested-structure, enum, and malformed-definition coverage.
- `specs/changes/2026-10-05-product-schema-selection-and-preview.md` — this change record.

## Files Changed

- `src/pages/ProductCatalogue.tsx` — routes Website-product creation to `/products/schemas` and retains associated schema previews in the overview.
- `src/pages/Products.tsx` — eligible schema selection and preview in the creation dialog; supports opening the creation dialog from the overview link; schema/design preview beside each listed Product's associated schema.
- `specs/features/service-products.md` — documents schema selection and the content-schema versus website-visual-design boundary.

## Impact analysis

### Database

None. No migrations or data changes. Product creation continues to use the existing tenant-scoped aggregate endpoint and its schema revision check.

### Runtime

Website Products are created from `/products/schemas` with a selected same-workspace `service-product` `page-collection` schema. The unified Products overview routes the user directly into that schema-selection flow. The Product Page is created under that schema and opens in the canonical PageBuilder. The schema preview displays field requirements, nested structures, descriptions, choices, and configured frontend targets.

### API surface

None. Uses the existing `POST /api/products` aggregate contract. Only eligible Product schemas are selectable; ordinary Page schemas are not reclassified implicitly.

## Verification

- `npm run typecheck` — passed.
- `npm test` — passed (409 tests).
- `npm run build` — passed. Existing dynamic-import and bundle-size warnings remain.
- `npm run dev` smoke check — `/products/manage`, `/products/schemas?create=1`, and the transformed ProductCatalogue, Products, and schema-preview modules returned HTTP 200. An authenticated browser interaction was not available.
