# MCP Tool Outcome Logging and Schema Identifier Resolution

## Summary

Improved operational visibility for MCP tool calls. Logs now identify the JSON-RPC/MCP operation (including the tool name), distinguish an inner tool failure from the outer HTTP transport response, and record a Supabase user ID/email only after verifying the bearer session. MCP tool errors now return `isError` and structured HTTP status for `update_system_data`, so clients no longer mistake a failed update for a successful tool call.

The failed URL update used `schema_slug: "blog"`. The update implementation passed that value to REST `PATCH /api/schemas/:slug/system-data`, whose route resolves `:slug` as the stable `api_slug`, not the tenant-local `page_schemas.slug`. The tenant-local-slug migration gives new schemas opaque UUID API identifiers, so this mismatch explains the observed 404 when `blog` is the local schema slug. The MCP tool now resolves a stable `api_slug` directly or accepts a tenant-local slug only when it uniquely identifies one schema visible under the caller's RLS; ambiguous values return a clear 409 with candidate API identifiers.

## Files Added

- `api/lib/mcpObservability.ts` — parses MCP logical operation names and inner tool outcomes.
- `migrations/202610010001_agent_logs_mcp_context.sql` — adds operation, verified actor, and transport-status columns to `agent_logs`.
- `tests/mcpObservability.test.mjs` — locks in MCP tool outcome and auth/public-page endpoint contracts.
- `specs/changes/2026-10-01-mcp-tool-observability-and-schema-alias-resolution.md` — this record.

## Files Changed

- `api/middleware/agentLogger.ts` — stores MCP operation/tool names, verified user ID/email, schema linkage, inner effective status, separate outer transport status, and nested MCP errors.
- `api/routes/mcp.ts` — resolves unambiguous tenant-local schema slugs for system-data edits and returns standard MCP tool errors with structured HTTP status.
- `api/index.ts` — allows PATCH through CORS preflight for REST clients.
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
- `npm test` — passed (333 tests, including migration-order validation).
- API TypeScript check — no diagnostics for changed core API files; the overall check remains blocked by existing git-ignored PluraDash/generated plugin errors.
- `npm run build` — passed.
- `git diff --check` — passed.
