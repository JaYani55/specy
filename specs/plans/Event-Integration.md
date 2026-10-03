# Event integration — focused implementation plan

**Status:** Focused MVP implementation is complete in core. The registered migration has not been applied or verified against the live database; production tenant/data/RLS review remains required.  
**Relationship to the broader plan:** This is a customer-focused slice of [`PRODUCT-INTEGRATION.md`](PRODUCT-INTEGRATION.md), not completion of its staff, CRM, event rebuild, or legacy-migration scope.

## 1. Goal and recommendation

Allow an authorized tenant user to create an operational event, select an existing product, enter the event's date/time and other current event details, and optionally give that event a page in the tenant's public frontend. Keep the existing event workflow working for private events that do not need a public page.

**Do not create event occurrences in the selected product's schema.** A product schema describes one reusable service offering; an event is one scheduled occurrence of that offering. The product schema/page relationship also requires a service-product aggregate to own each page. Putting an event page there would mix two entity types, apply the wrong content validation, and violate the product/page ownership contract.

Instead:

- Keep the selected product association on the operational event.
- When public presentation is requested, create **one page per event** in a tenant-owned `page-collection` schema classified as `entity_kind = 'event'`.
- Link that event page to the existing operational event. The page belongs to the event schema, not the product schema.
- Keep the page draft until someone explicitly publishes it. Event scheduling status (for example `new` or `locked`) is not page publication status.
- Keep operational date/time and event facts in the event record as the source of truth. Use `pages.content` for schema-defined presentation/editorial content. Public delivery should expose an allow-listed event projection from the event record so schedule edits do not require copying the same date/time into page JSON.
- Let the frontend associate an event with its product through an explicit, tenant-checked, public product reference. Only expose a product relation when it is safe to expose that product; never expose a legacy integer ID or private product fields as the public identity.

This fits the existing schema/PageBuilder architecture and can grow later into a full event catalogue without treating the product content schema as a generic event store.

## 2. What exists today

### Create flow

`src/pages/CreateEvent.tsx` still creates private events directly through the caller's Supabase client, with explicit tenant and owner values. When an event schema is selected, it instead calls `createPublicEventPage()` and the database creates the event and draft page atomically. Both paths retain the selected product's **legacy integer** `product_id`, current scheduling fields, and the after-create hook/refetch behavior. Public-page creation opens the canonical PageBuilder route.

`src/components/events/EventForm.tsx` retains its product, staff, company, date/time/duration, and additional-info sections and now includes an optional active-tenant event-schema selector, public page title, and visible IANA timezone. Product and company pickers are scoped to the active workspace. The event schema selection is optional, so private event creation remains available.

### Edit flow and storage

`src/pages/EditEvent.tsx` continues to update operational event fields directly with an explicit active-tenant predicate; database triggers reject cross-tenant product/company references. Linked public pages are resolved in the same tenant, can be opened in PageBuilder, and have their confirmed timezone preserved/updated. Published schedule changes call the existing best-effort frontend revalidation path.

`migrations/mentorbooking_events.sql` defines the existing event UUID and operational fields; the additive `202610030001_event_page_aggregates.sql` now adds nullable `page_id` and `timezone` columns, unique/restrictive event-page ownership, tenant checks, and aggregate RPCs. Existing date/time strings are retained. The page's name is the public page title; the legacy required `company` field is not used as public title.

### Schema and public delivery boundary

Schema metadata already supports `entity_kind = 'event'`, and event schemas are required to be tenant-owned page collections. The PageBuilder now resolves event pages through `getEventPageAggregateByPage`; event saves/publication use event-aware RPCs. Generic page create/update does not write event schemas directly. The existing Pages post/update MCP tools and matching authenticated REST endpoints now dispatch event schemas through the event aggregate. `api/routes/schemas.ts` delivers registered published event pages with allow-listed `entity`, `event`, and optional published-product includes. A separate event collection tool family remains deferred.

