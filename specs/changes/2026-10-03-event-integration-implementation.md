# Focused event-page integration implementation

## Summary

Implemented the focused event-integration MVP. Event creation now optionally creates a draft public event page in a tenant-owned event schema, atomically linked to the operational event. The selected product remains an operational relation; event pages do not go into product schemas. The schema-driven PageBuilder now edits event pages through caller-scoped aggregate RPCs. Authenticated REST `POST/PATCH /api/schemas/:slug/pages` and existing MCP Pages create/update tools dispatch event schemas through those aggregates, and registered public event-schema endpoints serve only published, linked, same-tenant pages with allow-listed event and optional published-product projections.

Also closed the identified legacy product active-workspace query gap in dashboard reads/selectors/details and scoped related event product/company/group lookups. Product/event/company/schema/page tenant links are checked in database triggers/RPCs. No existing event/product rows were backfilled.

## Files Added

- `migrations/202610030001_event_page_aggregates.sql` — optional event page/timezone fields, same-tenant link triggers, event page write guard, transaction-backed create/update/publication RPCs, and event-delete page cleanup.
- `src/services/events/eventPageService.ts` — typed caller-scoped event/page RPC client.
- `src/utils/eventPage.ts` — IANA timezone validation and event page slug normalization.
- `src/utils/productTenantScope.ts` — fail-closed product tenant normalization/require helper.
- `api/lib/eventPageAggregates.ts` — shared REST/MCP validation and event aggregate adapter.
- `tests/eventPageAggregates.test.mjs` — REST/MCP event post input validation.
- `tests/eventPageIntegration.test.mjs` — event aggregate, ownership, generic-write, REST/MCP post/update, and public-delivery source contracts.
- `tests/eventPageService.test.mjs` — timezone and slug helper coverage.
- `tests/productTenantScope.test.mjs` — fail-closed tenant helper and scoped dashboard call coverage.
- `specs/features/event-catalogue.md` — implemented event-page lifecycle and public-delivery contract.
- `specs/agents/event-catalogue-integration.md` — frontend setup, include contract, and privacy guidance.

## Files Changed

- `scripts/lib/migration-order.mjs` — registers the event migration after its table/function dependencies.
- `src/services/events/productService.ts`, `src/services/mentorGroupService.ts`, `src/services/company/companyService.ts` — require/scope active tenant for legacy product, group, and company reads/writes.
- `src/pages/VerwaltungAllProducts.tsx`, `src/pages/ProductDetail.tsx`, `src/components/events/ProductCombobox.tsx`, `src/components/events/CompanyCombobox.tsx`, `src/hooks/useProductManagement.ts`, `src/hooks/useMentorGroupsAndMentors.ts` — workspace-qualified loads, fail-closed empty states, and stale workspace response guards.
- `src/components/events/EventForm.tsx`, `src/pages/CreateEvent.tsx`, `src/pages/EditEvent.tsx`, `src/pages/EventDetail.tsx`, `src/types/event.ts`, `src/contexts/DataContext.tsx` — optional event schema/page creation, explicit timezone, scoped product selection, public page editing links, and schedule-change revalidation.
- `src/features/page-builder/PageBuilderPage.tsx`, `src/features/page-builder/SchemaContentEditor.tsx`, `src/pages/PagesSchemaDetail.tsx` — load/save/publish/archive event pages through aggregate operations and reject generic event page creation.
- `api/lib/publicEntityProjection.ts`, `api/routes/schemas.ts`, `api/routes/mcp.ts`, `api/lib/frontendManifest.ts`, `src/lib/apiCatalog.ts` — authenticated entity-aware REST/MCP page post/update operations, registered event-page public delivery, and allow-listed includes.
- `specs/features/README.md`, `specs/agents/README.md`, `specs/agents/agent-system-prompt.md`, `specs/agents/mcp-exposition.md`, `specs/agents/frontend-integration-manifest.md`, `specs/features/page-builder.md`, `specs/features/schema-contracts.md`, `specs/features/service-products.md`, `specs/architecture/page-builder.md`, `specs/architecture/system-overview.md`, `specs/platform/multi-tenancy.md`, `specs/agents/product-catalogue-integration.md`, `specs/agents/event-catalogue-integration.md`, `specs/plans/Event-Integration.md` — updated REST/MCP contracts, current feature status, indexes, and rollout limits.
- `tests/publicEntityProjection.test.mjs`, `tests/productDeleteSafety.test.mjs` — event relation projection coverage and updated required-tenant deletion expectation.

## Impact analysis

### Database

One additive, idempotent migration adds nullable event page/timezone columns, a unique restrictive event-page FK, tenant/entity validation triggers, and caller-scoped aggregate functions. The migration is registered but was **not applied** to any database in this session. No historical data was backfilled or assigned a guessed timezone. Apply only after a snapshot-backed staging review; verify existing row ownership and RLS with real personas.

### Runtime

Private event creation remains available with no public event schema selected. Selecting an event schema creates an event and draft page in one transaction. Event page content is schema-edited and publication is separate from scheduling status. Public date/time values come from the operational event row, and the browser-visible timezone must be confirmed. Product lists/getters now require active tenant scope and fail closed when it is absent. Event schedule edits use best-effort existing frontend revalidation; durable outbox/retry guarantees remain out of scope. Agent Pages post/update operations can create and publish event pages, but operational schedule edits through REST/MCP remain dashboard-only.

### API surface

Registered `entity_kind = event` schemas now support public collection/detail delivery. Authenticated `POST/PATCH /api/schemas/:slug/pages` and the existing MCP `create_page` / `specy_pages_schemas_create_page` / `specy_pages_schemas_update_page` tools dispatch event-classified schemas through event aggregate operations. `include=entity,event,product` provides only opaque event/product IDs and explicitly allow-listed occurrence/product fields. No separate `specy_events_*` collection tool family was added. The manifest advertises event includes but keeps `supports_new_routes: null`.

## Verification

- `npm run typecheck` — passed.
- `npm test` — passed (376 tests).
- `npm run build` — passed; existing plugin dynamic-import and chunk-size warnings remain.
- `npm run typecheck:api` — core API files, including the changed schema route, reported no errors; the command remains non-zero on existing generated plugin metadata and the gitignored `plugins/pluradash` workspace.
- `npm run dev:api -- --port 8799` — Wrangler reached `Ready`; unauthenticated `POST /api/schemas/test/pages` and `PATCH /api/schemas/test/pages/:pageId` returned `401` as expected. The timeout wrapper stopped the worker after smoke checks. No authenticated database-backed write or public schema query was exercised to avoid touching the configured remote Supabase project.
- `npm run dev -- --host 127.0.0.1 --port 5173` — Vite served the `/create-event` SPA deep route. No authenticated browser interaction was available.
- Live migration application, transaction/RLS persona tests, and customer frontend/Astro deployment-mode revalidation were not available and remain rollout gates.
