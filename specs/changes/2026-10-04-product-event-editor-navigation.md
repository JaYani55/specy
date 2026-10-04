# Product and Event editor navigation

## Summary

Connected Product and Event editing flows for operators. Schema-backed and legacy Product views now show related Events; creating an Event from a Product preselects that Product and returns to the originating Product view when no public page is created. Event details link back to the associated Product where the caller has permission. Product custom values and Event custom values receive clearer contextual section headings in their existing forms.

The public Object mirror and Product-specific custom-field definition ownership are not implemented by this UI change. Custom-field definitions remain workspace-wide, and generated Objects remain outside this feature slice.

## Files Added

- `src/components/products/ProductEventsPanel.tsx` — tenant-scoped related Event list and Product-to-Event create navigation.

## Files Changed

- `src/pages/ProductDetail.tsx` — related Event panel and developer-only display of the public dynamic data URL.
- `src/features/page-builder/SchemaContentEditor.tsx` — related Event panel for schema-backed Products and confirmation before leaving with unsaved Product changes.
- `src/pages/CreateEvent.tsx` — accept a tenant-validated preselected Product and return path from Product navigation.
- `src/pages/EventDetail.tsx` — link back to the associated Product for permitted users.
- `src/components/products/CustomFieldsEditor.tsx` — allow contextual section title and description.
- `src/components/events/EventForm.tsx` — label custom values as additional Event details.
- `specs/features/service-products.md`, `specs/features/event-catalogue.md` — document the current UI flow and clarify that field definitions remain workspace-wide.

## Impact analysis

### Database

No migration, schema, RLS policy, or database data change. The related-event panel reads existing tenant-scoped Product/Event/Page records using the caller's Supabase session.

### Runtime

Adds read-only Product-to-Event summaries to Product views. Event creation can receive navigation state for an initial Product selection and a safe in-app return path. Public-page event creation retains its existing behavior of opening the new page in the PageBuilder. Product PageBuilder prompts before discarding unsaved edits when opening Event creation.

### API surface

No API or MCP contract change. No Object mirror or Product-specific field-definition contract is introduced. Existing custom-field definitions remain workspace-wide; per-Product field ownership remains future work.
