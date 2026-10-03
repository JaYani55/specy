# Event catalogue integration

## Status

The dashboard event-page workflow and public event-schema delivery are implemented. Event aggregate writes are not exposed through MCP or a dedicated REST mutation API in this slice; event creation/editing uses the authenticated dashboard and caller-scoped database operations.

## Setup and workflow

1. Select the tenant/workspace explicitly in the dashboard.
2. Create a tenant-owned `page-collection` schema with `entity_kind: "event"` and define the public event page content fields.
3. Register the frontend with the existing schema registration and target workflow. Registration alone does not prove that a static frontend can generate new detail routes; check the manifest's route capability.
4. Open **Create Event**, select a product from the active workspace, provide the scheduling details, and optionally choose an event catalogue. Selecting an event schema creates one event-owned draft page atomically and opens its canonical PageBuilder route.
5. Edit schema-defined presentation content in PageBuilder and explicitly publish the page. Event operational status and public page publication are separate states.
6. Fetch the public event collection or detail without credentials from the registered schema endpoint. Request only the named relations the frontend needs.

A product schema describes a reusable service offering. A scheduled occurrence uses an event schema and must not be inserted into the product schema. Event operational date/time/product facts remain on the event record; the page's developer-owned JSON remains unchanged and presentation-oriented.

## Public API includes

```text
GET /api/schemas/:apiSlug/pages?include=entity,event,product
GET /api/schemas/:apiSlug/pages/:pageSlug?include=entity,event,product
```

- `entity`: `{ kind: "event", id: "<event-uuid>" }`
- `event`: allow-listed `date`, `time`, `end_time`, `duration_minutes`, `mode`, and IANA `timezone`
- `product`: only an active product whose service-product page is registered and published; returns its opaque UUID, name, page slug, and `schema_api_slug`

Default page `content` is the stored JSON. Relations are an independent response envelope and never overwrite content keys. Draft/archived pages, unregistered schemas, unlinked records, and events without a valid timezone are not delivered publicly. Company/customer fields, meeting links, internal status, staff/account IDs, assignments, approval/request arrays, compensation, and private notes are excluded.

## Tenant and lifecycle safeguards

Authenticated writes run as the caller and remain subject to RLS. The event, selected product, event page, event schema, and any selected company must belong to the same workspace. Event pages are created, edited, and published through event-aware aggregate RPCs; ordinary page CRUD is not a supported writer. Event page deletion is restricted while linked; deleting an event removes its linked page transactionally.

Public page publication is explicit and independent of event scheduling status. Event schedule edits update the operational record, which is the public source of date/time facts; the PageBuilder does not copy those values into arbitrary page JSON. Dashboard revalidation is best-effort only; durable invalidation and static route generation guarantees are not implemented.

See [`../features/event-catalogue.md`](../features/event-catalogue.md) for the complete current contract and [`../platform/multi-tenancy.md`](../platform/multi-tenancy.md) for workspace ownership/RLS requirements.
