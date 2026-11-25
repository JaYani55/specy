# Plan: `n8n-nodes-specy` — n8n Connector Package for Specy

> **Status:** Scaffold created (2026-11-25) · reviewed 2026-11-25 (scope decisions: no
> webhook subsystem, no account-type work — see §6/§7) · implementation phases below are pending.
> **Repository:** `plugins/n8n-nodes-specy/` — **separate git repository**, gitignored by the
> core repo (same convention as Specy plugins). Intended upstream home:
> `github.com/pluracon/n8n-nodes-specy`.
> **Related:** [`../auth/api-tokens.md`](../auth/api-tokens.md) · [`../architecture/system-overview.md`](../architecture/system-overview.md)

---

## 1. Goal

An [n8n community node package](https://docs.n8n.io/integrations/community-nodes/) that lets
automation workflows call the Specy REST API directly: create/update/query data objects, read
forms submissions, manage media, and (later) drive page schemas and products — without
embedding agents or browser flows.

- **Package name:** `n8n-nodes-specy`
- **License:** MIT (separate work — see §9)
- **Auth:** Specy Personal Access Tokens (PAT, `spc_…`) via the transparent Bearer exchange
  ([`../auth/api-tokens.md`](../auth/api-tokens.md) §4)

### Why REST and not MCP?

Specy exposes an MCP surface, and n8n has MCP client nodes — but for deterministic,
high-frequency automation the typed REST surface is the right target: no LLM round-trip,
stable operation parameters, native n8n error handling and retries. MCP remains the path for
agentic flows.

---

## 2. Repository Layout (scaffolded)

```
plugins/n8n-nodes-specy/          # own .git repo
├── package.json                  # n8n manifest (credentials + nodes), MIT
├── tsconfig.json                 # tsc → dist/
├── index.ts                      # package entry point
├── credentials/
│   └── SpecyApi.credentials.ts   # Base URL + PAT, generic header auth
├── nodes/Specy/
│   ├── Specy.node.ts             # resource/operation router + execute()
│   ├── GenericFunctions.ts       # specyApiRequest() + envelope extraction
│   ├── Object.resource.ts        # /api/objects            (implemented)
│   ├── Spec.resource.ts          # /api/specs              (implemented)
│   ├── Form.resource.ts          # /api/forms              (implemented)
│   ├── Media.resource.ts         # /api/media              (implemented)
│   └── specy.svg                 # node icon
├── scripts/copy-assets.mjs       # copies icons into dist/
└── README.md / LICENSE / .gitignore / .npmignore
```

Build: `npm run build` (`tsc` + icon copy). The `n8n` field in `package.json` points at
`dist/credentials/SpecyApi.credentials.js` and `dist/nodes/Specy/Specy.node.js`.

---

## 3. Authentication Design

| Aspect | Decision |
|---|---|
| Credential type | `SpecyApi` — **Base URL** + **API Token** (password field) |
| Token format | PAT (`spc_<43-char base64url>`), created in dashboard *Admin → API* or via MCP `agent_tokens_create` |
| Transport | `Authorization: Bearer spc_…`; the Worker exchanges the PAT for a real session transparently (`verifyAuthSession`) |
| Authority | PAT **never exceeds** the creating account's roles (RLS-identical); no token chaining (PAT sessions cannot mint PATs) |
| Account setup | A **normal `user`-role account** with membership in the target workspace(s), used only for automation. No new account type is needed — the `agent` role/`is_agent` claim exists but grants no API powers and is deliberately not used by the connector (2026-11-25 review decision) |
| Rate/caps | Max 10 active PATs per account; ~1 h access-token lifetime handled server-side (no client refresh logic needed) |
| Failure semantics | Unknown/revoked/expired PAT → `401` with RFC 9728 `WWW-Authenticate` challenge; surfaced as `NodeApiError` in n8n |

The credential also sets `genericAuth = true` so the same credential can be used in the
generic n8n *HTTP Request* node for endpoints not yet covered by dedicated resources.

---

## 4. Resource / Operation Matrix (Phase 1 — implemented in scaffold)

Source of truth: `api/routes/*.ts` in the core repo.

### 4.1 Object (`/api/objects`)

| Operation | HTTP | Endpoint | Notes |
|---|---|---|---|
| List | GET | `/api/objects` | Optional `tenantId` filter. Authenticated callers see RLS-allowed rows; generated Product objects are filtered out. **No server-side pagination** (see §7) |
| Get | GET | `/api/objects/:idOrSlug` | Accepts UUID id or slug |
| Create | POST | `/api/objects` | Body: `name`, `slug`, `object_type` (`json`/`markdown`), `schema`, `data`, `status`, `api_enabled`, `requires_auth`, `share_*`, `tenant_id`. Requires role `user` + workspace membership |
| Update | PUT | `/api/objects/:id` | Field-wise patch semantics; managed Product objects return `409` |
| Delete | DELETE | `/api/objects/:id` | **Soft delete → archives** (`status: archived`); UI mirrors this |
| (Phase 2) Access | PATCH | `/api/objects/:id/access` | Toggle `requires_auth` / `api_enabled` / share settings |
| (Phase 2) Datastreams | GET | `/api/objects/datastreams` | Datastream discovery for dynamic data wiring |

### 4.2 Spec (`/api/specs`)

| Operation | HTTP | Endpoint | Notes |
|---|---|---|---|
| List | GET | `/api/specs` | Unauthenticated call returns the **public discovery surface** (published specs + `mcp_endpoint`); with Bearer returns full tenant + global registry |
| Get | GET | `/api/specs/:slug` | Spec bundle |
| Create | POST | `/api/specs` | Tenant spec; `POST /global` is super-admin only (out of scope for n8n) |
| Update | PUT | `/api/specs/:id` | |
| Delete | DELETE | `/api/specs/:id` | |
| (Phase 3) Attachments | PUT | `/api/specs/schema/:schemaId/attachments` | |

### 4.3 Form (`/api/forms`)

| Operation | HTTP | Endpoint | Notes |
|---|---|---|---|
| List | GET | `/api/forms` | Authenticated |
| Get | GET | `/api/forms/:identifier` | UUID or `tenantName/formSlug` |
| Get Answers | GET | `/api/forms/:identifier/answers` | Submissions; also exists as public share route for API-enabled forms |

Form **submission** from n8n (`POST …/answers`) is intentionally *not* a node operation in
Phase 1 — n8n usually *consumes* answers; bots submitting forms is better done through the
public share endpoint when actually needed (Phase 2 operation `Submit Answer`).

### 4.4 Media (`/api/media`)

| Operation | HTTP | Endpoint | Notes |
|---|---|---|---|
| List | GET | `/api/media/list` | Optional `source` filter |
| Upload | POST | `/api/media/upload` | Multipart (`file`, `path`, `source`, `scope`); uses n8n binary data buffer |
| Delete | DELETE | `/api/media/file` | Query param `path` (storage path), optional `scope`/`source` |
| (Phase 2) Sources | GET | `/api/media/sources`, `/api/media/config` | For dynamic source pickers |

### 4.5 Shared Node UX

- `resource` → `operation` two-level dropdown (n8n standard pattern).
- JSON fields (`schema`, `data`) accept raw JSON strings or objects; parsed before send.
- **Phase 2:** `loadOptions` for dynamic pickers — *Object*, *Form*, *Schema*, *Workspace*
  selectors populated from the live API (removes manual ID copying).
- Response envelopes normalized (`{ objects: [] }`, `{ specs: [] }`, …) into n8n items.

---

## 5. Phase 2 — Page Schemas, Products, Knowledge Base

| Resource | Endpoints (core) | Planned operations |
|---|---|---|
| Schema | `/api/schemas`, `/api/schemas/templates*` | List schemas, list/get/import templates |
| Page | `/api/schemas/:slug/pages*` | List, Get (by page id/slug), Create, Update (`PATCH pages/:pageId`), Register, Revalidate (`POST /:slug/revalidate`) |
| Product | `/api/products` | List, Get, Create, Update, Publish, Archive, Delete |
| Knowledge Base | `/api/knowledge-base/sync` | Trigger KB sync for an entity |

Page payloads are the schema-driven PageBuilder content JSONB — the node should expose
`content` as a JSON field plus a *Register + Revalidate* convenience operation so automations
can push generated pages and bust ISR caches in one step.

---

## 6. Trigger Story (2026-11-25 review decision)

The connector scope is **outbound automation** ("n8n calls Specy"). For that, no trigger
mechanism and no webhook subsystem is needed. Reactive workflows ("Specy event → n8n
runs") are **explicitly out of scope until proven necessary**:

- **Polling works today, zero core changes:** n8n Schedule trigger → `GET /api/objects`
  (ordered `updated_at desc`) → deduplicate via an `updated_at` watermark in n8n static data.
- **If polling becomes painful in practice,** the small, low-risk core change is an
  `updated_since` query parameter on `GET /api/objects` (ISO timestamp filter). That is the
  pragmatic middle ground.
- **Outbound webhooks (Specy → n8n push):** initially not planned, then **approved and
  implemented on 2026-11-25** — authoritative contract:
  [`../platform/webhooks.md`](../platform/webhooks.md). The n8n Trigger node can consume
  signed deliveries (`X-Specy-Signature: sha256=…`) in the next release cycle.

n8n can additionally be triggered by anything external (cron, other tools) and then *pull*
from Specy — the pull pattern covers most "automate API operations" cases without any core
addition.

---

## 7. Core Adjustments (reviewed 2026-11-25)

Remaining candidates, in priority order. **Items 1–2 were implemented on 2026-11-25**
(see [`../changes/2026-11-25-outbound-webhook-subsystem.md`](../changes/2026-11-25-outbound-webhook-subsystem.md));
the `updated_since` filter additionally unlocks efficient polling (§6).

1. **✅ Pagination on `GET /api/objects`** — `limit`+`offset` (max 500) with `total` in the
   paginated response. Implemented 2026-11-25.
2. **✅ List filtering** — `updated_since` implemented 2026-11-25; `status`/`object_type`
   filters remain open (low priority).
3. **Object list omits `data`** — unchanged; a `?include=data` option would halve polling
   round-trips (deferred).

Rejected / descoped (2026-11-25 review):

- ~~**Outbound webhooks** — new subsystem, no current need.~~ Reversed on 2026-11-25: approved and implemented — see §6 of the release plan and [`../platform/webhooks.md`](../platform/webhooks.md).
- **"API client" account type** — not needed; a normal `user` account with a PAT is the
  complete recipe (documented in §3 and the connector README). The existing `agent` role /
  `is_agent` claim is unused by the API and is not leveraged by the connector.
- **Dashboard "connector settings" UI** — out of scope; would be a separate core plugin
  decision.

---

## 8. Error Handling & Testing

- All transport errors wrapped in `NodeApiError` with the Specy error body preserved
  (`{ error: string }` shape used by all routes).
- Status mapping: `401` (PAT unknown/revoked/expired) → credential hint; `403` (no workspace
  membership / role) → operation hint; `409` (slug/share-slug conflict, product-managed
  object) → user-actionable message; `501` (KB sync without plugin handler) → feature note.
- Tests (in the connector repo): unit tests per resource mapping operation →
  method/URL/body (mocked `helpers.request`); an n8n dev instance smoke test per operation
  against a local `npm run dev:api` Worker before each release.

## 9. Licensing & Boundary Compliance

- The connector is a **separate work** (MIT) and imports nothing from the core repo — it
  speaks HTTP only. This satisfies the EUPL core / separate plugin boundary (see
  [`../plugins/eupl-compliance.md`](../plugins/eupl-compliance.md)).
- It is *not* a Specy plugin (no `PluginDefinition`, no hooks, no registry entries, no
  migrations, no binding intents). The `plugins/` location is purely a workspace convention
  for satellite repositories.
