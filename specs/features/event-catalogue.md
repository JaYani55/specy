# Event catalogue pages

## Status and scope

The focused event-page integration is implemented in core. An operational event may optionally own one public page in a tenant-owned `event` page-collection schema. The page is a separate event occurrence page; it is never created in the selected service product's schema.

This is not the broader event/staff/CRM rebuild. Existing scheduling events and legacy integer product references remain. Event create/update through the entity-aware Pages REST/MCP post/update operations is supported; separate `specy_events_*` collection tools, recurrence, booking/ticketing, staff public profiles, CRM changes, backfill, and durable invalidation are out of scope.

## Dashboard flow

- `/create-event` retains the current product, staff, company, date/time, and scheduling fields. The product selector uses only products from the active workspace.
- **Public event page** is optional. The schema picker shows only event-classified `page-collection` schemas owned by the active workspace. Without a selection, event creation remains private and creates no page.
- Event creation can be opened from a Product's related-events panel. The form starts with that Product selected and, when no public page is created, returns to the originating Product view. A public page still opens in the PageBuilder after creation.
- With a schema selected, the dashboard asks for a public page title and event timezone. The timezone defaults to the browser's IANA timezone but is displayed for the operator to confirm/change; it is not silently treated as UTC.
- The event and its canonical `pages` record are created atomically via `create_event_page_aggregate`. The new page is a draft and the dashboard opens it in the canonical PageBuilder route.
- `pages.content` contains developer-defined presentation/editorial content. Operational date, time, duration, mode, product selection, and scheduling data stay on `mentorbooking_events`.
- The PageBuilder edits page name, slug, and schema content through event-specific aggregate RPCs. Its top-level content-template controls can save a reusable template for this schema and load one onto another event page; templates copy page content only, never the event title, slug, publication state, or operational schedule. Publication is explicit and independent of the event's operational scheduling status. Event edits retain the page link; public schedule data is resolved from the event row rather than copied into page JSON.
- Event detail/edit screens link back to the public page editor and associated Product. Event custom values appear under **Weitere Veranstaltungsangaben** and remain separate from event page content. For Product-associated Events, available fields are defined by that Product and stored in `mentorbooking_events.custom_fields`; for Events without a Product, legacy workspace-wide definitions remain a compatibility fallback. Deleting an event removes its linked page in the same caller-scoped transaction; deleting a linked page directly is restricted.

Event page creation currently happens when creating a new event. Converting/attaching a page to an existing legacy event is not included in this MVP.

## Tenant and database invariants

The additive migration [`../../migrations/202610030001_event_page_aggregates.sql`](../../migrations/202610030001_event_page_aggregates.sql) adds nullable `mentorbooking_events.page_id` and `timezone` fields. Existing events remain unchanged and may have no page/timezone.

Database constraints/triggers and `SECURITY INVOKER` operations enforce:

- one event per page and at most one page per event;
- event, event page, event schema, selected product, and selected company belonging to the same tenant;
- event pages using tenant-owned `event` page-collection schemas;
- no page shared between an event and product;
- no generic direct event-page writes (the dedicated aggregate operation sets a transaction-local write guard);
- page delete restriction while linked and transactional page cleanup on event deletion; and
- an IANA timezone for public event pages.

The app's legacy product service now requires an explicit tenant for list/get/create/update operations. Product lists and detail/product selectors scope to the active workspace and clear/reload when it changes. Database RLS remains authoritative; UI filters do not replace it.

## Content and publication operations

- `create_event_page_aggregate` creates the event and draft page in one transaction under the caller's RLS identity. It checks the event schema's current `definition_revision` and validates all tenant/entity links.
- `update_event_page_aggregate` saves the page content through an expected schema revision and expected page `updated_at` concurrency token. Content uses the same recursive schema validator as service products.
- `set_event_page_publication` publishes, unpublishes, or archives the page. Publishing validates required schema fields and timezone. The operational event status is not changed by page publication.
- The dashboard uses `src/services/events/eventPageService.ts`. Repeated occurrences may share the same product; public page slugs are occurrence-specific (title + date + time). Product editors list related Events and link to their Event detail views; Event detail provides a tenant-scoped link back to Product management when permitted. Authenticated REST `POST/PATCH /api/schemas/:apiSlug/pages` and MCP `specy_pages_schemas_create_page` / `specy_pages_schemas_update_page` dispatch event-classified schemas to the same event aggregate service. Pages PATCH updates event-page content and publication; operational schedule edits remain dashboard-only. No separate event collection API/tool family exists.

