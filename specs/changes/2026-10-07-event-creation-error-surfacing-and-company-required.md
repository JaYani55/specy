# 2026-10-07 — Event creation: real RPC errors surfaced + company required for public pages

## Summary

Two defects in the event creation flow surfaced by a production 400 from
`POST /rest/v1/rpc/create_event_page_aggregate_with_custom_fields`
(PostgREST `error=22023`):

1. **German toasts discarded the real error message.** The catch handler in
   `CreateEvent` used
   `language === 'en' ? message || 'Failed to create event' : 'Fehler beim Erstellen der Veranstaltung'`,
   so German users only ever saw the static fallback, hiding the actual
   Postgres error (e.g. `event company, date, time and end_time are required
   in valid formats.`). The message is now shown in both languages, with the
   static text only as fallback.
2. **Company is optional in the form but required by the event-page RPC.**
   `create_event_page_aggregate` (migration `202610030001`) raises
   `22023 — event company, date, time and end_time are required in valid
   formats.` when the event has no company. The form allowed saving without a
   company, so any event with a public page and empty company failed with an
   opaque 400. The form now validates this up front and the field tooltip no
   longer promises that a company is never needed.

## Files Changed

- `src/pages/CreateEvent.tsx` — error toast now surfaces the real error
  message in both languages.
- `src/components/events/EventForm.tsx` — `superRefine` additionally requires
  a non-empty company when a public event page (event catalogue) is selected:
  `Für öffentliche Veranstaltungsseiten ist ein Unternehmen erforderlich.`
- `src/components/events/EventFormSections/CompanySection.tsx` — tooltip now
  states that public event pages require a company.
- `src/pages/CreateEvent.tsx` (hardening from the same session) — the
  draft-first correction for event pages only runs when the RPC result
  explicitly reports `published` and carries the required revision metadata,
  and is wrapped in try/catch so a failed correction can never abort the
  creation (protects against production DB functions returning a different
  result shape).

## Impact Analysis

- **Database:** none. The `company` requirement is the existing contract of
  `create_event_page_aggregate`; it is now enforced client-side before the RPC
  is called. Relaxing the DB contract was deliberately not done to avoid
  changing the public event-page data contract.
- **Runtime:** users get a precise validation error in the form instead of an
  opaque 400 toast; all future creation errors show their real Postgres
  message.
- **API surface:** none.