The service-product implementation remains a pattern for transactions, revisions, validation, and safe public projection; event operations use event records and event authorization rather than product aggregate operations.

### Product/workspace isolation is a prerequisite

The multi-tenancy contract in [`../platform/multi-tenancy.md`](../platform/multi-tenancy.md) already gives `mentorbooking_products` a `tenant_id`, tenant ownership, and RLS. It also states that products are not globally shared and that workspace selectors must make tenant assignment meaningful. However, RLS does not automatically apply the dashboard's currently selected workspace as a query filter: a caller who belongs to multiple tenants, and especially a `super-admin` with platform-wide visibility, can be authorized to read rows across those tenants.

The legacy product client has been changed so product list/get/create/update operations require an explicit tenant scope and missing list/get scope fails closed. The product overview and reloads now use the active tenant and reload/reset on workspace changes; combobox, detail, and related company/group reads are scoped as well. The event-page RPCs revalidate selected event schema, page, product, and company ownership in the database. This closes the identified **code-path** leak before enabling event/product integration; row-level ownership still needs the live audit below.

Treat the reported cross-workspace product visibility as a **blocking tenancy defect**, not as an expected event-page behavior. Implementation has closed the unscoped client-query paths, but production ownership/RLS verification remains pending:

- Make an active tenant mandatory for normal dashboard product list/get/create/update operations. Missing tenant context returns an empty/unavailable state or an error; it must never mean “all visible products.” Keep any deliberate platform-wide admin view separate and explicit.
- Apply an explicit `.eq('tenant_id', activeTenantId)` filter on product reads in all lists, selectors, detail views, and post-mutation reloads. Reload/clear local state when the active workspace changes; retain tenant-qualified query keys so cached data from one workspace cannot render in another.
- Require tenant context in legacy product service methods instead of making it optional. Writes must include/validate that tenant. RLS remains the authorization boundary; client filters are not a substitute for RLS.
- Verify ownership for existing product rows with missing or unexpected `tenant_id`. Do not bulk-assign rows based only on the currently selected workspace. Resolve ambiguous legacy ownership through a reviewed audit, consistent with the production guidance in the multi-tenancy specification.
- Validate the selected event product and event schema/page against the same authoritative tenant in the event aggregate/database operation. A selector filter alone is not sufficient.

## 3. Proposed MVP user flow

1. A user creates an event using only products from the currently selected workspace; changing workspace refreshes the list and selector and does not retain stale products from the prior tenant.
2. An optional **Public event page** control is available only when the active tenant has an eligible event schema. Choosing no schema leaves the event private and preserves the current result.
3. If a schema is selected, create the event and its linked **draft** page as one aggregate operation. The page starts with its schema-compatible content (an empty object is acceptable for draft creation) and gets a page name/slug. Do not publish automatically just because the scheduling event was created.
4. Open the linked page in the canonical schema PageBuilder route. Reuse the current schema-driven editor for the event page's presentation content, but use an event-aware save/publication adapter rather than generic page writes.
5. The user explicitly publishes the event page when ready. Page publication controls public visibility; the event's scheduling status remains independent.
6. On event edits, update operational details through the existing event edit flow/service. Public event data is read from the event record, so date/time/product changes are reflected without rewriting page content. A separate page action opens the linked page for editorial changes or unpublishing.

Private events remain valid without an event schema or page. A product can have many event occurrences; each occurrence may have zero or one public event page.

## 4. High-level implementation steps

### Step 0 — close the existing product tenant-isolation gap (release blocker)

Implemented client-side product workspace scoping in `src/services/events/productService.ts`, `src/pages/VerwaltungAllProducts.tsx`, `src/components/events/ProductCombobox.tsx`, `src/pages/ProductDetail.tsx`, event product lookups, and product group/company selectors. `DataContext`'s tenant-qualified query remains the reference. The database event migration validates same-tenant product/company/schema/page relations.

