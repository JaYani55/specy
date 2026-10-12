# Logging & Retention

How request/operation logging is written, throttled, and cleaned up — designed
so the platform's own observability does not dominate Supabase API usage and
edge-log volume.

## Core request logging (`agent_logs`)

`api/middleware/agentLogger.ts` logs every `/api/*` and `/mcp/*` request into
`public.agent_logs`. Its per-request cost is deliberately bounded:

| Mechanism | Detail |
|---|---|
| **Logging-config cache** | `system_config` (namespace `logging`) is read once per isolate per 5 minutes (`LOGGING_CONFIG_TTL_MS`); `upsertLoggingConfig` callers call `invalidateLoggingConfigCache()` so settings writes apply immediately. The read itself is a single REST query (`mode` + `enabled_endpoints` in one `.in()` call). |
| **Monitoring-path skip** | Liveness probes matching `/api/(health|healthz|ping|ready|live)` are never logged — zero diagnostic value, high frequency. |
| **Schema-slug cache** | `schema_slug → schema_id` resolution is cached per isolate for 5 minutes (`resolveSchemaId`), scoped by caller kind (`user`/`anon`) because the lookup honours RLS. Previously 1–2 `page_schemas` lookups per logged request. `invalidateSchemaIdCache()` exists for future wiring into schema-mutation routes. |
| **Batched writes** | Rows go through `createLogBuffer` (`api/lib/logBuffer.ts`): up to 10 rows share one batched `INSERT`, flushed immediately at the threshold or ~1 s after the first buffered row via `executionCtx.waitUntil()`. Failed batches are retried once, then dropped with a console error. |

Trade-off: rows buffered in an isolate that dies inside the coalescing window
are lost, and freshly logged requests may take up to ~1 s to appear in the
log viewer. Both are accepted — logging is best-effort by design.

## Log buffer primitive

`api/lib/logBuffer.ts` exposes a generic `createLogBuffer<Row, Ctx>` used by
both the core agentLogger and plugins (PluraDash sync logs). Contract:

- `push(row, ctx, schedule?)` — buffers a row; flushes immediately when
  `batchSize` is reached, otherwise after `flushDelayMs`. `schedule` is
  typically `executionCtx.waitUntil` (extracted via the exported
  `getWaitUntil(context)` helper) so flushes survive the response on Workers.
- `insert(rows, ctx)` must throw on failure; the buffer retries once and then
  reports via `onError(error, rowCount, ctx)`. Failed rows are dropped, not
  retried forever.
- Covered by `tests/logBuffer.test.mjs`.

## Retention (automated cleanup)

| Table | Mechanism | Default window | Schedule |
|---|---|---|---|
| `public.agent_logs` | `public.cleanup_old_agent_logs(retention_days, batch_size)` | 14 days | Daily pg_cron job `agent-logs-retention` (02:30) — `202610160002_agent_logs_retention.sql` |
| `pluradash.sync_logs` | `pluradash.cleanup_old_sync_logs(retention_days, batch_size)` | 30 days | Daily pg_cron job `pluradash-sync-logs-retention` (02:40) — plugin migration `027_sync_logs_retention.sql` (owned by the PluraDash plugin repository) |

Both functions delete in bounded batches (default 1000 rows per loop
iteration) so a run never holds long transactions; both report the total
deleted row count. If pg_cron is unavailable (self-hosted), the functions
remain callable manually and a notice is raised at migration time. The manual
super-admin endpoints (`DELETE /api/schemas/logs`, plugin log cleanup) are
unchanged.

## Mail-queue cron noise

`migrations/202610160001_mail_queue_cron_tuning.sql` reschedules the
`mail-queue-processor` pg_cron job from every minute to **every 5 minutes** and
folds the two per-tick `system_config` lookups into one query. The
work-presence gate from `202609110001_mail_queue_cron_gate.sql` (skip the
`send_email` invocation when nothing is due) is preserved. Net effect: queued
mail waits up to 5 minutes for its delivery attempt; idle-tick Postgres log
noise drops from ~2,880 to ~576 lines/day.

## PluraDash sync logging (plugin-owned)

`scheduleSyncLog()` in the plugin's `api/sync/logger.ts`:

- resolves the verbosity level (`off`/`basic`/`verbose`) from the ~30 s
  in-isolate cache — **never** live per write (a live lookup per row made every
  log event cost an extra `admin_settings` REST GET);
- buffers rows through the shared `createLogBuffer` and flushes them as one
  batched insert into `pluradash.sync_logs`.

Level changes via `PUT /admin/github/log-level` still apply immediately (the
endpoint force-refreshes the cache after upsert). Plugin logging internals are
documented and versioned in the plugin's own repository.
