# 2026-08-30 — PluraDash Apps: Storage Provisioning, Sync Logging & ZIP Portability

## Summary

Three related enhancements to the PluraDash workspace apps stack (GitHub App →
R2 sync engine → user-facing apps):

1. **Apps storage provisioning (`allocation_type`)** — the core tenant storage
   provisioning (`public.tenant_storage_allocations`) now supports a dedicated
   `apps` type alongside the existing `files` type, so workspace app files
   (sync engine workspaces under `.../files/apps/...`) are provisioned and
   quota-tracked in their own bucket (default 2 GiB) instead of consuming the
   generic file quota.
2. **Full sync operation logging** — every workspace sync operation
   (pull / files.list / files.read / save / push / deploy / archive /
   app.launch / repo.assign / repo.unassign / logs.cleanup) is now persisted to
   the new `pluradash.sync_logs` table (fire-and-forget, sanitized payloads)
   and surfaced in the GitHub Apps admin panel via a new **Sync-Logs** tab,
   modeled after the Agent Communication Logs view.
3. **ZIP download for portability** — a new `GET /api/plugin/pluradash/sync/archive`
   endpoint streams the synced workspace (dev or main snapshot) as a ZIP
   archive; the `/plugins/pluradash/apps` overview gains a "ZIP" download
   button. A dependency-free STORE-method ZIP writer
   (`plugins/pluradash/api/sync/zip.ts`) was added since the Worker bundle has
   no zip library.

Additionally, the user-facing **Apps** page was cleaned up: no GitHub links,
no branch information and no repository URLs are shown anymore. GitHub is an
admin/CI-CD concern — workspace users only see the app name, file count and
stored size. The per-app size and file count come from the R2 apps prefix in
`tenant_storage_objects`. The PluraDash file overview (storage stats card)
now includes an **Apps** category with counts *and* byte totals per category.

## Files Added

- `migrations/202608300001_tenant_storage_allocation_types.sql` — core migration: `allocation_type` column, widened PK `(tenant_id, user_id, allocation_type)`, usage-sync trigger routing by object key.
- `plugins/pluradash/migrations/022_create_sync_logs.sql` — sync operation logs table (pluradash schema) with RLS.
- `plugins/pluradash/migrations/down/022_create_sync_logs.sql` — downmigration.
- `plugins/pluradash/api/sync/logger.ts` — fire-and-forget sync operation logger.
- `plugins/pluradash/api/sync/zip.ts` — minimal ZIP (STORE) writer with CRC-32.
- `specs/changes/2026-08-30-pluradash-apps-storage-provisioning-logging-zip.md` — this document.

## Files Changed

- `scripts/setup.mjs` — registered the new core migration in `MIGRATION_ORDER`.
- `api/lib/tenantStorageMgt.ts` — `ensureTenantStorageSummary` accepts `allocationType`, provisions/reads the matching allocation row and back-fills usage on first provisioning.
- `api/lib/tenantStorageHooks.ts` — `TenantStoragePolicyContext` carries `allocationType`.
- `plugins/pluradash/api/storageHooks.ts` — policy hook provisions a dedicated apps quota (`DEFAULT_APPS_QUOTA_BYTES`, 2 GiB).
- `plugins/pluradash/api/sync/engine.ts` — quota checks use the `apps` allocation; new `buildWorkspaceArchive()` for branch ZIPs.
- `plugins/pluradash/api/sync/routes.ts` — every sync route logs to `sync_logs`; new `GET /sync/archive` endpoint.
- `plugins/pluradash/api/index.ts` — `/apps` returns per-app `fileCount`/`totalBytes`; `/apps/launch` and `/admin/github/assign` are logged; new `GET|DELETE /admin/github/logs`; storage stats include an `apps` category with byte totals.
- `plugins/pluradash/src/services/githubAppService.ts` — `downloadWorkspaceArchive()`, `fetchSyncLogs()`, `deleteSyncLogs()`, size fields on `WorkspaceRepo`.
- `plugins/pluradash/src/services/pluradashService.ts` — `PluradashFileTypeStat` gains `bytes` and the `apps` key.
- `plugins/pluradash/src/pages/AppsPage.tsx` — removed GitHub link / branch badge / repo path; added size + file count cards and ZIP download.
- `plugins/pluradash/src/pages/WelcomePage.tsx` — file-type overview shows the `Apps` category and per-category byte totals.
- `plugins/pluradash/src/pages/admin/GitHubAppsAdminPage.tsx` — tabs ("Repositories" / "Sync-Logs") with filterable log table, stats cards and cleanup action.
- `plugins/pluradash/src/hooks/usePluradashTranslations.ts` — `apps` label.
- `plugins/pluradash/src/index.tsx` — API catalog entry for `pluradash-sync-archive`.
- `specs/features/pluradash-r2-sync-engine.md`, `specs/agents/plurapi-file-sync-integration.md`, `specs/agents/r2-file-storage.md`, `specs/features/pluradash-github-app-integration.md` — documentation updates.

## Impact Analysis

### Database

- Core: `tenant_storage_allocations` gains `allocation_type` (CHECK `files|apps`, default `files`) and a widened PK. The usage-sync trigger now routes
  increments/decrements to the `apps` row for objects under
  `tenant/{tenantId}/user/{userId}/files/apps/%` and to `files` otherwise.
  Existing rows are untouched (all become `files`); the first apps provisioning
  back-fills `used_bytes_cached` from existing catalog rows.
- Plugin: `pluradash.sync_logs` (new table, idempotent migration + downmigration).

### Runtime

- `ensureTenantStorageSummary` gained an optional `allocationType` parameter —
  fully backwards compatible (defaults to `files`).
- Sync quota checks now provision the `apps` bucket; the policy hook grants a
  2 GiB default to PluraDash support users (same eligibility as before).
- ZIP archives are built in memory (STORE, no compression); bounded by the
  existing tree-size limits of the sync engine.

### API Surface

- New: `GET /sync/archive` (JWT, all sync roles), `GET /admin/github/logs`,
  `DELETE /admin/github/logs` (super-admin only).
- Extended: `GET /apps` responses now include `fileCount` and `totalBytes`
  per repository.
- `/sync/*` and app/assignment endpoints write one `sync_logs` row per
  operation (best-effort; failures never break the request).