A registered event schema can be edited in the existing Schema Editor. The event page itself uses the existing schema-driven PageBuilder, not generic page CRUD. Generic page create/update tools remain disallowed for classified schemas.

## Public delivery contract

Registered event schemas use the existing public schema-scoped endpoints:

- `GET /api/schemas/:apiSlug/pages`
- `GET /api/schemas/:apiSlug/pages/:pageSlug`

Only published pages that resolve to a same-tenant event with a valid timezone are returned. The stored `content` JSON is unchanged. Named includes are allow-listed:

- `?include=entity` adds `{ kind: "event", id: "<event-uuid>" }`.
- `?include=event` adds `relations.event` with `date`, `time`, `end_time`, `duration_minutes`, `mode`, and `timezone`.
- `?include=product` adds a product's UUID, name, slug, and `schema_api_slug` only when the selected product is active and its page belongs to a registered service-product schema and is published.
- Includes can be combined, for example `?include=entity,event,product`.

Public delivery never returns company/customer data, Teams/meeting URLs, internal event status, staff/account IDs, staff assignments, request/approval arrays, compensation, or private notes. The generated Product Object exposes published linked occurrences in `data.events[]`, with allow-listed schedule facts and only Event fields marked public in that Product's field definitions. Product custom fields appear in `data.product.custom_fields`; private/undefined fields and internal event fields remain excluded. `GET /api/products/:workspaceSlug/:productSlug` is a friendly alias returning the same Object envelope as `GET /api/objects/{objectSlug}`. With no `include` query, the schema-scoped API's allow-listed operational schedule is returned as `relations.event` by default so frontends can sort and render occurrences without copying schedule facts into page content. An explicit `include` query returns only its requested relations. Event scheduling state does not implicitly publish or unpublish a page.

The public Worker uses a privileged read client only for this narrow, published, allow-listed projection. Anonymous callers cannot read drafts or perform writes.

## Revalidation and deployment limits

PageBuilder save/publication uses the existing frontend revalidation path. Editing schedule/product details in `EditEvent` triggers best-effort revalidation for a published event page. Failed requests show a concise status with target, HTTP status, path, and upstream response details behind a disclosure; event data remains saved if only revalidation fails. There is no durable invalidation outbox/retry guarantee in this slice. The frontend manifest continues to report `supports_new_routes: null`; registration does not prove a static frontend can create new detail routes without a rebuild.

## Implementation files

- `src/pages/CreateEvent.tsx`, `src/pages/EditEvent.tsx`, `src/components/events/EventForm.tsx` — event creation/editing, optional event schema selection, time zone, and editor links.
- `src/services/events/eventPageService.ts`, `src/utils/eventPage.ts` — caller-scoped RPC adapters and IANA timezone/slug helpers.
- `src/features/page-builder/PageBuilderPage.tsx`, `SchemaContentEditor.tsx`, `PageContentTemplateControls.tsx`, `src/services/pageContentTemplateService.ts`, `src/pages/PagesSchemaDetail.tsx` — event page loading/editing/publication, schema-scoped page content templates, and collapsed revalidation diagnostics.
- `api/lib/eventPageAggregates.ts`, `api/lib/publicEntityProjection.ts`, `api/routes/schemas.ts`, `api/routes/mcp.ts`, `api/lib/frontendManifest.ts`, `src/lib/apiCatalog.ts` — entity-aware Pages post/update REST/MCP operations, event/product allow-listed public projections, and discovery metadata.
- `migrations/202610030001_event_page_aggregates.sql` — tenant link constraints, write guards, aggregate RPCs, timezone validation, and page lifecycle behavior.
- `migrations/202610040002_page_content_templates.sql` — schema-scoped content-template storage, tenant/owner policies, schema ownership validation, and content limits.
- `migrations/202610040003_product_event_custom_fields.sql` — compatibility workspace field definitions, Product/Event JSONB values and aggregate operations.
- `migrations/202610040004_product_scoped_fields_and_object_sources.sql` — per-Product Product/Event field definitions and generated Object source protection.
- `migrations/202610040005_product_object_projection.sql` — transactional Product Object synchronization and reviewed legacy Product backfill.

## Rollout boundary

The migration is registered in `scripts/lib/migration-order.mjs`, but it has not been applied or tested against the configured live database in this implementation session. Production rollout still requires the multi-tenancy guide's snapshot-backed ownership/RLS review and real two-tenant persona tests. Existing product/event row ownership was not inferred or backfilled. See [`../plans/Event-Integration.md`](../plans/Event-Integration.md) and [`../platform/multi-tenancy.md`](../platform/multi-tenancy.md).
