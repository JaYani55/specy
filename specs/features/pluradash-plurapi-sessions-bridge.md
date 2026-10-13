# PluraDash ↔ PluraPi-Sessions Bridge (Agent Build Feedback & Agent Sessions)

Feature-level documentation for the bridge between the PluraDash sync feature
and the external **PluraPi-Sessions** Durable Object service (Cloudflare Worker
+ DO, separate deployment — see its service documentation for the full API
contract).

> **Scope note:** this is a **plugin feature** implemented entirely inside the
> `pluradash` plugin workspace (`plugins/pluradash/`). Core CMS
> authentication, API surface, and database objects are untouched. The bridge
> talks to PluraPi-Sessions over its public REST contract (three token realms:
> `engine`, `specy`, `user`) — no PluraPi-internal endpoints are used.

## Overview

The bridge has two directions:

1. **Build feedback delivery (outbound).** The check_run webhook feedback loop
   ([check-run-webhook](../../../plugins/pluradash/specs/check-run-webhook.md))
   learns about preview-build outcomes for pushed commits. The bridge delivers
   each `succeeded`/`failed` outcome to the agent's PluraPi session via
   `POST /v1/builds`, where the DO enqueues a `build_feedback` injection. The
   PluraPi engine polls the injection inbox (≤ 15 s) and runs the outcome as an
   **autonomous agent turn** — the agent reacts to the build without user
   input. On failure, the bridge fetches the **exact Cloudflare build logs**
   and passes them as the injection `detail` so the agent can troubleshoot.
2. **Agent-session reads (inbound).** The super-admin panel
   (`/admin/github-apps` → tab **Agent-Sessions**) shows a live overview of all
   agent sessions aggregated from the DO.

```
GitHub check_run ──► /webhooks/check-run (HMAC) ──► repo_deployments upsert
                                        │
                                        └─► build target resolution
                                              (pluradash.build_targets)
                                                    │
                     succeeded │ failed
                        │           │
                        │           ├──► CF Builds API (logs, CF_API_TOKEN/CF_ACCOUNT_ID)
                        │           │
                        └───────────┴──► POST $BASE/v1/builds (specy token)
                                              │
                                              ▼
                            PluraPi-Sessions DO → build_feedback injection
                                              │
                                              ▼
                            PluraPi engine → autonomous agent turn

Admin panel (Agent-Sessions tab) ──► /admin/github/agent-sessions[/*] ──► DO reads (engine token)
```

## Build target resolution (commit → agent session)

A `check_run` event only knows repository + commit SHA — it carries no
PluraPi identity. The missing link is the new plugin table
`pluradash.build_targets` (migration 028 + downmigration, idempotent):

| Column | Meaning |
|---|---|
| `github_repo_id` + `head_sha` | Unique conflict target (one row per pushed commit) |
| `branch` | Pushed branch (`dev` from `/sync/push`, `main` from `/sync/deploy`) |
| `workspace_id` | Specy workspace UUID → DO `tenantId` |
| `user_id` | User `sub` of the pushing caller → DO `userId` |
| `session_id` | Optional PluraPi session id (`sess_<uuid>`); the sync routes accept an optional `sessionId` in the push body so the PluraPi engine can pin the exact session |
| `created_at` | Retention/fallback ordering |

- Written by `POST /sync/push` and `POST /sync/deploy` **after** a successful
  push (background, best-effort — a mapping failure never fails the push).
