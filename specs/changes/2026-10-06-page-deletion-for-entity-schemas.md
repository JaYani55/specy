# Page deletion for product and event schemas

## Summary

The schema page list only offered **Löschen** for ordinary `page` schemas; pages in product and event schemas could only be archived. Because event deletion removes only the `mentorbooking_events` row, its page stayed behind as an orphan — and orphan pages blocked the explicit schema-purpose reclassification. Deleting pages is now available for every schema purpose with kind-aware cascade semantics.

## Files Added

- `specs/changes/2026-10-06-page-deletion-for-entity-schemas.md` — this change record.

## Files Changed

- `src/pages/PagesSchemaDetail.tsx` — the Delete action is available for every schema kind. Kind-aware behavior:
  - `page` schemas: direct page deletion (unchanged).
  - `event` schemas: if the page is linked to an event, the linked event is deleted first (requires the delete-events permission), then the page; unlinked orphan pages are removed directly.
  - `service-product` schemas: if the page is a product's canonical page, the product aggregate is deleted through `DELETE /api/products/:id` (product, its events, event pages, archive history, canonical page and generated Object); unlinked pages are removed directly.
  - The confirmation dialog text states the concrete consequences per schema kind.
- `src/services/productService.ts` — re-added the `deleteServiceProduct` wrapper used by the schema page list for canonical product pages.

## Impact analysis

### Database

None. The existing foreign keys (`mentorbooking_events.page_id`, `mentorbooking_products.product_page_id`, both `ON DELETE RESTRICT`) remain the final authority; the UI now resolves the linked aggregate before deleting instead of failing the FK.

### Runtime

- Operators can clean up orphan event pages (for example after an event was deleted) which previously blocked schema reclassification.
- Deleting an event-linked page also deletes the event; deleting a canonical product page deletes the whole product aggregate. Both cases require an explicit confirmation and the matching permission.

### API surface

No changes; the existing `DELETE /api/products/:id` aggregate endpoint is used from the schema page list.

## Verification

- `npm run typecheck` — passed.
- `npm test` — passed (412 tests).
