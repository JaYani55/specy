# PluraPi Apps — Merge Conflict Handling for Concurrent Workspace Sessions

> **Status: implemented (P0–P5, 2026-10-27); P6 deferred.**
> Plan for making the PluraDash `/sync/*` + `/apps/*` surfaces safe when several
> people (and their PluraPi agents) edit the same app's `dev` branch at the same
> time. The authoritative contract now lives in
> [`../agents/plurapi-file-sync-integration.md`](../agents/plurapi-file-sync-integration.md)
> (file sync) and [`../agents/pluradash-apps-integration.md`](../agents/pluradash-apps-integration.md)
> (apps/deploy); the implementation is recorded in
> [`../changes/2026-10-27-apps-merge-conflict-handling.md`](../changes/2026-10-27-apps-merge-conflict-handling.md).
> See that record for the delivered phase matrix and impact analysis.

**Scope:** PluraDash plugin (`plugins/pluradash/api/sync/*`) — core `src/`,
`api/`, `migrations/` stay untouched. All new plugin migrations must target the
`pluradash` schema and ship a `down/` counterpart (AGENTS.md §5).

---

## 1. Problem

PluraPi is a multi-user execution engine: a workspace session can be joined by
several people, each running their own agent, each pushing to the same app's
`dev` branch. The current sync engine models **one writer per workspace/user**
and treats every divergence as a hard error whose only recovery destroys staged
work.

Three distinct conflict classes are conflated today, and they need different
fixes:

| # | Class | Trigger |
|---|---|---|
| C1 | **Staging-tree collision** | Two clients share one staging tree (same user identity, e.g. multiple people in one workspace session) and overwrite each other's saves / corrupt the manifest. |
| C2 | **Concurrent push race** | Two clients pull at the same base, both push; the second is blocked by a SHA equality gate, and retrying requires a destructive re-pull. |
| C3 | **True same-path divergence** | Both sides edited (or one deleted) the same file since the common base. |

`C3` is the only case that genuinely needs a human/agent decision. `C1` and
`C2` are architecture bugs that should be *eliminated*, not "resolved".

---

## 2. Verified current behavior

| Mechanic | Location | Consequence |
|---|---|---|
| Staging key is `tenant/{workspaceId}/user/{userId}/files/apps/{repoKey}/{branch}/HEAD/…` + `manifest.json` | `api/sync/keys.ts:38` (`buildAppsRoot`), `keys.ts:75` (`buildBranchPrefix`) | No `sessionId` dimension. All people sharing an identity share one mutable tree. |
| `push` precondition: `liveHead !== manifest.baseCommitSha` → `409` | `api/sync/engine.ts:475-482` | Any concurrent push blocks wholesale. Recovery = full `/sync/pull` (documented, destructive). |
| Commit path: `getRef` → `createTree(base_tree = head tree)` → `createCommit(parents=[head])` → `updateRef` (`force` unset ⇒ `false`) | `api/sync/github.ts:167-230` | Already a **tree-level 3-way merge**: remote changes to paths this client did not touch survive automatically. `force:false` is already the correct CAS primitive. |
| `updateRef` is not retried; a lost race surfaces as `422` | `api/sync/github.ts:220` | Second push returns `500`, not a modeled `409`. |
| `save` = read manifest → mutate → `put` manifest (no ETag/`onlyIf`) | `engine.ts:335-458`, `storage.ts:48-78` | Lost-update on the manifest. |
| `push` treats "path present at base but absent from `manifest.files`" as deleted | `engine.ts:506-511` | **Data-loss hazard:** a clobbered/partial manifest turns into a mass deletion commit on `dev`. |
| `pull` replaces the whole staging tree | `engine.ts:178-270` | Unpushed staged edits are destroyed — the only documented conflict recovery today. |
| Deploy merges `dev → prod` via `repos.merge`; gate only checks the latest dev build | `github.ts:236-256`, `deployGate.ts` | If production has human commits (`behindBy > 0`) the merge is real and can conflict; that error is unmodeled (generic `500`). |
| No lock/lease/DO anywhere in `api/sync/*` | — | By design today; correctness must come from CAS + merge, not locking. |

