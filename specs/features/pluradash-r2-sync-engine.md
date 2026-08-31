# PluraDash R2 Sync Engine & Branch Management Protocol

Feature-level documentation for the PluraDash R2 sync engine — the bridge that
lets external agentic runtimes (PluraPi) pull, modify, push and deploy workspace
repositories **without any git tooling**: serviceCMS performs all GitHub
operations server-side via the GitHub App (Octokit) and keeps an extracted,
quota-tracked file tree in Cloudflare R2.

> **Scope:** plugin feature, implemented entirely inside
> `plugins/pluradash/api/sync/` (EUPL isolation). Core files are only touched
> at the mounting point. Builds on the
> [GitHub App integration](pluradash-github-app-integration.md).

## Overview

```
[ PluraPi Engine ] ◄──(HTTP/OAuth 2.1)──► [ serviceCMS sync API ] ──(Octokit)──► [ GitHub Org Repo ]
                                              │                                   (dev / main)
                                              ▼
                                        [ Cloudflare R2 ]
                                        tenant/{tenantId}/user/{userId}/files/apps/{repoKey}/
                                          ├── dev/HEAD/       (agent working tree, quota-tracked)
                                          ├── dev/manifest.json
                                          ├── main/HEAD/      (production snapshot, read-only)
                                          └── main/manifest.json
```

- PluraPi is **stateless regarding git**: it holds no git binaries, no SSH keys,
  no GitHub tokens. It only exchanges JSON/bytes with the sync API.
- serviceCMS holds the GitHub App credentials and mints ephemeral installation
  tokens server-side; credentials never reach agents or browsers.

## Branch isolation rules

| Branch | Role | Who may write |
|---|---|---|
| `dev` | Exclusive target for agent tool calls, workspace syncs and trial edits | Agents + users via the sync API (RLS-verified) |
| `main` | Protected production branch | **Nobody via API.** Updated only by the user-triggered "Deploy to Production" (dev → main merge) |

- **Auto-creation rule:** on every pull, `refs/heads/dev` is looked up; when
  missing it is created from the latest commit SHA of the repository's default
  branch (`createRef`). Pushing to `dev` triggers the Cloudflare preview
  deployment pipeline.
- **Push safety:** a push refuses (HTTP 409) when the GitHub `dev` head differs
  from the manifest's `baseCommitSha` — the workspace must re-pull first, so
  remote changes are never silently clobbered.
- **Deploy gating:** `POST /sync/deploy` rejects agent tokens (`is_agent`) with
  403 and requires a super-admin or an active tenant admin of the workspace.

## R2 storage schema

```
tenant/{tenantId}/user/{userId}/files/apps/{owner__repo}/
└── {branch}/                 # dev (agent active) | main (production snapshot)
    ├── HEAD/                 # extracted file tree (index.html, src/...)
    └── manifest.json         # commit SHA, file index, sync timestamps
```

- Workspace files are **fully tracked** in `tenant_storage_objects` (scope
  `files`, mount `pluradash`) — quota accounting works like every other file in
  the platform, so "user provisioned cloud disk space" is enforced:
  `ensureTenantStorageSummary` + `assertTenantStorageQuota` gate every write
  with the **net byte delta** of the operation.
- Workspace app files are provisioned against the dedicated
  **`apps` allocation type** (`public.tenant_storage_allocations.allocation_type`,
  default 2 GiB) — separate from the generic `files` quota bucket. The usage
  sync trigger routes catalog changes to the matching bucket by object key
  (`.../files/apps/%` → `apps`). See
  [`../agents/r2-file-storage.md`](../agents/r2-file-storage.md) §4.
- `manifest.json` is engine-owned metadata and deliberately NOT registered in
  the catalog (it never counts toward quota and cannot be deleted through the
  file UI; deleting it simply forces a re-pull).
- Object keys are deterministic (no UUID suffix) so repeated saves overwrite
  the same object and `createTree` diffs stay reproducible.

### manifest.json contract

```jsonc
{
  "version": 1,
  "repoId": 123456789,
  "repoFullName": "owner/repo",
  "repoUrl": "https://github.com/owner/repo",
  "branch": "dev",
  "productionBranch": "main",
  "headCommitSha": "…",       // GitHub commit the HEAD tree currently mirrors
  "baseCommitSha": "…",       // diff base for the next push
  "fileCount": 42,
  "totalBytes": 1234567,
  "lastSyncedAt": "2026-08-28T12:00:00.000Z",
  "lastPushedAt": null,
  "deployedCommitSha": null,  // set after a production deploy
  "files": [
    { "path": "index.html", "objectKey": "tenant/…/dev/HEAD/index.html",
      "size": 2048, "blobSha": "<git blob sha1>", "contentType": "text/html; charset=utf-8",
      "mode": "100644" }
  ]
}
```

