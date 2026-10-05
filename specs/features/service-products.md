# Service products

## Status and scope

The service-product foundation uses one product row and one canonical `pages` row per aggregate. It reuses the historical product table as a compatibility backing store; new code sees the neutral `service_products` projection and UUID `id`. The legacy integer ID remains internal for existing event FKs and is not part of the new MCP/REST DTO.

Implemented: tenant-scoped list/get/create/update/publish/unpublish/archive; schema-driven page editing; revision-checked saves; idempotent create; product-only public page delivery; active-workspace scoping in legacy product dashboard reads. A focused optional event-page workflow is documented in [`event-catalogue.md`](event-catalogue.md). Not implemented: staff/team relations, customer CRM, a separate event collection API/tool family, durable outbox/cache-purge guarantees, and conversion of historical legacy products into schema-backed Product/page aggregates. Generated Object mirrors are backfilled by the new migration for existing Product rows, subject to migration rollout.

## Dashboard entry points

`/products/manage` is the unified Products overview. It lists schema-backed Website products and existing event-planning products in one workspace-scoped searchable page, with separate sections and clear actions. **Website-Produkt anlegen** opens the schema-backed product workflow; **Veranstaltungsprodukt anlegen** uses the compatible legacy form. `/products` redirects to this overview. `/products/schemas` remains the focused catalogue/editor list, `/products/manage/legacy` retains the previous full legacy management view, and `/products/manage/:productId` opens a legacy Product detail/editor.

Schema-backed product and event entries open the PageBuilder at the canonical schema/page route. Event pages are created from the event workflow and use a separate `event` schema; an event occurrence is never placed in its selected product's schema. The Product PageBuilder includes a related-events panel and can open event creation with that Product selected. The legacy Product detail view also lists its related Events and provides the same shortcut. Event detail links back to the associated Product when the caller may view Product management. These links use the existing tenant-scoped Event/Product relation; they do not expose legacy IDs as public identifiers. The old `/pagebuilder/:legacyProductId` URL now resolves a linked schema and redirects there; the fixed-layout legacy editor is limited to schema-less historical product page content. See [`page-builder.md`](page-builder.md) and [`event-catalogue.md`](event-catalogue.md) for the editor hierarchy and event contract.

The legacy and schema-backed experiences remain separate compatibility paths: existing legacy products are not automatically converted into schema-backed aggregates, and opening the schema workflow does not migrate data. Legacy `/admin/all-products`, `/admin/create-product`, and `/admin/product/:productId` URLs redirect to their `/products/manage` equivalents. Product management links have been removed from the Administration landing page; the main Products navigation opens the standard product overview.

Schema definition and frontend registration remain technical-administrator/developer responsibilities. Product content managers use the schema-backed workflow only after an eligible catalogue has been set up.

Product-specific **Eigene Angaben verwalten** is available from Product editing/details and the schema-backed Product PageBuilder. Each Product owns separate Product and Event field definitions. Definitions include a generated key, label, type (`string`, `number`, `boolean`, `date`, `url`, `email`, `json`, or `price`), optional help, required flag and opt-in public visibility. The Event form loads Event definitions from its selected Product; switching Products preserves values not currently defined rather than deleting them. Values remain separate from page `content` and are stored in `mentorbooking_products.custom_fields` or `mentorbooking_events.custom_fields`. Older workspace-wide definitions are available to import into a Product's definition; they are not automatically copied to every Product. For Events without a Product, workspace-wide legacy Event definitions remain a compatibility fallback.

The legacy product form remains the standard event-product overview. Its product-card/menu color is optional and purely presentational; omitting it uses the menu's default styling. The staffing requirement control is labelled for staff in both supported dashboard languages. Validation failures show an error toast as well as inline field feedback. These wording and styling changes do not alter the legacy data model.

## Schema eligibility

A product catalogue is a tenant-owned `page-collection` schema with `entity_kind = service-product`. The schema JSON defines one product entry's presentation contract. `pages.content` is arbitrary developer-owned JSON and remains separate from operational product identity/status.

Generic page create/update is rejected for this classification. Database constraint-trigger checks also prevent a product-schema page from committing without a same-tenant product row. Product/editor entry points use aggregate operations.

## Aggregate identity and operations

New aggregate IDs are opaque UUIDs (`integration_id`). The historical integer row ID is retained only for old database relationships. The `version` is a business aggregate version, separate from `definition_revision` on its schema. A save that changes product name, page slug, or content is one transactional operation and advances the aggregate version. Create/update/publish lock and check both revisions; stale versions conflict.

### REST

Authenticated routes use the caller JWT and RLS:

- `GET /api/products?tenant_id=<uuid>` — active products in exactly one workspace.
- `GET /api/products/:id?tenant_id=<uuid>` — one aggregate and its page.
- `GET /api/products/by-page/:pageId?tenant_id=<uuid>` — resolve the aggregate for the canonical editor route.
- `POST /api/products` — create a draft product/page atomically. Requires `tenant_id`, `schema_id`, `expected_definition_revision`, `name`, JSON `content`, and a UUID `idempotency_key`. Replaying the same key and payload returns the same aggregate; changing the payload for a used key conflicts.
- `PATCH /api/products/:id` — atomically update `name`, `slug`, and/or full `content`; requires `tenant_id`, `expected_version`, and `expected_definition_revision`.
- `POST /api/products/:id/publish` — explicit `draft`/`published` transition with expected product/schema versions and content validation.
- `POST /api/products/:id/archive` — atomically mark the business row retired and page archived.

