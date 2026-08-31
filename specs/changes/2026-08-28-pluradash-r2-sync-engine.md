# PluraDash R2 Sync Engine (PluraPi File Sync)

**Date:** 2026-08-28
**Scope:** Plugin change (`plugins/pluradash/`) — EUPL-isolated.

## Summary

Implements the R2 sync engine & branch management protocol: external agentic
runtimes (PluraPi) can pull, modify, push and deploy workspace repositories via
serviceCMS without any git tooling. serviceCMS performs all GitHub operations
server-side through the GitHub App (Octokit) and mirrors an extracted,
quota-tracked file tree into Cloudflare R2 under the user's `/apps` folder.

Key behaviors:

- `dev` is the exclusive agent-writable branch; it is auto-provisioned from
  `main` (`createRef`) when missing. Pushing to `dev` triggers the Cloudflare
  preview pipeline.
- `main` is protected: only the user-triggered deploy endpoint merges
  `dev → main` (Octokit `repos.merge`) and snapshots the merged tree into
  `main/HEAD/`. Agent tokens are rejected (403).
- Pushes diff the R2 tree against the manifest's `baseCommitSha` (git blob
  SHA-1 comparison) and commit exactly that diff via the Git Data API
  (`createTree` → `createCommit` → `updateRef`). A 409 forces re-pull when the
  remote branch advanced (no silent clobbering).
- All workspace files are registered in `tenant_storage_objects` (scope
  `files`, mount `pluradash`) with deterministic object keys; every pull /
  save / deploy is quota-checked against the net byte delta — tracking the
  user's provisioned cloud disk space.

## Files Added

- `plugins/pluradash/api/sync/types.ts` — shared types (`WorkspaceSyncManifest`,
  file payloads, result shapes, `SyncError` with HTTP status).
- `plugins/pluradash/api/sync/keys.ts` — R2 key layout
  (`tenant/{tenantId}/user/{userId}/files/apps/{repoKey}/{branch}/HEAD/…`),
  path normalization (traversal-safe), MIME guessing.
- `plugins/pluradash/api/sync/github.ts` — Octokit operations: dev-branch
  auto-provisioning, recursive tree snapshot, blob download (base64, bounded
  concurrency), Git Data commits, dev→main merge, git blob SHA-1 helper.
- `plugins/pluradash/api/sync/storage.ts` — R2 read/write/delete, manifest
  persistence, catalog upsert/delete (orphan rollback), key listing.
- `plugins/pluradash/api/sync/engine.ts` — orchestration: `pullUpstream`,
  `listWorkspaceFiles`, `readWorkspaceFile`, `saveChanges`, `pushDev`,
  `deployProduction`, RLS-based `resolveWorkspaceRepo`, quota gating.
- `plugins/pluradash/api/sync/routes.ts` — Hono sub-app with the five
  endpoints (`/sync/pull`, `/sync/files`, `/sync/save`, `/sync/push`,
  `/sync/deploy`), agent-token gating on deploy, error mapping.
- `specs/features/pluradash-r2-sync-engine.md` — feature documentation.
- `specs/agents/plurapi-file-sync-integration.md` — detailed handoff spec for
  the PluraPi integration (auth, payloads, workflows, error recovery).
- `specs/changes/2026-08-28-pluradash-r2-sync-engine.md` (this file).

## Files Changed

- `plugins/pluradash/api/index.ts` — mounts the sync router at `/sync`
  (`pluradash.route('/sync', syncEngine)`).
- `plugins/pluradash/src/index.tsx` — API catalog: added the five sync endpoint
  definitions (`pluradash-sync-pull|files|save|push|deploy`) so agents discover
  them through the frontend-integration manifest.
- `plugins/pluradash/plugin.json` — added the optional
  `PLURADASH_PREVIEW_URL_TEMPLATE` wrangler var (Cloudflare preview URL
  template with `{branch}`/`{owner}`/`{repo}` placeholders).
- `specs/features/README.md`, `specs/agents/README.md` — registered the new
  documents.

## Impact Analysis

