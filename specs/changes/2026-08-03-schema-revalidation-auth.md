# Schema revalidation authentication fix

## Summary

Publishing a page from the console called the deployed schema revalidation route without forwarding the authenticated CMS session. Tenant-scoped schema lookup therefore returned `404 Schema not found`, and the client displayed an unhelpful `undefined` message.

## Files Added

- `specs/changes/2026-08-03-schema-revalidation-auth.md`

## Files Changed

- `api/routes/schemas.ts`
  - Uses the request bearer token when loading the schema for revalidation.
- `src/services/pageService.ts`
  - Sends the authenticated session header.
  - Converts non-2xx responses and malformed responses into useful messages.
- `src/pages/PagesSchemaDetail.tsx`
  - Provides a fallback message in the ISR warning toast.
- `tests/pagesContract.test.mjs`
  - Adds revalidation authentication and error-message regression coverage.

## Impact analysis

### Database

No database changes.

### Runtime

Tenant-scoped schemas can now be resolved during console-triggered revalidation. The frontend still receives the registered schema's configured revalidation request.

### API surface

`POST /api/schemas/:slug/revalidate` now honors the caller's bearer token for schema lookup. The route's upstream frontend request behavior is unchanged.