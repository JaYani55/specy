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

## Files Changed

- `plugins/pluradash/api/index.ts` — new `POST /admin/github/sync` endpoint;
  `POST /admin/github/assign` now provisions on assign and cleans up on
  unassign (repo row is read before delete to resolve the R2 prefix)
- `plugins/pluradash/api/sync/storage.ts` — added `deleteR2Objects` bulk
  helper
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
- `npm run typecheck:api` — no errors in touched files (68 pre-existing
  gitignored-plugin errors unchanged)
- `npm test` — 286/286 pass
- `npm run build` — succeeds