`blobSha` values are real git blob SHA-1s (computed with
`gitBlobSha()` at save time, taken from the GitHub tree at pull time), which
makes push diffing a pure map comparison — no content hashing on GitHub's side.
`mode` preserves the git file mode (`100644` regular, `100755` executable) so
executable bits survive the HTTP round-trip.

### Server-side sanitization (ignore rules)

`/sync/save` enforces a server-side ignore filter regardless of client
payload. Attempts to write or delete these paths are rejected with `400`:

- `.env`, `.env.*` (secrets)
- `.dev.vars` (Cloudflare secrets)
- `.git/`, `.pi/`, `node_modules/` (tooling / local runtime noise)

Rationale: agents run tools locally and may blindly scan their workspace;
secrets and thousands of dependency files must never reach R2 or GitHub.
Note the filter intentionally does **not** apply to pulls — files already
tracked in the GitHub repo keep their manifest entries so a push never
misreads them as deletions.

### Save payload constraints

- Max **500 file entries** per call **and** max **10 MiB total request body**
  (whichever hits first → `413`). Split large batches.
- `deleted: true` entries remove the file from R2, the storage catalog (quota
  freed) and the manifest — the next push reports them under `diff.deleted`.
- `mode: "100644" | "100755"` overrides the git file mode (executables).

## API surface

All endpoints live under `/api/plugin/pluradash/sync/` and accept a Supabase
JWT (dashboard session or OAuth 2.1 agent token). Tenant/repo access is
enforced by RLS on `pluradash.workspace_repos` — the caller must be able to
SELECT the row for `{workspaceId, repoId}`.

| Method | Path | Spec tool name | Description |
|---|---|---|---|
| POST | `/sync/pull` | `workspace_sync_upstream` | Validates/creates `dev`, downloads the GitHub dev tree, replaces R2 `dev/HEAD/`, rewrites manifest. Returns `{ fileCount, totalBytes, headCommitSha, devBranchCreated }` |
| GET | `/sync/files` | `workspace_pull_files` | Without `path`: manifest + file listing. With `path`: streams raw file bytes (`Content-Type`, `X-Workspace-Path`) |
| POST | `/sync/save` | `workspace_save_changes` | Overwrites/creates (`content`/`contentBase64`), deletes (`deleted: true`) files in R2 `dev/HEAD/` only (no GitHub call). Max 500 entries AND 10 MiB body. Quota-checked; server-side ignore filter rejects protected paths |
| POST | `/sync/push` | `workspace_push_dev` | Diffs R2 tree vs. `baseCommitSha`, commits via Git Data API (`createTree` → `createCommit` → `updateRef`), returns `commitSha`, `commitUrl`, `previewUrl`, diff summary |
| POST | `/sync/deploy` | `workspace_deploy_prod` | **User UI only** (agents get 403). Merges dev → main via `repos.merge`, snapshots merged tree into R2 `main/HEAD/` |
| GET | `/sync/archive` | `workspace_download_archive` | Streams the synced workspace branch (default `dev`, or `main`) as a ZIP archive (`application/zip`, `Content-Disposition: attachment`) for portability. 409 when no pull has happened yet |

Payload examples and agent workflows: see
[`../agents/plurapi-file-sync-integration.md`](../agents/plurapi-file-sync-integration.md).

## Configuration

| Variable | Kind | Purpose |
|---|---|---|
| `PLURADASH_PREVIEW_URL_TEMPLATE` | wrangler var | Optional Cloudflare preview URL template, e.g. `https://{branch}.{project}.pages.dev`. `{branch}`, `{owner}`, `{repo}` placeholders. Empty → `previewUrl: null` |
| GitHub App vars / Secrets Store | existing | See [GitHub App integration](pluradash-github-app-integration.md) — unchanged |
| `MEDIA_BUCKET` | R2 binding | Core-owned R2 binding, reused by the sync engine |

## Module layout

```
plugins/pluradash/api/sync/
├── types.ts     — shared types (manifest, payloads, results, SyncError)
├── keys.ts      — R2 key layout, path normalization, MIME guessing
├── github.ts    — Octokit: dev provisioning, tree/blob fetch, Git Data commits, prod merge
├── manifest.ts  — (folded into storage.ts) manifest persistence
├── storage.ts   — R2 puts/gets/deletes + tenant_storage_objects catalog sync
├── engine.ts    — orchestration: pull / list / read / save / push / deploy / archive
├── zip.ts       — dependency-free ZIP writer (STORE method + CRC-32) for /sync/archive
├── logger.ts    — fire-and-forget operation logging into pluradash.sync_logs
└── routes.ts    — Hono sub-app mounted at /sync
```

