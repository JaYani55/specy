# PluraDash Repository Re-Sync & Provisioning Lifecycle (GitHub Apps Admin Panel)

Date: 2026-09-22

## Summary

Closes a functional gap in the PluraDash GitHub App integration: until now,
assigning a repository to a workspace only wrote the `workspace_repos` access
row — **no** R2 data objects, no `tenant_storage_objects` catalog rows and no
data-space (storage allocation) verification happened, and unlinking left all
provisioned data orphaned in storage. There was no way to re-sync an
already-connected repository at all.

This change introduces an explicit provisioning lifecycle, implemented
entirely inside the pluradash plugin workspace (EUPL isolation):

1. **Re-Sync per app (GitHub Apps Admin Panel):** a new "Re-Sync" button per
   repository row re-provisions the repo data in **every** workspace the repo
   is connected to — mirrors the current GitHub `dev` tree into R2, writes
   the data objects (`tenant_storage_objects`, scope `apps`) for every
   entitled workspace user, verifies the per-user data space (storage
   allocation) can absorb the net byte delta, auto-creates a missing `dev`
   branch and rewrites the manifests.
2. **Connect = provision:** `POST /admin/github/assign` (action `assign`)
   now automatically performs the same provisioning run for the newly
   connected workspace after the upsert.
3. **Unlink = cleanup:** `POST /admin/github/assign` (action `unassign`)
   deletes all provisioned data of the repo in the workspace (R2 objects
   incl. manifests across all users/branches + catalog rows, quota freed via
   the usage-sync trigger) after the access row removal.

Provisioning is **fail-soft** for assign/unassign: the access row change
stays valid, provisioning/cleanup problems are returned in the response
(`provisioning` / `provisioningError`, `cleanup` / `cleanupError`) and logged
to `pluradash.sync_logs` (operation `repo.resync`). The admin Re-Sync
endpoint reports per-workspace, per-user results.

## Provisioning semantics

Target users per (workspace, repo):

- Every user with **existing provisioned data** for the repo (their copy is
  refreshed in place — even without an allocation row, since the existing
  usage already covers the replaced content).
- Every **active workspace member holding an active storage allocation**
  (fresh provisioning).

Users without an active allocation are skipped with a machine-readable
reason (`no-allocation`, `suspended-allocation`, `quota-exceeded`) — the
allocation provisioning remains the exclusive job of the storage platform
(policy hooks / tenant admins); the sync engine never creates quota-less
allocation rows.

The GitHub dev tree is fetched **once per repository** and reused for all
(workspace, user) targets of a run. R2 keys and manifest contents are
identical to the interactive sync engine (`plugins/pluradash/api/sync/engine.ts`),
so a subsequent user pull/push operates on the same objects.

## Files Added

- `plugins/pluradash/api/sync/provisioning.ts` — admin-driven provisioning
  and cleanup engine (repo snapshot fetch, target resolution, per-user
  mirroring, quota gating, R2 + catalog cleanup)
- `plugins/pluradash/api/sync/r2Ops.ts` — dependency-free R2 helpers
  (shape-tolerant list pagination via opaque cursor, 1000-key delete
  chunking), unit-tested in `tests/pluradashSyncStorage.test.mjs`
- `tests/pluradashSyncStorage.test.mjs` — regression tests for R2 list
  pagination (real Workers API shape vs. legacy `truncated`), delete
  chunking and repo-prefix matching (SQL LIKE wildcard guard)

## Files Changed

- `plugins/pluradash/api/index.ts` — new `POST /admin/github/sync` endpoint;
  `POST /admin/github/assign` now provisions on assign and cleans up on
  unassign (repo row is read before delete to resolve the R2 prefix)
- `plugins/pluradash/api/sync/storage.ts` — added `deleteR2Objects` bulk
  helper; `listObjectKeys` now paginates via the real Workers R2 API shape
  (`list_complete: false` + opaque top-level `cursor`; the previous code
  checked a nonexistent `truncated` field and always stopped after the first
  1000 objects); R2 deletes and catalog `in (...)` deletes are chunk-safe
- `plugins/pluradash/api/sync/keys.ts` — added pure
  `matchesRepoPrefix(objectKey, workspaceId, repoFullName)` helper (exact
  post-filter for SQL LIKE results; repo keys may contain `_` LIKE wildcards)
- `plugins/pluradash/api/sync/logger.ts` — new sync-log operation
  `repo.resync`
- `plugins/pluradash/plugin.json` — api_metadata entry
  `pluradash-admin-github-resync`
- `plugins/pluradash/src/services/githubAppService.ts` — `resyncRepo()`,
  provisioning/cleanup result types, updated assign/unassign response types
