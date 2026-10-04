# Product and Event Object UI integration

## Summary

Completed the first integrated Product/Event operator workflow around the existing Create Event form patterns. The Products landing page now lists schema-backed Website products and existing event-planning products together; product-related Events can be opened or created from either product editor; Event detail links back to the Product and its page editor. Product-specific Product/Event field definitions are editable with readable labels, types, optional help, required and public-display options. Workspace definitions can be imported into a Product explicitly rather than being copied to all Products. Price fields use decimal-string amounts and currency codes.

Implemented the corresponding generated Product Object source/read model so this UI has a live delivery destination: source Product/Event/page changes synchronize one read-only Object per Product transactionally. The existing friendly public Product URL now returns the canonical Object response shape. Ordinary Object authoring filters generated records, and direct attempts to edit generated Objects are rejected/redirected.

Static-page refresh feedback follows the existing Event editor pattern. Event updates refresh the Event route and affected old/new Product routes; Product field configuration and legacy Product edits refresh the published Product route. Dynamic Object reads reflect the committed database projection without requiring revalidation.

## Files Added

- `migrations/202610040004_product_scoped_fields_and_object_sources.sql` — per-Product Product/Event definitions, server-side custom-value validation, Product Object source identity and source immutability guard.
- `migrations/202610040005_product_object_projection.sql` — transactional Product Object projection functions/triggers, safe public allow-list, registration/publication gates and idempotent backfill.
- `src/components/products/ProductCustomFieldSchemaDialog.tsx` — Product-scoped field-definition editor and explicit import of existing workspace definitions.
- `src/components/products/ProductEventsPanel.tsx` — Product-related Event list and contextual Event creation.
- `src/pages/ProductCatalogue.tsx` — unified Product overview for schema-backed Website products and existing event-planning products.
- `src/services/productCustomFieldSchemaService.ts` — Product-scoped definition read/write adapter.

## Files Changed

- `scripts/lib/migration-order.mjs`, `specs/platform/unified-setup-tui.md` — register and classify the two new migrations.
- `api/lib/customFields.ts`, `api/lib/productAggregateService.ts`, `api/routes/products.ts`, `api/routes/objects.ts` — validate Product values, return Product field definitions to authorized aggregate editors, resolve the dynamic Product URL through its generated Object, and reject generic mirror edits.
- `src/App.tsx`, `src/pages/ProductCatalogue.tsx`, `src/pages/Products.tsx`, `src/pages/VerwaltungAllProducts.tsx` — unified Product entry point and clearer Website-product access.
- `src/features/page-builder/PageBuilderPage.tsx`, `SchemaContentEditor.tsx`, `src/pages/ProductDetail.tsx`, `src/pages/EventDetail.tsx`, `src/pages/EditEvent.tsx`, `src/pages/CreateEvent.tsx` — Product/Event links, field management and value forms, contextual creation, and related-page revalidation feedback.
- `src/components/events/EventForm.tsx`, `ProductForm.tsx`, `src/components/products/CustomFieldsEditor.tsx`, `CustomFieldsDisplay.tsx`, `TenantCustomFieldsDialog.tsx` — Product-specific definitions, typed price values and readable field sections.
- `src/services/events/productService.ts`, `src/services/productService.ts`, `src/services/tenantCustomFieldsService.ts`, `src/types/objects.ts`, `src/utils/tenantCustomFields.ts`, `src/pages/ObjectEditor.tsx`, `src/pages/Objects.tsx` — Product definition contracts, internal Object source marker, pricing validation, and read-only/filter behavior for generated Objects.
- `src/lib/apiCatalog.ts`, `specs/architecture/system-overview.md`, `specs/features/service-products.md`, `specs/features/event-catalogue.md`, `specs/agents/product-catalogue-integration.md`, `specs/agents/event-catalogue-integration.md` — public delivery contract and operator workflows.
- `tests/productEventCustomFields.test.mjs`, `tests/tenantCustomFields.test.mjs` — Object-backed alias, mirror migration contract and price validation coverage.

## Impact analysis

### Database

Adds `mentorbooking_products.custom_field_schema` with per-Product Product/Event definitions. Adds `objects.source_product_id` as an internal unique source relation, source immutability, custom-field validation triggers, synchronous mirror synchronization for Product/Event/Page/schema changes, and an idempotent Product mirror backfill. Existing workspace definitions and values are preserved and are not automatically fanned out; authorized users can explicitly import them into individual Products. **The migration has not been applied to a live database in this implementation session.** Production rollout requires a snapshot, real migration execution/rollback rehearsal, and tenant-persona/RLS verification.

### Runtime

The generated mirror contains Product presentation data, published eligible Event pages and operational schedule facts, plus only custom values marked public in that Product's definitions. Product/Event aggregates remain the source for edits. ObjectEditor routes generated records back to their Product; Object lists exclude them from ordinary authoring. Product and Event saves trigger best-effort revalidation for affected static routes while direct Object requests read the immediately synchronized data.

### API surface

`GET /api/objects/{objectSlug}` is the canonical dynamic Product/Event read contract. `GET /api/products/{workspaceSlug}/{productPageSlug}` is a friendly alias returning the identical Object envelope. Generic Object API update/archive rejects generated mirrors. Product/Event custom field definitions and values remain tenant-checked authenticated source data; only explicitly public fields enter the Object response. No new MCP tool family is added; existing `list_objects` and `get_object` expose the generated records through their ordinary Object contract.
