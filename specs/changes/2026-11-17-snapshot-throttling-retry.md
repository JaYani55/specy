# Snapshot tooling — Management API throttling retry

Date: 2026-11-17

## Summary

`npm run snapshots` (and the `npm run setup` → DB Snapshots menu) failed with
`HTTP 429: ThrottlerException: Too Many Requests` while creating a snapshot.
The snapshot dump issues one Management API request per table page
(`select * … limit/offset` for every base table in every application schema —
roughly 100 tables in a populated project). The Supabase Management API
rate-limits such bursts, and `runSqlQuery` had no retry logic: a single 429
aborted the entire snapshot run.

`runSqlQuery` in `scripts/lib/remote-sql.mjs` now retries throttled/transient
responses with exponential backoff:

- **Retried statuses:** `429` (throttled) and `5xx` (transient platform errors).
- **Backoff:** honours the server's `Retry-After` header (seconds, capped at
  30 s) when present, otherwise exponential — 1 s, 2 s, 4 s, 8 s, 16 s, capped
  at 30 s.
- **Attempts:** up to 6 tries per query before the error propagates.
- Each retry logs `Management API 429 (…) — retry n/5 in Xs…` so the operator
  sees the slowdown.

Because every Management API consumer in the repo (`snapshots.mjs`,
`migrate.mjs`, `install-plugins.mjs`, `cf-update.mjs`, `provision-bindings.mjs`,
`auth-diagnostics.mjs`, `update-plugins.mjs`) goes through `runSqlQuery`, they
all inherit the retry behaviour. No call site was changed.

## Files Changed

- `scripts/lib/remote-sql.mjs` — `runSqlQuery` retry loop; new exported
  `sqlRetryDelayMs(attempt, retryAfterHeader)` helper (pure, unit-tested);
  local `sleep` + `isRetryableSqlStatus` helpers.
- `tests/dbSnapshots.test.mjs` — new `sqlRetryDelayMs` describe block
  (exponential curve, 30 s cap, `Retry-After` handling, invalid-header
  fallback).

## Files Added

- `specs/changes/2026-11-17-snapshot-throttling-retry.md` (this record)

## Impact Analysis

### Database

None. No SQL or migration changes; the retry only affects the tooling client.

### Runtime

Snapshots that hit the rate limit now slow down and complete instead of
aborting after ~90 tables. Worst-case added wall time per query is ~30 s × 5
retries; normal runs (no throttling) are unchanged — no artificial delay is
added to successful requests.

### API surface

None. `sqlRetryDelayMs` is a new export of the internal script library
(`scripts/lib/`), not part of the Worker API.
