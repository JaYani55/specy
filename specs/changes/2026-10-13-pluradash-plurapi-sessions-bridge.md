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
with a per-session detail dialog showing the live chatlog tail and build
history.

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
  agent-session overview tab (detail dialog: chatlog tail + build history)
- `plugins/pluradash/migrations/028_create_build_targets.sql` (+ down)
- `plugins/pluradash/specs/plurapi-sessions-bridge.md`
- `plugins/pluradash/specs/changes/2026-10-13-plurapi-sessions-bridge.md`
- `specs/features/pluradash-plurapi-sessions-bridge.md`
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
  record `build_targets` rows (background, best-effort), optional `sessionId`
  request field on push
- `plugins/pluradash/api/sync/logger.ts` — `SyncOperation` += `plurapi.build_feedback`, `agent.sessions`
- `plugins/pluradash/api/index.ts` — three new super-admin
  `/admin/github/agent-sessions*` proxy routes; env fields for the bridge
  config
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

- `specs/features/pluradash-plurapi-sessions-bridge.md`
- `specs/features/pluradash-github-app-integration.md`
- `specs/changes/2026-09-13-pluradash-check-run-webhook.md`
