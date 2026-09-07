# Mail Delivery Queue & Rate-Limit Protection

Outbound e-mail (form notifications, confirmation copies, poll reminders) is
delivered through the Supabase Edge Function `send_email` on top of a durable
database queue (`mail_delivery_jobs`). The system follows the **Optimal Hybrid
Pattern**: instant direct sending with an automatic queue fallback — normal
traffic goes out immediately, rate-limited or failed sends are requeued and
retried with backoff so an e-mail can **never** be silently lost.

---

## 1. Delivery flow

```
[ Form submission / Poll reminder ]
            │
            ▼
[ Job row in mail_delivery_jobs (status: pending) ]
            │
            ▼
[ Direct send attempt via send_email (deliver-job) ]
    │                            │
    ▼ (Success)                  ▼ (429 / network error / provider error)
[ Sent instantly ]         [ Requeued: status pending, next_attempt_at = now + backoff ]
                                     │
                                     ▼ (Every minute via pg_cron + pg_net)
                          [ send_email process-pending batch ]
                                     │
                       ▼ (Success)                ▼ (3 failed attempts)
                  [ Sent ]                [ Terminal failed — kept in DB, re-dispatchable via /admin/mail ]
```

Key properties:

- **An e-mail never fails to send without being queued for retry.** Every
  failed attempt (rate limit, provider outage, network error) writes the job
  back as `pending` with a future `next_attempt_at`.
- **Retry limit:** after `max_attempts` (default **3**) failed attempts the job
  is parked as terminal `failed` — but **always kept in the database** (never
  deleted) so it can be audited and manually re-dispatched from the
  *E-Mail-Verlauf* page (`/admin/mail`).
- **Rate-limit awareness:** when the provider answers HTTP 429, the batch
  processor stops immediately for that minute; a provider `Retry-After` header
  overrides the computed backoff (capped at 15 minutes).

## 2. Retry / backoff contract

Implemented in `functions/send_email/retryPolicy.ts` (pure, unit-tested in
`tests/mailRetryPolicy.test.mjs`):

| Failed attempt | Backoff                    | Result                          |
|----------------|----------------------------|---------------------------------|
| 1 of 3         | 60 s                       | `pending`, retry on next cron   |
| 2 of 3         | 120 s (exponential ×2)     | `pending`, retry on next cron   |
| 3 of 3         | —                          | terminal `failed`, row kept     |

- Backoff base 60 s, exponential ×2, hard cap 900 s (15 min).
- Provider `Retry-After` (seconds or HTTP-date) takes precedence, also capped.
- Jobs stuck in `processing` for more than 5 minutes (worker crash) are
  reclaimed as `pending` and retried.
- Batch processing is **strictly sequential** with a 300 ms inter-job delay;
  batch size is capped at 10 per cron tick (25 max per invocation).

## 3. Scheduling (pg_cron + pg_net)

Migration `202609070001_mail_queue_retry.sql`:

- Enables `pg_cron` and `pg_net` (guarded — self-hosted installs without them
  keep working; manual re-dispatch still functions, only the automatic retry
  loop is absent).
- `public.trigger_mail_queue_processing()` posts to the `send_email` edge
  function with `{ mode: 'process-pending', limit: 10 }`.
- The target URL is read from `system_config` (namespace `mail`):
  - `edge_function_url` — `{SUPABASE_URL}/functions/v1/send_email`
    (written automatically by `scripts/setup.mjs`).
  - `edge_function_key` — **optional** API key. `send_email` is deployed with
    `verify_jwt = false`, so the header can be omitted; operators may set a
    publishable key for defense in depth.
- Cron job name: `mail-queue-processor`, schedule `* * * * *`.

## 4. Data model

All queue state lives in the existing `mail_delivery_jobs` table (extended in
place — there is no separate queue table, because the answer auto-delete logic
(`delete_answer_after_email`) counts non-`sent` jobs per answer and the event
audit trail is FK-linked to this table):

| Column             | Purpose                                              |
|--------------------|------------------------------------------------------|
| `status`           | `pending` / `processing` / `sent` / `failed`         |
| `attempt_count`    | Delivery attempts made                               |
| `max_attempts`     | Retry ceiling (default 3)                            |
| `next_attempt_at`  | Earliest time the job may be attempted again         |
| `last_error`       | Last provider/error message                          |
| `tenant_id`        | Owning tenant (FK → `tenants`, derived from the form)|

`tenant_id` is stamped by a `BEFORE INSERT` trigger (`set_mail_delivery_job_tenant`)
that derives it from `forms.tenant_id`, so every enqueue path (Worker, plugins,
cron) is covered; legacy rows were backfilled in the same migration.

`mail_delivery_events` records the full history with event types `queued`,
`testing`, `sending`, `sent`, `requeued`, and `failed` (FK → job, cascade
delete).

**RLS / tenant scoping** (`202609070002_mail_queue_tenant_scoping.sql`):
`mail_delivery_jobs` and `mail_delivery_events` are readable by
- active members of the owning tenant (`public.is_tenant_member(tenant_id)`),
- global `admin` / `super-admin` roles.

Rows without a tenant (no linked form) remain admin-only. There are **no
delete/update policies for client roles** — deletes always go through the
Worker API, which verifies tenant visibility with the caller's JWT (RLS) and
performs the delete with the privileged admin client.

## 5. API surface

Documented in the API catalog (`src/lib/apiCatalog.ts`, tag *Mail*):

- `GET /api/mail/jobs` — tenant-scoped delivery log (jobs + event history).
  Reads through the caller's JWT so RLS enforces tenancy.
- `POST /api/mail/jobs/:id/retry` — manual re-dispatch. Verifies tenant
  visibility through the user JWT (404 if not visible), then resets the job
  (`attempt_count = 0`, `status = pending`) via the admin client, writes a
  `requeued` event and triggers an immediate `deliver-job` attempt. Failures
  fall back to the cron queue as usual.
- `DELETE /api/mail/jobs/:id` — deletes a single job (event history cascades).
  Tenant-visibility check via the user JWT; `processing` jobs are rejected
  (409) to avoid deleting mid-delivery.
- `DELETE /api/mail/jobs` — clear-all: deletes every job visible to the
  caller's tenant (optionally filtered with `?status=failed`), up to 1000 per
  call; `processing` jobs are skipped.

## 6. Dashboard

*Verwaltung → E-Mail-Verlauf* (`/admin/mail`, visible to all tenants):

- Filterable list (all / pending / processing / sent / failed) of the
  tenant's mail delivery jobs with status badges, recipient, subject, type,
  attempt counter, and creation date.
- Failed rows are highlighted (red) and offer an **Erneut senden** (retry)
  button plus a **Löschen** (delete) button.
- Row expansion shows the last error, the next automatic attempt time, and the
  full event history — with a **Eintrag löschen** delete option (with
  confirmation dialog) available for every entry.
- **Alle löschen** (Clear all) in the page header deletes all entries of the
  tenant after a confirmation dialog (count and scope are shown; e-mails
  already sent are not affected).

## 7. Operator notes

- Run `npm run setup` to apply the migration and write
  `mail.edge_function_url`; re-running is safe and idempotent.
- Verify the cron in Supabase Dashboard → Database → Cron
  (`mail-queue-processor`).
- Terminal `failed` jobs block the answer auto-delete (`delete_answer_after_email`)
  by design — the content was never delivered.
