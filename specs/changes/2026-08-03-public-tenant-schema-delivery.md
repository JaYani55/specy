# Public tenant-owned schema delivery

## Summary

Registered tenant-owned schemas were visible to authenticated CMS requests, but public frontend requests received `Schema not found` because page delivery used the anonymous Supabase client and tenant RLS hid the schema metadata.

## Files Added

- `specs/changes/2026-08-03-public-tenant-schema-delivery.md`

## Files Changed

- `api/routes/schemas.ts`
  - Uses the server-side Supabase client for public collection and detail page delivery.
  - Uses server-side target visibility for public collection responses.
- `api/lib/schemaRegistration.ts`
  - Adds an explicit `publicRead` option for frontend-target lookup.
- `tests/pagesContract.test.mjs`
  - Covers public schema visibility and the published-only page filter.

## Impact analysis

### Database

No migration is required. Existing RLS remains unchanged because the API's public delivery path uses the server-side client and applies its own public contract.

### Runtime

Registered tenant-owned schemas can now be resolved by public frontends without a CMS user JWT. Collection and detail endpoints still return only pages with `status = 'published'`.

### API surface

The following public routes now support tenant-owned registered schemas consistently:

- `GET /api/schemas/:slug/pages`
- `GET /api/schemas/:slug/pages/:pageSlug`

Draft and archived pages remain excluded.
