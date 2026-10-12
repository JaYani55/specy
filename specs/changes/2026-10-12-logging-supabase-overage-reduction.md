# 2026-10-12 — Logging Supabase Overage Reduction (Phases 1–5)

## Summary

Supabase log-tail analysis showed the platform's log usage was dominated by
self-amplifying logging traffic: every log write and config check generated
its own Supabase REST request, each of which lands in the edge logs. This
change implements the logging-overage plan end to end (Phases 1–5):

1. **Config-check amplification removed.** The PluraDash plugin resolved the
   sync-log level live from `pluradash.admin_settings` on *every* log row
   (uncached `refreshSyncLogLevel`); the core agentLogger re-read the logging
   config in two separate queries every 30 s per isolate. Both now use cached
   reads (plugin ~30 s, core 5 min), and the core read is a single query.
2. **Batched log writes.** A reusable in-isolate log buffer
   (`api/lib/logBuffer.ts`) collects rows and flushes them as one batched
   INSERT (size threshold or ~1 s coalescing delay, Workers-safe via
   `executionCtx.waitUntil()`). Used by the core agentLogger (`agent_logs`)
   and the plugin (`sync_logs`) — N log events cost 1 REST round-trip instead
   of N, eliminating the "log entry to record a log entry" multiplier.
3. **Per-request auxiliary lookups removed.** The schema `slug → id`
   resolution in the agentLogger is cached per isolate (5 min, caller-kind
   scoped); liveness/monitoring probes (`/api/health`, `/api/ping`, …) are
   never logged.
4. **Cron noise reduced.** The mail-queue pg_cron job is rescheduled from
   every minute to every 5 minutes and reads its two `system_config` settings
   in one query. The work-presence gate from 202609110001 is preserved.
5. **Automated retention.** Batched cleanup functions plus daily pg_cron jobs
   bound `public.agent_logs` (14 days) and `pluradash.sync_logs` (30 days) —
   previously both grew unboundedly (only a manual super-admin delete endpoint
   existed).

Accepted trade-offs: rows buffered in an isolate that dies inside the
coalescing window are lost (logs are best-effort), and freshly logged requests
appear in the log viewer with up to ~1 s delay. Queued mail now waits up to
5 minutes (instead of 1) for its delivery attempt.

## Files Added

- `api/lib/logBuffer.ts` — generic in-isolate log write buffer (batch +
  coalescing flush, one retry, `waitUntil` scheduling, `getWaitUntil` helper).
- `tests/logBuffer.test.mjs` — 7 tests: coalescing, threshold flush, retry
  success/failure, `onError` reporting, explicit flush, empty-flush no-op.
- `migrations/202610160001_mail_queue_cron_tuning.sql` — reschedules
  `mail-queue-processor` to 5-minute cadence; single-query config read;
  preserves the work-presence gate. Idempotent.
- `migrations/202610160002_agent_logs_retention.sql` —
  `public.cleanup_old_agent_logs(retention_days, batch_size)` (batched
  deletes) + daily pg_cron job `agent-logs-retention`. Idempotent.
- `specs/platform/logging-and-retention.md` — logging pipeline, buffer
  contract, retention jobs, cron tuning (registered in
  `specs/platform/README.md`).
- Plugin (`plugins/pluradash`, separate repository):
  - `migrations/027_sync_logs_retention.sql` +
    `migrations/down/027_sync_logs_retention.sql` —
    `pluradash.cleanup_old_sync_logs` + daily cron job `pluradash-sync-logs-retention`
    (with matching downmigration, registered in the plugin's `plugin.json`).

## Files Changed

- `api/lib/systemConfig.ts` — `getLoggingConfig()` uses a single
  `system_config` query (`.in('key', [...])`) instead of two `.single()` calls.
- `api/middleware/agentLogger.ts` — `LOGGING_CONFIG_TTL_MS` 30 s → 5 min;
  `resolveSchemaId()` slug→id cache (5 min, `user`/`anon` scoped) with
  `invalidateSchemaIdCache()` export; monitoring-path skip
  (`isMonitoringPath`); request rows buffered through `agentLogBuffer`
  (batch of 10 / 1 s) instead of a single-row INSERT per request.
- `scripts/lib/migration-order.mjs` — the two new migrations registered
  *above* `202610120001_repair_catalogue_product_aggregate_rpcs.sql`, which
  must stay the last array entry (enforced by
  `tests/catalogueEligibilityConsistency.test.mjs`); the repair entry's
  comment now documents that invariant.
- `specs/platform/README.md` — new doc registered.
- Plugin (`plugins/pluradash`, separate repository):
  - `api/sync/logger.ts` — `scheduleSyncLog()` uses the cached level read
    (`getCachedSyncLogLevel`) instead of the uncached `refreshSyncLogLevel()`;
    rows written through a shared `createLogBuffer` batch insert;
    `toSyncLogRow()` extracted (reused by `logSyncOperation`); doc comments
    updated.
  - `plugin.json` — migration `027_sync_logs_retention.sql` appended.

## Impact Analysis

### Database

- No schema changes to existing tables. New objects: two stored functions
  (`public.cleanup_old_agent_logs`, `pluradash.cleanup_old_sync_logs`) and two
  pg_cron jobs. Read volume on `system_config` (logging) and
  `pluradash.admin_settings` drops sharply; `agent_logs` / `sync_logs` rows
  older than their retention windows are deleted daily in bounded batches.

### Runtime

- Config lookups: at most one REST call per isolate per 5 min (core) / 30 s
  (plugin). Staleness bounded by cache invalidation on settings writes.
- Log writes: up to 10 rows share one INSERT; a lost batch is retried once,
  then dropped with a console error. Logging never blocks or breaks requests.
- Mail queue: pending jobs wait up to 5 minutes for a delivery attempt
  (previously 1); retries/backoff contract unchanged.

### API Surface

- No route signatures or response shapes change. Log-viewer rows may appear
  with up to ~1 s delay (batch flush). `GET/PUT /admin/github/log-level`
  behaviour preserved (PUT force-refreshes the cache).

## Out of Scope

- Frontend REST query waterfall (5–7 unbatched Supabase GETs per page load) —
  a traffic consolidation/caching effort tracked separately; not part of the
  logging plan. Mitigated at the log level by the monitoring-path skip and
  batched writes.
