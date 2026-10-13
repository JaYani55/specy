# PluraDash ↔ PluraPi-Sessions Bridge + Admin Agent-Sessions Overview

Date: 2026-10-13

## Summary

Connects the PluraDash check_run build feedback loop to the external
**PluraPi-Sessions** Durable Object service: completed preview builds are now
delivered to the triggering agent's PluraPi session via `POST /v1/builds`
("specy" realm), where the DO enqueues a `build_feedback` injection that the
PluraPi engine runs as an autonomous agent turn (≤ 15 s latency).

- **Success** → confirmation prompt with commit + preview URL.
- **Failure** → the bridge resolves the Cloudflare build id (already parsed
  from the check_run output) and fetches the **exact build logs** from the
  Cloudflare API using the existing worker credentials `CF_API_TOKEN`
  (Worker secret, additionally needs Account → Workers Builds: Read) and
  `CF_ACCOUNT_ID` (existing var). The log tail (≤ 120 lines / 12 KB) is pushed
  as the injection `detail` so the agent can diagnose and fix the build
  autonomously.

The commit → session mapping is provided by the new plugin table
`pluradash.build_targets`, written by the sync push/deploy routes (they now
accept an optional `sessionId` so the PluraPi engine can pin the exact
session; otherwise the DO attaches to the most recent open session).

Additionally, the super-admin panel `/admin/github-apps` gained a third tab
**Agent-Sessions** (alongside Repositories and Sync-Logs): a live overview
(10 s polling) of all agent sessions aggregated from the PluraPi-Sessions DO,
with a per-session detail dialog showing the live chatlog tail, build
history, and the recent agent-driven workspace operations.

**Log separation fix (same day):** pair discovery keys on the agent-driven
operation set (`pull`, `files.list`, `files.read`, `save`, `push`,
`app.launch`) instead of `actor_type`, because agent tokens without the agent
claim are logged as `actor_type: 'user'` (the first run returned `pairs: 0`).
The aggregation endpoint is no longer sync-logged (its ~10 s dashboard polling
spammed the sync logs). `GET /admin/github/logs` gains `?view=human|agent|all`
and `?userId=`; the Sync-Logs tab hides agent operations by default — agent
activity surfaces in the Agent-Sessions detail dialog instead.

**Delivery hardening (same day, first live run):** Cloudflare delivers the
same Workers Builds run as two check_run events (`action: created` with
terminal state, then `action: completed`), which enqueued duplicate
`build_feedback` injections. The bridge now records the reported state per
commit (`build_targets.feedback_state`/`feedback_at`, migration 029 + down)
and skips duplicate deliveries. When the check_run output carries no
`Build ID:` label (first live run: `buildId: null` → no logs), the build id is
recovered from the `details_url` or, as a last resort, by listing recent
Cloudflare builds and matching the commit SHA — so failure logs reach the
agent in the typical case.

**Routing incident (same day, resolved by PluraPi):** the first injection was
enqueued but never drained — the engine's `/v1/internal/…` requests hit the
sessions Worker's catch-all 404 (`{"error":"no route for …"}`) because its
address parser only anchored on `/v1/t/…`. Triage distinction (now documented
in the bridge doc): a **router 404** body means the request never reached the
DO (Worker route table), while a **DO miss** (`{"error":"session not found"}`)
means wrong keying. After the PluraPi redeploy, pending injections drain
within ≤ 15 s.

**Tenant-key alignment (same day, DO live tail):** the first injection was
enqueued in the `<workspace-uuid>:<user>` DO instance but never drained — the
engine's poller requests `t/personal/u/<user>` (404). The DO instance is keyed
`"<tenantId>:<userId>"`, so a tenant mismatch orphans injections. Specy now
records the pushing caller's **JWT `tenant_id` claim**
(`build_targets.session_tenant_id`, migration 030 + down — the tenant the
engine registers its sessions under) and prefers it over `workspace_id` when
resolving the push target. The Agent-Sessions tab surfaces per-pair DO read
failures (`unreachablePairs` warning banner) instead of failing silently.
On the PluraPi side the engine must upsert **and** poll the same
`(tenantId, userId)` key — polling `personal` while upserting under the
workspace tenant (or not upserting at all, given the 404) must be fixed there.

