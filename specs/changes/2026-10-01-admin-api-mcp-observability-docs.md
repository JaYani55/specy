# Admin API MCP and Logging Documentation

## Summary

Completed the `/admin/api` catalog and verbosity-setting documentation for MCP schema/page management and the corrected MCP observability model. The catalog now documents the public published-page collection/detail REST endpoints, the authenticated `PATCH /api/schemas/:slug/system-data` endpoint, OAuth-protected MCP POST transport and its `specy_pages_schemas_*` tools, actor/status fields in logs, and the fact that HTTP 200 can contain an MCP tool failure. The verbosity UI explains that `POST /mcp` is one switch for all MCP methods/tools; it cannot be configured per tool name.

## Files Added

- `specs/changes/2026-10-01-admin-api-mcp-observability-docs.md` — this change record.

## Files Changed

- `src/lib/apiCatalog.ts` — documents published-only REST page delivery, MCP auth/tool behavior, tool error versus transport status, actor log fields, and the semantics of `POST /mcp` in logging configuration.
- `src/pages/VerwaltungApi.tsx` — explains MCP operation/account/status fields and the shared MCP verbosity toggle in the admin API/logging interface.
- `tests/mcpObservability.test.mjs` — verifies the admin catalog and verbosity UI retain these API/auth/logging contracts.

## Impact Analysis

- **Database:** None. No schema or persisted data changes.
- **Runtime:** None. This is documentation/test coverage for the existing MCP logger and verbosity configuration.
- **API surface:** No endpoint changes. Catalog documentation now distinguishes OAuth-protected MCP POST management calls from public GET discovery and published-page delivery APIs.

## Verification

- `npm run typecheck` — passed.
- `npm test` — passed (335 tests).
- `npm run build` — passed.
- `git diff --check` — passed.
