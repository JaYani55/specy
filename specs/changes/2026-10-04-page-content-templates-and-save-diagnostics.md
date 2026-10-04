# Page content templates and save diagnostics

## Summary

Added named, schema-scoped page-content templates to the PageBuilder. A page can be saved as a template and loaded into another page using that schema; only `pages.content` is copied, not page title, slug, publication state, or operational event fields. Added workspace RLS and schema-ownership checks for template storage.

Revalidation now preserves per-target HTTP status, endpoint, path, and upstream error diagnostics, redacts shared secrets/bearer tokens, and shows details behind a collapsed disclosure. Event editing now detects an update that affects zero rows, surfaces PostgREST message/code/details, and does not misreport an event as unsaved if only the event list refresh fails.

## Files Added

- `migrations/202610040002_page_content_templates.sql` — schema-scoped template table, tenant matching trigger, RLS policies, size/name constraints, and update timestamp.
- `src/services/pageContentTemplateService.ts` — tenant/schema-scoped list and save operations.
- `src/features/page-builder/PageContentTemplateControls.tsx` — save/load dialogs at the top of schema-driven page editing.
- `src/components/revalidation/RevalidationFeedback.tsx` — concise revalidation feedback with a collapsed technical-details disclosure.
- `api/lib/revalidationDiagnostics.ts` — upstream diagnostic sanitizer that redacts configured secrets and bearer tokens.
- `tests/pageContentTemplates.test.mjs`, `tests/revalidationDiagnostics.test.mjs`, `tests/eventEditDiagnostics.test.mjs` — template isolation/content contract, secret-safe revalidation reporting, and zero-row event-update regression tests.

## Files Changed

- `scripts/lib/migration-order.mjs`, `specs/platform/unified-setup-tui.md` — register and document the core migration component.
- `src/features/page-builder/SchemaContentEditor.tsx` — template load replaces content values and updates optional-field activation while preserving page identity/schedule; shows detailed revalidation feedback only when expanded.
- `src/services/pageService.ts` — return structured revalidation target diagnostics while keeping the visible summary concise.
- `api/routes/schemas.ts` — retain per-target upstream failures, HTTP status/path/endpoint, and bounded redacted diagnostics instead of dropping details when one target times out.
- `src/pages/EditEvent.tsx`, `src/components/events/EventForm.tsx`, `src/pages/PagesSchemaDetail.tsx` — detect no-row event updates, surface database errors, keep the editor available when revalidation fails, and render the same expandable revalidation report on event edits and publication changes.
- `specs/features/page-builder.md`, `specs/features/schema-contracts.md`, `specs/features/event-catalogue.md` — document template scope, schedule isolation, and revalidation diagnostics.

## Impact analysis

### Database

Adds the idempotent `page_content_templates` table. Each template references one `page_schemas` row and carries its schema's workspace ID. A trigger rejects mismatched schema/workspace links. Authenticated users can read templates in their workspace; owners and workspace/content admins can edit or remove rows according to RLS. Content must be a JSON object no larger than 1 MiB. The migration is registered but was not applied to a live database in this session.

### Runtime

Templates load into the current PageBuilder fields and remain schema-specific. Loading a template does not alter the event occurrence's date, time, timezone, product, staff, event status, page title, slug, or publication state. Event schedule edits that save successfully remain saved even if frontend revalidation or list refresh fails. Event saves with no updated row now report a clear error instead of appearing successful.

### API surface

The authenticated `/api/schemas/:slug/revalidate` response retains per-target diagnostic fields and sanitizes upstream text; it never returns the configured shared secret or authorization bearer value. The dashboard service exposes those diagnostics to the UI, where detailed target information remains collapsed until requested. No new public API or MCP template tools were added.
