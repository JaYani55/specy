# PluraPi — System Overview & Migration Guide

> High-level orientation for developers working inside the PluraPi repository.
> For exhaustive detail see `knowledgebase-core/`, `plurapi-engine/migrations/README.md`,
> `plurapi-sessions/README.md` and `AI-GATEWAY-QUERY-LOGGING.md`.

---

## Part 1 — What PluraPi Is

**PluraPi is the agentic execution system of the Pluracon ecosystem.** It runs AI coding
agents against real, isolated Git workspaces on behalf of end users (non-technical
clients who should never see a terminal). A user opens a chat client, the engine clones
a project template into a sandboxed workspace, and a Pi SDK agent edits that workspace
— writing content, adjusting a site, committing and pushing to a dev branch — while the
conversation streams back live.

It is deliberately split into four cooperating pieces plus two external services.

### 1.1 Topology at a glance

```
┌──────────────────┐   REST + SSE    ┌─────────────────────────────┐
│ local-chat-ui    │ ───────────────►│ plurapi-engine (Fastify)    │
│ Svelte 5 + Vite  │ ◄───────────────│ Pi SDK agent runtime        │
│ (test/ops client)│                 │ workspace + session manager │
└──────────────────┘                 └───────┬──────────┬──────────┘
                                             │          │
                          PostgreSQL / SQLite│          │ REST (mirror, drains)
                                             ▼          ▼
                              ┌──────────────────┐  ┌──────────────────────────┐
                              │ Central Supabase │  │ plurapi-sessions Worker  │
                              │ schema `plurapi` │  │ + PluraPiSessions DO     │
                              │ (+ `public`,     │  │ (per tenant:user)        │
                              │  Specy, auth)    │  └───────────┬──────────────┘
                              └──────────────────┘              │
                                                                ▼
                                                   Cloudflare AI Gateway → OpenRouter
```

### 1.2 Components

| Component | Path | Role |
|---|---|---|
| **Execution engine** | `plurapi-engine/` | Fastify server + Pi SDK. Owns sessions, workspaces, streaming, persistence, auth, media proxy, visual testing. |
| **Sessions service** | `plurapi-sessions/` | Cloudflare Worker + `PluraPiSessions` Durable Object. Cross-application shared session state: chatlog mirror, injection inbox, build events, and the AI Gateway LLM proxy. Contract version `sessions-do/v3`. |
| **Chat client** | `local-chat-ui/` | Svelte 5 + Vite SPA. Sign-in, session sidebar, SSE chat, model picker, settings, storage picker, workflow flowchart, dev tools. |
| **Site templates** | `templates/template-site-repo/` | The repo skeleton cloned into every user workspace. Carries its own `.pi/` config, `AGENTS.md` and `knowledgebase-project/`. |
| **Core knowledge base** | `knowledgebase-core/` | System-level docs: brand, ontology, component registry, Specy integration, sessions-DO contract, changelog. |
| **Specy (external)** | `console.pluracon.org` | Multi-tenant headless CMS, OAuth 2.1 authorization server (Supabase Auth), MCP tool surface, R2 media storage. Contract docs in `knowledgebase-core/05_Specy/`. |
| **Cloudflare AI Gateway** | AI Gateway `plurapi` | Pass-through in front of OpenRouter; every query logged to `plurapi.ai_query_logs`. |

### 1.3 Execution engine (`plurapi-engine/`)

- **`src/server.ts`** — REST + SSE surface: workspaces, sessions, prompts, history,
  injections, auth (Specy OAuth), BYOK keys, deploy accounts, media proxy, dev tools,
  visual testing (`/api/test/html`, `/api/test/screenshot`).
- **`src/sessionManager.ts`** — session lifecycle, Pi SDK instantiation, workspace
  cloning, history rehydration, granular stream events (`delta`, `thought`,
  `tool_start`, `tool_end`, `done`), durable turn persistence, Pluracon model
  resolution, AI Gateway proxy routing.
- **`src/db.ts` + `src/db/`** — pluggable persistence (`PERSISTENCE=sqlite|postgres`),
  identical query interfaces so call sites never change.
- **`src/auth/`** — Specy OAuth verification (JWT claims `sub`, `tenant_id`,
  `user_roles`, `is_agent`) and role/super-admin gating.