The required two-workspace UI and live JWT/RLS matrix has not been run because no safe staging database/browser persona was available. Before production rollout, test two workspaces with distinct products and a user who belongs to both; switching the active workspace must show only that workspace's products. Missing workspace must fail closed. Also test direct cross-tenant service/RPC attempts and `super-admin`: global platform visibility must not turn the normal active-workspace product UI into a global list.

### Step 1 — settle the small set of contract decisions

Before coding, confirm:

- Public event pages are optional and draft by default.
- Which existing event fields are safe for public delivery. The initial projection should exclude company/customer data, Teams links, internal scheduling status, staff/account IDs, approval/request arrays, and internal notes.
- Whether event display title is `pages.name` for the initial slice or whether a dedicated operational event title is required immediately. Do not reuse the required `company` value as a title.
- Which timezone applies. The current form/database store date/time without a timezone. Use a confirmed tenant timezone or capture an explicit IANA timezone; do not silently label local event time as UTC.
- What happens when the selected product has no published schema-backed product page. The event may remain publishable without a public product relation, or product publication may be a prerequisite; decide explicitly and avoid leaking private product data.

Keep customer-organization redesign, staff identity migration, and broad legacy cleanup outside this slice unless a verified dependency makes one necessary.

### Step 2 — add the event/page relationship and transactional lifecycle

Add an additive, ordered migration for a nullable event-to-page relationship, preferably `mentorbooking_events.page_id` with uniqueness and restrictive deletion behavior. Add database checks/triggers so a linked page:

- belongs to the same tenant as the event;
- uses a tenant-owned `event` schema;
- is not shared by another event or a service product; and
- cannot be deleted while the event still references it.

Implement a caller-scoped event aggregate operation for creating an event with an optional event page. Keep it subject to caller JWT/RLS and transaction boundaries; a failure to create/link the page must not leave a half-linked aggregate. Add the corresponding safe update/publication operation for page metadata and content. Keep event rows that do not have public pages supported.

The existing event table uses UUID event IDs and legacy integer product IDs. Preserve that product reference for this focused change, but validate that the selected product belongs to the same tenant. Resolve a safe product UUID/public page reference at the API boundary; do not change the legacy product identity or rewrite event history in this feature.

### Step 3 — add a shared service boundary

Introduce a typed event-page service/application layer and route the new public-page create/edit actions through it. Keep route handlers thin and use the caller's Supabase identity for authenticated mutations. Avoid creating the event with one browser request and then creating its page in a second request without recovery; that can leave an event that appears opted in but has no linked page.

Use separate expected event/page or aggregate versions if concurrent edits require them. Preserve the existing event status triggers and do not treat the scheduling status as a publication field.

### Step 4 — extend CreateEvent and EditEvent

Likely frontend touchpoints:

- `src/pages/CreateEvent.tsx` — load eligible event schemas for the active tenant and use the event creation service for the optional page aggregate. Retain refetch, success feedback, and the existing after-create hook after the transaction commits. Do not allow this flow to proceed until selected product/schema tenant isolation is enforced by the service/database.
- `src/pages/EditEvent.tsx` — load the event's optional page link, preserve it during event updates, and expose an edit/unpublish action for that page.
- `src/components/events/EventForm.tsx` — add the optional public-page/schema selection and pass it with current product/date/time values. Keep private-event creation unchanged from the user's perspective.
- A small event-page section/component may be preferable to mixing schema selection into `ProductSection`; product selection and event-schema selection represent different things.
- `src/components/events/EventFormSections/DateTimeSection.tsx` and event types — include the confirmed timezone contract if it is not supplied by an authoritative tenant setting.
- `src/features/page-builder/PageBuilderPage.tsx` and `SchemaContentEditor.tsx` — allow event pages to load/edit through an event aggregate adapter. Continue rejecting event pages through generic page writers.

The existing `ProductCombobox` is a legacy integer product picker. Keep it for the MVP unless the customer specifically requires selecting only schema-backed products; in either case validate tenant ownership on the server/database, not only through the selector filter.

### Step 5 — expose safe public event pages

Extend the registered-schema public list/detail delivery in `api/routes/schemas.ts` for `entity_kind = 'event'`:

