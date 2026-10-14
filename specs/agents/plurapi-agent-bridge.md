# PluraPi Agent Bridge — canonical entry point

> **Start here.** This is the single entry point for everything concerning the
> bridge between Specy (PluraDash) and **PluraPi-Sessions** — the external
> Cloudflare Worker + Durable Object service that owns agent session state
> (chatlogs, injections, build events). Build feedback flows *out* to the
> agent, agent sessions flow *in* to the admin panel.
>
> Audience: Specy developers (bridge implementation), Specy operators
> (configuration), and triage engineers (the [Triage playbook](#triage-playbook)).

---

## 1. What the bridge does

```
GitHub check_run ──► PluraDash /webhooks/check-run (HMAC)
                        │
                        ├─► repo_deployments upsert (build status + preview URL)
                        │
                        └─► build-target resolution (pluradash.build_targets)
                              │  commit SHA → sessionTenantId / userId / sessionId
                              │
              succeeded ──────┼────── failed
                  │                          │
                  │                          ├─► Cloudflare Builds API (exact logs,
                  │                          │   CF_API_TOKEN + CF_ACCOUNT_ID)
                  │                          │
                  └────────────┬─────────────┘
                               ▼
              POST $BASE/v1/builds   ("specy" realm token)
                               ▼
              PluraPi-Sessions DO ──► build_feedback injection (inbox)
                               ▼
              PluraPi engine poller (≤ 15 s) ──► autonomous agent turn
                               ▼
              chatlog message `[injection · build_feedback]`
```

Two directions:

1. **Build feedback (outbound).** A completed preview build is pushed to the
   agent's session. Success → short confirmation prompt. Failure → the exact
   Cloudflare build logs are fetched and passed as the injection `detail` so
   the agent can diagnose and fix the build autonomously.
2. **Agent-session reads (inbound).** The super-admin panel
   (`/admin/github-apps` → tab **Agent-Sessions**) aggregates all agent
   sessions from the DO: live overview (10 s polling), per-session detail
   dialog with live chatlog tail, build history, and workspace activity.

Related docs: [plurapi-file-sync-integration.md](plurapi-file-sync-integration.md)
(the engine's workspace sync contract), the PluraPi-Sessions service
documentation (push contract §4, reads §5 — lives in the plurapi-sessions
repository).

---

## 2. Contract summary

### 2.1 Push (Specy → DO)

`POST $BASE/v1/builds`, `Authorization: Bearer <"specy" realm token>`:

| Field | Value / source |
|---|---|
| `tenantId` | **`build_targets.session_tenant_id`** — the JWT `tenant_id` claim the agent pushed with. Falls back to `workspace_id`. *This matters: DOs are keyed `"<tenantId>:<userId>"` — a wrong tenant key orphans the injection (see [Triage](#triage-playbook))* |
| `userId` | user `sub` of the pushing caller |
| `projectId` | = `tenantId` (per the PluraPi-Sessions contract) |
| `sessionId` | `build_targets.session_id` — set only when the engine passes `sessionId` in the `POST /sync/push` body; otherwise the DO attaches to the user's most recent non-ended session |
| `branch` / `state` | from the check_run (`succeeded` / `failed` only; `queued`/`building`/`cancelled` never enqueue) |
| `commitSha` / `commitUrl` | check_run `head_sha` + GitHub commit link |
| `previewUrl` | success only |
| `summary` | one-line, UI-safe |
| `detail` | **failure only**: context header (branch, commit, CF build id) + verbatim log excerpt (tail ≤ 120 lines / 12 KB) — the DO passes this verbatim into the agent prompt |

The bridge is **fail-closed**: without `PLURAPI_SESSIONS_URL` or the push
token it disables itself (sync-log warning), webhook + status tracking keep
working. Delivery is at-most-once (DO inbox semantics — consumed on read); no
retries.

### 2.2 Reads (Specy ← DO)

`Authorization: Bearer <"engine" realm token>` — used by three super-admin
plugin routes:

| Plugin route | DO call |
|---|---|
| `GET /api/plugin/pluradash/admin/github/agent-sessions` | `GET /v1/projects/<projectId>/sessions?userId=<sub>` per pair (≤ 30 pairs, concurrency 4) — returns exactly that user's sessions |
| `.../agent-sessions/messages` | `GET /v1/t/<t>/u/<u>/sessions/<id>/messages?after=<seq>` (addressed route — user already in the path) |
| `.../agent-sessions/builds` | `GET /v1/projects/<projectId>/builds?userId=<sub>&limit=` (`projectId` = `tenantId`) |

> ⚠️ **Two engine-realm addressing rules (both cost a debugging round):**
> 1. **Route trap:** the session **list** must use `/v1/projects/<projectId>/sessions`.
>    The path `/v1/t/<t>/u/<u>/sessions` is the engine's **POST-upsert** route —
>    a GET there answers **405 method not allowed**.
> 2. **User naming:** the DO is keyed per `(tenant, user)`, and an engine token
>    carries **no user** — so project-scoped reads MUST pass `?userId=<sub>`
>    (the DO answers `400` with a self-explanatory body otherwise). Addressed
>    routes (`/v1/t/<t>/u/<u>/...`) need no parameter.

Pair discovery: identities with agent-driven sync activity in the last 30
days, keyed on the **operation set** (`pull`, `files.list`, `files.read`,
`save`, `push`, `app.launch`) — **not** on `actor_type`, because agent tokens
without the agent claim are logged as `actor_type: 'user'`. The aggregation
endpoint itself is never sync-logged (polled ~10 s).

> ⚠️ **sync_logs are prunable.** A `logs.cleanup` (`DELETE /admin/github/logs`,
> super-admin) with `before=<ISO>`/`?confirm=true` deletes `pluradash.sync_logs`
> — if it covers the whole 30-day lookback, pair discovery finds nothing and
> the Agent-Sessions tab goes empty (observed 2026-10-14: cleanup with
> `"before": "all"`). The PluraPi-Sessions DO data is **not** affected; sessions
> reappear with the agent's next sync operation. As a safety net, pair
> discovery falls back to `pluradash.build_targets` (`session_tenant_id` →
> `workspace_id` fallback, newest first) whenever sync_logs yield fewer pairs
> than the 30-pair cap — build_targets is not touched by the log cleanup.

### 2.3 Token realms (values must match per realm)

| Realm | Sessions worker secret | CMS worker secret (Secrets Store) | Purpose |
|---|---|---|---|
| `specy` | `SPECY_PUSH_TOKEN` | `PLURAPI_SESSIONS_PUSH_TOKEN` (binding `SS_PLURAPI_SESSIONS_PUSH_TOKEN`) | `POST /v1/builds` only |
| `engine` | `INTERNAL_TOKEN` (engine copies it as `SESSIONS_INTERNAL_TOKEN`) | `PLURAPI_SESSIONS_API_TOKEN` (binding `SS_PLURAPI_SESSIONS_API_TOKEN`) | DO reads for the admin overview |

Leaving `PLURAPI_SESSIONS_API_TOKEN` unset degrades gracefully: build feedback
still works, only the Agent-Sessions tab reports "nicht verbunden".

### Read realm decision (resolved 2026-10-13)

The sessions service initially enforced `403: user token required` on the §5
read routes (engine realm rejected). **Resolved on the PluraPi side:** the
engine realm is now accepted on all read routes, with the addressing rule
above (project-scoped reads require `?userId=<sub>`; specy realm stays
push-only; user realm stays own-data-only). The fallback of minting CMS-side
user sessions was not needed and remains unimplemented.

---

## 3. Data model & configuration

**`pluradash.build_targets`** (plugin migrations 028–030; written by
`/sync/push` and `/sync/deploy` after a successful push, background,
best-effort, idempotent per `(github_repo_id, head_sha)`):

| Column | Meaning |
|---|---|
| `branch` / `head_sha` | pushed branch + full commit SHA |
| `workspace_id` | Specy workspace UUID the repo is assigned to |
| `session_tenant_id` | **JWT `tenant_id` claim of the caller — the DO instance key the engine's sessions live under (preferred push tenant)** |
| `user_id` | caller's user `sub` |
| `session_id` | optional pinned session (`sess_<uuid>`) |
| `feedback_state` / `feedback_at` | build state already reported for this commit — dedupes Cloudflare's double delivery (same build arrives as `action: created` + terminal state, then again as `action: completed`) |
| `created_at` | retention: rows > 7 days pruned opportunistically |

**Worker configuration (pluradash plugin `wrangler_intents`):**

| Setting | Kind | Notes |
|---|---|---|
| `PLURAPI_SESSIONS_URL` | var | e.g. `https://plurapi-sessions.<subdomain>.workers.dev` — set the value in `plugin.json` (the var is regenerated into `wrangler.jsonc` on every build) |
| `SS_PLURAPI_SESSIONS_PUSH_TOKEN` / `SS_PLURAPI_SESSIONS_API_TOKEN` | Secrets Store | create the store secrets (`PLURAPI_SESSIONS_PUSH_TOKEN` / `PLURAPI_SESSIONS_API_TOKEN`) in the dashboard or via CF API — `wrangler secret put` cannot populate a Secrets Store |
| `CF_API_TOKEN` / `CF_ACCOUNT_ID` | existing worker secret / var | failure-log retrieval; the token additionally needs **Account → Workers Builds: Read** |

Local dev: plain values in `.dev.vars` (`PLURAPI_SESSIONS_URL`,
`PLURAPI_SESSIONS_PUSH_TOKEN`, `PLURAPI_SESSIONS_API_TOKEN`; the single var
`PLURAPI_SESSIONS_TOKEN` covers both realms).

**Plugin routes** (all super-admin): the three `agent-sessions` proxies, the
arbitrary-injection route (§2.4) plus `GET /admin/github/logs` with
`?view=human|agent|all` + `?userId=` — agent operations are hidden in the
Sync-Logs tab by default and surface in the Agent-Sessions detail dialog
("Workspace-Aktivität").

All DO read proxies return a discriminated result
(`PlurapiReadResult<T>`): failures carry the DO **status + error body**, the
aggregation response exposes them as `pairErrors`, and the panel banner
names the cause — no more silent empty lists.

### 2.4 Arbitrary injection (manual prompt)

The dashboard can push a **manually typed prompt** into any agent session
without waiting for a real build — useful for the triage checklist above,
deliberate steering, and end-to-end verification of the poller chain.

Specy-side endpoint (super-admin):

| | |
|---|---|
| Route | `POST /api/plugin/pluradash/admin/github/agent-sessions/inject` |
| Body | `{ "tenantId": "<workspace-or-session-tenant>", "userId": "<user sub>", "sessionId?": "sess_…", "prompt": "<free text, ≤ 8000 chars>" }` |
| Response | `{ "delivered": true, "injectionCreated": true }` — `injectionCreated: false` means the DO accepted the event but created no injection (e.g. ended session) |
| Errors | `400` missing/oversized fields · `502` DO push failed (carries the DO status + error body) · `503` bridge not configured |
| Sync log | operation `arbitrary.inject`, actor `user`, detail carries `sessionId`, `promptLength`, `injectionCreated` |

The dashboard UI lives in the session detail dialog (Agent-Sessions tab →
session row → "Manuelle Injektion" card): textarea + send button; the live
chatlog tail (10 s poll) shows the arriving `[injection · build_feedback]`
message and the agent's autonomous turn.

**Contract mapping — the prompt rides the `build_feedback` channel.** The
PluraPi-Sessions DO currently only knows the `build_feedback` injection
type, so the manual prompt is shaped as a synthetic failed build
(`buildArbitraryInjectionPayload`):

| `POST /v1/builds` field | Value for a manual injection |
|---|---|
| `tenantId` / `projectId` | request `tenantId` (the DO instance key — must match the engine's poll key, see §2.1 tenant trap) |
| `userId` | request `userId` |
| `sessionId` | request `sessionId` — **pinned**; without it the DO attaches to the user's most recent non-ended session |
| `branch` | `manual` |
| `state` | `failed` (this makes the DO pass `detail` verbatim into the agent prompt, §4.4) |
| `summary` | first line of the prompt, truncated to 120 chars (UI-safe) |
| `detail` | the full prompt verbatim |

Caveats:

- **Delivery is at-most-once** and needs a **running engine poller** — an
  enqueued injection with no poller rots in the DO inbox (§4.2, row 1).
  A successful inject that never reaches the agent is a poller/keying
  problem on the PluraPi side, not a Specy one.
- The prompt surfaces in the chatlog as `[injection · build_feedback]` with
  a badge derived from the first bracketed segment — it is not labelled
  differently from real build feedback (no dedicated injection type yet).
  If PluraPi later adds a generic prompt-injection type, switch the payload
  mapping here and keep the route/UI contract unchanged.
- No dedupe: every call enqueues a new injection. The route is super-admin
  only; the UI rate-limits itself by disabling the button while a request
  is in flight.

---

## 4. Triage playbook

### 4.1 Distinguish the two 404s (Worker router vs. DO miss)

This distinction cost us a debugging round — memorize it:

| Response body | Meaning | Where to fix |
|---|---|---|
| `{"error":"no route for GET …"}` | **Worker router 404** — the request never reached the DO; the address parser missed the route pattern (incident: `parseAddress()` anchored on `/v1/t/…` only, so every `/v1/internal/…` engine drain hit the catch-all — routing bug, *not* tenant/token/state) | fix the Worker's route table and redeploy |
| `{"error":"session not found",…}` | **DO miss** — the request reached the DO, but the session/instance key doesn't match (wrong tenant/user/session id, or the engine polled before upserting) | fix the engine's key derivation or add the missing session upsert |

Rule of thumb: **read the error body in the live tail first** — a repeating
router-404 body on every drain attempt means routing; a DO-error body means
keying.

### 4.2 Known failure signatures

| Symptom | Likely cause | Check |
|---|---|---|
| Injection enqueued (`injectionCreated: true`) but agent never reacts | Engine poller not draining: env vars missing, wrong DO instance key, session not idle, or drained-and-crashed (at-most-once) | DO live tail for `/v1/internal/.../injections/pending`; engine `[injectionPoller]` lines |
| Poll hits `t/personal/…` while sessions live under the workspace tenant | Engine derives the tenant differently than it upserts | compare the poll URL tenant against the upsert URL tenant — must be identical |
| Specy `logsFetched: 0` on a failed build | check_run output carried no `Build ID:` label | recovery chain: label → `details_url` → commit-SHA match against recent CF builds; if all fail the detail says so |
| Agent-Sessions tab empty but `configured: true` | pair discovery found nothing, or pair reads failed | the tab's warning banner shows the **per-pair DO status + error body** (`readErrors` in the response): `400` naming `userId` = project read without `?userId=<sub>` (engine realm must name the user) · `403` `user token required` = read routes accept **only user JWTs** — engine realm for reads not allowed on the sessions worker yet (fixed on PluraPi side 2026-10-13) · `401/403` otherwise = API token (engine realm) wrong · `405` = wrong method/route (e.g. listing via the POST-upsert path) · `404` with `no route` = sessions-Worker router problem · `404` with `session not found` = tenant key mismatch · network error = service unreachable |
| Same build prompts the agent twice | duplicate check_run delivery before the dedupe fix (migration 029) | `build_targets.feedback_state`; only affects builds pushed pre-fix |

### 4.3 Verification flow after any change

1. `curl $BASE/healthz` → `{"ok":true,"service":"plurapi-sessions"}`.
2. Prompt the agent once → engine tail shows silent successes: `…/injections/pending` → `200 {"injections":[]}`.
3. Fire an **arbitrary injection** (§2.4) — dashboard: Agent-Sessions tab →
   session row → "Manuelle Injektion" → send; or curl:
   `POST /api/plugin/pluradash/admin/github/agent-sessions/inject` with
   `{tenantId, userId, sessionId?, prompt}` → within ≤ 15 s the engine logs
   `[injectionPoller] 1 injection(s) for session …` → autonomous turn; the
   chatlog contains `[injection · build_feedback]`. If the inject answers
   `200/injectionCreated: true` but nothing happens within ~30 s, go to §4.2
   row 1 (poller/keying on the PluraPi side).
4. The Agent-Sessions tab clears its warning banner on the next read cycle.

---

## 5. Implementation map

| Concern | File |
|---|---|
| Pure logic (unit-tested) | `plugins/pluradash/api/sync/plurapiSessionsLogic.ts` |
| Runtime client, CF logs, dedupe, DO proxies | `plugins/pluradash/api/sync/plurapiSessions.ts` |
| Webhook hook-in | `plugins/pluradash/api/sync/webhookService.ts` (+ `api/webhooks.ts` logging) |
| Target recording | `plugins/pluradash/api/sync/routes.ts` (push/deploy) |
| Admin routes (incl. arbitrary injection `POST …/agent-sessions/inject`) | `plugins/pluradash/api/index.ts` |
| Admin UI | `plugins/pluradash/src/pages/admin/AgentSessionsPanel.tsx`, `GitHubAppsAdminPage.tsx` |
| Service client (frontend) | `plugins/pluradash/src/services/githubAppService.ts` |
| Migrations | `plugins/pluradash/migrations/028–030` (+ `down/`) |
| Tests | `tests/plurapiSessionsBridge.test.mjs`, `tests/checkRunWebhook.test.mjs` |

Change records: `specs/changes/2026-10-13-pluradash-plurapi-sessions-bridge.md`
(consolidated, incl. the routing incident) and
`plugins/pluradash/specs/changes/2026-10-13-plurapi-sessions-bridge.md`.
Plugin-internal contract: `plugins/pluradash/specs/plurapi-sessions-bridge.md`.