- **`src/utils/`** — `pathLock.ts` (workspace escape guard), `sessionsDO.ts`
  (sessions-DO client), `injectionPoller.ts` (autonomous turn trigger),
  `crypto.ts` (AES-GCM for BYOK secrets).
- **`src/testing/browserRun.ts`** — Cloudflare Browser Run headless Chromium; the repo
  never runs a local browser or serves local visual tests.
- **`global-pi/agent/`** — workspace-agent Pi configuration baked into the container
  (prompt, rules, extensions, `settings.json`). Not developer documentation.

**Dual `.pi` resolution:** on each prompt the session `cwd` is the cloned workspace and
`agentDir` is the baked-in global Pi config. The SDK therefore loads global extensions
from `agentDir` **and** repository skills/rules/`AGENTS.md` from the workspace.

### 1.4 Sessions service (`plurapi-sessions/`)

One Durable Object per `(tenantId, userId)` keyed `"<tenantId>:<userId>"`. The engine is
the **authoritative** owner of live conversations; the DO is a **projection + injection
inbox** (only the engine writes `user`/`assistant`/`tool` chatlog rows; the service may
append `system` status messages).

Three auth realms: internal (engine, shared token), `specy` (build pushes), and user
JWTs. External contract is versioned and governed — see
`knowledgebase-core/06_sessions-DO/Data-contract-changes/current-contract.md`, and the
consumer registry in `consumers.md`. **Every contract change must be documented there
and mirrored in `plurapi-sessions/README.md` before/with the code change** (root
`AGENTS.md` §3).

### 1.5 Chat client (`local-chat-ui/`)

Svelte 5 runes, light-mode-first. Highlights: gated sign-in with Specy, session sidebar,
SSE streaming with per-animation-frame batching, collapsible reasoning/tool blocks,
unified storage picker (media grid + file list, explicit upload destination), build
workflow flowchart rendered from system messages, project details/deploy context,
BYOK + named deploy account management, and a DEV-only tools modal. Memory is bounded
via `src/lib/limits.js`.

### 1.6 Identity, tenancy & the "personal" fallback

Identity is always Specy's: Supabase `sub` is the user key, `tenant_id` is the Specy
workspace. Sessions without workspace membership fall back to the reserved sentinel
`"personal"` — that value is meaningful for DO addressing and must be handled
explicitly wherever an identifier is typed (see migration 0013).

### 1.7 Key flows

1. **Agent turn** — UI prompt → engine ensures workspace → `runAgentPrompt` resolves the
   model (Pluracon virtual model → OpenRouter id) → routes OpenRouter traffic through
   the sessions Worker's AI Gateway proxy with attribution in the URL path → streams
   events → persists turns.
2. **Build / injection loop** — Specy (or a Cloudflare Workflow) pushes a build result
   to the DO → the DO enqueues an injection → the engine's injection poller drains it →
   an autonomous agent turn starts (held for approval unless yolo mode).
3. **Query logging** — the Worker writes one `plurapi.ai_query_logs` row per proxied
   query (model, tokens, USD cost, tenant/user/session attribution) fire-and-forget via
   Supabase REST.

### 1.8 Build, run & verification