**Read diagnosability (same day):** the DO read proxies return a
discriminated result — failures carry the DO status + error body; the
aggregation response exposes `readErrors` (max 10) and the Agent-Sessions
banner names the exact cause (401/403 token realm, 405 wrong method, 404
router vs. DO miss, network) instead of a silent empty list.

**Read route fix (same day, banner 405):** the session list used
`GET /v1/t/<t>/u/<u>/sessions` — that path is the engine's POST-upsert route
(§7) and answers 405 on GET. Corrected to the documented project-scoped list
route `GET /v1/projects/<projectId>/sessions` (§5.1): one call per distinct
tenant now returns all sessions of that project, so the aggregation reads
projects instead of (tenant, user) pairs.

**Read realm gate (same day, banner 403 „user token required“):** the
sessions service enforces the **user realm** on the §5 read routes — the
engine-realm token is rejected there (contract says "engine may do
everything", the implementation doesn't cover reads). Resolution recorded in
the bridge doc: recommended fix is a PluraPi one-liner (accept the engine
realm on the read routes); fallback would be CMS-side user-session minting
(Not implemented — heavy: session churn + refresh handling). Banner and
triage table updated with the exact error signature.

EUPL boundary: all code lives inside the `pluradash` plugin workspace and
communicates with core only through the generated plugin route mounting and
the plugin `wrangler_intents` (binding intents). Core `src/`, `api/` and
`migrations/` are unchanged except for the two documentation files in
`specs/`.

## Files Added

- `plugins/pluradash/api/sync/plurapiSessionsLogic.ts` — pure bridge logic
  (target resolution, log truncation/composition, push payload shape)
- `plugins/pluradash/api/sync/plurapiSessions.ts` — runtime: config
  resolution (fail closed), Cloudflare build-log retrieval, `POST /v1/builds`
  push, build-target persistence, DO read proxies
- `plugins/pluradash/src/pages/admin/AgentSessionsPanel.tsx` — live
  agent-session overview tab (detail dialog: chatlog tail + build history +
  workspace activity; `unreachablePairs` warning banner)
- `plugins/pluradash/migrations/028_create_build_targets.sql` (+ down)
- `plugins/pluradash/migrations/029_build_targets_feedback_columns.sql` (+ down)
- `plugins/pluradash/migrations/030_build_targets_session_tenant.sql` (+ down)
- `plugins/pluradash/specs/plurapi-sessions-bridge.md`
- `plugins/pluradash/specs/changes/2026-10-13-plurapi-sessions-bridge.md`
- `specs/agents/plurapi-agent-bridge.md` — **canonical bridge entry point**
  (architecture, contracts, configuration, triage playbook incl. the
  Worker-router-404 vs. DO-miss distinction from the 2026-10-13 incident)
- `specs/features/pluradash-plurapi-sessions-bridge.md` — pointer stub to the
  canonical doc (consolidated)
- `specs/changes/2026-10-13-pluradash-plurapi-sessions-bridge.md`
- `tests/plurapiSessionsBridge.test.mjs` (17 cases: target resolution incl.
  fallback window, log truncation caps, failure detail composition, push
  payload shape, CF log parsing)

## Files Changed

- `plugins/pluradash/api/sync/webhookService.ts` — `processCheckRunPayload`
  now runs the PluraPi delivery after the deployment upsert (captured
  outcome, never thrown); `waitUntilSafe` context typing loosened
- `plugins/pluradash/api/webhooks.ts` — dedicated `plurapi.build_feedback`
  sync-log entry for delivery attempts
- `plugins/pluradash/api/sync/routes.ts` — `/sync/push` and `/sync/deploy`
  record `build_targets` rows (background, best-effort) incl. the caller's
  JWT `tenant_id` claim, optional `sessionId` request field on push
- `plugins/pluradash/api/sync/logger.ts` — `SyncOperation` += `plurapi.build_feedback`
- `plugins/pluradash/api/index.ts` — three new super-admin
  `/admin/github/agent-sessions*` proxy routes; env fields for the bridge
  config; pair discovery via agent-operation set (not actor); polling route
  no longer sync-logged; `/admin/github/logs` gains `?view=` and `?userId=`
  filters
- `plugins/pluradash/src/pages/admin/GitHubAppsAdminPage.tsx` — third tab
  **Agent-Sessions**, new log filter entries
- `plugins/pluradash/src/services/githubAppService.ts` — agent-session
  service functions + types
- `plugins/pluradash/plugin.json` — migration 028 (+down), three
  `api_metadata` route entries, `wrangler_intents` additions (`PLURAPI_SESSIONS_URL` var; `SS_PLURAPI_SESSIONS_PUSH_TOKEN` and
  `SS_PLURAPI_SESSIONS_API_TOKEN` Secrets Store intents), capability entry
  `pluradash-plurapi-sessions-bridge`
- `specs/features/README.md` — feature doc registered

## Core Impact

### Database

- **No core (public schema) changes.** New plugin table `pluradash.build_targets`
  (migration 028 + downmigration, idempotent): unique `(github_repo_id, head_sha)`,
  branch, workspace/user/session columns, created_at. RLS: writes
  service-role only, SELECT for super-admins.

### Runtime

- The check_run webhook pipeline now performs an outbound fetch chain per
  completed build (build_targets lookup → on failure up to two Cloudflare API
  calls → `POST $BASE/v1/builds`) inside the existing `waitUntil` background
  task. Failure of any step is captured and sync-logged; the webhook still
  answers 202 and the deployment status is kept.
- Sync push/deploy write one `build_targets` row per successful push
  (idempotent upsert; 7-day retention pruned opportunistically).
- `wrangler.jsonc` regenerated: `PLURAPI_SESSIONS_URL` var + two Secrets Store
  bindings (`SS_PLURAPI_SESSIONS_PUSH_TOKEN`, `SS_PLURAPI_SESSIONS_API_TOKEN`).
  Operator must set: `PLURAPI_SESSIONS_URL`, both store secrets, and grant
  `CF_API_TOKEN` the Workers Builds: Read permission.

### API surface

All new routes are plugin-scoped under `/api/plugin/pluradash/` and documented
in `plugin.json` `api_metadata` (`pluradash-admin-agent-sessions`,
`pluradash-admin-agent-sessions-messages`, `pluradash-admin-agent-sessions-builds`).
The core public API surface is unchanged. The bridge consumes the
PluraPi-Sessions REST contract (`POST /v1/builds`, session list/messages/
builds reads) — no PluraPi engine-internal endpoints.

## Tests

- `npm test` — 484 tests pass (incl. 17 new bridge cases).
- `npm run typecheck` / `typecheck:api` — clean for all touched files.
- `npm run build` — succeeds (registry + wrangler regeneration verified).

## Operator notes

1. Agree the two token values with the PluraPi operator (specy realm = push
   only; engine realm = needed for the agent-session overview).
2. `npx wrangler secret put PLURAPI_SESSIONS_PUSH_TOKEN` /
   `PLURAPI_SESSIONS_API_TOKEN` in the Secrets Store (or plain Worker secrets
   as fallback).
3. Set the `PLURAPI_SESSIONS_URL` var (merged into `wrangler.jsonc` by the
   build).
4. Add Workers Builds: Read to the CF API token for failure log retrieval.
5. Verify end-to-end with a dev push → check_run → chatlog entry labeled
   `[injection · build_feedback]` in the Agent-Sessions detail dialog.

## Related

- `specs/agents/plurapi-agent-bridge.md` — canonical bridge entry point
- `specs/features/pluradash-github-app-integration.md`
- `specs/changes/2026-09-13-pluradash-check-run-webhook.md`