- Return only registered-schema pages with `status = published`, linked to a same-tenant operational event.
- Add a narrowly allow-listed event projection/relation for public title and confirmed date/time/timezone plus other explicitly approved fields. Keep `pages.content` unchanged.
- Include a product relation only through an explicit allow-listed projection and only when the product is safe to expose.
- Keep unregistered, draft, archived, unlinked, or cross-tenant records unavailable.
- Do not use `select('*')` or expose company/customer details, meeting URLs, private staff/account identifiers, compensation, request/approval data, or internal status.

Use the existing frontend target and revalidation machinery. Published event-page edits, publication changes, schedule changes, slugs, and archive/unpublish need a revalidation decision. Durable outbox/retry guarantees are broader planned work; this feature must not claim those guarantees unless they are implemented. Public event routes also need to be tested against the actual frontend deployment mode.

## 5. Suggested delivery slices

### MVP slice

- [x] Tenant-owned event schema selection on event creation.
- [x] Atomic event + draft page creation with a restrictive same-tenant link.
- [x] Event-aware PageBuilder save and explicit publish/unpublish.
- [x] Public registered event-schema list/detail delivery with an allow-listed event projection.
- [x] Event updates reflected from the operational event record, without copied date/time fields in page content.
- [x] Keep no-page/private event behavior and the existing legacy product selector.
- [x] Require active-tenant scope in legacy product dashboard reads and validate event product/schema/page/company tenant links.
- [ ] Apply and verify the migration against snapshot-backed staging; run the real two-tenant/super-admin RLS and rollback matrix.
- [ ] Verify delivery/revalidation with the customer's actual frontend deployment mode; new static routes are not guaranteed by schema registration.

### Deliberately deferred

- Public staff profiles, staff/account-link conversion, customer CRM changes, event assignments rebuild, and mentor terminology cleanup.
- A separate `specy_events_*` collection API/tool family. Agents create/update occurrences through the entity-aware Pages post/update REST/MCP operations; dedicated event list/search tools can be added later if needed.
- Multiple event pages per occurrence, recurrence/series, ticketing/booking, and availability.
- Automatic event content mirroring into product pages or product-specific schema selection for event content.
- Full historical event/page backfill, table renames, and product legacy contraction.
- Reliable invalidation outbox/webhooks and guarantees for static frontends that need new routes.

## 6. Verification and acceptance

Before enabling the workflow, test at least:

- Product tenant isolation is verified across the legacy overview, event product selector, detail lookups, reloads, and active-workspace switches; missing tenant context fails closed, and direct cross-tenant operations are denied.
- Private event creation still works with no event schema selected.
- Event plus draft page succeeds atomically; forced failure leaves neither an orphan page nor a half-linked event.
- Wrong-tenant product/schema/page references, duplicate event-page links, generic page writes, and direct RPC attempts fail safely under RLS.
- A draft page is not public; explicit publication exposes only the intended event fields; unpublish/archive suppresses it.
- Editing event date/time/product updates the public projection without changing unrelated `pages.content`.
- Schema validation, stale revision/version conflicts, and route/page ownership checks work.
- Public list and detail responses are consistent and exclude private company, Teams, staff/account, request, and scheduling data.
- Event local time is represented with an explicitly confirmed timezone, including daylight-saving boundaries.
- Existing event create/edit/detail/list/calendar behavior and product selection remain intact.

Live database/RLS and migration rollback tests are required before production rollout; source-only tests are not sufficient for transactional and policy guarantees.

## 7. Plan relationship

This document implements only the event-page integration slice of [`PRODUCT-INTEGRATION.md`](PRODUCT-INTEGRATION.md), especially its event/page separation, public occurrence projection, and aggregate/API principles. It does not claim the broad plan's Phase 0 data audit, staff/CRM foundation, legacy conversion, typed handoff, or final contraction is complete. If the customer scope expands to those areas, continue from the broader plan rather than silently treating this MVP as their completion.
