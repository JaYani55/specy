# PluraPi Build Feedback via Cloudflare Workflows (`sessions-do/v2`)

Date: 2026-10-15 (updated for contract v2.3: buildId forwarding, no failure detail)

## Summary

Migrates the PluraDash ⇄ PluraPi-Sessions build feedback bridge to the
workflow-orchestrated contract (`sessions-do/v2`, cf. the PluraPi handoff):
one durable Cloudflare Workflow instance per build instead of a single
completed-outcome push.

- **Build open** (`running` check_run): `POST /v1/build-sessions`
  (idempotent per deterministic `idempotencyKey`); the returned
  `workflowInstanceId` is stored on the exact `pluradash.build_targets` row
  (new columns, migration 031). The DO writes a
  `[build-status · <branch>]` status line (`role: "system"`) into the
  chatlog — previously `building` states were silently dropped.
- **Build result** (terminal check_run): `POST
  /v1/build-sessions/<workflowInstanceId>/result`. On failure Specy forwards
  the Cloudflare Workers Builds `build_uuid` (`buildId`, contract v2.3) —
  **the workflow retrieves the build log itself** from the Cloudflare Builds
  API and composes the diagnose-fix-repush prompt; Specy sends NO failure
  prompt/detail for orchestrated builds (the Specy-composed `detail` remains
  only as the verbatim fallback when no build id is recoverable).
  `409` (already finalized) is treated as "delivered, duplicate" and ignored;
  `404` (unknown instance) falls back to the legacy `POST /v1/builds` push
  (which still carries the Specy-fetched log detail, since the legacy DO does
  not retrieve logs); other failures are **not** fallback-pushed
  (double-delivery risk) — the workflow's result timeout marks the build
  `cancelled` instead of stranding it.
- **Legacy fallback preserved:** builds without a stored workflow handle
  (pre-migration pushes, single-delivery Cloudflare Pages check_runs) keep
  using `POST /v1/builds` unchanged. One build = one path — orchestrated
  builds are never also legacy-pushed.
- **Manual injections switched** to `POST /v1/workflow-injections` (same
  inputs, async injection row, approval tracking by PluraPi). No more
  failstate shaping: the injection no longer rides the check_run/
  `build_feedback` channel as a synthetic failed build. The Specy-side
  route/UI contract stays backward-compatible
  (`{ delivered, injectionCreated }`, now always `injectionCreated: true` on
  success + `workflowInstanceId`); the synthetic failed-build payload shape
  (`buildArbitraryInjectionPayload`) was removed.
- **Chatlog UI:** the Agent-Sessions detail dialog renders `role: "system"`
  entries tagged `[workflow · …]` / `[build-status · <branch>]` as compact
  status/flowchart lines instead of chat turns.
- Approval lifecycle tracking (failed build → fix prompt → user
  accept/reject or 24 h window) is handled entirely by PluraPi — no Specy
  involvement.

## Files Added

- `plugins/pluradash/migrations/031_build_targets_workflow_columns.sql`
  (+ `down/031_build_targets_workflow_columns.sql`)

## Files Changed

- `plugins/pluradash/api/sync/plurapiSessionsLogic.ts` — new pure builders
  `buildBuildSessionOpenPayload`, `buildBuildSessionResultPayload`,
  `buildSessionIdempotencyKey`, `buildWorkflowInjectionPayload`;
  `buildArbitraryInjectionPayload` removed; `BuildTargetRow` gains
  `workflow_instance_id`/`workflow_opened_at`
- `plugins/pluradash/api/sync/plurapiSessions.ts` — new runtime calls
  `openBuildSessionToPlurapi`, `sendBuildResultToWorkflow`,
  `pushWorkflowInjectionToPlurapi`, `storeBuildTargetWorkflowInstanceId`;
  `deliverCheckRunToPlurapi` now orchestrates the full lifecycle
  (`running` → open, terminal → workflow result with `buildId` forwarding
  and 409/404 semantics, Specy log fetch only as legacy/no-buildId fallback)
  and reports `mode`/`workflowInstanceId`/`workflowBuildId`/
  `alreadyFinalized`/`created`
- `plugins/pluradash/api/sync/webhookService.ts` — outcome typing + docs
- `plugins/pluradash/api/webhooks.ts` — `plurapi.build_feedback` sync log
  carries `mode`, `workflowInstanceId`, `workflowBuildId`, `alreadyFinalized`;
  messages distinguish build-session open / result / 409
- `plugins/pluradash/api/index.ts` — `/admin/github/agent-sessions/inject`
  switched to `POST /v1/workflow-injections`
- `plugins/pluradash/src/services/githubAppService.ts` — inject return type
  (+ `workflowInstanceId`), `isBuildStatusMessage`/`buildStatusBranch`
  (accepts `[workflow · …]` and `[build-status · <branch>]` tags)
- `plugins/pluradash/src/pages/admin/AgentSessionsPanel.tsx` — workflow
  status/flowchart lines; injection toast wording (async creation)
- `plugins/pluradash/plugin.json` — migration 031 registered
- `plugins/pluradash/specs/plurapi-sessions-bridge.md` — workflow-first flow
- `specs/agents/plurapi-agent-bridge.md` — §1 diagram, §2.1 push contract
  (workflow-first + legacy fallback), §2.2 reads (system entries,
  `workflow_instance_id`), §2.4 (workflow-injections), §4 triage signatures
- `tests/plurapiSessionsBridge.test.mjs` — replaced arbitrary-injection
  payload tests with workflow open/result/injection + idempotency-key tests;
  result tests lock in the v2.3 semantics (buildId forwarded, no detail when
  a buildId exists, detail only as no-buildId fallback)

## Impact analysis

- **Database:** `pluradash.build_targets` gains two nullable columns and a
  partial index (migration 031, idempotent, with down-migration). No data
  backfill needed — rows without a handle keep the legacy delivery path.
- **Runtime:** same worker bindings/secrets (`PLURAPI_SESSIONS_URL`,
  `SS_PLURAPI_SESSIONS_PUSH_TOKEN`); two extra outbound calls per build
  (open + result). Bridge stays fail-closed. The inject route depends on the
  workflow-injections endpoint being deployed on the sessions worker
  (`sessions-do/v2`) — otherwise it answers 502 (visible in the sync log).
- **API surface:** no core API changes; plugin route response gains an
  optional `workflowInstanceId` field (additive).