**Conclusion:** the missing piece is *not* a lock and *not* a merge UI. It is
(a) session-scoped staging identity, (b) replacing the SHA equality gate with a
retried 3-way merge, (c) a structured, non-destructive conflict contract.

---

## 3. Design principles

1. **Auto-merge when provably safe, fail closed only on same-path overlap.**
   Different-file concurrency is the dominant PluraPi workload and must never
   require user interaction.
2. **Never force a ref.** `updateRef(force:false)` + recompute-on-`422` is the
   only write mechanism. No rebase/force-push, ever.
3. **Never destroy staged work as a side effect.** Re-pull remains available but
   stops being the conflict path.
4. **Optimistic concurrency at the cheapest layer.** Detect at `save` where
   possible, at `push` where necessary, never later.
5. **Locks are advisory only.** A short-TTL lease may reduce wasted work; it is
   never the correctness boundary (sessions are long-lived, deadlocks are worse
   than a retry).
6. **The conflict payload names people and sessions.** `sync_logs` and
   `build_targets` already carry the actor/session — conflicts must be routable
   back to the agent that caused them.

**Non-goals (v1):** server-side hunk-level text merging (OT/CRDT), a CMS merge
UI, per-branch PR workflows inside the dashboard, cross-repo atomic commits.

---

## 4. Conflict taxonomy → handling matrix

| Case | Base | Ours | Theirs (live head) | Handling |
|---|---|---|---|---|
| untouched vs untouched | any | = base | = base | no-op |
| remote-only change | A | A | B | **auto-keep theirs** (tree base does this already) |
| local-only change | A | B | A | **auto-take ours** |
| both changed identically | A | B | B | **no conflict** (equal blob SHAs) |
| both changed differently | A | B | C | **conflict `edit-edit`** → 409 + payload |
| local deleted, remote untouched | A | — | A | delete (as today) |
| local deleted, remote edited | A | — | C | **conflict `delete-edit`** (default: fail closed; `theirs` resurrects with warning) |
| local edited, remote deleted | A | B | — | **conflict `edit-delete`** (default: fail closed; `ours` restores) |
| both deleted | A | — | — | no-op |
| binary file, both changed | A | B | C | conflict, byte-level only (`ours`/`theirs`, no content resolution) |
| rename (as delete+add) | A→B | — at A, + at B′ | — at A, + at B″ | reported as `edit-delete` on A + `add-add` on B′/B″ — clients must treat renames as two paths |

`C1` (staging collision) disappears once staging keys include the session id;
the remaining same-identity race is closed by manifest CAS (§5.1).

---

## 5. Target design

### 5.1 Session-scoped staging + manifest CAS

**Key layout (v2):**

```
tenant/{workspaceId}/user/{userId}/files/apps/{repoKey}/sessions/{sessionId}/{branch}/HEAD/{path}
tenant/{workspaceId}/user/{userId}/files/apps/{repoKey}/sessions/{sessionId}/{branch}/manifest.json
```