## Operation logging

Every sync operation writes one row into `pluradash.sync_logs`. Rows are
scheduled via `executionCtx.waitUntil()` — on Cloudflare Workers a bare
fire-and-forget promise is cancelled once the response returns, so logging
MUST NOT bypass the scheduler (`scheduleSyncLog` in `logger.ts`). Logging
failures never break the request. Logged attributes: tenant, user, repo,
operation (`pull` | `files.list` | `files.read` | `save` | `push` | `deploy` |
`archive` | `app.launch` | `repo.assign` | `repo.unassign` | `logs.cleanup`),
actor type (`user` | `agent`), status (`success` | `error` | `denied`), HTTP
status, duration, net byte delta, sanitized message and detail. Secret-looking
payload keys are redacted.

### Verbosity

Die Detailtiefe wird in dieser Reihenfolge aufgelöst:

1. **Env-Var `PLURADASH_SYNC_LOG_LEVEL`** (`off` | `basic` | `verbose`) —
   expliziter Override, überschreibt die gespeicherte Einstellung. Leer =
   keine Override.
2. **Gespeicherte Einstellung** `pluradash.admin_settings.sync_log_level` —
   zur Laufzeit änderbar im GitHub-Apps-Admin-Panel (Sync-Logs-Tab) bzw. via
   `GET/PUT /admin/github/log-level` (Super-Admin). Cache: ~30 s pro Isolate.
3. **Default `basic`.**

| Level | Verhalten |
|---|---|
| `off` | Keine Zeilen werden geschrieben. |
| `basic` | Standard. Eine Zeile pro Sync-Operation. |
| `verbose` | Extra-Trace-Zeilen für Requests ohne Handler-Log (Auth-Denials, Validierungs-Exits; `detail.trace = true`), reichere Details (Save-Batch-Pfade/Sizes, komplette Push-Diff-Pfadlisten, Error-Stacks, Quota-Mathematik aus `ensureQuota`) und Console-Debug-Output für `wrangler tail`. |

Die Variable ist in `plugins/pluradash/plugin.json`
(`wrangler_bindings.vars`) deklariert und wird von `ensure-registry.mjs` in
`wrangler.jsonc` injiziert.

Super-admins browse the logs in the GitHub Apps admin panel (**Sync-Logs** tab):
filterable by operation/status/workspace, with 24h/7d error-rate stat cards and
a bulk cleanup action (`DELETE /admin/github/logs?before=<ISO>` or
`?confirm=true`). The table follows the same pattern as `public.agent_logs`
and `pluradash.ai_service_logs`.

## Design decisions & deviations

- **Trees API instead of zipball:** no zip library exists in the Worker
  bundle, so pulls fetch `git.getTree(recursive)` + `git.getBlob` (base64)
  with bounded concurrency (8). Repos whose trees GitHub truncates are
  rejected with HTTP 413.
- **main/ snapshot is quota-tracked too:** files written under `main/HEAD/`
  go through the same catalog registration. Deploy limits snapshot files to
  2 MiB to keep production snapshots cheap.
- **Manifests are untracked:** documented above; keeps quota semantics clean.
- **MCP tools:** not yet registered; agents integrate via the HTTP endpoints
  (OAuth 2.1 tokens), which the API catalog advertises. Registering
  `mcp.tools` contributions mirroring the six endpoints is a planned follow-up.
- **ZIP archives instead of a zip library:** `/sync/archive` assembles the ZIP
  structure manually (STORE method, CRC-32) because the Worker bundle has no
  zip dependency — see `plugins/pluradash/api/sync/zip.ts`.

## Related

- Change record: [`../changes/2026-08-28-pluradash-r2-sync-engine.md`](../changes/2026-08-28-pluradash-r2-sync-engine.md)
  and [`../changes/2026-08-30-pluradash-apps-storage-provisioning-logging-zip.md`](../changes/2026-08-30-pluradash-apps-storage-provisioning-logging-zip.md)
- Agent handoff: [`../agents/plurapi-file-sync-integration.md`](../agents/plurapi-file-sync-integration.md)
- GitHub App basis: [`pluradash-github-app-integration.md`](pluradash-github-app-integration.md)
- Storage platform rules: [`../agents/r2-file-storage.md`](../agents/r2-file-storage.md)
