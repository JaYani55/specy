# 2026-10-26 — Products: Full Agentic Control over REST and MCP (AX)

## Summary

Closes the last documented gap in the agentic product lifecycle: **schema
reassignment** was only reachable over REST (`PATCH /api/products/:id/schema`)
— there was no dedicated MCP tool
(`specs/agents/product-catalogue-integration.md` previously stated: *"There is
not yet a dedicated MCP schema-reassignment tool."*).

With this change the whole product process is controllable agentically and
programmatically over both surfaces:

- **MCP** (`POST /mcp`, OAuth 2.1): `specy_products_list`, `_create`, `_get`,
  `_update`, `_publish`, `_archive`, `_delete`, and the new
  **`specy_products_reassign_schema`** — plus schema setup via
  `specy_pages_schemas_*` and event scheduling via the event-aware page tools.
- **REST** (`/api/products`, Supabase JWT): list, by-page, get, create, update,
  schema reassignment, publish, archive, delete — unchanged, already complete.

### Seamless agent experience (AX)

- The new tool mirrors the REST contract 1:1 (`tenant_id`, `expected_version`,
  `schema_id`, `expected_definition_revision`) and reuses the same aggregate
  service (`changeProductSchemaAggregate` → `change_service_product_schema_aggregate` RPC).
- Lifecycle tool results now carry **`next_step` hints**: `create` (draft →
  edit → publish), `publish` (public delivery + archive/delete options),
  `archive` (reversible retirement + permanent-delete pointer) — agents can
  chain the lifecycle without leaving the tool loop.
- The tool is advertised in all discovery surfaces: `/.well-known/mcp.json`
  tools array, MCP `AUTHENTICATED_MCP_TOOLS` / tool-name list in
  `api/routes/mcp.ts`.

## Files Changed

- `api/routes/mcp.ts` — new `specy_products_reassign_schema` tool
  (`changeProductSchemaAggregate` import, registration, both tool-name lists);
  `next_step` hints on create/publish/archive results
- `api/index.ts` — added the tool to the `/.well-known/mcp.json` discovery
  payload
- `src/lib/apiCatalog.ts` — `/admin/api`: MCP catalog entry (`POST /mcp`) now
  documents the complete `specy_products_*` family incl. `reassign_schema` and
  the `next_step` hints; `products-create` and `products-change-schema` entries
  cross-reference their MCP mirrors
- `tests/schemaAgentTools.test.mjs` — tool-name registry assertion extended;
  new REST↔MCP lifecycle-parity test (every REST lifecycle route has a
  discovery-advertised MCP tool)
- `specs/agents/product-catalogue-integration.md` — reassignment paragraph
  rewritten (dedicated MCP tool now exists); "Full agentic control" section
- `specs/agents/mcp-exposition.md` — built-in tools list + products workflow
  note
- `specs/features/service-products.md` — MCP tool list + AX note

## Impact Analysis

### Database

- None. The tool calls the existing `change_service_product_schema_aggregate`
  RPC under caller RLS (migration `202610050004_product_schema_reassignment.sql`).

### Runtime

- MCP-layer only: one additional registered tool and response-envelope hints.
  REST responses are unchanged (hints are added at the MCP tool layer only).

### API Surface

- New MCP tool `specy_products_reassign_schema` (authenticated callers only).
- `/.well-known/mcp.json` tools array extended.
- No changes to existing REST endpoints or tool signatures.
