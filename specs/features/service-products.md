# Service products

## Status and scope

The service-product foundation uses one product row and one canonical `pages` row per aggregate. It reuses the historical product table as a compatibility backing store; new code sees the neutral `service_products` projection and UUID `id`. The legacy integer ID remains internal for existing event FKs and is not part of the new MCP/REST DTO.

Implemented: tenant-scoped list/get/create/update/publish/unpublish/archive; schema-driven page editing; revision-checked saves; idempotent create; product-only public page delivery. Not implemented: staff/team relations, sale pricing/money, customer CRM, event occurrences, outbox/cache-purge guarantees, and migration/backfill of legacy products.

## Dashboard entry points

`/products/manage` is the standard product overview and retains the established event-product management experience for legacy `mentorbooking_products` records. `/products` redirects to this overview. The overview includes an **Edit schemas** button to `/products/schemas`, the separate schema-backed service-product list and editor. `/products/manage/new` creates through the legacy form, and `/products/manage/:productId` shows its legacy detail/edit interface.

Schema-backed product entries open the PageBuilder at the canonical schema/page route. The old `/pagebuilder/:legacyProductId` URL now resolves a linked schema and redirects there; the fixed-layout legacy editor is limited to schema-less historical page content. See [`page-builder.md`](page-builder.md) for the editor hierarchy and compatibility behavior.

The legacy and schema-backed experiences remain separate compatibility paths: existing legacy products are not automatically converted into schema-backed aggregates, and opening the schema workflow does not migrate data. Legacy `/admin/all-products`, `/admin/create-product`, and `/admin/product/:productId` URLs redirect to their `/products/manage` equivalents. Product management links have been removed from the Administration landing page; the main Products navigation opens the standard product overview.

Schema definition and frontend registration remain technical-administrator/developer responsibilities. Product content managers use the schema-backed workflow only after an eligible catalogue has been set up.

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

`?include=entity` is an allow-listed optional relation. It adds only:

```json
{"relations":{"entity":{"kind":"service-product","id":"<product-uuid>"}}}
```

The relation envelope never reserves or modifies a `pages.content` key. Other includes are rejected. Customer, staff, operational, compensation, account, and legacy product fields are never part of public product delivery.

The schema-driven dashboard editor calls the existing registered-frontend revalidation path after published product edits/publication. The REST/MCP aggregate adapters do not yet write a durable invalidation outbox or guarantee cache purge/rebuild; external/agent consumers must account for their own refresh until that planned reliability phase ships.

## Rollout boundary

This is an additive compatibility slice, not a legacy conversion. Existing product IDs, event references, and legacy columns remain. Existing rows are not auto-classified, attached to new schemas, or transformed. Before production rollout, complete the plan's snapshot-backed inventory and RLS/constraint/rollback rehearsal. In particular, verify duplicate page links, historical FK/policy/grant definitions, and event/archive references against the live database.
