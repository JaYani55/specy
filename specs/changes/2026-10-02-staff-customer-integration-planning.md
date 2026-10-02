# Independent staff, optional customer CRM and integration handoff planning

## Summary

Extended the Products / Pages rebuild plan after auditing staff identity constraints/UI, company CRUD and event validation, and legacy employer/auth hydration. The plan now requires independent staff/freelancer/guest records with separate optional account links, an optional single-table customer-organization CRM, and versioned privacy-aware business handoff contracts for frontends, other CMSs, scheduling and invoice adapters. Added explicit risk controls, migration prerequisites and consumer/security acceptance gates.

## Files Added

- `specs/changes/2026-10-02-staff-customer-integration-planning.md` — this record.

## Files Changed

- `specs/plans/PRODUCT-INTEGRATION.md` — expanded scope, audit, model, API/file map, migration phases, acceptance criteria and new sections 11–14.
- `specs/plans/README.md` — updated plan description.

## Impact analysis

### Database

None now. Separate account links, customer/event constraints, typed business values and integration identity/outbox migrations are proposals only. Historical migrations remain unchanged; live policies/data must be inspected before implementation.

### Runtime

None. No staff/company/product/auth/frontend/API/plugin code was changed. The plan replaces forced customer creation and role-derived staff lookup only when implemented.

### API surface

None now. Proposed runtime-validated DTOs, stable UUID handoff, optional customer CRUD, scoped export/import and webhook contracts do not change current REST/MCP behavior.

## Verification

Reviewed affected source and migrations; checked Markdown links, structure and documentation-only diff scope. No build/typecheck/runtime gates run because no application code changed. Implementation test requirements are explicit in the plan.
