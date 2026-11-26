# n8n Integration (`n8n-nodes-specy`)

> **Status:** Implemented (2026-11-27, v0.2.0) · **Repository:** `plugins/n8n-nodes-specy/` —
> separate git repository (gitignored satellite repo, same convention as Specy plugins —
> it is *not* a plugin: no `PluginDefinition`, hooks, registry entries, migrations, or
> binding intents). Upstream home: `github.com/pluracon/n8n-nodes-specy`.
> **Related:** [`../plans/n8n-nodes-specy-connector-plan.md`](../plans/n8n-nodes-specy-connector-plan.md) (plan) ·
> [`../platform/webhooks.md`](../platform/webhooks.md) (delivery contract) ·
> [`../auth/api-tokens.md`](../auth/api-tokens.md) (PAT exchange) ·
> [`mcp-exposition.md`](mcp-exposition.md) (the agentic alternative)

## 1. Purpose

`n8n-nodes-specy` is an [n8n community node package](https://docs.n8n.io/integrations/community-nodes/)
that lets automation workflows call the Specy REST API directly — deterministic, typed,
no LLM round-trip. It covers outbound automation ("n8n calls Specy") for objects, specs,
forms, media, page schemas, pages, products and the knowledge base, plus a signed
webhook trigger for reactive flows ("Specy event → n8n runs").

**REST vs. MCP:** the connector targets the stable `/api/*` REST surface for
high-frequency automation. For agentic (LLM-driven) flows, the MCP surface
([`mcp-exposition.md`](mcp-exposition.md)) remains the right entry point.

## 2. Authentication

| Aspect | Contract |
|---|---|
| Credential | `SpecyApi` — Base URL + API token (password field), generic Bearer header auth (`genericAuth: true`, usable in the HTTP Request node for uncovered endpoints) |
| Token | PAT (`spc_…`), created in dashboard *Admin → API* or MCP `agent_tokens_create`; exchanged transparently for a short-lived session by the Worker (`verifyAuthSession`, [`../auth/api-tokens.md`](../auth/api-tokens.md) §4) |
| Authority | PAT never exceeds the creating account's roles (RLS-identical); use a dedicated `user` account with workspace membership for automation. The `agent` role is not leveraged by the connector |
| Subscription writes | Creating webhook subscriptions requires a **`support` or `super-admin`** PAT (webhook RBAC) — a normal automation account cannot self-provision triggers |

## 3. Node surface → REST mapping

The `Specy` node exposes a two-level `resource` → `operation` dropdown. Source of truth
for every contract is `api/routes/*.ts` in the core repo.

### 3.1 Object (`/api/objects`)

| Operation | HTTP | Notes |
|---|---|---|
| List | `GET /api/objects` | Optional `tenantId`; server-side pagination via `limit` (≤500) + `offset` (response includes `total`); `updated_since` ISO filter for polling watermarks |
| Get | `GET /api/objects/:idOrSlug` | UUID or slug |
| Create | `POST /api/objects` | `name`, `slug`, `object_type`, `schema`, `data`, `status` |
| Update | `PUT /api/objects/:id` | Field-wise patch; managed Product objects → `409` |
| Update Access | `PATCH /api/objects/:id/access` | `api_enabled` + `requires_auth` (both required, booleans) |
| Datastreams | `GET /api/objects/datastreams` | Discovery for dynamic data wiring |
| Delete | `DELETE /api/objects/:id` | **Soft delete → archives** (`status: archived`) |

### 3.2 Spec (`/api/specs`)

List (`GET /api/specs` — Bearer returns the full tenant registry), Get (`/:slug`),
Create (`POST /api/specs`, tenant scope), Update (`PUT /:id`), Delete (`DELETE /:id`).
`POST /global` is super-admin only and intentionally not exposed.

### 3.3 Form (`/api/forms`)

| Operation | HTTP | Notes |
|---|---|---|
| List | `GET /api/forms` | Published forms |
| Get | `GET /api/forms/:identifier` | UUID or `tenantName/formSlug` (encoded per segment) |
| Get Answers | `GET /api/forms/:identifier/answers` | Requires `api_enabled` on the form |
| Submit Answers | `POST /api/forms/:identifier/answers` | `{ answers, submitter_name? }`; requires `api_enabled`, poll deadline enforced (`403` when closed) |

### 3.4 Media (`/api/media`)

| Operation | HTTP | Notes |
|---|---|---|
| List | `GET /api/media/list` | Returns `{ items, storage? }` — optional `source`/`scope` (`media`\|`files`) |
| Upload | `POST /api/media/upload?source=&scope=` | **multipart/form-data**: `file`, `path?`; n8n binary buffer |
| Delete | `DELETE /api/media/file?path=&source=&scope=` | Storage path from List |
| Sources | `GET /api/media/sources` | Feeds the dynamic source picker |
| Config | `GET /api/media/config` | Provider diagnostics |

### 3.5 Schema (`/api/schemas`)

| Operation | HTTP | Notes |
|---|---|---|
| List | `GET /api/schemas` | Feeds the dynamic schema picker (`api_slug` values) |
| List / Get / Import Templates | `GET /templates`, `GET /templates/:slug`, `POST /templates/import` | Import takes a validated `url` |
| Update Definition | `PATCH /api/schemas/:slug/definition` | Optimistic concurrency: `expected_revision` required |
| Get Spec (JSON/Text) | `GET /:slug/spec`, `/:slug/spec.txt` | LLM-ready schema specification |
| Get Manifest | `GET /:slug/manifest` | Frontend manifest |
| Delete | `DELETE /:slug` | — |

Admin-only routes (`/admin/domains*`, revalidation-secret management) are not exposed.

### 3.6 Page (`/api/schemas/:slug/pages*`)

| Operation | HTTP | Notes |
|---|---|---|
| List / Get | `GET /:slug/pages`, `GET /:slug/pages/:pageSlug` | Public delivery surface of registered schemas (published content; drafts with bearer) |
| Create | `POST /:slug/pages` | Plain `page` kind: `name`, `content` (≤1 MiB), `slug?`, `status?`; catalogue kinds route through the aggregate API |
| Update | `PATCH /:slug/pages/:pageId` | Catalogue schemas (event/service-product) require `tenant_id`, `expected_definition_revision` (+ `expected_page_updated_at` for events); updates auto-push ISR revalidation |
| Revalidate | `POST /:slug/revalidate` | `{ page_slug }` — requires `registration_status === 'registered'` |
| Register | `POST /:slug/register` | `{ code, frontend_url }` |

### 3.7 Product (`/api/products`)

Strict optimistic concurrency on every mutation — **read-modify-write**: List/Get first,
then pass `expected_version` (+ `expected_definition_revision` for content/schema
mutations) back. A `409` means the entity changed concurrently → refetch and retry.

| Operation | HTTP | Required body |
|---|---|---|
| List / Get | `GET /?tenant_id=…`, `GET /:id?tenant_id=…` | `tenant_id` always required |
| Create | `POST /` | `tenant_id`, `schema_id`, `idempotency_key` (UUID — node generates when empty), `expected_definition_revision`, `name`, `content` (≤1 MiB); returns `editor_url` |
| Update | `PATCH /:id` | concurrency + ≥1 of `name`/`slug`/`content`/`custom_fields` |
| Publish | `POST /:id/publish` | concurrency + `status: draft\|published` |
| Archive / Delete | `POST /:id/archive`, `DELETE /:id` | concurrency (`expected_version`) |

### 3.8 Knowledge Base (`/api/knowledge-base`)

**Sync Entity** — `POST /api/knowledge-base/sync` with `{ sourceTable, sourceRecordId, tenantId? }`.
Dispatches to the `knowledgeBase.sync.invoke` plugin hook; without an active handler the
core answers `501` (surfaced as "feature not active").

## 4. Trigger node (`specyTrigger`)

Programmatic-style webhook trigger consuming signed deliveries from the outbound webhook
subsystem ([`../platform/webhooks.md`](../platform/webhooks.md)). n8n requires trigger
nodes to be programmatic style; community packages may mix a declarative action node
(`Specy`) with a programmatic trigger node (`SpecyTrigger`).

Setup flow:

1. Copy the trigger's Production webhook URL (n8n auto-generates `webhookId`; path
   `={{$parameter.webhookId}}`, `responseMode: 'onReceived'`).
