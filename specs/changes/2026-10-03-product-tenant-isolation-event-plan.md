# Product tenant isolation added as an event integration prerequisite

## Summary

Reviewed the multi-tenancy contract and product/event code after identifying that the legacy product UI can show products across workspaces. Documented that product rows already have `tenant_id` and RLS, but several legacy product reads allow a missing tenant filter; in particular, the standard product overview calls the optional-tenant fetch without a tenant and does not reload on active workspace changes. Added a tenant-isolation release blocker and test expectations to the focused Event Integration plan, including same-tenant validation for event/product/schema/page relationships.

This is a planning/documentation update only. Product scoping, database ownership, and event integration have not been changed by this record.

## Files Added

- `specs/changes/2026-10-03-product-tenant-isolation-event-plan.md` — this change record.

## Files Changed

- `specs/plans/Event-Integration.md` — added the multi-tenancy audit, likely unscoped read paths, required fail-closed product scoping, ownership-audit guidance, and release-blocking workspace-isolation tests.

## Impact analysis

### Database

None. No migrations or database operations were performed. Existing product `tenant_id` and RLS behavior should be reviewed/verified against live data before any ownership repair.

### Runtime

None. No application code was changed.

### API surface

None. No REST or MCP contract was changed.

## Verification

Reviewed `specs/platform/multi-tenancy.md`, the legacy product service and overview, the event product combobox, and the tenant-qualified product query in `DataContext`. Verified the plan remains indexed and ran `git diff --check`. No tests/build were run because this change is documentation-only.
