# 2026-09-07 — Mail Queue Tenant Scoping & Delete Functionality

Follow-up to `2026-09-07-mail-queue-rate-limiting.md`.

## Summary

1. **Explicit tenant scoping for the mail queue.** The initial implementation
   scoped mail log visibility through a join to `forms`
   (`can_access_owned_row` on the owning form). This change adds a dedicated
   `tenant_id` column to `mail_delivery_jobs` (house multi-tenancy style:
   `uuid null references tenants(id) on delete set null`), backfills it from
   `forms.tenant_id`, and stamps it on every insert via a `BEFORE INSERT`
   trigger (`set_mail_delivery_job_tenant`) so *all* enqueue paths (Worker,
   plugins, cron, future ones) are covered automatically. RLS select policies
   were replaced: active tenant members (`public.is_tenant_member`) see their
   workspace's mail log, global `admin`/`super-admin` see everything,
   tenantless rows stay admin-only. **No delete/update policies are exposed to
   client roles** — deletes go through the Worker API, which verifies tenant
   visibility with the caller's JWT (RLS read-through) and performs the delete
   with the privileged admin client (the same pattern the retry endpoint uses).

2. **Delete functionality on the /admin/mail page** (*E-Mail-Verlauf*):
   - Failed rows now show a **Löschen** (delete) button beside **Erneut
     senden** (retry).
   - Every entry's expanded detail view has a **Eintrag löschen** option behind
     a confirmation dialog.
   - **Alle löschen** (clear all) in the page header deletes all tenant
     entries (including event history) after a confirmation dialog that shows
     the affected count; e-mails already sent are not affected.
   - `processing` jobs cannot be deleted (409) to avoid deleting mid-delivery.

## Files Added

- `migrations/202609070002_mail_queue_tenant_scoping.sql` — `tenant_id`
  column + FK + index, backfill from `forms.tenant_id`, tenant-stamping
  trigger, replacement tenant-scoped RLS select policies for
  `mail_delivery_jobs` / `mail_delivery_events`.
- `specs/changes/2026-09-07-mail-queue-tenant-scoping-and-delete.md` (this
  document).

## Files Changed

- `api/routes/mail.ts` — extracted `getVisibleJob` helper (JWT/RLS visibility
  check); new `DELETE /api/mail/jobs/:id` and `DELETE /api/mail/jobs`
  (clear-all, optional `?status=` filter, max 1000 per call) with tenant
  visibility enforced through the caller's JWT and privileged deletes via the
  admin client.
- `src/services/mailService.ts` — `deleteMailJob`, `clearMailJobs`.
- `src/pages/VerwaltungMail.tsx` — delete button beside retry on failed rows,
  delete option (with `AlertDialog` confirmation) in the expanded details of
  every entry, **Alle löschen** header action with confirmation dialog,
  toasts; `stopPropagation` so row-expansion clicks don't toggle while
  deleting.
- `scripts/setup.mjs` — registered the migration in `MIGRATION_ORDER` after
  `202609070001_mail_queue_retry.sql`.
- `specs/platform/email-delivery-queue.md` — tenant_id column, new RLS
  contract, delete API surface, updated dashboard description.

## Database impact

- `mail_delivery_jobs`: + `tenant_id uuid null` (FK → `tenants(id) on delete
  set null`), + index `(tenant_id, created_at desc)`, + `BEFORE INSERT`
  trigger `set_mail_delivery_job_tenant` deriving the tenant from
  `forms.tenant_id`.
- Idempotent backfill of existing rows from their owning form.
- RLS: form-join select policies (from `202609070001`) replaced by
  `is_tenant_member(tenant_id)`-based policies on both tables.
- `mail_delivery_events` rows cascade with their job (pre-existing FK).

## Runtime / API surface impact

- New endpoints documented in the API catalog: `mail-jobs-delete`
  (`DELETE /api/mail/jobs/:id`) and `mail-jobs-clear-all`
  (`DELETE /api/mail/jobs`).
- `send_email` edge function unchanged.
- Form submission / enqueue paths unchanged — tenant stamping happens in the
  database trigger, not in application code.

## Verification

- `npm run typecheck` — clean; `typecheck:api` — clean for `api/routes/mail.ts`
  (only the pre-existing `src/plugins/registry.ts` plugin-workspace error
  remains).
- `npm test` — 72/72 green.
- `npm run build` — succeeds.
- NOT verified live: RLS behavior against a real multi-tenant database and
  the delete round-trips — smoke-test after `npm run setup` with two tenants.
