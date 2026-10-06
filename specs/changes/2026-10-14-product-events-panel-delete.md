# 2026-10-14 — Product events panel delete button

## Summary

The **Veranstaltungen** overview on the product screens (`ProductEventsPanel`, rendered by the Product detail editor and the Product PageBuilder's related-events panel) now offers a per-event delete action. The row-level trash button (visible with `canDeleteEvents`) opens the shared `DeleteEventDialog`; confirming performs a tenant-scoped delete of the `mentorbooking_events` row. The associated public event page is removed in the same caller-scoped transaction by the existing `delete_event_page_after_event_delete` database trigger — no new deletion path was introduced.

Behaviour details:

- Past events follow the existing deletion rule: they remain deletable only for viewers with admin data access (`canViewAdminData`), mirroring the guard inside `DeleteEventDialog`.
- After a successful delete the panel reloads its event list; success and failure are reported via toasts. The confirmation dialog explains that the action cannot be undone.

## Files Added

- `specs/changes/2026-10-14-product-events-panel-delete.md` — this document.

## Files Changed

- `src/components/products/ProductEventsPanel.tsx` — per-event delete button, `DeleteEventDialog` wiring, tenant-scoped delete handler and list reload (`reloadKey`).
- `specs/features/service-products.md` — documented the delete affordance on the related-events overview.

## Impact analysis

### Database

- No migration. Page cleanup reuses the transactional `delete_event_page_after_event_delete` trigger from `202610030001_event_page_aggregates.sql`; a denied page delete rolls back the event delete.

### Runtime

- Frontend-only change. The generated Product Object projection continues to be refreshed by the existing event-delete triggers, so the dynamic data stream stays consistent.

### API surface

- No REST/MCP changes.
