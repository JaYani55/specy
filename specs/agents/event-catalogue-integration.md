# Event catalogue integration

## Status

The dashboard event-page workflow, authenticated Pages REST/MCP post/update operations, and public event-schema delivery are implemented. Event create/update uses the existing schema Pages entry tools/endpoints and dispatches to the same caller-scoped event aggregate service; there is no separate `specy_events_*` tool family.

## Setup and workflow

1. Select the tenant/workspace explicitly. Every event write requires `tenant_id` matching the event schema and product.
2. Create a tenant-owned `page-collection` schema with `entity_kind: "event"` and define the public event page content fields.
3. Register the frontend with the existing schema registration and target workflow. Registration alone does not prove that a static frontend can generate new detail routes; check the manifest's route capability.
4. Create an event through the dashboard or authenticated `POST /api/schemas/:apiSlug/pages` / MCP `specy_pages_schemas_create_page`. Include `tenant_id`, `expected_definition_revision`, page `name`/`content`, and an `event` object with operational `company`, date, time, duration, IANA timezone, and optional service-product UUID. The event and draft page are created atomically.
5. Edit schema-defined presentation content through PageBuilder or authenticated `PATCH /api/schemas/:apiSlug/pages/:pageId` / MCP `specy_pages_schemas_update_page`, passing tenant, expected schema revision, and expected page `updated_at` for event pages. Publish explicitly through that same update operation with `status: "published"`.
6. Fetch the public event collection or detail without credentials from the registered schema endpoint. The operational schedule projection is included by default; request `entity` or `product` when those relations are needed.

A product schema describes a reusable service offering. A scheduled occurrence uses an event schema and must not be inserted into the product schema. Event operational date/time/product facts remain on the event record; the page's developer-owned JSON remains unchanged and presentation-oriented.

## Pages post contract for agents

The event-aware page post tools accept the existing Pages fields plus operational event details. `status` is not an event scheduling field; event pages are always created as drafts.

REST example:

```http
POST /api/schemas/<event-api-slug>/pages
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "tenant_id": "<tenant-uuid>",
  "expected_definition_revision": 2,
  "name": "Workshop in Berlin",
  "content": { "headline": "Planning with your team" },
  "event": {
    "company": "Acme GmbH",
    "product_id": "<service-product-uuid>",
    "date": "2026-11-05",
    "time": "09:00",
    "duration_minutes": 90,
    "timezone": "Europe/Berlin",
    "mode": "online"
  }
}
```

The same fields are accepted by MCP `specy_pages_schemas_create_page` (or its `create_page` compatibility tool). `product_id`, when supplied, is the service-product UUID from the tenant-scoped product list, not the legacy integer event-FK value. Event page content/title/slug and publication use `specy_pages_schemas_update_page` with the tenant UUID, current schema `definition_revision`, and page `updated_at` returned by the latest page read. REST uses `PATCH /api/schemas/<event-api-slug>/pages/<page-uuid>` with those same concurrency fields. Updating operational schedule/product/company details through REST/MCP is not yet supported; use the dashboard event editor.

## Public API includes

```text
GET /api/schemas/:apiSlug/pages
GET /api/schemas/:apiSlug/pages/:pageSlug
GET /api/schemas/:apiSlug/pages?include=entity,event,product
GET /api/schemas/:apiSlug/pages/:pageSlug?include=entity,event,product
```

- With no `include` query, `relations.event` is returned by default with allow-listed `date`, `time`, `end_time`, `duration_minutes`, `mode`, and IANA `timezone`. Supplying `include` opts into the named relations only.
- `entity`: `{ kind: "event", id: "<event-uuid>" }`
- `event`: allow-listed `date`, `time`, `end_time`, `duration_minutes`, `mode`, and IANA `timezone`
- `product`: only an active product whose service-product page is registered and published; returns its opaque UUID, name, page slug, and `schema_api_slug`

Default page `content` is the stored JSON. Relations are an independent response envelope and never overwrite content keys. Draft/archived pages, unregistered schemas, unlinked records, and events without a valid timezone are not delivered publicly. Company/customer fields, meeting links, internal status, staff/account IDs, assignments, approval/request arrays, compensation, and private notes are excluded.

## Tenant and lifecycle safeguards

Authenticated writes run as the caller and remain subject to RLS. The event, selected product, event page, event schema, and any selected company must belong to the same workspace. Event pages are created, edited, and published through event-aware aggregate RPCs; ordinary page CRUD is not a supported writer. Event page deletion is restricted while linked; deleting an event removes its linked page transactionally.

Public page publication is explicit and independent of event scheduling status. Event schedule edits update the operational record, which is the public source of date/time facts; the PageBuilder does not copy those values into arbitrary page JSON. Dashboard revalidation is best-effort only; durable invalidation and static route generation guarantees are not implemented.

See [`../features/event-catalogue.md`](../features/event-catalogue.md) for the complete current contract and [`../platform/multi-tenancy.md`](../platform/multi-tenancy.md) for workspace ownership/RLS requirements. Event creation always returns a draft page; explicit publication is a separate operation.
