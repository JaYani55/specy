# Focused event integration plan

## Summary

Audited the existing Create Event and Edit Event flows, event form/product selector, operational event table, PageBuilder entity handling, public schema delivery, and the existing Products × Pages plan. Proposed a narrow event-page integration: an event remains a scheduled occurrence linked to its selected product, while an optional one-to-one event-schema page provides public presentation. The plan rejects creating event occurrences in a product schema and distinguishes event scheduling status from page publication.

This is planning/documentation only. The event aggregate, relationship, UI, and public delivery are not implemented by this change.

## Files Added

- `specs/plans/Event-Integration.md` — focused MVP evaluation, current-code audit, proposed architecture, high-level implementation steps, deferred scope, and acceptance criteria.
- `specs/changes/2026-10-03-event-integration-plan.md` — this change record.

## Files Changed

- `specs/plans/README.md` — indexed the focused event integration plan.

## Impact analysis

### Database

None. No migration was added or applied. The plan proposes a future nullable, unique, restrictive event-to-page relationship and transactional aggregate operations.

### Runtime

None. No frontend, API, Worker, or database code was changed.

### API surface

None. Event aggregate operations and public event projections are proposals only; existing REST/MCP behavior is unchanged.

## Verification

Reviewed the CreateEvent/EditEvent forms and direct Supabase writes, current event table fields, product selector, PageBuilder event-schema rejection, public event-delivery rejection, and the broader integration plan. Checked plan indexing and links by repository structure. No build or tests were run because this is a documentation-only change.
