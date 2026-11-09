# PluraPi File Sync Integration — Handoff Specification

> **Audience:** developers and agents integrating **PluraPi** (the stateless
> external execution engine) with Specy's PluraDash workspace file sync.
>
> This document is the complete integration contract: authentication, every
> endpoint with request/response payloads, the recommended agent workflows,
> error handling, and the branch-isolation rules PluraPi must respect.
>
> Backend reference: [`../features/pluradash-r2-sync-engine.md`](../features/pluradash-r2-sync-engine.md)

---

## 1. What PluraPi gets

PluraPi can treat a Specy workspace as a remote filesystem backed by GitHub:

| Capability | Tool name | Endpoint |
|---|---|---|
| Initialize / refresh local workspace | `workspace_sync_upstream` | `POST /api/plugin/pluradash/sync/pull` |
| List workspace files / read one file | `workspace_pull_files` | `GET /api/plugin/pluradash/sync/files` |
| Write files into the workspace cache | `workspace_save_changes` | `POST /api/plugin/pluradash/sync/save` |
| Publish changes as a GitHub commit (auto-merge + conflict resolution) | `workspace_push_dev` | `POST /api/plugin/pluradash/sync/push` |
| Cheap preflight (base vs. live head, remote delta) | — | `GET /api/plugin/pluradash/sync/status` |
| List remote-changed paths since a commit | — | `GET /api/plugin/pluradash/sync/changes` |
| Production release (human only) | `workspace_deploy_prod` | `POST /api/plugin/pluradash/sync/deploy` |
| Download workspace as ZIP (portability) | `workspace_download_archive` | `GET /api/plugin/pluradash/sync/archive` |

PluraPi needs **no git, no SSH, no GitHub credentials**. All GitHub access is
performed by serviceCMS through the GitHub App.

## 2. Prerequisites

1. **Assigned repository.** A super-admin (or workspace admin) has assigned a
   GitHub organization repository to the target workspace — see the GitHub App
   admin panel (`/admin/github-apps`). The mapping lives in
   `pluradash.workspace_repos`.
2. **Workspace identity.** The caller needs the workspace UUID (`workspaceId`,
   the tenant ID). Agent accounts carry their default workspace in the JWT
   `tenant_id` claim.
3. **Storage entitlement.** The acting user needs a provisioned tenant storage
   allocation (single shared quota bucket — workspace app files carry the
   `apps` scope in the catalog but count toward the same quota as all other
   files). Pull/save/deploy are quota-checked against the **net byte delta**
   of each operation; exceeding the quota fails with `Storage quota exceeded.`
   (HTTP 500 message; treat as a hard stop).

## 3. Authentication

All requests use a Supabase access token:

```
Authorization: Bearer <supabase_access_token>
```

Token acquisition for machine accounts:

- **OAuth 2.1 Authorization Code + PKCE** against Supabase's authorization
  server — full flow documented in
  [`oauth-unified-authentication.md`](oauth-unified-authentication.md).
- Agent accounts hold the `agent` role; their tokens carry
  `is_agent: true` and `tenant_id: <default workspace>`.
- Tokens are accepted everywhere EXCEPT `/sync/deploy`, which rejects agent
  tokens by design (branch isolation).

Tenant/repo access is additionally enforced twice: by RLS on
`pluradash.workspace_repos` (the caller must be able to SELECT the mapping row)
and by explicit role checks on the deploy path. A token for the wrong workspace
receives `404 {"error": "Repository not found for this workspace or access denied (RLS)."}`.

## 4. Endpoint reference

Base URL: `{CMS_ORIGIN}/api/plugin/pluradash`

### 4.1 `POST /sync/pull` — initialize / refresh the workspace

Mirrors the GitHub `dev` tree into the R2 workspace cache and returns the file
index. **Always run this before the first save/push of a session.**

Request:

```json
{ "workspaceId": "7c9e…", "repoId": 123456789 }
```

- `repoId` is optional; omit it when exactly one repository is assigned to the
  workspace.
- Behavior: if `refs/heads/dev` does not exist on GitHub it is created from the
  latest commit of the repo's default branch (`devBranchCreated: true` in the
  response).

Response `200`:

```json
{
  "success": true,
  "repo": { "id": 123456789, "fullName": "acme/website", "url": "https://github.com/acme/website" },
  "branch": "dev",
  "headCommitSha": "3f2a8c9…",
  "devBranchCreated": false,
  "fileCount": 42,
  "totalBytes": 1234567,
  "deletedCount": 0
}
```

Notes:

