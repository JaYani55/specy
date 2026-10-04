# Dynamic product/event data and custom fields

## Summary

Added the public dynamic read URL `GET /api/products/{workspaceSlug}/{productSlug}`. The response groups data under `product` and nests its associated published events under `product.events`, joining page content with allow-listed operational schedule data. Workspace-defined custom JSON fields are persisted separately for products and events; only fields explicitly marked public are returned by the dynamic endpoint.

Added the Product Management **Eigene Felder** dialog with separate product/event definitions and type, label, required, and public-visibility settings. The legacy product form, schema-backed Product PageBuilder, and Create/Edit Event forms now render custom field editors beneath their standard fields; product and event details show saved values.

## Files Added

- `migrations/202610040003_product_event_custom_fields.sql` — workspace field-definition table, product/event custom JSON columns, view projection, and transactional aggregate operations.
- `api/lib/customFields.ts` — public custom-field allow-list projection.
- `src/services/tenantCustomFieldsService.ts`, `src/utils/tenantCustomFields.ts`, `src/utils/productApiSlug.ts` — workspace definitions, custom value validation, and URL slug generation.
- `src/components/products/TenantCustomFieldsDialog.tsx`, `CustomFieldsEditor.tsx`, `CustomFieldsDisplay.tsx` — field-definition modal, dynamic editors, and value display.
- `tests/productEventCustomFields.test.mjs`, `tests/tenantCustomFields.test.mjs` — public projection, URL slug, and field-value regression coverage.

## Files Changed

- `scripts/lib/migration-order.mjs`, `specs/platform/unified-setup-tui.md` — register and classify the new migration.
- `api/routes/products.ts`, `api/lib/productAggregateService.ts`, `api/lib/productAggregates.ts`, `api/routes/mcp.ts` — tenant-resolved public product/event delivery and schema-backed product custom-field updates.
- `src/lib/apiCatalog.ts` — document the dynamic public product endpoint.
- `src/pages/VerwaltungAllProducts.tsx`, `src/pages/Products.tsx`, `src/components/events/ProductManagementModal.tsx`, `src/components/events/ProductForm.tsx`, `src/services/events/productService.ts`, `src/components/products/types.ts` — configure and edit product custom values.
- `src/components/events/EventForm.tsx`, `src/pages/CreateEvent.tsx`, `src/pages/EditEvent.tsx`, `src/contexts/DataContext.tsx`, `src/types/event.ts`, `src/services/events/eventPageService.ts`, `api/lib/eventPageAggregates.ts` — load, create, and edit event custom values, including atomic public event-page creation.
- `src/features/page-builder/PageBuilderPage.tsx`, `SchemaContentEditor.tsx`, `src/pages/ProductDetail.tsx`, `src/pages/EventDetail.tsx` — edit/display service-product custom values, show saved product/event fields, and provide the public product JSON URL.
- `specs/agents/database-integration.md`, `specs/agents/event-catalogue-integration.md`, `specs/features/service-products.md`, `specs/features/event-catalogue.md` — document storage, public delivery, workspace scope, and visibility rules.

## Impact analysis

### Database

Adds JSONB custom-value columns to `mentorbooking_products` and `mentorbooking_events`, constrained to JSON objects with a 1 MiB limit. `tenant_custom_field_definitions` stores per-workspace product/event field contracts under RLS. A new event aggregate wrapper writes custom fields in the same transaction as event/page creation; service-product aggregate updates include custom fields in their expected-version transaction. The migration is registered but **was not applied to a live database**.

### Runtime

Custom fields are separate from schema-defined page content. Product and event editors render definitions for the active workspace, validate required/type constraints, and preserve custom values on edit. Custom field definitions identify which values may appear in the public read projection. The public product API resolves `workspaceSlug` from `tenants.slug` and requires a published page in a registered service-product schema. Nested events are limited to linked, published event pages in registered event schemas with valid timezones.

### API surface

`GET /api/products/:workspaceSlug/:productSlug` is public and returns `{ product: { ..., custom_fields, events: [...] } }`. It exposes published product content, safe standard product descriptions, allow-listed public custom fields, and published event-page content plus date/time/end-time/duration/timezone/mode. It omits compensation, company/customer records, staff IDs/assignments, meeting links, internal event status, approvals, and private custom fields. Authenticated product aggregate updates and event-page creation support custom JSON values; no new MCP collection family was added.
