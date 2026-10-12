# Logging Audit — 12 October 2026

This document summarizes an internal audit of our application's logging behaviour
and the measures taken to reduce logging verbosity. It is intended as a general
reference of what was changed and why.

## Background

An analysis of Supabase log usage showed that a large share of the observed log
volume was self-generated: our application's own logging and configuration reads
each produced Supabase REST requests, which in turn appear in the Supabase edge
logs. In other words, logging was amplifying itself.

## Measures taken

1. **Cached configuration reads** — Logging and sync-log level configuration is
   now read via short-lived in-process caches instead of being re-fetched from
   the database on (nearly) every log write. Configuration writes invalidate the
   caches, so changes take effect promptly.

2. **Batched log writes** — Log rows are collected in memory and written to the
   database as a single batched insert (instead of one insert per event). This
   applies to request logging and to plugin sync logging alike.

3. **Cached auxiliary lookups** — Recurring slug-to-id lookups needed for log
   attribution are cached per process, removing repeated identical database
   reads from the request hot path.

4. **Skip rules** — High-frequency liveness and monitoring endpoints
   (health checks, pings) are no longer logged, as they carry no diagnostic
   value.

5. **Cron cadence tuning** — The mail-queue cron job was rescheduled from every
   minute to every 5 minutes and now reads its configuration in a single query
   per tick, reducing constant Postgres log noise.

6. **Automated retention** — Log tables (`agent_logs`, `sync_logs`) are cleaned
   up automatically via scheduled batched deletes (14-day and 30-day retention
   windows respectively), keeping storage growth bounded.

## Outcome

These changes remove the majority of previously redundant database round-trips
per logged event and reduce constant scheduler log noise, while keeping log data
available for diagnostics. The trade-offs are accepted and intentional: log
writes are best-effort (a small number of rows may be lost if a process dies
inside the short batching window), and queued mail may wait up to 5 minutes
instead of 1 minute for its delivery attempt.

Details of the individual changes are recorded in
[`changes/2026-10-12-logging-supabase-overage-reduction.md`](changes/2026-10-12-logging-supabase-overage-reduction.md)
and [`platform/logging-and-retention.md`](platform/logging-and-retention.md).