- The pull **replaces** the entire workspace tree: files removed from GitHub
  are deleted locally too (and their catalog rows removed, freeing quota).
- A pull resets the manifest's `baseCommitSha` to `headCommitSha`; any unsaved
  local state in R2 from a previous session is discarded.

### 4.2 `GET /sync/files` — list files or stream one file

**Listing** (returns the manifest without the `files` array inline, plus the
flattened index):

```
GET /sync/files?workspaceId=7c9e…&repoId=123456789
```

Response `200`:

```json
{
  "success": true,
  "manifest": {
    "version": 1, "repoId": 123456789, "repoFullName": "acme/website",
    "branch": "dev", "productionBranch": "main",
    "headCommitSha": "3f2a8c9…", "baseCommitSha": "3f2a8c9…",
    "fileCount": 42, "totalBytes": 1234567,
    "lastSyncedAt": "2026-08-28T12:00:00.000Z",
    "lastPushedAt": null, "deployedCommitSha": null
  },
  "files": [
    { "path": "index.html", "size": 2048, "contentType": "text/html; charset=utf-8", "blobSha": "8c1e…" },
    { "path": "src/main.js", "size": 512, "contentType": "text/javascript; charset=utf-8", "blobSha": "ab12…" }
  ]
}
```

**Single file** (raw bytes):

```
GET /sync/files?workspaceId=7c9e…&repoId=123456789&path=src/main.js
```

Response `200` is the raw file body with:

- `Content-Type` — guessed from the extension (`text/html`, `image/png`,
  `application/octet-stream`, …)
- `X-Workspace-Path` — URL-encoded repo-relative path
- `Cache-Control: no-store`

Errors: `409` when no pull has happened yet ("No synced workspace found…"),
`404` for unknown paths.

### 4.3 `POST /sync/save` — write files into the workspace cache

Overwrites/creates files **in R2 only** — GitHub is not touched. This is the
fast, reversible staging step; nothing is published until `/sync/push`.
Also handles **deletions** and **executable bits**.

Request:

```json
{
  "workspaceId": "7c9e…",
  "repoId": 123456789,
  "files": [
    { "path": "index.html", "content": "<!doctype html>…" },
    { "path": "assets/logo.png", "contentBase64": "iVBORw0KGgo…" },
    { "path": "scripts/bootstrap.sh", "content": "#!/usr/bin/env bash\n…", "mode": "100755" },
    { "path": "src/legacy.js", "deleted": true }
  ]
}
```

Rules:

- `path` is repo-relative; `..`, leading `/` and empty segments are rejected.
- Write entries: exactly one of `content` (UTF-8 string) or `contentBase64`.
- **Deletion entries:** `{ "path": "…", "deleted": true }` — removes the file
  from R2, the storage catalog (frees quota) and the manifest; the next push
  reports it under `diff.deleted`. Deletions must not carry content.
- **Executable files:** optional `"mode": "100755"` (default `"100644"`),
  forwarded to the GitHub Git Data Tree API so `chmod +x` semantics survive —
  required for shell scripts used in downstream build steps.
- **Server-side ignore rules:** serviceCMS rejects (`400`) attempts to save or
  delete `.env`, `.env.*`, `.dev.vars`, `.git/…`, `.pi/…`, `node_modules/…` —
  regardless of the payload. PluraPi must pre-filter these paths client-side
  too (see §7) to avoid hard failures.
- Max **500 file entries** per call **and** max **10 MiB total request body**
  (whichever hits first → `413`). Split larger batches into multiple calls.
- Each call is quota-checked against the net byte delta.

Response `200`:

```json
{
  "success": true,
  "repo": { "id": 123456789, "fullName": "acme/website", "url": "…" },
  "branch": "dev",
  "saved": 3,
  "deleted": 1,
  "totalBytes": 1239999,
  "manifest": { "headCommitSha": "3f2a8c9…", "baseCommitSha": "3f2a8c9…", "fileCount": 42, "totalBytes": 1239999 }
}
```

### 4.4 `POST /sync/push` — commit workspace changes to GitHub `dev`

Merges the staging tree on top of the live GitHub `dev` head using a retried,
blob-level 3-way merge (never a force-push, never a server-side text merge).
Pushing triggers the Cloudflare **preview** deployment.

Request:

```json
{
  "workspaceId": "7c9e…",
  "repoId": 123456789,
  "commitMessage": "feat: new hero section",
  "sessionId": "sess_abc",
  "expectedHeadSha": "def456…",
  "strategy": "merge",
  "resolutions": { "src/App.tsx": "ours", "src/theme.css": "theirs" }
}
```

