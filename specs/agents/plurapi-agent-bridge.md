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
   running (created) ─────────┼────── succeeded / failed
        │                     │                 │
        ▼                     │                 ├─► forward Cloudflare build id
POST $BASE/v1/build-sessions │                 │   (build_uuid, v2.3) — the
("specy" realm, idempotent)  │                 │   WORKFLOW retrieves the log
        │                     │                 │   itself (CF Builds API)
        ▼                     │                 ▼
workflowInstanceId ───────────┘     POST $BASE/v1/build-sessions/<wfId>/result
stored on build_targets             ("specy" realm; 409 = already finalized)
(build opens the orchestration)     ▼
PluraPi Workflow: notification → result wait
                                     → injection → approval tracking
                                     ▼
              PluraPi engine poller (≤ 15 s) ──► autonomous agent turn
                               ▼
              chatlog messages `[workflow · …]` / `[build-status · <branch>]`
                               (role system) and `[injection · build_feedback]`
```

Two directions:

1. **Build feedback (outbound).** The bridge is **workflow-first**
   (sessions-do/v2): when the build starts (check_run `created`/`running`) it
   opens one durable Cloudflare Workflow instance per build via
   `POST /v1/build-sessions` and stores the returned `workflowInstanceId` on
   the `build_targets` row. When the build finishes, the outcome is sent to
   `POST /v1/build-sessions/<workflowInstanceId>/result` — the workflow drives
   notification → result wait → injection → approval tracking with automatic
   retries (a missed push marks the build `cancelled` after
   `resultTimeoutSeconds` instead of stranding it). The legacy
   `POST /v1/builds` push remains the **fallback/rollback path** for builds
   that were never opened as build-sessions (pre-migration pushes,
   single-delivery Cloudflare Pages check_runs, 404 instances — there Specy
   still fetches the logs itself, since the legacy DO does not). Success →
   short confirmation prompt. Failure → Specy forwards the Cloudflare build
   id (`build_uuid`, v2.3) and the **workflow retrieves the build log itself**
   and composes the diagnose-fix-repush prompt — Specy sends no failure
   prompt/detail for orchestrated builds. The approval lifecycle (user
   accepts/rejects the injected fix prompt, 24 h window) is tracked entirely
   by PluraPi — Specy
   has no involvement.
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

### 2.1 Push (Specy → DO) — workflow-first (sessions-do/v2)

**Primary path — `POST $BASE/v1/build-sessions`** (build OPEN, fired on the
check_run `created`/`rerequested` → `running` event),
`Authorization: Bearer <"specy" realm token>`:

| Field | Value / source |
|---|---|
| `tenantId` / `userId` / `projectId` | as in the legacy table below (`projectId` = `tenantId`) |
| `sessionId` | `build_targets.session_id` (optional pin; else most recent non-ended session) |
| `branch` / `commitSha` / `commitUrl` | from the check_run |
| `notifyBuilding` | `true` — the DO writes a `[build-status · <branch>]` / `[workflow · …]` status line (`role: "system"`) into the chatlog as soon as the build opens |
| `idempotencyKey` | deterministic: `cf-build-<buildId>` when the check_run carried a build id, else `commit-<repoId>-<sha>` — a retry returns the same instance instead of duplicating |
| `resultTimeoutSeconds` / `approvalTimeoutSeconds` | not sent — service defaults (30 min / 24 h) apply |

→ `200 { buildId, workflowInstanceId, created, sessionId }`. The
`workflowInstanceId` is stored on the exact `build_targets` row
(`workflow_instance_id`, migration 031) and is the correlation handle for the
result push (the response `buildId` is PluraPi-side only — recorded in the
`plurapi.build_feedback` sync log for observability, no Specy column).
`sessionId: null` means no open session exists — the build is
still recorded, but no notification/prompt is created.

**Result path — `POST /v1/build-sessions/<workflowInstanceId>/result`** (build
finished) — **sessions-do/v2.3: the workflow owns log retrieval**:

| Field | Value / source |
|---|---|
| `state` | `succeeded` / `failed` (a GitHub `cancelled` conclusion maps to `failed` — the agent should still see why) |
| `buildId` | **failure only, strongly recommended**: the Cloudflare Workers Builds `build_uuid` (the same id the check_run pipeline already extracts/recovers). The workflow fetches the build log itself via the Cloudflare Builds API (user-scoped token, tail-capped ~12k chars) and composes the diagnose-fix-repush prompt |
| `previewUrl` | success only |
| `summary` | one-line, UI-safe |
| `detail` | **NOT sent when `buildId` is present** (ignored by the DO anyway) — legacy fallback only: sent solely when no build id is recoverable; the workflow uses it verbatim if its own retrieval fails/is unconfigured |
| `commitSha` / `commitUrl` | check_run `head_sha` + GitHub commit link |

*Why (v2.3):* the workflow calls the Cloudflare Builds API with its own
user-scoped token — Specy no longer fetches logs or composes the failure
prompt for orchestrated builds. If retrieval fails (wrong/missing `buildId`),
the prompt still goes out with `summary` (+ fallback `detail`) plus an
explanatory note — nothing is lost.

→ `200 { sent: true }` · `409 { error: "instance not running: …" }` = already
finalized (duplicate delivery) — **safe to ignore**, booked as delivered ·
`404` = unknown instance → legacy fallback below. Other failures are **not**
fallback-pushed (a fallback could double-deliver); PluraPi's result timeout
marks the build `cancelled` instead.

**Legacy fallback — `POST $BASE/v1/builds`** (unchanged contract): used when
the exact `build_targets` row carries no `workflow_instance_id`
(pre-migration builds, Cloudflare Pages single completed delivery) or the
result endpoint answered `404`. Never mix paths for one build: once a build
is opened via `/v1/build-sessions`, its final state must NOT also be pushed
via `POST /v1/builds` (duplicate build row + duplicate agent prompt).

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
| `detail` | **failure only** (legacy DO does NOT retrieve logs): context header (branch, commit, CF build id) + verbatim log excerpt (tail ≤ 120 lines / 12 KB) — Specy fetches the logs itself (CF_API_TOKEN + CF_ACCOUNT_ID) and the DO passes this verbatim into the agent prompt |

The bridge is **fail-closed**: without `PLURAPI_SESSIONS_URL` or the push
token it disables itself (sync-log warning), webhook + status tracking keep
working. Delivery is at-most-once (DO inbox semantics — consumed on read); no
retries. Workflow-mode retries are handled inside the PluraPi Workflow.

### 2.2 Reads (Specy ← DO)

`Authorization: Bearer <"engine" realm token>` — used by three super-admin
plugin routes:

| Plugin route | DO call |
|---|---|
| `GET /api/plugin/pluradash/admin/github/agent-sessions` | `GET /v1/projects/<projectId>/sessions?userId=<sub>` per pair (≤ 30 pairs, concurrency 4) — returns exactly that user's sessions |
| `.../agent-sessions/messages` | `GET /v1/t/<t>/u/<u>/sessions/<id>/messages?after=<seq>` (addressed route — user already in the path) |
| `.../agent-sessions/builds` | `GET /v1/projects/<projectId>/builds?userId=<sub>&limit=` (`projectId` = `tenantId`) — rows now carry `workflow_instance_id` (NULL for legacy pushes) |

Chatlog reads include `role: "system"` entries tagged
`[workflow · …]` / `[build-status · <branch>]` (workflow-mode build
openings) — the Agent-Sessions dialog renders them as status/flowchart
lines, not as user/assistant
turns.

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
| `specy` | `SPECY_PUSH_TOKEN` | `PLURAPI_SESSIONS_PUSH_TOKEN` (binding `SS_PLURAPI_SESSIONS_PUSH_TOKEN`) | build-sessions (open/result), workflow-injections, legacy `POST /v1/builds` |
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

The prompt is pushed via the **workflow-mediated route**
`POST $BASE/v1/workflow-injections` (sessions-do/v2 §3.11): the prompt is
passed directly (no synthetic failed-build shape), the DO accepts it, creates
the injection row **asynchronously** (usually well under a second) and tracks
the approval lifecycle. The legacy failstate-shaped channel (riding
`POST /v1/builds` as a synthetic failed check_run build) is **removed** —
there is no reason to inject via the build channel anymore.

Specy-side endpoint (super-admin):

| | |
|---|---|
| Route | `POST /api/plugin/pluradash/admin/github/agent-sessions/inject` |
| Body | `{ "tenantId": "<workspace-or-session-tenant>", "userId": "<user sub>", "sessionId?": "sess_…", "prompt": "<free text, ≤ 8000 chars>" }` |
| Response | `{ "delivered": true, "injectionCreated": true, "workflowInstanceId": "wf-…" }` — accepted means the workflow took the prompt; the injection row appears asynchronously |
| Errors | `400` missing/oversized fields · `502` DO push failed (carries the DO status + error body) · `503` bridge not configured |
| Sync log | operation `arbitrary.inject`, actor `user`, detail carries `sessionId`, `promptLength`, `accepted`, `workflowInstanceId` |

The dashboard UI lives in the session detail dialog (Agent-Sessions tab →
session row → "Manuelle Injektion" card): textarea + send button; the live
chatlog tail (10 s poll) shows the arriving `[injection · build_feedback]`
message and the agent's autonomous turn.

**Contract mapping** (`buildWorkflowInjectionPayload`):

| `POST /v1/workflow-injections` field | Value for a manual injection |
|---|---|
| `tenantId` | request `tenantId` (the DO instance key — must match the engine's poll key, see §2.1 tenant trap) |
| `userId` | request `userId` |
| `sessionId` | request `sessionId` — **pinned**; without it the DO attaches to the user's most recent non-ended session |
| `prompt` | the full prompt verbatim (≤ 8000 chars, enforced Specy-side) |
| `idempotencyKey` / `source` / `approvalTimeoutSeconds` | not sent — service defaults apply |

Caveats:

- **Delivery needs a running engine poller** — an accepted injection with no
  poller rots in the DO inbox (§4.2, row 1). A successful inject that never
  reaches the agent is a poller/keying problem on the PluraPi side, not a
  Specy one.
- The prompt surfaces in the chatlog as `[injection · build_feedback]`.
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
| Specy `logsFetched: 0` on a failed build | expected in workflow mode (the WORKFLOW retrieves the log itself, v2.3 — Specy only forwards the `buildId`); in legacy mode it means the check_run output carried no `Build ID:` label | recovery chain: label → `details_url` → commit-SHA match against recent CF builds; if all fail Specy sends the explanatory-note detail as the workflow's verbatim fallback |
| Agent-Sessions tab empty but `configured: true` | pair discovery found nothing, or pair reads failed | the tab's warning banner shows the **per-pair DO status + error body** (`readErrors` in the response): `400` naming `userId` = project read without `?userId=<sub>` (engine realm must name the user) · `403` `user token required` = read routes accept **only user JWTs** — engine realm for reads not allowed on the sessions worker yet (fixed on PluraPi side 2026-10-13) · `401/403` otherwise = API token (engine realm) wrong · `405` = wrong method/route (e.g. listing via the POST-upsert path) · `404` with `no route` = sessions-Worker router problem · `404` with `session not found` = tenant key mismatch · network error = service unreachable |
| Same build prompts the agent twice | duplicate check_run delivery before the dedupe fix (migration 029) | `build_targets.feedback_state`; only affects builds pushed pre-fix |
| Build marked `cancelled` although it succeeded | Specy never sent the result (bridge unconfigured at terminal time, result push network/5xx failure — no legacy fallback to avoid double delivery) | sync log `plurapi.build_feedback` for the terminal event; the workflow's `resultTimeoutSeconds` (default 30 min) turned the wait into a cancellation |
| Build prompted the agent twice with one outcome | mixed paths: build opened via `/v1/build-sessions` AND terminal state also pushed via legacy `POST /v1/builds` | the bridge never mixes (workflow result wins; legacy only without a stored `workflow_instance_id` or on 404); check for manual/curl interference |
| `[workflow · …]` / `[build-status · <branch>]` lines clutter the chatlog read | not a failure — workflow-mode build openings | render `role: "system"` entries as status/flowchart lines (the Agent-Sessions dialog does) |

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
| Runtime client (build-sessions open/result, workflow-injections, legacy push), CF logs, dedupe, DO proxies | `plugins/pluradash/api/sync/plurapiSessions.ts` |
| Webhook hook-in | `plugins/pluradash/api/sync/webhookService.ts` (+ `api/webhooks.ts` logging) |
| Target recording | `plugins/pluradash/api/sync/routes.ts` (push/deploy) |
| Admin routes (incl. arbitrary injection `POST …/agent-sessions/inject`) | `plugins/pluradash/api/index.ts` |
| Admin UI | `plugins/pluradash/src/pages/admin/AgentSessionsPanel.tsx`, `GitHubAppsAdminPage.tsx` |
| Service client (frontend) | `plugins/pluradash/src/services/githubAppService.ts` |
| Migrations | `plugins/pluradash/migrations/028–031` (+ `down/`) |
| Tests | `tests/plurapiSessionsBridge.test.mjs`, `tests/checkRunWebhook.test.mjs` |

Change records: `specs/changes/2026-10-13-pluradash-plurapi-sessions-bridge.md`
(consolidated, incl. the routing incident),
`specs/changes/2026-10-15-plurapi-build-workflow-sessions.md`
(sessions-do/v2 workflow orchestration) and the plugin-internal counterparts
in `plugins/pluradash/specs/changes/`.
Plugin-internal contract: `plugins/pluradash/specs/plurapi-sessions-bridge.md`.