- `plugins/pluradash/src/pages/admin/GitHubAppsAdminPage.tsx` — per-repo
  "Re-Sync" button (Aktionen column, shown for assigned repos), resync
  mutation with summary toasts, assign/unassign toasts surface
  provisioning/cleanup results, `repo.resync` added to the Sync-Logs
  operation filter

## Database Impact

None — no schema changes. Reuses `pluradash.workspace_repos`,
`tenant_storage_objects`, `tenant_storage_allocations`, `tenant_users` and
`pluradash.sync_logs`. Catalog writes/decrements flow through the existing
usage-sync trigger.

## API Surface

| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/admin/github/sync` | super-admin | Re-sync a repo into all connected workspaces (or one `workspaceId`); returns per-workspace/per-user provisioning summary |
| POST | `/admin/github/assign` | super-admin | Unchanged contract for the access row, extended response: `provisioning`/`provisioningError` (assign), `cleanup`/`cleanupError` (unassign) |

## Runtime Impact

- Assign/unassign endpoints now perform GitHub tree/blob downloads and R2
  writes inline (same work profile as the interactive pull). Large repos
  increase request duration proportionally; errors are fail-soft.
- Unassign performs R2 list + bulk delete per affected user prefix.

## Verification

- `npm run typecheck` (frontend, includes plugin pages) — exit 0
- `npm run typecheck:api` — no errors in touched files (pre-existing
  gitignored-plugin errors unchanged)
- `npm test` — 294/294 pass (incl. 8 new `pluradashSyncStorage` tests)
- `npm run build` — succeeds

## Follow-up fixes (same day, runtime smoke tests)
1. **Assign provisioning crashed** with `Cannot read properties of undefined
   (reading 'startsWith')`: `resolveProvisionTargets` read `row.object_key`
   without selecting it. Fixed (`select('object_key, user_id, size_bytes')`)
   and `matchesRepoPrefix` hardened against null/undefined keys.
2. **Cleanup/provisioning silently truncated at 1000 objects**: the real
   Workers R2 list API has no `truncated` field — pagination must follow
   `list_complete: false` + the opaque top-level `cursor`. Fixed via the new
   pure module `sync/r2Ops.ts` (`collectR2Keys`, `chunkForR2Delete`);
   legacy `truncated` shapes fall back to the last object key.
3. **Large-tree deletes**: R2 `delete()` rejects batches above 1000 keys and
   PostgREST `in=(...)` filters hit URL-length limits — `deleteHeadTree`,
   `deleteR2Objects` and `deleteCatalogRows` now chunk (1000 / 25).
4. **Cleanup failed with `400 Bad Request`** (`Failed to remove deleted files
   from the storage catalog`): the cleanup deleted thousands of catalog rows
   via `object_key in ("…","…",…)` — with ~170-char object keys the DELETE
   request URL exceeded PostgREST/gateway URI limits (supabase-js also does
   not escape reserved characters inside `in (...)` values). Cleanup now
   deletes per user via a single exact LIKE filter over the deterministic
   object-key prefix (`deleteCatalogRowsByPrefix`, wildcards escaped via the
   new pure helper `escapeLikePattern` in `sync/keys.ts`) — one small
   request per user, collation-independent, no key lists. The `in (...)`
   path remains only for small engine batches (chunk 25).
5. **Launch button removed from the tenant apps grid** (`/plugins/pluradash/apps`):
   the "Starten" button called `/apps/launch`, whose `launchUrl` points
   directly at the GitHub repository — users have no direct access to the
   repository (infrastructure/CI-CD concern of the administrator). The app
   card footer now offers only the ZIP download. The `/apps/launch` endpoint
   stays part of the authenticated API surface (agent/PluraPi sessions);
   the unused frontend wrapper `launchAppSession()` was removed.
6. **Workspace storage usage showed ~0 bytes** while the file-type stats
   showed the real data (e.g. 18 media objects / 7.5 MB): `/storage/summary`
   and `/files` returned `ensureTenantStorageSummary()` — the CALLER's
   personal allocation (`tenant_storage_allocations.used_bytes_cached` of
   one (tenant, user) row). The PluraDash file overview is a support/super-
   admin workspace view whose catalog rows belong to other users, so the
   usage tile showed the viewer's (near-zero) usage. New plugin helper
   `readWorkspaceStorageSummary()` (api/index.ts) aggregates the actual
   catalog across ALL users of the workspace (same source as the file-type
   stats — always in agreement, immune to `used_bytes_cached` drift) and
   sums the active allocations of the workspace's active members for the
   quota display (auto-provisioned policy-hook allocations of non-member
   viewers are excluded). `/storage/summary` and `/files` now return this
   workspace-wide summary; per-user quota enforcement on uploads is
   unchanged.