### Database

- **No new migrations.** The engine reuses `pluradash.workspace_repos`
  (authorization mapping, RLS) and `tenant_storage_objects` /
  `tenant_storage_allocations` (catalog + quota). No schema changes.
- Catalog rows are written with the admin client (bulk upserts keyed on
  `object_key`); quota accounting flows through the existing triggers.
- RLS-based authorization: every sync operation resolves the repo through a
  user-scoped SELECT on `pluradash.workspace_repos` — cross-tenant access is
  impossible. The 2026-08-28 tenant-admin RLS fix (migration 021) is a
  prerequisite for workspace admins to manage assignments.

### Runtime

- New worker module `api/sync/*` (~1,100 lines) bundled into the Worker;
  verified with `wrangler deploy --dry-run` and `tsc --noEmit`.
- R2 writes use the core-owned `MEDIA_BUCKET` binding; `manifest.json` objects
  are intentionally not catalog-registered (engine metadata, see feature doc).
- Pull uses the GitHub Trees API + Blobs API (no zip dependency exists in the
  Worker runtime); trees flagged `truncated` by GitHub are rejected (413).

### API Surface

- Five new authenticated endpoints under `/api/plugin/pluradash/sync/*`
  (see `specs/agents/plurapi-file-sync-integration.md` §4 for full payloads).
- Branch isolation guarantees: no endpoint writes to `main`; `/sync/deploy`
  rejects `is_agent` tokens and requires super-admin or active tenant admin.
- The endpoints are published in the agent API catalog for automatic discovery.

### Security

- GitHub App credentials remain server-side; agents receive only the JWT they
  already hold plus workspace content.
- Quota enforcement gates every write; deletes decrement usage via triggers.
- Push refuses to run against a moved remote branch (409), preventing
  accidental overwrites of teammates' commits.

---

## Amendment (review hardening, same day)

Review feedback identified two critical gaps and three edge cases; all five
are resolved before locking the contract:

1. **Explicit deletion payload in `/sync/save`.** File entries now accept
   `"deleted": true` (mutually exclusive with content). The engine removes the
   R2 object, the `tenant_storage_objects` row (quota freed) and the manifest
   entry, so `POST /sync/push` correctly reports the path under
   `diff.deleted`.
2. **Absolute request body ceiling.** `/sync/save` enforces max **10 MiB**
   total payload (checked via `Content-Length` up front and again after
   reading) in addition to the existing 500-entry cap — both return `413`.
   This prevents Worker memory spikes from large base64 JSON batches.
3. **Server-side ignore rules.** `/sync/save` rejects (400) any write or
   delete touching `.env`, `.env.*`, `.dev.vars`, `.git/…`, `.pi/…` or
   `node_modules/…` regardless of client payload, preventing secret leakage
   and dependency-noise commits. The filter deliberately does not apply to
   pulls, so files already tracked on GitHub keep their manifest entries and
   are never misread as push deletions.
4. **Conflict-recovery data loss documented.** §5.4 of the PluraPi handoff now
   states explicitly that a pull destroys unpushed R2 staging state and
   instructs PluraPi to buffer uncommitted edits client-side before pulling.
5. **Executable bits preserved.** Save entries accept an optional
   `"mode": "100755" | "100644"`; the mode is stored in the manifest, captured
   from the GitHub tree on pull, and forwarded to the Git Data Tree API on
   push. Symlinks/submodules (`mode 120000`) are excluded from tree snapshots.

Code changes: `sync/types.ts` (payload + manifest `mode`), `sync/keys.ts`
(`isIgnoredWorkspacePath`, `parseGitFileMode`), `sync/github.ts` (mode through
fetch/commit), `sync/storage.ts` (single-object delete), `sync/engine.ts`
(deletion handling, ignore filter, mode threading), `sync/routes.ts`
(deletion/mode validation, 10 MiB body cap). Docs: feature doc §manifest +
new "Server-side sanitization" / "Save payload constraints" sections; PluraPi
handoff §4.3/§5.4/§6/§7.