Draft aggregate creation accepts incomplete content so an editor can open a new entry. Content replacements and publication validate the current schema's required fields, types, nullable values, enums, numeric/array constraints, and JSON limits. Unknown content keys are allowed and preserved. Payloads are bounded to 1 MiB, nesting to 32 levels, and arrays to 1,000 items. Product/public DTOs omit compensation, legacy approval/group arrays, auth account IDs, and private notes.

### MCP

Authenticated MCP tools share the REST aggregate services:

- `specy_products_list`
- `specy_products_create`
- `specy_products_get`
- `specy_products_update`
- `specy_products_publish`
- `specy_products_archive`

Every tool requires an explicit `tenant_id`; the browser's active workspace is not an MCP tenant selector. Create accepts the stable schema UUID, `expected_definition_revision`, and a caller-supplied or generated idempotency key. Updates/publication require both aggregate `expected_version` and schema `expected_definition_revision`. Generic `specy_pages_schemas_create_page/update_page` cannot create or mutate product pages.

## Public frontend delivery

Registered service-product schemas use the schema-scoped published pages endpoints. Product pages appear only when `status = published`, a non-retired product aggregate owns the page in the same tenant, and the schema is registered. Product retirement atomically archives the page. The stored content is unchanged.

Each Product has one generated, read-only Object projection synchronized in the same database transaction as Product, Event, Page-publication, and schema-registration changes. The canonical dynamic read is `GET /api/objects/{objectSlug}`; the friendly `GET /api/products/:workspaceSlug/:productSlug` resolves the same Product mirror and returns the identical Object envelope (`schema` and `data`). `data.product` and `data.events` contain operational/descriptive Object values and Page references (`page_id`/`slug`), not copied `pages.content`. Pages remain the editorial and revalidation transport; Objects are the dynamic Product/Event data stream. Nested Events contain current schedule, registration, capacity, and public custom-field values from operational rows. Anonymous delivery is enabled only for a published Product page in a registered service-product schema. Nested Events require published pages in registered event schemas, the same workspace/Product, and a valid IANA timezone. Direct Object reads reflect committed database changes without relying on static-page revalidation.

### Object Datastreams dashboard

The Objects navigation contains a **Datastreams** submenu at `/objects/datastreams`. It inventories every Object visible to the active workspace, including generated Product Objects that are intentionally hidden from the manual Object Editor list. Each entry shows source kind, API configuration flags, canonical endpoint, and a lightweight anonymous `HEAD` check. A configured-public Object returning 404 is flagged as an availability mismatch; auth-required, disabled, and archived Objects are shown as non-public rather than omitted. The inventory endpoint is authenticated and RLS-scoped; it does not return Object payloads or internal Product database IDs.

The access dialog reuses the Object Editor's API-enabled/JWT-required controls. Manual Objects update their Object row. Generated Product Objects save these preferences on the Product source; effective availability remains gated by a published Product Page in a registered `service-product` schema. If that gate is closed, the dialog explains whether the Page is missing/unpublished or its schema is not registered. The toggle cannot bypass Product publication policy.

Product/Event `custom_fields` are projected from the selected Product's definitions and include only keys marked public. Private/undefined custom fields, compensation, approval IDs, customer/company data, meeting links, staff IDs and internal scheduler status are excluded from the generated Object. `price` values use `{ "amount": "125.00", "currency": "EUR" }`; amounts are decimal strings rather than floating-point numbers. Public event occurrences also expose structured `registration_status`, `participant_min`, and `participant_max` fields; these are distinct from scheduler status and `required_staff_count`.

`?include=entity` is an allow-listed optional relation. It adds only:

```json
{"relations":{"entity":{"kind":"service-product","id":"<product-uuid>"}}}
```

The relation envelope never reserves or modifies a `pages.content` key. Other includes are rejected. Customer, staff, operational, compensation, account, and legacy product fields are never part of public product delivery.

The schema-driven dashboard editor calls the existing registered-frontend revalidation path after published product edits/publication. The REST/MCP aggregate adapters do not yet write a durable invalidation outbox or guarantee cache purge/rebuild; external/agent consumers must account for their own refresh until that planned reliability phase ships.

## Rollout boundary

This is an additive compatibility slice, not a legacy conversion. Existing product IDs, event references, and legacy columns remain. Existing rows are not auto-classified, attached to new schemas, or transformed. Migrations through `202610040006_product_event_dynamic_data_contract.sql` are reported deployed and tested. Follow-up migrations `202610040007_product_object_api_access.sql` and `202610050001_backfill_event_registration_capacity.sql` require their own rollout. Verify Product Object access preferences/publication gates and the legacy Event registration/capacity backfill on the deployed database.
