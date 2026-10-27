# 2026-10-27 — MCP Event Creation Requires a Service Product (Soft Failure)

## Summary

In a test run an agent created an event **without a product** — an event that
can never be publicly delivered with its service context and breaks the
catalogue model (products describe the offering, events are scheduled
occurrences of one). MCP event creation now **requires** a service product
reference:

- `create_page` and `specy_pages_schemas_create_page` (the two event-creation
  MCP paths) run a guard when the resolved schema has `entity_kind: 'event'`.
- A missing/empty `event.product_id` returns a **structured soft failure** —
  never an exception: `isError` tool result with HTTP **422**, stable code
  **`product_required`** and a `next_step` instruction
  (create the product with `specy_products_create` — including its product
  information/content — then retry with `event.product_id`). The MCP session
  stays intact and the agent can recover in the same loop.
- **Soft-failure logging:** the agentLogger middleware persists the failed
  attempt (error text, effective `http_status`, tool `operation_name`) to
  `public.agent_logs`, so operators can see product-less event attempts
  without any hard failure breaking the transport or session.
- **REST/dashboard unchanged by the guard:** `POST /api/schemas/:slug/pages`
  and the dashboard event editor keep their own product-validation UX — the
  guard is an MCP/agent contract (agents have `specy_products_create`
  available; humans may attach a product later in the editor).

## Files Changed

- `api/routes/mcp.ts` — `requireEventProductGuard()` (pure decision function);
  wired into the event branches of `create_page` and
  `specy_pages_schemas_create_page` **before** the aggregate write (no event
  row is created without a product); tool descriptions + `product_id`
  schema description updated; `start_here` workflow guidance updated
- `src/lib/apiCatalog.ts` — `/admin/api` MCP catalog entry documents the
  requirement and the soft-failure contract
- `tests/schemaAgentTools.test.mjs` — guard contract test (code, 422,
  event-only scope, both tool paths wired, guard precedes the aggregate write)
- `specs/agents/event-catalogue-integration.md` — setup step 4 + pages-post
  contract updated (product required, soft-failure semantics, invalid-UUID
  behavior)
- `specs/agents/mcp-exposition.md` — products/event workflow notes + agent
  workflow step 7
- `specs/agents/product-catalogue-integration.md` — "Workflow ordering —
  products before events" paragraph

## Impact Analysis

### Database

- None.

### Runtime

- MCP-layer only. Events that would previously have been created product-less
  now abort before `createEventPageAggregate` — no orphan rows, no partial
  writes (the guard precedes the write).
- `agent_logs` gains rows for rejected attempts (existing middleware behavior
  for tool-level failures).

### API Surface

- MCP `tools/call` for event creation without `event.product_id` now returns
  an `isError` result with `http_status: 422`, `code: 'product_required'`,
  `next_step`.
- REST `POST /api/schemas/:slug/pages` event behavior unchanged.
