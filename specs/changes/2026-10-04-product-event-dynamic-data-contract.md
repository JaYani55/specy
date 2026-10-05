# Product/Event dynamic-data contract and API discovery fix

## Summary

Clarified the Page/Object boundary for Product and Event data. Pages remain the editorial content and revalidation transport; the generated Product Object is the dynamic API stream for current Product/Event operational values. Generated Object payloads now replace embedded Page content with Page references. Event registration state and participant capacity are represented as typed operational fields rather than free-text-only content/custom fields. MCP Object discovery no longer advertises an anonymous `detail_url` unless all REST anonymous-read gates are satisfied.

Migrations through `202610040005_product_object_projection.sql` were reported as deployed and tested before this change. This change adds a new forward migration; it must be rolled out separately.

## Files Added

- `migrations/202610040006_product_event_dynamic_data_contract.sql` — nullable registration/capacity columns and constraints, atomic event-page create wrapper update, generated Object projection normalization, and idempotent Product Object resync.
- `api/lib/objectVisibility.ts` — shared public Object visibility predicate.
- `tests/objectVisibility.test.mjs` — public Object visibility and MCP detail-link regression coverage.

## Files Changed

- `scripts/lib/migration-order.mjs`, `specs/platform/unified-setup-tui.md` — register and classify migration 006.
- `api/lib/eventPageAggregates.ts`, `api/routes/mcp.ts`, `api/lib/publicEntityProjection.ts`, `api/routes/schemas.ts` — validate and expose structured event status/capacity, document Pages/Object MCP boundaries, and suppress non-public detail URLs.
- `src/types/event.ts`, `src/components/events/EventForm.tsx`, `src/pages/CreateEvent.tsx`, `src/pages/EditEvent.tsx`, `src/contexts/DataContext.tsx`, `src/services/events/eventPageService.ts` — German operator fields, cache mapping, persistence and typed event reads/writes.
- `src/lib/apiCatalog.ts` — document the dynamic Object contract and Page references.
- `tests/eventPageAggregates.test.mjs`, `tests/publicEntityProjection.test.mjs` — structured-field validation and public allow-list coverage.
- `specs/features/event-catalogue.md`, `specs/features/service-products.md`, `specs/agents/event-catalogue-integration.md`, `specs/agents/product-catalogue-integration.md` — document the source-of-truth and delivery boundary.

## Impact analysis

### Database

Adds nullable `mentorbooking_events.registration_status` (`open`, `waitlist`, `full`, `closed`, `cancelled`), `participant_min`, and `participant_max`, with range constraints. Existing rows are not assigned inferred values. The event-page aggregate wrapper writes these fields in the same transaction as Event/Page creation. A generated Object trigger strips duplicated Page JSON from Product/Event projections, stores Page references, and enriches event records with the structured fields. Existing Product mirrors are resynchronized idempotently.

### Runtime

The Event editor now captures registration status and participant limits. `required_staff_count` remains separate. Pages and PageBuilder retain editorial content/publication; Product/Event operational data is edited through their dedicated forms. Object reads provide current dynamic values without waiting for a revalidation cycle. Public Pages may include an allow-listed snapshot for static generation/revalidation, but the Object is the dynamic operational read contract.

### API surface

`GET /api/objects/{slug-or-uuid}` and the friendly Product URL return the generated Object envelope with Page references and operational Product/Event data, not duplicated `pages.content`. `relations.event` on schema Pages delivery includes registration/capacity as a revalidation snapshot. MCP Page list/get tools describe and return Page records; `get_object` reads the dynamic stream. `list_objects` emits a public detail URL only when `status=published`, `api_enabled=true`, and `requires_auth=false`.

## Verification status

Automated tests and build/typecheck remain to be run for this change. The new migration has not been applied as part of this code change and requires normal staging/live rollout verification.
