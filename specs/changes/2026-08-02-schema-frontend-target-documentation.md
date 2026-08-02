# Schema Frontend Target Documentation

## Summary

Updates the pagebuilder, MCP, and tenancy documentation to describe the implemented frontend-target registry. The documentation now distinguishes collection slots from optional detail routes and explicitly treats browser fragments as frontend-local.

## Files Added

- `tests/targetContracts.test.mjs`
- `specs/changes/2026-08-02-schema-frontend-target-documentation.md`

## Files Changed

- `specs/Architecture_Pagebuilder.md`
- `specs/Specs_MCP_Exposition.md`
- `specs/multi-tenancy.md`
- `specs/changes/2026-08-02-schema-frontend-target-tests.md`

## Impact

No schema or content data is changed. Documentation and tests now reflect that `/` is a valid collection host path, `/posts/:slug` is an optional detail target, and `/#posts` is not a server route or cache invalidation target.
