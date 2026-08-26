# 2026-08-26 — Media Picker Frontend Consistency Guide & Scope-Aware Media API

## Summary

**Part 1 (docs):** Extended `specs/agents/r2-file-storage.md` with a new **§8 "Frontend
media picker — consistency guide"** that codifies how frontend surfaces (core pages and
plugins) must integrate with the unified storage so upload, browse, select, and delete
behave identically everywhere.

**Part 2 (API):** Implemented the scope-aware storage API so the documented `'files'`
scope is actually reachable. Previously `POST /upload` hardcoded `scope: 'media'`, so
downloadable documents could not be stored with their own intent; `GET /list` and
authenticated delivery were likewise restricted to `'media'`.

Contents of the new section:

1. **File storage vs. media storage** — explains the two `tenant_storage_objects.scope`
   values (`'media'` = inline-rendered assets, `'files'` = downloadable documents) and
   how they share one pipeline while differing in presentation (grid vs. list picker,
   MIME filtering, folder conventions, delete-warning copy).
2. **Canonical component contract** — the `MediaPickerProps` boundary (`value`/`onChange`,
   string-only, `previewVariant`), plus behavioral invariants already implemented in
   `ImageUploader.tsx` (upload = select auto-commit, hover-overlay removal, German UI).
3. **Reference snippets** — auth-header helper, `AuthenticatedImage` blob-fetch pattern,
   a shared `mediaApi` helper module (`sources`/`list`/`upload`/`remove`), the picker
   dialog skeleton (drive selector → tabs → footer), and the file-scope variant deltas.
4. **Consistency checklist** — pre-ship verification list for any storage-touching UI.

Documentation-only changes were also made to §3.3/§3.4/§3.6 to reflect the implemented
scope parameter and the actual delivery access rules.

### API implementation details

New helpers in `api/lib/tenantStorageHooks.ts`:

- `TENANT_STORAGE_SCOPES: readonly TenantStorageScope[]` — `['media', 'files']`.
- `isTenantStorageScope(value)` — type guard.
- `parseTenantStorageScope(value, fallback = 'media')` — parses form fields/query
  params; returns `fallback` when absent/empty and `null` when present-but-invalid so
  callers reject with HTTP 400 instead of silently coercing.

Changes in `api/routes/media.ts`:

| Endpoint | Change |
|---|---|
| `POST /upload` | Accepts optional `scope` form field **or** query param (`media` \| `files`, default `media`, invalid → 400). Threads scope through quota summary, object-key building, catalog registration, and signed URL generation. |
| `GET /list` | Accepts optional `scope` query param (default `media`, invalid → 400) passed to `listTenantStorageItems`. |
| `DELETE /file` | Accepts optional `scope` query param used for the access/quota summary assertion (the deleted row is still resolved by its unique object key). |
| `GET /file` | Authenticated lookups no longer filter to `scope='media'`; owners can fetch their own `'files'` documents without a signature. Anonymous behavior unchanged (`media` publicly deliverable, everything else requires `sig`). |

Supabase Storage and S3 mounts are unaffected — they do not track scope.

## Files Added

- `specs/changes/2026-08-26-media-picker-frontend-consistency.md` (this record)

## Files Changed

- `specs/agents/r2-file-storage.md` — added §8 (frontend media picker consistency);
  added cross-link in the header "Related" list; documented `scope` on `/list`,
  `/upload`, `/file` (§3); corrected §3.6 access-rules table to match delivery code.
- `api/lib/tenantStorageHooks.ts` — added `TENANT_STORAGE_SCOPES`,
  `isTenantStorageScope()`, `parseTenantStorageScope()`.
- `api/routes/media.ts` — scope parameter on upload/list/delete; scope-threaded R2
  registration path; scope-unrestricted authenticated delivery lookup.

## Impact Analysis

- **Database:** none (both scopes already existed as CHECK-enforced values).
- **Runtime:** `/api/media/*` only. Existing clients are unaffected: omitted `scope`
  defaults to `media`, preserving prior behavior exactly. Invalid explicit values now
  return 400 instead of being silently coerced. Authenticated delivery of non-media
  objects changes from 404 to served-for-owner — required by the new files flow.
- **API surface:** additive optional `scope` parameter on `/api/media/upload`,
  `/api/media/list`, and `DELETE /api/media/file`.
