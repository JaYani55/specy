# 2026-11-27 — n8n Connector Fully Implemented (`n8n-nodes-specy` v0.2.0)

## Summary

Implemented the complete **`n8n-nodes-specy`** n8n community node package (separate git
repository at `plugins/n8n-nodes-specy/`, satellite-repo convention — see the scaffold
change record
[`2026-11-25-n8n-nodes-specy-connector-scaffold.md`](2026-11-25-n8n-nodes-specy-connector-scaffold.md)
and the plan
[`../plans/n8n-nodes-specy-connector-plan.md`](../plans/n8n-nodes-specy-connector-plan.md)).
All connector phases from the plan are now live: the three Media bugs fixed, Phase 1.5
additions to existing resources, the four Phase-2 resources (Schema, Page, Product,
Knowledge Base), the signed `specyTrigger` webhook trigger node, dynamic `loadOptions`
pickers, central status-hint error mapping, and a unit test suite (26 tests, all passing).

Agent-facing documentation: [`../agents/n8n-integration.md`](../agents/n8n-integration.md).

## Files Added

- `plugins/n8n-nodes-specy/` (connector repo, not the core repo)
  - `nodes/Specy/Schema.resource.ts`, `Page.resource.ts`, `Product.resource.ts`, `KnowledgeBase.resource.ts` — new resources
  - `nodes/Specy/SpecyTrigger.node.ts` — programmatic webhook trigger with `sha256=` HMAC signature verification (`timingSafeEqual` over n8n's raw request body) and event filter
  - `tests/resources.test.ts`, `tests/signature.test.ts` — vitest suite (operation → method/URL/body mapping per resource, signature contract)
  - `docs/phase-2-implementation-plan.md` — implementation plan/prep doc (marked implemented)
- `specs/agents/n8n-integration.md` — agent-facing integration doc

## Files Changed

- `plugins/n8n-nodes-specy/` — connector repo only:
  - `Media.resource.ts` — **fixed 3 bugs**: upload now sends real multipart/form-data (file + path, `scope`/`source` as query params) instead of serializing the form data into the query string; delete targets `/api/media/file` (was the non-existent `/api/file`); list extracts `{ items }` (was reading a non-existent `files` key, always empty). Added Sources/Config operations and a `scope` selector
  - `Object.resource.ts` — list supports `limit`/`offset` (≤500) + `updated_since`; new `updateAccess` (PATCH `/api/objects/:id/access`) and `datastreams` operations
  - `Form.resource.ts` — new `submitAnswers` operation; form identifiers encoded per path segment (composite `tenantName/formSlug` keeps its slash)
  - `GenericFunctions.ts` — multipart request support, status-hint error mapping (401/403/404/409/501), shared JSON field parser
  - `Specy.node.ts` — registers all 8 resources + operations, all parameter fields, 6 `loadOptions` dynamic pickers (Workspaces, Objects, Schemas, Templates, Forms, Media sources)
  - `Spec.resource.ts` — unchanged (attachments endpoint remains a deferred Phase-3 item)
  - `package.json` / `package-lock.json` — version 0.2.0, trigger node registered in the `n8n` manifest, `vitest` devDependency and `test` script
  - `index.ts` — exports the trigger node; `README.md` — full documentation incl. read-modify-write pattern and polling-watermark recipe
- `specs/agents/README.md` — registered `n8n-integration.md`.

## Deferred (documented, not implemented)

- Spec attachments (`PUT /api/specs/schema/:schemaId/attachments`) — plan §4.2 Phase 3, low priority.
- Trigger self-provisioning of webhook subscriptions (v1.1 candidate) — requires a
  `support`/`super-admin` PAT per the webhook RBAC.

## Impact Analysis

- **Database:** none — no core migration; the connector consumes the existing REST surface.
- **Runtime:** none — the connector is a separate npm package; no core code paths changed.
  Core features it builds on were already implemented on 2026-11-25 (objects pagination,
  `updated_since`, outbound webhook subsystem).
- **API surface:** unchanged — all requests map onto existing `/api/*` routes. The connector
  intentionally does not expose super-admin routes (`/api/schemas/admin/domains*`,
  revalidation-secret management) or `POST /api/specs/global`.
- **Licensing:** connector is MIT (separate work); core remains EUPL-1.2. No core imports.
- **Test gates:** connector build (`tsc` + icon copy) clean; 26/26 vitest tests pass;
  compiled nodes smoke-tested via `require` (manifest shape, webhook description, signature helper).
