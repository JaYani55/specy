# 2026-09-07 — Mail Queue Retry & Rate-Limit Protection

## Summary

Provider rate limits (e.g. Resend free tier) previously dead-ended outbound
e-mail: a single failed send attempt (HTTP 429 or any provider error) marked
the `mail_delivery_jobs` row as terminal `failed` and nothing ever retried it
— notification e-mails were silently lost. The existing `process-pending`
batch mode of the `send_email` edge function had no caller at all.

This change implements the **Optimal Hybrid Pattern (instant send + queue
fallback)**:

- Form submissions still enqueue into `mail_delivery_jobs` and trigger an
  immediate `deliver-job` invocation (instant path — no added latency for
  normal traffic).
- On **any** send failure the edge function now requeues the job instead of
  dead-ending it: `status = pending` with `next_attempt_at = now + backoff`
  (exponential 60 s → 120 s → cap 900 s; provider `Retry-After` header from a
  429 response takes precedence). A `requeued` event is logged.
- After **3 failed attempts** the job becomes terminal `failed` — but is
  **never deleted**, it stays in the delivery log for auditing and manual
  re-dispatch.
- A new **pg_cron schedule** (`mail-queue-processor`, every minute) invokes
  `send_email` with `process-pending` via pg_net, processing due jobs
  strictly sequentially (max 10 per tick, 300 ms spacing) and aborting the
  batch on the first rate limit so the remaining jobs wait for the next tick.
- Jobs stuck in `processing` > 5 minutes (worker crash) are reclaimed as
  pending.
- New **/admin/mail** page (*E-Mail-Verlauf*): tenant-scoped mail delivery log
  with status filters, event history per job, failed jobs highlighted with a
  manual **Erneut senden** (retry) button.
- New API surface `GET /api/mail/jobs` and `POST /api/mail/jobs/:id/retry`
  (tenant-scoped via RLS read-through with the caller's JWT).
- Side effect: `poll_reminder` jobs (previously inserted without any send
  trigger) are now actually delivered by the cron queue processor.

## Files Added

- `migrations/202609070001_mail_queue_retry.sql` — additive columns
  (`next_attempt_at`, `max_attempts` + check), due-job index, backfill of
  pending jobs, `requeued` event type in the `mail_delivery_events` check
  constraint, tenant-scoped select RLS policies for jobs/events (replacing the
  admin-only policies), `pg_cron`/`pg_net` enablement (guarded),
  `public.trigger_mail_queue_processing()`, and the `mail-queue-processor`
  cron schedule.
- `functions/send_email/retryPolicy.ts` — pure retry/backoff decision logic
  (`computeMailRetryDecision`, `parseRetryAfterHeader`, `isRateLimitStatus`),
  shared by the edge function and unit-tested from Node.
- `api/routes/mail.ts` — `GET /jobs` (tenant-scoped listing with event
  history) and `POST /jobs/:id/retry` (manual re-dispatch).
- `src/services/mailService.ts` — dashboard client for the mail endpoints.
- `src/pages/VerwaltungMail.tsx` — *E-Mail-Verlauf* page (German/English).
- `tests/mailRetryPolicy.test.mjs` — retry contract tests (incl. the hard
  requirement: a job is retryable before max attempts and terminal-failed jobs
  are kept, never deleted).
- `specs/platform/email-delivery-queue.md` — feature documentation.
- `specs/changes/2026-09-07-mail-queue-rate-limiting.md` — this document.

## Files Changed

- `functions/send_email/index.ts` — `ProviderSendError` with HTTP status /
  `Retry-After` capture (Resend adapter); `processJob` requeue-or-fail fallback
  with `requeued`/`failed` events; `processPendingJobs` rewritten: stale
  `processing` reclaim, due-only selection, sequential processing with
  inter-job delay, abort-on-429 batch semantics, summary response; `deliver-job`
  no longer throws on provider failure (returns requeue outcome instead);
  `appendDeliveryEvent` accepts `requeued`.
- `api/index.ts` — mounts `api/routes/mail.ts` at `/api/mail`.
- `src/App.tsx` — route `/admin/mail` (requiredRole `user` → available to all
  tenants).
- `src/components/layout/AppSidebar.tsx` — sidebar entry *E-Mail* (`/admin/mail`).
- `src/pages/Verwaltung.tsx` — overview card linking to `/admin/mail`.
- `src/lib/apiCatalog.ts` — API catalog entries for the two mail endpoints.
- `scripts/setup.mjs` — registered the migration in `MIGRATION_ORDER` (after
  `202605240004_tenant_assignment_rls_fix.sql`, before the console visibility
  hardening); writes `system_config` (`mail.edge_function_url`) after
  migrations so the cron trigger can call the edge function.
- `specs/platform/README.md` — registered the new documentation.

## Database impact

- `mail_delivery_jobs`: + `next_attempt_at timestamptz`, + `max_attempts
  integer not null default 3` (+ check), + indexes; idempotent backfill.
- `mail_delivery_events`: event-type check constraint now also allows
  `requeued`.
- RLS: admin-only select policies replaced by tenant-scoped policies
  (`can_access_owned_row` on the linked form, plus admin/super-admin).
- New objects: `public.trigger_mail_queue_processing()`, cron job
  `mail-queue-processor`, extensions `pg_cron`/`pg_net` (guarded — creation
  failures are caught so installs without them are unaffected).

## Runtime impact

- `send_email` edge function: new retry/fallback behavior and batch semantics
  (verified with `deno check`).
- Cloudflare Worker: new `/api/mail` route; form submission flow unchanged
  (instant path preserved).
- `scripts/setup.mjs`: writes the cron config row; failure is non-fatal with
  an operator hint.

## API surface impact

- New: `GET /api/mail/jobs`, `POST /api/mail/jobs/:id/retry` (mounted at
  `/api/mail`), documented in the API catalog.
- `POST /api/config/mail/test` and the internal `deliver-job` invocation are
  unchanged; `deliver-job` now reports `{ success, sent, requeued,
  terminalFailed, rateLimited, nextAttemptAt, error }` instead of an HTTP 500
  on provider failure.

## Verification

- `npm test` — 72/72 green (incl. new retry-policy contract tests).
- `npm run typecheck` / `npm run typecheck:api` — clean for all touched files
  (remaining `plugins/*` errors are pre-existing in the gitignored plugin
  workspace).
- `npm run build` — succeeds.
- `deno check functions/send_email/index.ts` — clean.
- NOT verified live: actual Resend 429 handling and cron execution require a
  deployed environment — smoke-test after `npm run setup` (check Supabase
  Dashboard → Database → Cron for `mail-queue-processor`).