- `sessionId` is the PluraPi session id already accepted by `POST /sync/push`
  (`sessionId` body field → `build_targets.session_id`, migration 028).
  Default when omitted: `'default'` (one implicit session per user — preserves
  today's single-client behavior).
- `buildAppsRoot()` gains a `sessionId` parameter; every key builder
  (`buildBranchPrefix`, `buildHeadPrefix`, `buildManifestKey`,
  `buildWorkspaceObjectKey`, `buildWorkspaceFolderPath`) passes it through.
- Path validation: `sessionId` must match `^[a-zA-Z0-9._-]{1,64}$` (it becomes an
  R2 segment and must not be attacker-controlled traversal).
- Quota: each session is a full copy of the tree. Add **TTL reaping**
  (default 24 h, env `PLURADASH_STAGING_TTL_HOURS`) that deletes expired
  sessions via the existing `deleteHeadTree` + `deleteCatalogRowsByPrefix`
  helpers. Reaping runs opportunistically on pull/push (best-effort,
  `waitUntil`) — no cron required.

**Legacy compatibility:** staging is a reconstructible cache, so the upgrade is
a one-time "pull required" — no migration code path. On a v2 key miss, if a
legacy (`…/{repoKey}/{branch}/manifest.json`) manifest exists, return
`409 code: 'STAGING_UPGRADE_REQUIRED'` with the message
`"Workspace cache layout changed — run app_sync_pull once."` and (best-effort)
delete the legacy prefix. Do **not** silently keep two layouts.

**Manifest CAS:** `writeManifest` sends `onlyIf: { etagMatches: <expected> }`
when the caller supplies an ETag; mismatch → `409 code: 'STAGING_BUSY'` (retry
once inside the request, then surface). All mutation paths (`save`, `push`,
`pull`, `deploy`) read the manifest with its ETag and write conditionally.
*Fallback if the R2 binding lacks conditional-put support:* a per-manifest
in-flight guard in the manifest itself (`lockedUntil` + `lockOwner`) with a
short timeout, plus the same retry — never a long-lived lock.

> This is the C1 fix: two concurrent `save` calls can no longer drop manifest
> entries, which in turn removes the "missing entry ⇒ delete on push" hazard
> (`engine.ts:506`).

### 5.2 Push = retried 3-way merge (the core change)

Replace the SHA equality gate (`engine.ts:475-482`) with:

```ts
export interface MergePathState { path: string; baseSha: string | null; ourSha: string | null; theirSha: string | null }

// Pure, unit-testable (phase P1) — no I/O.
export function planMerge(base: TreeMap, ours: TreeMap, theirs: TreeMap): MergePlan

export interface MergePlan {
  write:  Array<{ path: string; ourSha: string; mode: GitFileMode }>;  // ours changed, theirs unchanged
  delete: string[];                                                    // ours deleted, theirs unchanged
  keepTheirs: string[];                                                // theirs changed, ours untouched (informational)
  conflicts: Array<{
    path: string;
    kind: 'edit-edit' | 'edit-delete' | 'delete-edit' | 'add-add';
    baseSha: string | null;
    ourSha: string | null;
    theirSha: string | null;
    binary: boolean;
  }>;
}
```

Where:

- `base`  = `fetchTreeSnapshot(manifest.baseCommitSha)` (path → blob sha)
- `ours`  = `manifest.files` (+ implicit absence for staged deletions)
- `theirs`= `fetchTreeSnapshot(liveHead)`
- `oursChanged(p)`  = `ourSha(p) !== baseSha(p)`
- `theirsChanged(p)`= `theirSha(p) !== baseSha(p)`
- conflict iff `oursChanged && theirsChanged && ourSha !== theirSha`

Push flow:

```
for attempt in 0..2:
  head   = getBranchHead(dev)                       # optimistic token
  theirs = fetchTreeSnapshot(head)
  base   = fetchTreeSnapshot(manifest.baseCommitSha)
  plan   = planMerge(base, ours, theirs)

  if plan.conflicts && no resolutions supplied:
      return 409 { code:'CONFLICT', conflictId, headSha, baseSha, conflicts, staleBase: head != manifest.baseCommitSha }

  resolved = applyResolutions(plan, resolutions)     # 'ours' | 'theirs' | {content|contentBase64}
  if resolved.conflicts: return 409 (same shape, remaining conflicts only)

  try:
      commit = commitTreeChanges(dev, head, resolved, message)   # headSha passed explicitly
      # createTree(base_tree = theirs.treeSha) → createCommit(parents=[head]) → updateRef(force:false)
      update manifest { headCommitSha: commit, baseCommitSha: commit, lastPushedAt }
      return 200 { …diff, mergedRemoteChanges, autoMerged: plan.keepTheirs.length }
  catch e where status(e) == 422:                    # head moved between read and write
      continue                                       # recompute against the new head
throw SyncError(409, { code:'CONFLICT_RETRY_EXHAUSTED' })
```

Implementation notes:

- `commitTreeChanges` must accept the **observed head sha** and build against
  *that* tree (today it re-reads `getRef`, which can silently base the commit on
  a different tree than the merge plan assumed). New signature:
  `commitTreeChanges(octokit, repo, branch, headSha, headTreeSha, changes, message)`.
  The `updateRef` stays `force:false` — if the head moved, `422` and the loop
  recomputes. This is strictly safer than today and removes the TOCTOU.
- Retry cap: 3 attempts. `422` three times = pathological contention → `409`
  with `code:'CONFLICT_RETRY_EXHAUSTED'` and `retryAfterMs`.
- `base` fetch can be cached by sha (immutable) — no cost on retries.
- The push *diff* response keeps its shape; add `autoMerged: string[]` and
  `keptRemote: string[]` so the agent can report "your change landed on top of
  X's changes to these files".
- **Never** merge text server-side. Conflicting content is returned as
  candidate bytes (base/ours/theirs) and the client resolves; this keeps
  Workers CPU/memory bounded and avoids a half-correct line merger.

### 5.3 Structured conflict contract

Error body (all conflict responses, HTTP `409`):

```jsonc
{
  "error": "Merge conflict on 2 paths — resolve and retry with expectedHeadSha.",
  "code": "CONFLICT",
  "conflictId": "sha256(head|base|path1,path2)[0..12]",   // stable across retries
  "workspaceId": "…",
  "repoId": 812345678,
  "branch": "dev",
  "baseSha": "abc123…",
  "headSha": "def456…",
  "staleBase": true,              // head advanced since this client's base
  "retryAfterMs": 0,
  "conflicts": [
    {
      "path": "src/App.tsx",
      "kind": "edit-edit",
      "baseSha": "a1…", "ourSha": "b2…", "theirSha": "c3…",
      "binary": false,
      "ours":   { "encoding": "utf-8", "content": "…" },   // omitted when > 64 KiB → see `downloadPath`
      "theirs": { "encoding": "utf-8", "content": "…" }
    }
  ]
}
```

- Content is capped (64 KiB per side); larger files return
  `GET /sync/files?…&path=…&ref=ours|theirs` (`ref=theirs` reads the live head,
  not the local staging tree) instead of inlining.
- `conflictId` is a pure function of `(baseSha, headSha, sorted paths)` so a
  retry after a transient failure is idempotent for clients.
- Logged to `sync_logs` as `operation: 'push'`, `status: 'error'`,
  `detail.conflict = { conflictId, paths, kinds }` — already the existing
  logging path, no new operation enum needed (keeps the `/admin/github-apps`
  Sync-Logs filters stable).

### 5.4 Non-destructive resolution (retire "pull first")

New/changed endpoints (all mount under the existing `sync` router,
`api/sync/routes.ts`; MCP mirrors in `api/sync/mcpTools.ts`):

| Endpoint | Purpose |
|---|---|
| `GET /sync/status` | Cheap preflight: `baseCommitSha`, `devHeadSha`, `behindBy`, `aheadBy`, `staleBase`, cached `remoteChangedPaths`, `stagingSessionId`, `stagingExpiresAt`. Served from the head-tree cache (§5.5) — **no full tree download**. |
| `GET /sync/changes?since=<sha>` | Remote-changed paths since the client's base: `{ paths: [{ path, change: 'added'|'modified'|'deleted', blobSha, size, mode }] }`. Optional `includeContent=true` for paths < 64 KiB. Replaces the full re-pull in the rebase path. |
| `POST /sync/push` | Gains `expectedHeadSha` (fail fast if the client's view is stale), `resolutions` (per path: `'ours'` \| `'theirs'` \| `{ content \| contentBase64, mode? }`), `strategy: 'merge'` (default) \| `'strict'` (any remote advance ⇒ 409, today's semantics). |
| `POST /sync/pull` | Gains `rebase=true`: update `baseCommitSha`/`headCommitSha` to the live head and **keep** staged files whose paths did not change remotely; response reports `{ kept, merged, discarded }`. Default stays destructive for back-compat, but the docs/agents stop using it for conflicts. |

Agent conflict loop becomes:

```
1. push → 409 CONFLICT { conflicts, headSha }
2. GET /sync/changes?since=<base>            # what the others changed
3. local 3-way apply (agent-side) / ask the human for ambiguous hunks
4. POST /sync/push { expectedHeadSha: <headSha>, resolutions: {…}, sessionId }
```

No full re-read, no lost staging, no "start over".

### 5.5 Save-time probe + head-tree cache

`/sync/save` currently performs no GitHub call. Keep that property via a cache:

- R2 object: `tenant/{ws}/cache/pluradash/git-head/{repoKey}/current.json`
  (`{ headSha, treeSha, fetchedAt, files: { path: { sha, size, mode } } }`) and
  per-sha cold copies for `GET /sync/changes?since=` and `ref=theirs` reads.
  No new binding (`MEDIA_BUCKET` is already core-shared); prune to the last
  ~10 heads per repo on write.
- Cache is populated lazily by `push`/`pull`/`status` (one `getTree` per new
  head) and invalidated by the check_run webhook only for `repo_deployments`
  (build status), not the tree — the tree is keyed by immutable sha.
- `/sync/save` accepts optional `baseBlobSha` per file (the timestamp-free token;
  the manifest already stores `blobSha` per path). Behavior:
  - omitted → today's semantics (back-compat);
  - supplied and `headTree[path].sha !== baseBlobSha` **and** `!== ourSha` →
    return `409 code:'STALE_FILE'` with `{ path, baseBlobSha, headSha }` for all
    affected paths at once. This catches C3 *before* the agent burns tokens.
- Optional `onStale: 'warn' | 'reject'` (default `'reject'` for agent/MCP
  callers, `'warn'` for interactive dashboard clients).

### 5.6 Deploy-side divergence (`dev → prod`)

`repos.merge` is a real merge whenever production has commits dev lacks. Model
it instead of letting it 500:

- `GET /apps/info` additions:
  ```ts
  diverged: boolean;                       // aheadBy > 0 && behindBy > 0
  mergeState: 'clean' | 'conflicted' | 'unknown';
  conflictingPaths: string[];              // 3-way diff: merge-base, devHead, prodHead
  deployState: … | 'merge-conflict';       // new union member
  canDeploy: false when mergeState === 'conflicted'
  ```
- Compute `mergeState` from the cached head trees: `base = mergeBase(devHead,
  prodHead)` (GitHub compare gives the base commit), then `planMerge` against
  `devHead`/`prodHead`. Reuse the **same pure planner** as §5.2 so push and
  deploy can never disagree about what "conflict" means.
- `POST /sync/deploy` / `POST /apps/deploy`:
  - `mergeState === 'conflicted'` → `409 { code: 'MERGE_CONFLICT', conflictingPaths }`
    (replaces the generic error from `repos.merge`).
  - Optional `onConflict: 'pr'` → open a PR
    (`POST /repos/{owner}/{repo}/pulls`, `base: prodBranch`, `head: dev`) and
    return `{ status: 'pr-opened', pullRequestUrl }`. Resolution then happens in
    GitHub, not in the CMS. Deploy remains human-only (agents stay `403`).
  - `behindBy > 0` but merge clean → keep merging (fast-forward-equivalent
    merge commit); report `mergedRemoteCommits: behindBy` so the human sees that
    production had moved.
- Deploy gate stays unchanged in principle: the dev build must be green on the
  current `devHeadSha`. A merge commit on production triggers its own build;
  the gate does not need to inspect it.

### 5.7 Attribution and advisory coordination

- **Commit trailers** (GitHub App commits are authored by the app, so trailers
  are the only attribution available):
  ```
  <message>

  Specy-Session: <sessionId>
  Specy-Actor: <userId>
  Specy-Conflict-Resolutions: path=ours,path2=theirs
  ```
  Applies to push and deploy commits; makes `git log`/blame usable for humans.
- `GET /apps/info` gains `recentPushes?: Array<{ userId, sessionId, at, changedPaths }>`
  derived from `pluradash.sync_logs` (already stores `user_id`, `session_id` in
  `detail`, and `commitSha`). Advisory only — the agent can avoid hot files.
  Respect the existing retention (`sync_logs` pruning) and do not add GitHub
  calls for this.
- Conflict `409`s are routed to the *originating* session via the existing
  `build_targets` mechanism where a session id is known, so build feedback and
  conflict feedback use the same (tenant, user, session) keying documented in
  [`../agents/plurapi-agent-bridge.md`](../agents/plurapi-agent-bridge.md).

### 5.8 Optional: branch-per-session (deferred, decision gate)

If hot-file collisions stay frequent after §5.2–5.5, hard isolation is the
better model: push to `dev/{sessionId}`, merge into `dev` on "publish"/session
end via `repos.merge` (same planner, batch conflict at integration time).

Why it is *not* phase 1: `repo_deployments` is already per branch and R2 keys
already carry a branch segment, so it would mostly "fall out" — but it changes
the deploy contract (`/apps/info`, `canDeploy`, build target resolution, quota
per branch) and multiplies preview builds. **Decision gate:** adopt only when
`sync_logs` shows > ~20 % of pushes hitting `CONFLICT` on the same paths.

---

## 6. API changes summary (back-compat notes)

| Surface | Change | Compat |
|---|---|---|
| `POST /sync/push` | new optional `expectedHeadSha`, `resolutions`, `strategy`, `sessionId` (already parsed); 409 body gains `code`/`conflicts` | Additive; old clients still get 409 only in `strategy:'strict'` |
| `POST /sync/pull` | `rebase` flag | Default unchanged |
| `POST /sync/save` | optional `baseBlobSha` per file, `onStale` | Omitted ⇒ unchanged |
| `GET /sync/status` | new | — |
| `GET /sync/changes` | new | — |
| `GET /sync/files` | `ref=ours\|theirs` for conflict-content reads | Additive |
| `GET /apps/info` | `diverged`, `mergeState`, `conflictingPaths`, `deployState:'merge-conflict'`, `recentPushes` | Additive; clients must treat unknown `deployState` as "not deployable" (already fail-closed) |
| `POST /sync/deploy`, `POST /apps/deploy` | `onConflict:'pr'`; structured `409 MERGE_CONFLICT` | Additive |
| MCP tools (`mcpTools.ts`) | `app_sync_commit` gains `expectedHeadSha`/`resolutions` + structured error text; new `app_sync_status`, `app_sync_changes` | Additive; tool descriptions must drop the "pull first / pull destroys staged work" warning in favour of the rebase flow |
| Error codes | `CONFLICT`, `CONFLICT_RETRY_EXHAUSTED`, `STALE_FILE`, `STAGING_BUSY`, `STAGING_UPGRADE_REQUIRED`, `MERGE_CONFLICT` | Documented in the agent handoff spec |

Key layout change (§5.1) is the **only breaking change**; it degrades to a
one-time re-pull.

---

## 7. Data model / migrations

- **No core migrations.** No new tables strictly required: conflict state lives
  in the response (stateless), staging state in R2, `sync_logs` already stores
  the detail.
- **Optional plugin migration `033_create_workspace_sessions.sql` (+ `down/`,
  `pluradash` schema):** `workspace_sessions(id, tenant_id, user_id, repo_id,
  session_id, created_at, last_seen_at)` for TTL reaping observability and for
  the Agent-Sessions admin tab. Adopt only if R2-side reaping proves opaque;
  register in the plugin `plugin.json` migrations array and in the repo's
  migration-order test expectations (`tests/coreMigrations.test.mjs` covers core
  only — plugin order is validated by `install-plugins.mjs`).
- **Manifest schema v2:** bump `version: 2`, add `sessionId`, keep `files[]`
  (its `blobSha` is the "ours" input). `readManifest` must accept v1 (treat
  `sessionId` as `'default'`) so a re-pull is enough.

---

## 8. Rollout phases

| Phase | Deliverable | Files | Exit criteria |
|---|---|---|---|
| **P0 — Stop the data loss** | manifest CAS (`onlyIf` ETag, retry once) + map `updateRef 422` → retried push / `409`; guard the "missing manifest entry ⇒ delete" loop behind a full-manifest integrity check | `storage.ts`, `engine.ts`, `github.ts` | Concurrency test: 50 parallel saves + 10 parallel pushes on one staging tree → no lost manifest entries, no spurious deletions, `422` never surfaces as `500` |
| **P1 — Auto-merge** | pure `planMerge`/`resolveMerge`; `commitTreeChanges(headSha, headTreeSha, …)`; push rewrite with retry loop; structured `409 CONFLICT`; `autoMerged`/`keptRemote` in response | `github.ts`, `engine.ts`, `types.ts`, `routes.ts` | Two clients editing disjoint files both succeed; same-path edits yield deterministic `conflictId` + exact path list; 3 concurrent pushes all land or fail with `409`, never `500` |
| **P2 — Non-destructive resolution** | `GET /sync/status`, `GET /sync/changes`, `pull?rebase`, `resolutions`, `ref=` file reads, MCP tool updates | `routes.ts`, `engine.ts`, `mcpTools.ts`, `github.ts` | Documented agent loop (§5.4) works without a destructive pull; staged work survives a conflict round-trip |
| **P3 — Session staging** | `sessionId` in key builders, `'default'` fallback, legacy 409 + cleanup, TTL reaping | `keys.ts`, `engine.ts`, `routes.ts` | Two sessions of the same user no longer share a tree; expired sessions free quota + catalog rows |
| **P4 — Save-time probe** | head-tree cache, `baseBlobSha`, `STALE_FILE` | `storage.ts`, `engine.ts`, `routes.ts` | Stale save is rejected before the agent proceeds; `/sync/save` still makes zero GitHub calls on cache hit |
| **P5 — Deploy divergence** | `diverged`/`mergeState`/`conflictingPaths`, `409 MERGE_CONFLICT`, `onConflict:'pr'`, `/apps/info` fields | `deployGate.ts`, `engine.ts`, `appDeployInfo.ts`, `api/index.ts` | `behindBy > 0` with conflicting content → structured 409 or PR URL; never `500` |
| **P6 — Decision gate** | branch-per-session evaluation | — | Only if the conflict-rate threshold in §5.8 is met |

Ordering rationale: P0 is a correctness fix that must not wait for the merge
engine; P1 unlocks multi-user concurrency; P2 removes the only remaining reason
users lose work; P3/P4 are isolation and efficiency; P5/p6 are follow-ups.

---

## 9. Tests

Repository convention: `node --test tests/**/*.test.mjs` (see
`tests/pluradashAppDeployState.test.mjs` for the plugin-logic precedent).

**New `tests/appsMergeConflicts.test.mjs` — pure logic (no I/O):**

1. `planMerge`: remote-only / local-only changes are auto-resolved; identical
   changes produce no conflict.
2. `edit-edit` on the same path → one conflict with correct base/our/their SHAs.
3. `delete-edit` and `edit-delete` both directions; `ours`/`theirs` resolution
   semantics (including resurrection warning flag).
4. Rename modelled as delete+add is reported as two entries, not one silent
   merge.
5. `conflictId` is stable across identical inputs and differs when the head
   advances.
6. `resolveMerge` with partial resolutions returns only the *remaining*
   conflicts (idempotency).
7. `mergeState` for deploy reuses the same planner output (fixture shared with
   `pluradashAppDeployState.test.mjs` style).
8. Key builders: `sessionId` validation rejects `..`, `/`, empty; `'default'`
   fallback reproduces the legacy path shape.

**Integration harness (mocked Octokit + in-memory R2):**

- Two clients, same base: disjoint edits → both commits land, second has
  `autoMerged` and `keptRemote` populated.
- Same-path edits → second gets `409` with exactly one conflict; after
  `resolutions: { path: 'ours' }` push succeeds and the first client's content
  is gone by explicit choice (not silently).
- `updateRef` 422 injected twice → push retries and lands on the third attempt;
  injected three times → `409 CONFLICT_RETRY_EXHAUSTED`.
- Manifest CAS: interleaved saves → `STAGING_BUSY` (or retried), never lost
  entries.
- `pull?rebase` keeps untouched staged files and reports `merged`/`discarded`
  exactly.
- `repos.merge` 409 mapped to `MERGE_CONFLICT` with correct `conflictingPaths`;
  `onConflict:'pr'` creates a PR and returns its URL.
- Deploy remains `403` for agent tokens (regression guard).

Manual/live: two PluraPi sessions on one app (same workspace, different users)
editing different files → both previews build, `sync_logs` shows two pushes,
`/apps/info` stays `up-to-date`/`changes-available` as expected.

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Manifest ETag / conditional put unsupported by the bound R2 API | Fallback: in-manifest short lease (`lockedUntil`) + retry; keep the algorithm identical |
| Retry loop storms under high contention | Cap 3 attempts, jittered `retryAfterMs`, structured 409; optional advisory lease (§3.5) |
| Conflict payload leaks large/binary content | 64 KiB cap per side, `downloadPath` for the rest, `binary: true` skips content entirely |
| Session-scoped staging multiplies storage/quota | TTL reaping (24 h default), surfaced in `/sync/status`, admin visibility in Agent-Sessions |
| Legacy staging silently resurrects after the layout change | Explicit `STAGING_UPGRADE_REQUIRED` 409 + best-effort legacy prefix cleanup |
| Agents ignore `409 conflicts` and loop blindly | MCP tool description + agent system prompt must present the exact loop; logs show repeated `conflictId`s (same id = no progress) |
| Server-side text merging temptation | Explicit non-goal; planner returns candidate sides only |
| Commit-message trailers break tooling | Trailers are appended after a blank line, plain `Key: value` — valid for GitHub |
| Deploy PR fallback leaks repo details to users | PR URL returned only to human admins (deploy is human-only); agents never see it |

---

## 11. Documentation to update on implementation

- [`../agents/plurapi-file-sync-integration.md`](../agents/plurapi-file-sync-integration.md)
  — replace §5.4 "Conflict recovery" (destructive pull) with the 3-way/rebase
  loop; add `/sync/status`, `/sync/changes`, `resolutions`, `expectedHeadSha`,
  error codes; document session-scoped staging.
- [`../agents/pluradash-apps-integration.md`](../agents/pluradash-apps-integration.md)
  — `mergeState`/`conflictingPaths`/`deployState:'merge-conflict'`, deploy `409`
  shapes, `onConflict:'pr'`, `recentPushes`.
- [`../features/pluradash-github-app-integration.md`](../features/pluradash-github-app-integration.md)
  — admin-panel note for conflicts in Sync-Logs / Agent-Sessions.
- `plugins/pluradash/specs/app-sync-mcp-tools.md` — new/changed tool contracts.
- `plugins/pluradash/specs/app-deploy-state.md` — new deploy state member.
- `specs/changes/YYYY-MM-DD-<phase>.md` — one record per phase (P0–P5), each
  with Summary / Files Added / Files Changed / impact analysis (database,
  runtime, API surface).

---

## 12. Open questions

1. **Session identity source of truth.** `POST /sync/push` already accepts an
   optional `sessionId`. Should the server *require* it for agent callers
   (forcing per-session staging), or keep `'default'` (single-client) for
   dashboard/legacy clients? Proposal: required when `is_agent`, optional with
   `'default'` otherwise.
2. **`GET /sync/status` GitHub cost.** The cached head tree means zero GitHub
   calls on hit — acceptable to poll? Proposal: yes, cache-hit only; on miss,
   fetch once and report `cacheState: 'cold'`.
3. **Manifest ETag support verification.** Confirm `R2Bucket.put(..., { onlyIf })`
   in the deployed compatibility date before committing to §5.1; otherwise use
   the lease fallback.
4. **Quota policy for parallel sessions.** A full tree copy per session can
   double a user's app footprint. Reap aggressively or count app staging as
   exempt from quota? Current catalog registers app files in the shared quota
   (`SYNC_SOURCE_MOUNT_ID = 'pluradash'`, scope `apps`), so this needs an
   explicit decision before P3.
5. **Conflict feedback channel.** Should unresolved conflicts also enqueue a
   `build_feedback`-style injection (existing bridge) so an idle agent wakes up,
   or stay purely request/response? Proposal: stay synchronous in v1; revisit
   after P2 telemetry.

---

## Related

- Current contracts: [`../agents/plurapi-file-sync-integration.md`](../agents/plurapi-file-sync-integration.md),
  [`../agents/pluradash-apps-integration.md`](../agents/pluradash-apps-integration.md)
- Build feedback / session keying: [`../agents/plurapi-agent-bridge.md`](../agents/plurapi-agent-bridge.md)
- Storage namespace & quota: [`../agents/r2-file-storage.md`](../agents/r2-file-storage.md)
- GitHub App provisioning: [`../features/pluradash-github-app-integration.md`](../features/pluradash-github-app-integration.md)
