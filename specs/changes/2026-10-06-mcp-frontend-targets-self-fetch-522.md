# MCP frontend-target replacement: remove 522-prone self-fetch

- **Date:** 2026-10-06
- **Scope:** MCP tool `specy_pages_schemas_replace_frontend_targets`, REST route `PUT /api/schemas/:slug/frontend-targets`

## Summary

Agents repeatedly received `Frontend-target update failed (522)` when calling `specy_pages_schemas_replace_frontend_targets`, while direct curl requests against the same API succeeded at the same time. Root cause: the MCP tool issued an internal HTTP fetch to the Worker's **own public URL** (`${baseUrl}/api/schemas/:slug/frontend-targets`). Worker-to-self subrequests travel back through the Cloudflare proxy; when the configured `public_url` host cannot be reached on that proxy path, Cloudflare answers with **522 (origin unreachable)** even though the API itself is healthy.

The fix removes the HTTP self-fetch. Target replacement now runs **in-process**:

- New shared function `replaceSchemaFrontendTargets(env, slug, targets, token)` in `api/lib/schemaRegistration.ts` — schema lookup via the caller's Supabase session, identical input validation (`validateSchemaFrontendTargetInputs`), atomic replacement via the existing `replace_schema_frontend_targets` admin RPC, then returns the fresh target list.
- The REST route (`PUT /api/schemas/:slug/frontend-targets`) now delegates to the shared function (auth + body parsing stay in the route). Behavior, validation, and response shape are unchanged.
- The MCP tool calls the shared function directly. The response/error JSON shape is unchanged.

## Files Added

- `tests/frontendTargetReplacement.test.mjs` — regression tests: no self-fetch to `frontend-targets` in the MCP surface, both surfaces share `replaceSchemaFrontendTargets`, validation invariants intact.
- `specs/changes/2026-10-06-mcp-frontend-targets-self-fetch-522.md` — this change record.

## Files Changed

- `api/lib/schemaRegistration.ts` — added `replaceSchemaFrontendTargets()`.
- `api/routes/schemas.ts` — `PUT /:slug/frontend-targets` delegates to the shared function.
- `api/routes/mcp.ts` — `specy_pages_schemas_replace_frontend_targets` calls the shared function instead of fetching its own URL.

## Impact analysis

- **Database:** none (same `replace_schema_frontend_targets` RPC, same validation).
- **Runtime:** one fewer HTTP round-trip per target replacement; no dependence on the configured `public_url` reachability.
- **API surface:** unchanged request/response contracts for both REST and MCP.

## Verification

- `npm run typecheck:api` — clean for all touched `api/` files.
- `npm test` — 426 tests pass (3 new).
