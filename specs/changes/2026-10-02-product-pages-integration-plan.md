# Product / Pages integration planning

## Summary

Audited the existing product administration, legacy page builder, schema-driven Pages editor, MCP/schema delivery, staff registry, event consumers and ordered migrations. Documented a proposed service-product rebuild with a shared Products/Pages editing workflow, frontend-first Astro/MCP contracts, optional curated staff presentation, separate public event pages, lossless JSON editing, tenant-safe aggregate mutations and staged legacy retirement.

This is a planning-only change. Proposed APIs, tables, migrations and file removals are not implemented.

## Files Added

- `specs/plans/PRODUCT-INTEGRATION.md` — detailed audit, architecture/UX/DX decisions, implementation file map, migration/rollback phases, verification and acceptance criteria. Populates the previously empty, untracked placeholder at this path.
- `specs/changes/2026-10-02-product-pages-integration-plan.md` — this record.

## Files Changed

- `specs/plans/README.md` — registers the plan in the knowledge-base index.

## Impact analysis

### Database

None. No migrations were added or executed; production constraints, ownership and data remain unchanged. The plan calls for live database verification before implementation.

### Runtime

None. No frontend, API, script, edge-function, generated-registry or plugin code was modified.

### API surface

None. New aggregate/schema-definition operations and relation envelopes are proposals only; existing REST/MCP contracts remain unchanged.

## Verification

Checked documentation links and repository diff scope. Build/typecheck/runtime gates were not run because this change is documentation-only; the plan specifies the required implementation gates and additional transaction/RLS, migration, UX and Astro delivery tests.
