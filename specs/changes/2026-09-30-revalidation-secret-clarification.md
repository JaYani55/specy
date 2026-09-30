# 2026-09-30 — Clarify frontend revalidation token management

## Summary

Clarifies that the schema's revalidation secret is a shared bearer token between Specy and the frontend's revalidation endpoint. The UI now explains that the same random token must be configured on both sides, distinguishes it from Supabase/Worker operator credentials, and labels `REVALIDATION_<SCHEMA_ID>` as an internal managed-secret name rather than the token value. The status warning now identifies whether the Supabase admin credential, `SECRETS_ENCRYPTION_KEY`, or both are unavailable. Management detection accepts either the `SS_SUPABASE_SECRET_KEY` Secrets Store binding or the supported `SUPABASE_SECRET_KEY` fallback, avoiding a false warning when the fallback is configured.

## Files Added

- `specs/changes/2026-09-30-revalidation-secret-clarification.md`

## Files Changed

- `src/pages/PagesSchemaDetail.tsx` — clarifies the token's purpose, frontend setup, write-only behavior, internal name, and unavailable-management warning.
- `api/lib/supabase.ts` — exposes shared detection for the Secrets Store binding and supported local fallback.
- `api/routes/schemas.ts` — uses that detection for read-only fallback, returns a specific `warning_code`, and reports the missing Worker credential precisely.
- `src/services/pageService.ts` — types the warning code returned by the status endpoint.
- `tests/supabaseAdminCredential.test.mjs` — covers both admin-key sources and the missing-key case.

## Impact Analysis

### Database

None.

### Runtime

The frontend revalidation token remains encrypted and write-only. Secret-status detection no longer reports management unavailable when the Worker has the supported `SUPABASE_SECRET_KEY` fallback but no `SS_SUPABASE_SECRET_KEY` Secrets Store binding.

### API Surface

The secret-status response adds `warning_code` so the dashboard can identify the specific missing Worker credential. Other routes and payloads are unchanged.