- `sessionId` (optional) selects the session-scoped staging tree; omitted ⇒
  the implicit `default` session.
- `expectedHeadSha` (optional, recommended after a conflict) fails fast with
  `409 STALE_HEAD` when the head moved since you planned the push.
- `strategy: "merge"` (default) auto-merges; `"strict"` reproduces the legacy
  "any remote advance ⇒ 409".
- `resolutions` (optional): per path `"ours"` | `"theirs"` |
  `{ "content": "…" }` / `{ "contentBase64": "…", "mode": "100755" }`.

Response `200`:

```json
{
  "success": true,
  "repo": { "id": 123456789, "fullName": "acme/website", "url": "…" },
  "branch": "dev",
  "commitSha": "9d8c7b6…",
  "commitUrl": "https://github.com/acme/website/commit/9d8c7b6…",
  "previewUrl": "https://dev.website.pages.dev",
  "diff": { "added": ["assets/logo.png"], "modified": ["index.html"], "deleted": [] },
  "autoMerged": ["index.html"],
  "keptRemote": ["src/other.ts"],
  "resolutions": [{ "path": "src/App.tsx", "choice": "ours" }],
  "rebased": true,
  "mergedRemoteChanges": 1
}
```

- Different-file concurrency is **auto-merged** — `keptRemote` lists remote-only
  changes that survived, `autoMerged` lists your paths that landed on a head
  that had moved.
- `previewUrl` is `null` unless the operator configured
  `PLURADASH_PREVIEW_URL_TEMPLATE`. Surface `commitUrl` as fallback.
- **No-op push** (no local differences) returns `200` with the current head SHA
  and empty diff — safe to call optimistically.

#### Conflict response `409` (same-path divergence)

```jsonc
{
  "error": "Merge conflict on 1 path — resolve and retry with expectedHeadSha.",
  "code": "CONFLICT",
  "conflictId": "a1b2c3d4e5f6",       // stable across retries; changes when head moves
  "workspaceId": "7c9e…",
  "repoId": 123456789,
  "branch": "dev",
  "baseSha": "abc123…",
  "headSha": "def456…",
  "staleBase": true,
  "retryAfterMs": 0,
  "conflicts": [
    {
      "path": "src/App.tsx",
      "kind": "edit-edit",           // edit-edit | edit-delete | delete-edit | add-add
      "baseSha": "a1…", "ourSha": "b2…", "theirSha": "c3…",
      "binary": false,
      "ours":   { "encoding": "utf-8", "content": "…" },
      "theirs": { "encoding": "utf-8", "content": "…" },
      "downloadPath": "/api/plugin/pluradash/sync/files?…&path=src%2FApp.tsx&ref=ours"
    }
  ]
}
```

Candidate content is capped at 64 KiB per side (binary files return
`binary: true`, text/binary content as `encoding`). For larger files use
`GET /sync/files?…&path=…&ref=ours|theirs` (`ref=theirs` reads the live head).
The error is also logged to `sync_logs` (`operation: 'push'`, `status: 'error'`,
`detail.conflict = { conflictId, paths, kinds }`).

`409 CONFLICT_RETRY_EXHAUSTED` means three consecutive ref races: wait
`retryAfterMs` and retry once the other writer pauses.

### 4.4a `GET /sync/status` — cheap preflight

```
GET /sync/status?workspaceId=7c9e…&repoId=123456789[&sessionId=sess_abc]
```

Returns `{ baseCommitSha, devHeadSha, behindBy, aheadBy, staleBase,
remoteChangedPaths, stagingSessionId, stagingExpiresAt, cacheState }` from the
R2 head-tree cache — **no full tree download** on a warm cache. Use it before a
push to see whether others pushed.

### 4.4b `GET /sync/changes` — remote delta since a commit

```
GET /sync/changes?workspaceId=7c9e…&repoId=123456789[&since=abc123…][&includeContent=true]
```

Returns `{ since, headSha, cacheState, paths: [{ path, change:
'added'|'modified'|'deleted', blobSha, size, mode, content? }] }`. Defaults
`since` to your `baseCommitSha`. `includeContent=true` inlines text/binary
content for files under 64 KiB. This replaces the destructive re-pull in the
rebase path.

### 4.5 `POST /sync/deploy` — production release (human users only)

Merges `dev` → `main` on GitHub (which triggers the Cloudflare production
deployment) and snapshots the merged tree into the read-only `main/HEAD/`
workspace.

