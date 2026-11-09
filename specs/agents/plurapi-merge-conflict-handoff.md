# Handoff — Merge-Conflict Handling for PluraPi / Consuming Apps

> **Audience:** PluraPi (agent runtime), external dashboards, and any client of
> the PluraDash `/sync/*` + `/apps/*` surfaces.
>
> **Status:** implemented 2026-10-27 (P0–P5). Backend: PluraDash plugin
> (`plugins/pluradash/api/sync/`). Authoritative endpoint contracts:
> [`plurapi-file-sync-integration.md`](plurapi-file-sync-integration.md) (file
> sync) and [`pluradash-apps-integration.md`](pluradash-apps-integration.md)
> (apps/deploy). Change record:
> [`../changes/2026-10-27-apps-merge-conflict-handling.md`](../changes/2026-10-27-apps-merge-conflict-handling.md).

This page is the **migration checklist**. It lists only what an external client
must change or may start relying on. Nothing here requires a new credential,
binding, or database migration.

## 1. What changed for clients

| Topic | Before | Now |
|---|---|---|
| Concurrent edits on `dev` | Second push blocked (`409`, “branch advanced”), recovery = destructive re-pull | Different-file edits **auto-merge**; only same-path divergence returns `409 CONFLICT` |
| Conflict recovery | Buffer edits → pull → re-save → push | `push → 409 → /sync/changes → resolve → push { resolutions }` — staged work survives |
| Staging identity | One tree per user; sessions of one user clobbered each other | One tree per `sessionId` (default `default`); pass `sessionId` to keep sessions isolated |
| Save races | Last-write-wins on the manifest | Optimistic CAS (`409 STAGING_BUSY`, retried once) + optional `baseBlobSha` stale probe (`409 STALE_FILE`) |
| Deploy divergence | Unmodelled `500` from `repos.merge` | `mergeState`/`conflictingPaths` in `/apps/info`; `409 MERGE_CONFLICT` or `onConflict:'pr'` |

## 2. Required client actions

1. **Add a conflict loop** to the agent/commit workflow (PluraPy):
   ```
   push
     → 409 CONFLICT { conflicts, headSha, baseSha, conflictId }
     → GET /sync/changes?since=<baseSha>
     → resolve locally (or ask the human)
     → push { expectedHeadSha: <headSha>, resolutions: { "<path>": "ours"|"theirs"|{ content } } }
   ```
   Do **not** call `/sync/pull` to recover from a conflict — staged work would be
   discarded (unless `rebase: true`).
2. **Send `sessionId`** on `/sync/pull`, `/sync/save`, `/sync/push` (and as a
   query param on `/sync/status`/`/sync/changes`/`/sync/files`). Omitting it
   falls back to the implicit `default` session (legacy behaviour, but two
   people in one workspace will share a tree again).
3. **Treat error `code` before the HTTP status** where possible. New codes:
   `CONFLICT`, `CONFLICT_RETRY_EXHAUSTED`, `STALE_HEAD`, `STALE_FILE`,
   `STAGING_BUSY`, `STAGING_UPGRADE_REQUIRED`, `MANIFEST_CORRUPT`,
   `MERGE_CONFLICT`.
4. **Handle the one-time upgrade.** The first request using the new staging
   layout returns `409 STAGING_UPGRADE_REQUIRED` while a legacy tree exists. Run
   `/sync/pull` once; no data migration is involved.
5. **Surface `merge-conflict`.** Consuming dashboards must treat
   `deployState: 'merge-conflict'` (and any unknown state) as *not deployable*.

## 3. New / changed endpoints (summary)

| Method | Path | Change |
|---|---|---|
| `GET` | `/sync/status` | **new** — cheap preflight from cache: base, live head, `behindBy`/`aheadBy`, `remoteChangedPaths`, staging metadata |
| `GET` | `/sync/changes` | **new** — remote-changed paths since `<sha>`, optional inline content (< 64 KiB) |
| `GET` | `/sync/files` | **new** `ref=ours\|theirs` for conflict-side reads (`theirs` = live head) |
| `POST` | `/sync/pull` | **new** `rebase: true` (non-destructive); response gains `kept`/`merged`/`discarded` |
| `POST` | `/sync/push` | **new** `expectedHeadSha`, `resolutions`, `strategy: 'merge'\|'strict'`, `sessionId`; success gains `autoMerged`/`keptRemote`; conflicts return structured `409` |
| `POST` | `/sync/save` | **new** `baseBlobSha` per file + `onStale: 'warn'\|'reject'`; `409 STALE_FILE` |
| `POST` | `/sync/deploy`, `/apps/deploy` | **new** `onConflict: 'pr'`; `409 MERGE_CONFLICT`; `mergedRemoteCommits` |
| `GET` | `/apps/info` | **new** `diverged`, `mergeState`, `conflictingPaths`, `recentPushes`; `deployState` gains `merge-conflict` |

All additions are backward-compatible; the only breaking change is the staging
key layout (degraded to a one-time re-pull).

## 4. MCP tools (authenticated agent connections)

| Tool | Change |
|---|---|
| `app_sync_status` | **new** — mirror of `GET /sync/status` |
| `app_sync_changes` | **new** — mirror of `GET /sync/changes` |
| `app_sync_commit` | **new** `expectedHeadSha` + `resolutions`; conflict/retry description updated |
| `app_sync_save` | **new** `baseBlobSha` per entry + `onStale` |

Full tool contracts: `plugins/pluradash/specs/app-sync-mcp-tools.md`.

## 5. What PluraPi does NOT need

- No git tooling, SSH or GitHub credentials (unchanged).
- No lock/lease protocol — correctness comes from the server-side CAS + merge.
- No destructive pre-buffering for conflicts (the staging tree survives).
- No server-side text merge — the server returns candidate bytes; resolution is
  the client's decision.

## 6. Recommended sequencing

1. Ship the client conflict loop and `sessionId` propagation.
2. Deploy the PluraDash backend change, then run one `/sync/pull` per
   repo/session to migrate staging (expect `STAGING_UPGRADE_REQUIRED` until then).
3. Wire `deployState: 'merge-conflict'` into the dashboard deploy gating.
4. Observe `sync_logs` `detail.conflict.conflictId` for repeated ids (agent
   looping without progress) and evaluate the P6 branch-per-session gate
   (>20 % same-path conflict rate).