2. Create the subscription in the Specy dashboard (*Admin → Webhooks*) pointing at that
   URL — requires a `support`/`super-admin` PAT. The signing secret is returned **exactly
   once**.
3. Paste the signing secret into the trigger node.

Verification contract (`X-Specy-*` headers, [`../platform/webhooks.md`](../platform/webhooks.md) §3):

| Header | Meaning |
|---|---|
| `X-Specy-Signature` | `sha256=<hex HMAC-SHA256(raw body, signing secret)>` — verified with `timingSafeEqual` over n8n's raw request body; mismatch → error before any workflow run (Specy's queue retries) |
| `X-Specy-Event` | Event type, also available as `$json.event` |
| `X-Specy-Delivery` | Delivery job UUID (idempotency key for downstream dedupe) |

Payload shape: `{ event, tenant_id, occurred_at, data: { id, name, slug, object_type } }` —
one n8n item per delivery. An event-filter multi-select drops non-selected events
(acknowledged without emitting items). Initial core event surface:
`object.created`, `object.updated`, `object.archived`.

## 5. Dynamic pickers (`loadOptions`)

Workspace (`tenant_id`, derived from the objects list), Object, Schema (`api_slug`),
Template, Form and Media source selectors are populated live from the API — no manual
ID copying.

## 6. Error semantics

All transport errors are wrapped in `NodeApiError` with the Specy error body
(`{ error: string }`) preserved plus actionable hints:

| Status | Hint |
|---|---|
| `401` | PAT unknown/revoked/expired — recreate in *Admin → API* |
| `403` | Missing role or workspace membership |
| `404` | Entity does not exist (or archived object addressed by id) |
| `409` | Slug/share conflict, Product-managed object, or stale expected version — refetch and retry |
| `501` | Plugin handler not active (e.g. Knowledge Base sync without Pluradash) |

## 7. Testing & release hygiene

- Unit tests per resource in the connector repo (`vitest`, mocked `helpers.request`)
  mapping operation → method/URL/body, plus HMAC signature tests.
- n8n dev-instance smoke test per operation against a local `npm run dev:api` Worker
  before each release.
- Implementation notes: `plugins/n8n-nodes-specy/docs/phase-2-implementation-plan.md`;
  change record: [`../changes/2026-11-27-n8n-nodes-specy-full-connector.md`](../changes/2026-11-27-n8n-nodes-specy-full-connector.md).

## 8. Licensing & boundary

The connector is a **separate work** (MIT) and imports nothing from the core repo —
it speaks HTTP only. It is not a Specy plugin (no hooks, no registry, no migrations,
no binding intents). The `plugins/` location is purely a workspace convention.
Core remains EUPL-1.2 (see [`../plugins/eupl-compliance.md`](../plugins/eupl-compliance.md)).