Request:

```json
{ "workspaceId": "7c9e…", "repoId": 123456789, "commitMessage": "Release hero section" }
```

Response `200`:

```json
{
  "success": true,
  "repo": { "id": 123456789, "fullName": "acme/website", "url": "…" },
  "merged": true,
  "status": "merged",
  "mergeCommitSha": "aa11bb2…",
  "productionBranch": "main"
}
```

- `status: "clean"` means `dev` and `main` were already identical (GitHub
  returns 204); nothing was merged.
- **Authorization:** agent tokens (`is_agent: true`) → `403`. Human callers
  must be super-admins or active tenant admins of the workspace (checked via
  `tenant_users.is_tenant_admin`).
- This endpoint must only ever be wired to an explicit user button ("Deploy to
  Production") in the PluraPi/dashboard UI — never to an autonomous agent loop.

### 4.6 `GET /sync/archive` — download the workspace as a ZIP (portability)

Streams every file of the synced workspace branch as a ZIP archive. Useful for
local mirroring, backups and handoff to tooling outside PluraPi.

```
GET /sync/archive?workspaceId=7c9e…&repoId=123456789[&branch=dev|main]
```

- `branch` defaults to `dev`; `main` returns the read-only production snapshot.
- Response `200`: `application/zip` with
  `Content-Disposition: attachment; filename="{repoKey}-{branch}.zip"`.
- The archive is uncompressed (STORE method) — build it in memory and write
  the blob straight to disk; do not expect compression gains.
- Errors: `409` when no pull has happened yet for the requested branch, `400`
  for unsupported branch names.

## 5. Recommended agent workflows

### 5.1 Session bootstrap (pull)

```
1. POST /sync/pull        { workspaceId, repoId? }
2. GET  /sync/files       ?workspaceId=…            → file index
3. GET  /sync/files       ?workspaceId=…&path=…     → materialize each file locally
```

### 5.2 Edit cycle (save → push → preview)

```
1. POST /sync/save        { workspaceId, files: [...] }        # stage locally in R2
2. POST /sync/push        { workspaceId, commitMessage }       # publish to dev
3. read previewUrl        (or commitUrl)                       # show the user
4. repeat 1–3 freely
```

### 5.3 Production release (user-driven)

```
1. Verify the preview looks right (user confirms).
2. POST /sync/deploy      { workspaceId }        # human click only
```

### 5.4 Conflict recovery (non-destructive, P2)

Since the merge-conflict work (2026-10-27) a conflict **never** requires
destroying staged work. The staging tree survives the round-trip:

```
1. POST /sync/push            { workspaceId, commitMessage }
     → 409 { code: "CONFLICT", conflicts: [...], headSha }
2. GET  /sync/changes         ?since=<baseSha>          # what the others changed
3. Resolve locally (agent-side 3-way apply, or ask the human for ambiguous hunks)
4. POST /sync/push            { workspaceId, expectedHeadSha: <headSha>,
                               resolutions: { "path": "ours" | "theirs" | { content } } }
```

- `resolutions` are keyed by path; unresolved paths keep the push blocked.
- `"theirs"` keeps the remote version, `"ours"` keeps the staged version, an
  object writes caller-supplied bytes.
- Retrying after a transient failure is idempotent — the `conflictId` is stable
  until the head advances.

`POST /sync/pull` with `"rebase": true` is a non-destructive alternative for
clients that prefer a pull-shaped flow: staged files whose paths did not change
remotely are kept; the response reports `{ kept, merged, discarded }`. Plain
`/sync/pull` (no `rebase`) stays destructive for back-compat, but it is no
longer the conflict path.

> **Data-loss warning (legacy):** a plain `/sync/pull` still *replaces* the R2
> staging tree. Use the conflict loop above, or `rebase: true`, when staged
> work must survive.

## 6. Error handling summary

| Signal | Meaning | Agent action |
|---|---|---|
| `404` "Repository not found … (RLS)" | Repo not assigned to workspace, or token belongs to another workspace | Stop; ask the user to assign the repo / fix the token |
| `409` "No synced workspace found" | Save/push/list before the first pull | Run `/sync/pull` |
| `409 code:"CONFLICT"` | Same-path divergence — both sides changed a file differently | Resolve via `resolutions` + `expectedHeadSha` (§5.4); never force-push |
| `409 code:"CONFLICT_RETRY_EXHAUSTED"` | Three consecutive ref races | Wait `retryAfterMs`, retry once the other writer pauses |
| `409 code:"STALE_HEAD"` | `expectedHeadSha` no longer matches the live head | Re-run `/sync/status`, re-resolve, retry |
| `409 code:"STALE_FILE"` | A save's `baseBlobSha` is behind the live head | Re-read the file (`/sync/files?ref=theirs`), re-apply, save again |
| `409 code:"STAGING_BUSY"` | Two concurrent saves on one manifest | Retry the save once |
| `409 code:"STAGING_UPGRADE_REQUIRED"` | Legacy (v1) staging layout found | Run `/sync/pull` once to migrate to the session-scoped layout |
| `409 code:"MANIFEST_CORRUPT"` | The manifest file index disagrees with its own totals (clobbered cache) | Run `/sync/pull` to rebuild staging; do not retry the push |
| `409 code:"MERGE_CONFLICT"` | Deploy-time dev→production merge conflicts (human path) | Human resolves or re-runs deploy with `onConflict:"pr"` |
| `400` "Refusing to sync protected paths…" | Payload touched `.env` / `.git/` / `.pi/` / `node_modules/` (server-side ignore rules) | Remove those paths from the batch; never retry them |
| `403` "Production deploys are restricted…" / "Only workspace admins…" | Deploy attempted by agent or non-admin | Never retry from an agent loop |
| `413` | File > 80 MiB (pull), > 2 MiB (prod snapshot), > 500 files per save | Split the operation |
| `Storage quota exceeded.` | Net delta exceeds the user's provisioned disk space | Clean up files (push deletions) or request quota |

## 7. Isolation rules PluraPi must enforce client-side

1. **Only `dev` is agent-writable.** PluraPi must never attempt to write to
   `main`; there is deliberately no API for it.
2. **Deploy is a human decision.** Surface it as an explicit user action only.
3. **Pull before the first save** of every session; the local R2 tree is the
   source of truth for diffs, so a stale cache produces wrong commits.
4. **Treat `baseCommitSha` as the session contract.** After a 409, a re-pull is
   mandatory — do not attempt to force-push or patch refs.
5. **Binary files** must be sent as `contentBase64`; text files as UTF-8
   `content`.
6. **Server-side sanitization is a backstop, not a filter.** serviceCMS
   rejects `.env`, `.env.*`, `.dev.vars`, `.git/…`, `.pi/…` and
   `node_modules/…` in `/sync/save` (write AND delete) with a `400` — but
   PluraPi must pre-filter these paths itself before building save batches:
   local tooling metadata and secrets never belong in a save payload.
7. **Preserve executable bits.** When replicating local files that carry the
   executable flag, send `"mode": "100755"`; plain HTTP transfers would
   otherwise commit scripts as non-executable and break downstream builds.

## 8. Discovery

The endpoints are also published in the agent-facing API catalog
(`/api/specs` frontend-integration manifest) with ids
`pluradash-sync-pull`, `pluradash-sync-files`, `pluradash-sync-save`,
`pluradash-sync-push`, `pluradash-sync-status`, `pluradash-sync-changes`,
`pluradash-sync-deploy`, `pluradash-sync-archive`, so MCP/API discovery
surfaces them automatically. MCP server tools mirroring
these endpoints are a planned follow-up (see the feature doc's roadmap).

Every endpoint call is logged server-side (`pluradash.sync_logs`) and visible
to super-admins in the GitHub Apps admin panel — agents do not need to do
anything for auditing.

### 8.1 MCP tools

The same workflows are also exposed as native MCP server tools registered by
the PluraDash plugin via the core `mcp.tools` hook (authenticated MCP
connections only):

`app_sync_list`, `app_sync_pull`, `app_sync_list_files`, `app_sync_read_file`,
`app_sync_save`, `app_sync_status`, `app_sync_changes`, `app_sync_commit`.

`workspaceId` defaults to the agent token's `tenant_id` claim and `repoId`
to the first assigned repo — repository IDs must be taken from
`app_sync_list`, never guessed (a wrong `repoId` yields the 404 described in
§6). Deploy and archive are deliberately not exposed as MCP tools. Tool
contracts: `plugins/pluradash/specs/app-sync-mcp-tools.md`.

## Related

- Backend engine reference: [`../features/pluradash-r2-sync-engine.md`](../features/pluradash-r2-sync-engine.md)
- Authentication flows: [`oauth-unified-authentication.md`](oauth-unified-authentication.md)
- Storage platform rules: [`r2-file-storage.md`](r2-file-storage.md)
- GitHub App setup: [`../features/pluradash-github-app-integration.md`](../features/pluradash-github-app-integration.md)
