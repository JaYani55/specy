# MCP Page and Schema Management Tools

## Summary

Added an authenticated `specy-pages > schemas` MCP tool family for inspecting schemas, listing and reading page records, creating and editing page content, and editing page-owned system fields. Schema system metadata can now be repaired without restarting frontend registration; in particular, an authenticated agent can correct `frontend_url` after confirming the intended destination. The REST update endpoint validates outbound URL safety and schema canonical-URL requirements.

Before this change, MCP exposed schema discovery/specification and page creation, but had no page-list, page-read, page-update, or direct schema-system-data repair tool. REST `GET /api/schemas/:slug/pages` is a published-content delivery API, not a management endpoint; frontend registration updates were gated by the one-time registration code. Authenticated `PUT /api/schemas/:slug/frontend-targets` already existed for target metadata.

## Files Added

- `api/lib/schemaPages.ts` — reusable CMS-compatible page slug normalization.
- `api/lib/schemaSystemData.ts` — safe validation/normalization for editable schema integration fields.
- `tests/schemaAgentTools.test.mjs` — validation, slug, and MCP/REST contract tests.
- `specs/changes/2026-10-01-mcp-page-schema-management.md` — this change record.

## Files Changed

- `api/routes/mcp.ts` — registers the authenticated `specy_pages_schemas_*` tools, including schema listing/detail, page listing/detail/create/update, schema system-data update, and frontend-target replacement; updates `start_here` guidance.
- `api/routes/schemas.ts` — adds authenticated `PATCH /api/schemas/:slug/system-data`; permits OAuth agent sessions on the existing frontend-target update route while retaining row-level security as the data-scope authority.
- `api/index.ts` — advertises the new MCP tools in MCP discovery metadata.
- `src/lib/apiCatalog.ts` — documents the new PATCH route in the API catalog.
- `src/pages/VerwaltungApi.tsx` — adds the PATCH method badge style.
- `specs/agents/agent-system-prompt.md` — adds the agent workflows/contracts for schema and page management and URL repair.
- `specs/agents/mcp-exposition.md` — documents the tools, auth, and REST system-data endpoint.
- `specs/architecture/page-builder.md` — documents the endpoint and MCP management surface.

## Tooling Contract

Tool names are grouped under the `specy-pages > schemas` hierarchy:

- `specy_pages_schemas_list`, `specy_pages_schemas_get`
- `specy_pages_schemas_list_pages`, `specy_pages_schemas_get_page`
- `specy_pages_schemas_create_page`, `specy_pages_schemas_update_page`
- `specy_pages_schemas_update_system_data`, `specy_pages_schemas_replace_frontend_targets`

Schema/page writes use the authenticated Supabase session and remain subject to RLS. Page content is preserved as arbitrary JSON; updates replace the complete content value and do not normalize keys. Page system fields supported by the page update tool are `name`, `slug`, `status`, and `domain_url`; schema-level integration data supports `frontend_url`, legacy `slug_structure`, and `revalidation_endpoint`. Registration codes and managed revalidation secrets are never accepted by the system-data endpoint.

## Impact Analysis

- **Database:** No migration or schema change. Existing `page_schemas`, `pages`, and `schema_frontend_targets` data are updated only through existing columns/tables and existing RLS policies.
- **Runtime:** MCP schema/page management tools require an authenticated MCP session. Schema and page reads/writes remain scoped by Supabase RLS. Frontend URLs are normalized to their origin and validated against outbound-target and canonical-URL rules. Target replacement continues using the existing validated/atomic target API.
- **API surface:** Adds authenticated `PATCH /api/schemas/:slug/system-data`, accepting only `frontend_url`, `slug_structure`, and `revalidation_endpoint`. Existing published-page delivery endpoints remain published-only. Existing target replacement is now callable by OAuth agent sessions as well as human sessions, with schema access still enforced by RLS.

## Verification

- `npm run typecheck` — passed.
- `npm test` — passed (328 tests).
- `npm run build` — passed.
- Local Worker smoke test — `PATCH /api/schemas/not-a-schema/system-data` without a bearer token returned the expected `401 Unauthorized`.
- `npm run typecheck:api` — reports existing errors in the git-ignored `plugins/pluradash` workspace and generated plugin metadata; no diagnostics were reported for the core files changed here.
