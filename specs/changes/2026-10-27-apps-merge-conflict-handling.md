# Apps Merge Conflict Handling — Implemented (P0–P5)

> **Date:** 2026-10-27
> **Status:** Implemented (P0–P5; P6 decision gate deferred)
> **Plan:** [`../plans/apps-merge-conflict-handling.md`](../plans/apps-merge-conflict-handling.md)
> **Scope:** PluraDash plugin (`plugins/pluradash/`) — core `src/`, `api/`,
> `migrations/` untouched. No core migration; no plugin migration added.

## Summary

The PluraDash `/sync/*` and `/apps/*` surfaces are now safe for concurrent
workspace sessions (several people/agents editing one app's `dev` branch).

Three previously conflated conflict classes are resolved:

- **C1 staging-tree collision** → removed by session-scoped staging keys
  (`…/apps/{repo}/sessions/{sessionId}/…`) plus optimistic manifest CAS.
- **C2 concurrent push race** → removed by a retried blob-level 3-way merge on
  `dev` (`updateRef(force:false)` + recompute-on-422); different-file
  concurrency auto-merges.
- **C3 same-path divergence** → modelled with a structured `409 CONFLICT`
  payload and non-destructive per-path `resolutions`.

All five planned phases landed:

| Phase | Deliverable |
|---|---|
| **P0** | Manifest CAS (`onlyIf: etagMatches` + retry/`STAGING_BUSY`), `422` ref races modelled as retried push / `409 CONFLICT_RETRY_EXHAUSTED`, manifest-integrity guard (`409 MANIFEST_CORRUPT`) stopping the "partial manifest ⇒ mass deletion" hazard. |
| **P1** | Pure `planMerge`/`resolveMerge`; `commitTreeChanges` takes the observed head; push rewrite with 3-attempt retry loop; structured `409 CONFLICT`; `autoMerged`/`keptRemote`. |
| **P2** | `GET /sync/status`, `GET /sync/changes`, `pull?rebase`, per-path `resolutions`, `expectedHeadSha`, `GET /sync/files?ref=ours\|theirs`; MCP `app_sync_status`/`app_sync_changes`; updated `app_sync_commit`. |
| **P3** | Session-scoped staging key layout (default `default`), legacy `409 STAGING_UPGRADE_REQUIRED` + best-effort cleanup, opportunistic TTL reaping (`PLURADASH_STAGING_TTL_HOURS`, default 24 h). |
| **P4** | R2 head-tree cache; optional `baseBlobSha` save-time probe → `409 STALE_FILE` (`onStale: 'warn'\|'reject'`). |
| **P5** | Deploy divergence via the same planner; `diverged`/`mergeState`/`conflictingPaths`; `409 MERGE_CONFLICT`; `onConflict:'pr'`; `recentPushes`; `deployState:'merge-conflict'`. |

**P6 (branch-per-session)** is intentionally deferred — the plan gates it on a
>20 % conflict rate on the same paths, which cannot be evaluated until this
change is in production.

## Files Added

- `plugins/pluradash/api/sync/merge.ts` — pure 3-way merge planner
  (`planMerge`, `resolveMerge`, `computeConflictId`, tree-map types).
- `tests/appsMergeConflicts.test.mjs` — 14 planner/key-builder/state tests.
- `specs/agents/plurapi-merge-conflict-handoff.md` — external-application
  migration checklist (conflict loop, session staging, error codes, MCP tools).

## Files Changed

- `plugins/pluradash/api/sync/types.ts` — manifest `version: 1 | 2` + `sessionId`;
  `SyncError` `code`/`detail`; `baseBlobSha`/`onStale` save inputs;
  `SyncPushOptions`; `SyncStatusResult`/`SyncChangesResult`/`SyncConflictPayload`;
  `SyncDeployResult` divergence fields; pull `rebase` result fields.
- `plugins/pluradash/api/sync/keys.ts` — `DEFAULT_SESSION_ID`,
  `normalizeSessionId`, session-scoped `buildAppsRoot`/`buildBranchPrefix`/
  `buildHeadPrefix`/`buildManifestKey`/`buildWorkspaceObjectKey`/
  `buildWorkspaceFolderPath`, legacy key builders for upgrade detection.
- `plugins/pluradash/api/sync/storage.ts` — `readManifestWithEtag`,
  conditional `writeManifest`, `ManifestCasConflictError`, head-tree cache
  (`readHeadTreeCache`/`writeHeadTreeCache`/`pruneHeadTreeCache`), extended
  `SyncStorageEnv`.
- `plugins/pluradash/api/sync/github.ts` — `treeSha` on snapshots;
  `commitTreeChanges(headSha, headTreeSha, …)`; `isRefUpdateConflict`;
  `GitHubMergeConflictError`; `openProductionPullRequest`; `compareBranches`;
  `fetchBlobBytes`; merge 409 mapping.
- `plugins/pluradash/api/sync/engine.ts` — session-aware manifest resolution and
  legacy upgrade 409; destructive + `rebase` pull; CAS save with stale probe;
  merge-based `pushDev` with retry loop and conflict payload; `getSyncStatus`,
  `getSyncChanges`, `readWorkspaceFileByRef`; `reapExpiredStagingSessions`;
  deploy divergence + `onConflict:'pr'`; commit trailers.
- `plugins/pluradash/api/sync/provisioning.ts` — v2 manifest with `default`
  session id; unlink cleanup also removes the repo's head-tree cache.
- `plugins/pluradash/api/sync/routes.ts` — `errorResponse` carries
  `code`/detail; session/options parsing; new `/status`, `/changes`; `ref` on
  `/files`; `rebase` on `/pull`; `resolutions`/`expectedHeadSha`/`strategy` on
  `/push`; `baseBlobSha`/`onStale` on `/save`; `onConflict` on `/deploy`;
  opportunistic reaping; conflict log detail.
- `plugins/pluradash/api/sync/mcpTools.ts` — `app_sync_status`,
  `app_sync_changes`, `baseBlobSha`/`onStale` on `app_sync_save`,
  `expectedHeadSha`/`resolutions` on `app_sync_commit`, revised descriptions.
- `plugins/pluradash/api/sync/appDeployInfo.ts` — `merge-conflict` state.
- `plugins/pluradash/api/index.ts` — `/apps/info` computes
  `diverged`/`mergeState`/`conflictingPaths` with the shared planner and adds
  `recentPushes`; `/apps/deploy` passes `onConflict`.
- `plugins/pluradash/plugin.json` — `/apps/info` + `/apps/deploy` catalog
  descriptions (merge fields, `onConflict`).
- `plugins/pluradash/specs/app-sync-mcp-tools.md`,
  `plugins/pluradash/specs/app-deploy-state.md` — tool/state contracts.
- `specs/agents/plurapi-file-sync-integration.md`,
  `specs/agents/pluradash-apps-integration.md` — external handoff contracts
  (conflict loop, new endpoints, error codes, deploy divergence).
- `specs/agents/README.md` — registers the new handoff doc.
- `specs/features/pluradash-r2-sync-engine.md`,
  `specs/features/pluradash-github-app-integration.md` — backend/admin docs
  (merge model, session staging, head cache, conflict logging).
- `specs/plans/apps-merge-conflict-handling.md`, `specs/plans/README.md` —
  status updated to implemented.

## Impact Analysis

- **Database:** none. No core migration and no plugin migration were needed —
  conflict state is stateless (response body), staging state lives in R2
  (`sessionId` in keys), and `sync_logs` already stores the conflict detail.
  The optional `033_create_workspace_sessions.sql` was **not** adopted; R2-side
  TTL reaping proved sufficient.
- **Runtime:** PluraDash Worker only. All new logic is plugin-local. R2 usage
  multiplies per session (one staging copy per session) and is bounded by TTL
  reaping; a head-tree cache under `tenant/{ws}/cache/pluradash/git-head/…`
  trades a small amount of R2 storage for fewer GitHub calls. GitHub write
  semantics are unchanged (`updateRef(force:false)`).
- **API surface (additive):** `GET /sync/status`, `GET /sync/changes`,
  `ref=` on `GET /sync/files`, `rebase` on `POST /sync/pull`,
  `expectedHeadSha`/`resolutions`/`strategy`/`sessionId` on `POST /sync/push`,
  `baseBlobSha`/`onStale` on `POST /sync/save`, `onConflict` on
  `POST /sync/deploy` + `POST /apps/deploy`; new `/apps/info` fields. Error
  bodies gain `code` + structured detail. **Breaking:** the staging key layout
  changed once — clients get a `409 STAGING_UPGRADE_REQUIRED` and migrate with a
  single `/sync/pull`.
- **Tests:** `tests/appsMergeConflicts.test.mjs` added; full suite green.

## Follow-ups

- **P6 decision gate:** evaluate `sync_logs` conflict rate (>20 % on the same
  paths) before considering branch-per-session.
- Frontend `AppsPage` / `githubAppService` types may surface the new
  `merge-conflict` state and divergence fields in the dashboard UI (not
  required for the backend contract).
