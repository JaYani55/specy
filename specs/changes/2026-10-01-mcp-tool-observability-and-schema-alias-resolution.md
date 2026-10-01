# MCP Tool Outcome Logging and Schema Identifier Resolution

## Summary

Improved operational visibility for MCP tool calls. Logs now identify the JSON-RPC/MCP operation (including the tool name), distinguish an inner tool failure from the outer HTTP transport response, and record a Supabase user ID/email only after verifying the bearer session. MCP tool errors now return `isError` and structured HTTP status for `update_system_data`, so clients no longer mistake a failed update for a successful tool call. The logger now reads the first JSON-RPC event from Streamable HTTP SSE responses; previously it only inspected JSON HTTP bodies, so it could not see the MCP tool result. The overlapping Hono mounts `/mcp` and `/mcp/*` also both matched the root endpoint, writing duplicate rows; a single `/mcp/*` mount now covers root and nested MCP paths.

The request used `schema_slug: "blog"`. The MCP tool resolves this as an API identifier first, then as a tenant-local `page_schemas.slug` if that slug uniquely identifies a schema visible under caller RLS. The previous tool also made an internal HTTP call to a URL from `system_config.public_url`. That indirection could send the write to a stale/different Worker even after resolving `blog`; the tool now updates through its authenticated Supabase client directly, sharing the same validation rules as the REST endpoint and enforcing RLS. Without the old response body or `public_url` value, I cannot prove which of those two paths caused the observed 404. Both failure modes are removed or made explicit: an unmatched/ambiguous schema becomes an MCP error, while validation or RLS failures are reported with useful status and error details.

## Files Added

- `api/lib/mcpObservability.ts` — parses MCP logical operation names, SSE responses, and inner tool outcomes.
- `migrations/202610010001_agent_logs_mcp_context.sql` — adds operation, verified actor, and transport-status columns to `agent_logs`.
- `tests/mcpObservability.test.mjs` — locks in MCP tool outcome and auth/public-page endpoint contracts.
- `specs/changes/2026-10-01-mcp-tool-observability-and-schema-alias-resolution.md` — this record.

## Files Changed

- `api/middleware/agentLogger.ts` — stores MCP operation/tool names, verified user ID/email, schema linkage, inner effective status, separate outer transport status, and nested MCP errors.
- `api/routes/mcp.ts` — resolves unambiguous tenant-local schema slugs, updates schema system data directly through the authenticated Supabase client, and returns structured MCP tool errors.
- `api/index.ts` — allows PATCH through CORS preflight and removes the duplicate MCP logger mount.
- `scripts/lib/migration-order.mjs` — registers the additive log-context migration after the agent-log table/hardening migrations.
- `src/types/pagebuilder.ts`, `src/components/pagebuilder/AgentLogs.tsx` — display operation/account identity and show transport status when it differs from the effective operation status.
- `specs/agents/agent-system-prompt.md`, `specs/agents/mcp-exposition.md` — clarify accepted schema identifiers, MCP OAuth, log semantics, and public published-page delivery.
- `specs/architecture/system-overview.md` — documents the new log fields and semantics.

## Security and Endpoint Behavior

- MCP `POST /mcp` rejects requests without OAuth with a 401 challenge. The schema/page management tools are only registered for a verified session, and direct database work remains subject to RLS.
- `PATCH /api/schemas/:slug/system-data` and `PUT /api/schemas/:slug/frontend-targets` require a verified bearer session and resolve schema access under that session's RLS context.
- `GET /api/schemas/:slug/pages` and its detail route intentionally remain public delivery endpoints: they expose published records only so public frontends can render them. They are not management APIs.
- Log actor identity is derived from `verifyAuthSession`, never from unverified request JSON/JWT payload. Credentials remain redacted and are not stored. Log read/delete access remains super-admin-only.

## Impact Analysis

- **Database:** Additive, idempotent migration adds nullable `operation_name`, `user_id`, `user_email`, and `transport_status_code` columns plus an actor/time index. No existing content data changes; apply this migration before deploying the Worker version that writes those columns.
- **Runtime:** MCP tool failures can be represented as tool errors even when HTTP/JSON-RPC transport succeeds. `status_code` records the inner failure where available; `transport_status_code` records the HTTP response. OAuth actor lookup is verified before persistence.
- **API surface:** MCP update accepts stable `api_slug`, or an unambiguous tenant-local schema slug as a convenience. The direct REST endpoint continues to require stable `api_slug`. CORS now permits PATCH preflights.

## Verification

- `npm run typecheck` — passed.
- `npm test` — passed (334 tests, including migration-order validation and MCP SSE parsing).
- API TypeScript check — no diagnostics for changed core API files; the overall check remains blocked by existing git-ignored PluraDash/generated plugin errors.
- `npm run build` — passed.
- `git diff --check` — passed.
