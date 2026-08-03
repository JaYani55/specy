# Revalidation unauthorized diagnostics

## Summary

ISR requests reached the configured frontend but returned `401 Unauthorized`. The CMS route now fails clearly when no managed secret is configured and returns safe endpoint/status diagnostics for upstream authentication failures.

## Files Added

- `tests/pagesContract.test.mjs` coverage
- `specs/changes/2026-08-03-revalidation-unauthorized-diagnostics.md`

## Files Changed

- `api/routes/schemas.ts`
  - Rejects missing revalidation secrets before making the upstream request.
  - Returns the upstream endpoint path and status without exposing secret values.
- `tests/pagesContract.test.mjs`
  - Verifies safe diagnostics.

## Impact analysis

### Database

No database changes. The registered schema must still have a managed revalidation secret, and the frontend must use the exact same value.

### Runtime

The CMS sends the secret as `Authorization: Bearer <secret>` and retains the legacy query-string retry for older frontend handlers. A remaining `401 Unauthorized` indicates that the frontend's configured secret does not match the secret registered in Specy, or that the frontend expects a different authentication contract.

### API surface

`POST /api/schemas/:slug/revalidate` now returns a clear configuration error when no secret is available and includes non-sensitive upstream endpoint/status information for failures.