- Full stack (Docker): `start_docker.bat` / `./start_docker.sh`
- Local: `start_local.bat` / `./start_local.sh`; or engine `npm run dev` (port 3000) and
  UI `npm run dev` (http://localhost:5173).
- Verify before finishing: `cd plurapi-engine && npm run build` and
  `cd local-chat-ui && npm run build`; `cd plurapi-sessions && npm run typecheck && npm test`.

---

## Part 2 — PluraPi Migrations Overview

### 2.1 What they are

Raw, hand-written SQL migrations for the **dedicated `plurapi` schema** in the central
Supabase Postgres (shared with Specy). They live in `plurapi-engine/migrations/`, with
matching rollback scripts in `migrations/down/`.

- **Applied manually** via the Supabase SQL Editor. There is **no automated deployment
  script and no engine-side migration runner** — this is a deliberate decision.
- **Every up-migration is idempotent**: re-running it produces no changes and no errors
  (`CREATE ... IF NOT EXISTS`, `CREATE OR REPLACE`, guarded `DO` blocks, `ON CONFLICT DO
  NOTHING`).
- **Each migration records itself** in the ledger `plurapi.schema_migrations (version,
  applied_at)`, so an operator can see what was applied.
- Down-migrations are expected for every up-migration; in practice `0008`–`0010` are
  still missing their `down/` counterparts (small `ALTER`-only changes).

### 2.2 Prerequisites (Specy core must exist first)

Migrations assume the Specy multi-tenancy objects already exist in `public`:

- tables: `public.tenants`, `public.tenant_users`, **`public.user_profile`**, `auth.users`
- helper functions: `public.set_current_timestamp_updated_at()`,
  `public.can_access_owned_row(row_tenant_id, row_owner_user_id)`,
  `public.is_super_admin()`

If a helper is missing on a fresh project, apply the Specy core migration set first
(`202605240001_multi_tenant_foundation.sql` et al.).

### 2.3 Conventions

- **Schema-first**: `0001` creates `plurapi`; later migrations only touch objects inside it.
- **FKs into `public` are allowed and encouraged** — `tenant_id → public.tenants(id)`,
  user/owner → `public.user_profile(user_id)` (or `auth.users(id)` where required). This
  is the sanctioned cross-schema join point (`knowledgebase-core/05_Specy/database-integration.md`).
- **Reuse `public.*` helper functions**; never re-implement role/membership logic inline.
- **RLS on every table** as defense-in-depth: the engine connects with service-role
  credentials (bypasses RLS) and filters by caller claims in code; policies guard direct
  table access. `plurapi.has_app_access()` is the app-level gate (roles `super-admin` or
  `support` only).
- **Ownership model**: `owner_user_id` (primary, uuid) plus optional `tenant_id`
  (workspace binding). Tenants resolve from token claims, never request bodies.
- **PostgREST reachability** is separate from RLS: Supabase default privileges cover
  `public` only, so the `plurapi` schema needs explicit `USAGE`/table grants (`0012`)
  **and** must be added to Dashboard → Settings → API → "Exposed schemas in API". REST
  calls address it with `Accept-Profile: plurapi` / `Content-Profile: plurapi`.
- **Rollback order**: run `down/` in reverse; `down/0001_init.sql` drops the whole
  schema (destructive).

### 2.4 Migration index

| # | File | What it does |
|---|---|---|
| 0001 | `0001_init.sql` | Creates the `plurapi` schema, `has_app_access()` gate, the migration ledger, and the core tables **`workspaces`**, **`sessions`**, **`messages`** with indexes, updated-at triggers and RLS policies. |
| 0002 | `0002_users.sql` | **`plurapi.users`** — profile cache only (never authoritative; identity stays in Supabase Auth). |
| 0003 | `0003_byok_secrets.sql` | **`plurapi.byok_secrets`** — per-user/provider server-side API keys, AES-GCM encrypted by the engine before insert. |
| 0004 | `0004_media_refs.sql` | **`plurapi.media_refs`** — reference ledger for objects in central Specy/R2 storage (`source` = `picker` \| `screenshot`). |
| 0005 | `0005_identity_fks.sql` | Temporarily **drops** `auth.users` FKs on owner/sub columns so synthesized local-dev identities could work (columns stay `uuid`). |
| 0006 | `0006_identity_fks_restore.sql` | Supersedes 0005: deletes orphaned local-dev rows and **restores** the `auth.users` FKs (`ON DELETE CASCADE`). Local dev mode retired. |
| 0007 | `0007_injection_decisions_session_metadata.sql` | **`plurapi.injection_decisions`** (drained DO injections held for human review, keyed by DO injection id) plus **`sessions.metadata`** (persists the session's default model). |
| 0008 | `0008_injection_decisions_workflow.sql` | Adds `injection_decisions.workflow_instance_id` — links a decision to the Cloudflare Workflow instance that created it (sessions-do/v2). |
| 0009 | `0009_workspace_deploy_context.sql` | Adds workspace deploy context: `deploy_target` (default `'pluracon'`), `deploy_account_id`, `deploy_note` (sessions-do/v2.4). |
| 0010 | `0010_deploy_accounts.sql` | **`plurapi.deploy_accounts`** — multiple named BYOK deployment accounts per user; token AES-GCM encrypted, tenant-isolated. |
| 0011 | `0011_ai_gateway_logs.sql` | **`plurapi.ai_query_logs`** (one row per proxied LLM query, written by the sessions Worker) + **`plurapi.pluracon_models`** (virtual `pluracon/*` model → concrete OpenRouter model mapping, seeded). |
| 0012 | `0012_postgrest_grants.sql` | PostgREST reachability for the `plurapi` schema: `USAGE` + `service_role`/`authenticated` grants so the Worker/engine and RLS-gated reads work over REST. |
| 0013 | `0013_ai_query_log_identity_fks.sql` | Hardens query-log identity: `ai_query_logs.tenant_id`/`user_id` `text → uuid`, normalizes the `'personal'` sentinel and other non-UUID values to `NULL`, adds FKs to `public.tenants(id)` and `public.user_profile(user_id)` (fallback `auth.users(id)`), both `ON DELETE SET NULL`, plus `ai_query_logs_tenant_idx`. |

### 2.5 Resulting `plurapi` schema objects

| Object | Purpose |
|---|---|
| `plurapi.schema_migrations` | Applied-migration ledger. |
| `plurapi.workspaces` | Per-user project environments (repo, path, deployment context). |
| `plurapi.sessions` | Chat conversations referencing a workspace; carries `metadata`. |
| `plurapi.messages` | Persisted conversation turns. |
| `plurapi.users` | Supabase Auth profile cache (never authoritative). |
| `plurapi.byok_secrets` | Encrypted per-user provider keys. |
| `plurapi.deploy_accounts` | Named encrypted BYOK deploy accounts. |
| `plurapi.media_refs` | Reference ledger for central R2 media. |
| `plurapi.injection_decisions` | Drained injections awaiting accept/reject. |
| `plurapi.ai_query_logs` | Per-query LLM usage/cost/attribution audit log. |
| `plurapi.pluracon_models` | Virtual-model → OpenRouter model mapping (super-admin setting). |
| `plurapi.has_app_access()` | App-level access gate used by every RLS policy. |

### 2.6 Applying a migration (operator checklist)

1. Confirm Specy core prerequisites exist (§2.2).
2. Paste the up-migration into the Supabase SQL Editor and run it. Read the `NOTICE`
   output — the migrations report counts of nulled/deleted/orphaned rows.
3. Confirm the ledger row: `select * from plurapi.schema_migrations order by version;`
4. For migrations touching REST-visible objects, verify the `plurapi` schema is in the
   exposed-schemas list and that `0012` grants are present.
5. When rolling back, run the matching `down/` script and remember the reverse order.

### 2.7 Ordering with code changes

Some migrations are coupled to a code change. Example: `0013` tightens
`ai_query_logs.tenant_id`/`user_id` to `uuid`, and the `plurapi-sessions` Worker was
updated to normalize attribution (and retry without it on rejection). **Deploy the
compatible Worker first, then run the migration** — the new Worker is safe against the
old `text` columns, whereas the old Worker writing `'personal'` into a `uuid` column
would be rejected and lose log rows. Apply the same reasoning to any future
schema/code coupling.

---

## Further reading

| Topic | Location |
|---|---|
| Engine architecture, API examples, security | `knowledgebase-core/03_Documentation/README.md` |
| Component registry (engine + UI) | `knowledgebase-core/02_Components/COMPONENTS.md` |
| Domain model / ontology | `knowledgebase-core/01_Ontology/ONTOLOGY.md` |
| Brand, tone, design tokens | `knowledgebase-core/00_CORE/CORE.md` |
| Specy integration contract | `knowledgebase-core/05_Specy/` |
| Sessions-DO contract & governance | `knowledgebase-core/06_sessions-DO/` |
| Sessions-DO user-facing doc | `plurapi-sessions/README.md` |
| Query logging & Pluracon models | `AI-GATEWAY-QUERY-LOGGING.md` |
| Migration details & rollback | `plurapi-engine/migrations/README.md` |
| Visual testing (Browser Run) | `knowledgebase-core/03_Documentation/browser-run-migration-plan.md` |
| System changelog | `knowledgebase-core/04_Changelog/CHANGELOG.md` |
