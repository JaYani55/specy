# 2026-10-13 — Product & Event UX refinements

## Summary

UX-focused slice across the product and event dashboard screens:

1. **`/products/manage` redesign** — the Products overview now uses the same card-grid design as the legacy product management page (gradient banner + product icon, hover actions) and adds a data overview to every product card: product-page connection badge, staff-product badge, compensation, required staff range, effort description and required trait groups (resolved from the workspace `mentor_groups`).
2. **`/events/:eventId` (EventDetail)** — the **Produktseite bearbeiten** button (direct PageBuilder shortcut for the Product page) was removed together with its page/schema resolution effect. The remaining product button (**Produkt bearbeiten**) navigates to the product edit screen `/products/manage/:productId`.
3. **`/edit-event/:eventId` missing-entry tooltips** — every field whose entry is still missing shows a help tooltip on its label (via the new `MissingEntryTooltipLabel` component): date, time, duration, staff members, required staff count, public page title, event timezone and the optional company. The tooltip disappears once an entry is provided.
4. **Company optional, Staff registry-only** — the event form's **Unternehmen** section moved under **Mitarbeiter** as an optional subsection. `company` is no longer required by the form schema; a CRM company record is only created/linked when a company name is present, otherwise `company` is stored as an empty string and `company_id` as `null`. The `StaffCombobox` now lists only the workspace's staff registry entries (`staff` table via `fetchStaffDirectory`, the same directory as `/admin/all-mentors`); login/tenant accounts (roles-based `user_profile` lookup) are no longer offered. This affects both the event form and `EventStaffAssignment` since they share the combobox.
5. **Default event catalogue selection** — when creating a new event, the **Öffentliche Veranstaltungsseite** schema picker preselects the first eligible event catalogue of the active workspace (instead of defaulting to empty). Operators can still switch to **Keine öffentliche Seite**.
6. **KB Sync hidden on the event editor** — `/edit-event/:id` no longer renders the plugin `knowledgeBase.entity.actions` row (`EntityActionsRow`). The component and hook remain wired for page/form/object entities; the `event` entity type was removed from the component's prop union. The `knowledgeBase.entity.afterCreate` hook on event creation is unchanged.

## Files Added

- `src/components/events/EventFormSections/MissingEntryTooltipLabel.tsx` — form label with a tooltip that renders while the field entry is missing.
- `specs/changes/2026-10-13-product-event-ux-refinements.md` — this document.

## Files Changed

- `src/pages/ProductCatalogue.tsx` — card-grid redesign with data overview; shared `DeleteProductDialog`; loads `mentor_groups` for trait names; bilingual labels via `useTheme`.
- `src/pages/EventDetail.tsx` — removed `productPagePath` state/effect and the **Produktseite bearbeiten** button; product button relabelled **Produkt bearbeiten**.
- `src/pages/EditEvent.tsx` — removed `EntityActionsRow` (KB Sync); company handling made optional (`company_id: null`, `company: ''` when absent).
- `src/pages/CreateEvent.tsx` — company handling made optional in both create paths (aggregate RPC payload and direct insert).
- `src/components/events/EventForm.tsx` — `company` schema optional; company section moved under Staff; missing-entry tooltips on public-page title/timezone; event schema preselected in create mode.
- `src/components/events/EventFormSections/StaffSection.tsx` — label with missing-entry tooltip.
- `src/components/events/EventFormSections/CompanySection.tsx` — optional labels with missing-entry tooltips.
- `src/components/events/EventFormSections/DateTimeSection.tsx` — missing-entry tooltips for date/time/duration.
- `src/components/events/EventFormSections/LockAndMentorCountSection.tsx` — missing-entry tooltip for required staff count.
- `src/components/events/StaffCombobox.tsx` — data source switched to the staff registry (`fetchStaffDirectory`/`fetchStaffRecord`), workspace-scoped.
- `src/components/entity-actions/EntityActionsRow.tsx` — `entityType` union no longer includes `'event'`.
- `specs/features/service-products.md` — documented the overview card design.
- `specs/features/event-catalogue.md` — documented optional company under Staff, staff-registry-only selector, schema preselection, editor form tooltips, EventDetail link change and KB action row removal.
- `specs/agents/plugin-hooks.md` — `knowledgeBase.entity.actions` context no longer includes `event`; dispatch status updated.

## Impact analysis

### Database

- No migration. `mentorbooking_events.company` remains `NOT NULL` and receives an empty string when no company is given; `company_id` becomes `NULL`, which the tenant-validation trigger already permits.
- `staff_members` on events now holds staff registry IDs (previously account user IDs). Values are only produced/consumed by the shared staff combobox, so new saves are self-consistent; historical rows keep their stored values.

### Runtime

- Frontend-only changes; no API/Worker or edge-function code touched.
- Event deletion of the Product-page editor shortcut removes one Supabase page/schema lookup on the event detail screen.

### API surface

- No REST/MCP changes. The plugin hook surface loses the `event` dispatch point of `knowledgeBase.entity.actions` (documented in `specs/agents/plugin-hooks.md`); `knowledgeBase.entity.afterCreate` for events is untouched.

### Tests

- `npm run typecheck`, `npm test` (458 passing, including `tests/productDeleteCascade.test.mjs` which pins the `/products/manage` deletion contract) and `npm run build` all pass.