- Retention: rows older than 7 days are pruned opportunistically after each push.
- Resolution logic (`plurapiSessionsLogic.ts#selectBuildTarget`, unit-tested):
  1. exact match on `(github_repo_id, head_sha)`,
  2. fallback: most recent row for the same repo **and branch** within 24 h —
     the DO then attaches the injection to the user's most recent non-ended
     session (§4.3 of the PluraPi-Sessions contract),
  3. no target → **only** the build event is stored DO-side; no injection
     (mirrors the DO's own resolution semantics).

## Push contract (`POST $BASE/v1/builds`)

- Endpoint/body per the PluraPi-Sessions documentation §4.1:
  `tenantId` (= `workspace_id`), `userId`, `projectId` (= `tenantId` for now),
  optional `sessionId`, `branch`, `state` (`succeeded`/`failed` only),
  `commitSha`, `commitUrl`, `previewUrl` (success), one-line `summary`, and
  `detail` (failure).
- Auth: `Authorization: Bearer <specy realm token>`.
- **Success** → short confirmation prompt (outcome, commit, preview URL, and
  the instruction to continue planned work — the DO composes the prompt).
- **Failure** → the `detail` field carries the failure documentation verbatim:
  context header (branch, commit, Cloudflare build id) plus the **exact build
  log excerpt** — last ≤ 120 lines, capped at 12 KB, tail-first (errors sit at
  the end). If no build id was extractable from the check_run output, the
  detail explains where to look instead.
- Delivery failures are logged (operation `plurapi.build_feedback`) and never
  break the webhook's 202 response or the already-persisted
  `repo_deployments` row.

## Cloudflare build log retrieval (failure path)

Uses the platform credentials **already present on the worker** — no new
bindings:

- `CF_ACCOUNT_ID` — Worker var (wrangler.jsonc)
- `CF_API_TOKEN` — Worker secret (`npx wrangler secret put CF_API_TOKEN`)
  ⚠️ the token additionally needs **Account → Workers Builds: Read** (the
  Secrets Store setup only grants Secrets Store: Edit).

Endpoints called (best-effort cascade):

1. `GET /accounts/{account_id}/builds/{build_id}/logs` — exact log lines
   (defensive parser: string entries or `{message|line|text, source}`).
2. Fallback `GET /accounts/{account_id}/builds/{build_id}` — build detail
   (`build_message`/`error_message`/stage name).
3. Nothing retrievable → the injected detail says so explicitly.

Redaction note: the payload is stored in the DO and becomes part of the agent
conversation — operators must keep build tokens/secrets out of build logs
(PluraPi-Sessions §4.4).

## Configuration

| Setting | Type | Purpose |
|---|---|---|
| `PLURAPI_SESSIONS_URL` | Worker var (plugin `wrangler_intents.vars`, default `""`) | Base URL of the PluraPi-Sessions service, e.g. `https://plurapi-sessions.<subdomain>.workers.dev` |
| `SS_PLURAPI_SESSIONS_PUSH_TOKEN` | Secrets Store binding (secret name `PLURAPI_SESSIONS_PUSH_TOKEN`) | "specy" realm token — agreed with the PluraPi operator; only `POST /v1/builds` |
| `SS_PLURAPI_SESSIONS_API_TOKEN` | Secrets Store binding (secret name `PLURAPI_SESSIONS_API_TOKEN`) | "engine" realm token (optional) — enables the admin agent-session overview |

Plain Worker env vars of the same name act as local-dev fallbacks; the single
env var `PLURAPI_SESSIONS_TOKEN` covers both realms in local development.

**Fail closed:** when `PLURAPI_SESSIONS_URL` or the push token is missing, the
bridge disables itself (no push attempt) and logs a sync-log warning — the
webhook and deployment status tracking keep working without it.

## Agent sessions (admin panel)

`/admin/github-apps` now has three tabs: **Repositories**, **Sync-Logs**,
**Agent-Sessions**. The Agent-Sessions tab polls (10 s) the aggregation
endpoint and renders a live overview of all agent sessions: status badge
(active/idle/beendet with pulse for active), title, workspace, user, last
activity. A detail dialog shows the live chatlog tail (last 50 messages,
10 s polling, injections labeled) and the build history (30 s polling) with
state badges, preview and commit links.

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/admin/github/agent-sessions` | super-admin | Aggregates candidate `(tenantId, userId)` pairs from `pluradash.sync_logs` (agent actors, last 30 days, max 30 pairs, concurrency 4) and reads each pair's sessions from the DO (`GET /v1/t/<t>/u/<u>/sessions`, engine-realm token). Response: `{ configured, sessions[], pairs[], unreachablePairs }` |
| GET | `/admin/github/agent-sessions/messages` | super-admin | Chatlog delta proxy: `?tenantId=&userId=&sessionId=&after=<seq>` (§5.2) |
| GET | `/admin/github/agent-sessions/builds` | super-admin | Build-history proxy: `?tenantId=&userId=&limit=` (§5.4, newest first) |

All three return `{ configured: false }` when the bridge/API token is not
configured. Sessions whose pair became unreachable (DO error) are skipped and
counted (`unreachablePairs`).

## New sync-log operations

| Operation | Meaning |
|---|---|
| `plurapi.build_feedback` | One entry per attempted build-outcome delivery (delivered / failed, injection created, logs fetched) |
| `agent.sessions` | Aggregation read for the admin overview |

## Semantics & limits

- **At-most-once** from the DO side (injections are consumed on read); the
  bridge adds no retry — a failed push can be recovered by a new build or a
  manual injection.
- **Delivery latency:** ≤ 15 s after the check_run arrives (DO inbox polling).
- The DO is a projection; the PluraPi engine remains the system of record for
  chat history.
- Only `succeeded`/`failed` outcomes are delivered; `queued`/`building`/
  `cancelled` only update `repo_deployments`.

## Related

- `plugins/pluradash/specs/plurapi-sessions-bridge.md` — plugin-internal contract
- `specs/changes/2026-10-13-pluradash-plurapi-sessions-bridge.md` — change record
- `specs/features/pluradash-github-app-integration.md` — GitHub Apps admin panel
- `specs/changes/2026-09-13-pluradash-check-run-webhook.md` — webhook foundation
