# 2026-10-07 — Product delete fix, draft-first event pages, creation confirmation

## Summary

Three related UX fixes around the product catalogue (`/products/manage`) and
event creation:

1. **Product delete was unreachable on `/products/manage`.** The delete button
   inside the clickable product card did not stop event propagation, so the
   card's `onClick` (navigate to the product detail page) fired alongside the
   delete handler — the user only ever saw the edit/detail page open. The
   delete handler now stops propagation so the existing confirmation modal
   (`DeleteProductDialog`) actually opens and the product can be deleted.
2. **New event pages must be draft-first.** The database RPC
   (`create_event_page_aggregate`) already inserts the page as `draft`, but as
   a safety net the frontend now verifies the created page status and forces
   the page back to `draft` via `setEventPagePublication` if a deployment with
   an outdated database function returns a published page.
3. **Creation confirmation with navigation to the pages overview.** After
   creating an event with a public page, the user is no longer dropped
   silently into the page editor. A confirmation dialog explains that the page
   was created as an unpublished draft and offers:
   - **Zur Seitenübersicht / Go to pages overview** → opens the owning
     schema's pages overview (`PagesSchemaDetail`), where the user can publish
     the new page via the page row's publish action.
   - **Seite bearbeiten / Edit page** → opens the page editor (previous
     behavior).
   - **Schließen / Close** → returns to the origin (`returnTo` or `/events`).

## Files Added

- (none)

## Files Changed

- `src/pages/ProductCatalogue.tsx` — `DeleteButton` click now calls
  `e.stopPropagation()` before opening `DeleteProductDialog`, so the
  surrounding product card no longer navigates away and swallows the delete
  confirmation.
- `src/pages/CreateEvent.tsx`
  - After `createPublicEventPage`, if `result.page_status !== 'draft'`, the
    page is immediately set back to `draft` via `setEventPagePublication`
    (defense against outdated DB functions that publish on creation).
  - New `CreatedEventConfirmation` state + `Dialog` rendered after successful
    event/page creation instead of an unconditional navigate to the editor.
    Navigation targets: schema pages overview (`getSchemaConsolePath(schema)`),
    page editor, or back to the origin.

## Impact Analysis

- **Database:** none. No migration added or changed. The draft-first guarantee
  already lives in `create_event_page_aggregate` (migration
  `202610030001_event_page_aggregates.sql`); the new frontend check is purely
  defensive. Deployments still running an outdated DB function should re-apply
  migrations.
- **Runtime:** event creation with a public page now ends in a confirmation
  dialog instead of an automatic redirect. Events created without a public
  page keep the existing behavior (redirect to `returnTo`/`/events`).
- **API surface:** none. Only client-side service calls already in use
  (`createPublicEventPage`, `setEventPagePublication`) are involved.
