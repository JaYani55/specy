# 2026-08-31 — PluraDash Sync-Log Fix + Verbosity-Settings

## Summary

Das Sync-Operation-Logging (`pluradash.sync_logs`, sichtbar unter
`/admin/github-apps` → „Sync Logs“) schrieb keine Zeilen. Ursache: Alle
`logSyncOperation`-Aufrufe liefen als Fire-and-forget (`void promise`). Auf
Cloudflare Workers werden Promises, die nach dem Zurückgeben der Response noch
ausstehen, abgebrochen — der Supabase-Insert wurde also in der Regel nie
ausgeführt. Das Projekt nutzt an anderer Stelle bereits korrekt
`ctx.waitUntil()` (z. B. `api/lib/queueHooks.ts`); der Sync-Logger tat das
nicht.

Zusätzlich wurde ein Verbosity-System eingeführt, über das sich die Tiefe des
Loggings per Env-Var steuern lässt (Debugging jetzt aktivierbar, später
deaktivierbar, ohne Codeänderung).

### Verbosity: `PLURADASH_SYNC_LOG_LEVEL` (Env-Override) + UI-Einstellung

Die Detailtiefe lässt sich auf zwei Wegen steuern:

1. **Runtime über die UI (empfohlen):** GitHub Apps Admin-Panel
   (`/admin/github-apps`) → Tab „Sync-Logs“ → Karte „Protokoll-Detailtiefe
   (Verbosity)“. Speichert `pluradash.admin_settings.sync_log_level` via
   `PUT /api/plugin/pluradash/admin/github/log-level` und wirkt nach spätestens
   30 s (Cache-TTL) auf alle neuen Log-Writes.
2. **Env-Var `PLURADASH_SYNC_LOG_LEVEL`** (`off` | `basic` | `verbose`) —
   expliziter Override, der die gespeicherte Einstellung **überschreibt**.
   Bei aktivem Override liefert `PUT` 409 und die UI zeigt einen Hinweis und
   deaktiviert die Auswahl. Leerer Wert (`""`) = keine Override, gespeicherte
   Einstellung gilt.

| Level | Verhalten |
|---|---|
| `off` | Gar keine Zeilen in `pluradash.sync_logs`. |
| `basic` | Default. Eine Zeile pro Sync-Operation. |
| `verbose` | Zusätzliche Trace-Zeilen (Auth-Denials 401/403, Validierungs-Exits wie „workspaceId is required“), angereicherte Details (Dateilisten mit Sizes bei `save`, komplette Diff-Pfadlisten bei `push`, Error-Stacks, Quota-Mathematik) und Console-Debug-Output für `wrangler tail`. |

Unbekannte/fehlende Werte fallen auf `basic` zurück. Die Variable ist in
`plugins/pluradash/plugin.json` (`wrangler_bindings.vars`) registriert und wird
von `ensure-registry.mjs` automatisch in `wrangler.jsonc` injiziert.

## Files Added

- `plugins/pluradash/migrations/023_create_admin_settings.sql` — global
  Key/Value-Settings-Store (`pluradash.admin_settings`, RLS: Super-Admin),
  Seed: `sync_log_level = 'basic'`. **Muss in `MIGRATION_ORDER` / beim
  Plugin-Setup angewendet werden** (inkl. Downmigration
  `migrations/down/023_create_admin_settings.sql`).

## Files Changed

- `plugins/pluradash/api/sync/logger.ts`
  - `SyncLogLevel` (`off` | `basic` | `verbose`) + `resolveSyncLogLevel(env)`.
  - Neues `scheduleSyncLog(context, entry)`: schreibt Log-Zeilen über
    `executionCtx.waitUntil()` (Workers-safe) mit Fallback auf Inline-Await
    außerhalb von Workers; filtert Zeilen über dem konfigurierten Level.
  - `debugSync(env, scope, message, detail)`: verbose-gated Console-Logging
    (sanitized) für `wrangler tail`.
  - `logSyncOperation` bricht bei Level `off` sofort ab.
- `plugins/pluradash/api/sync/routes.ts`
  - Alle `recordLog`-Call-Sites nutzen jetzt `scheduleSyncLog` mit dem Hono
    Context statt `void logSyncOperation(...)` — **das ist der eigentliche Fix**.
  - Neue Middleware: loggt in `verbose` alle Sync-Requests, die ohne
    Handler-Log enden (Auth-Denials, Validierungs-400er) als Trace-Zeilen
    (`detail.trace = true`), ohne Duplikate (Handler setzen Flag
    `syncLogRecorded`).
  - Verbose-Anreicherung: `save` loggt Batch (Pfad/Bytes/deleted), `push`
    komplette Diff-Pfadlisten, alle Error-Pfade zusätzlich Error-Name/-Stack.
  - `PLURADASH_SYNC_LOG_LEVEL` im `SyncEnv`-Bindingstyp deklariert.
- `plugins/pluradash/api/index.ts`
  - 7 Fire-and-forget-Call-Sites (`app.launch`, `repo.assign`,
    `repo.unassign`, `logs.cleanup`) auf `scheduleSyncLog(c, …)` umgestellt.
  - Neu: `GET /admin/github/log-level` (effektiver Level + Quelle) und
    `PUT /admin/github/log-level` (Level speichern; 409 bei aktivem
    Env-Override). Änderungen werden als `logs.level`-Zeile protokolliert.
- `plugins/pluradash/api/sync/engine.ts`
  - `ensureQuota` gibt im Verbose-Modus die exakte Quota-Mathematik aus
    (`quotaBytes` / `usedBytes` / `remainingBytes` / `bytesToAdd`) — wichtig
    für die Diagnose von falschen „Storage quota exceeded.“-Fehlern durch
    veraltete `used_bytes_cached`-Werte oder Zero-Quota-Allocation-Zeilen.
- `plugins/pluradash/plugin.json`
  - `PLURADASH_SYNC_LOG_LEVEL: ""` in `wrangler_bindings.vars` (registriert,
    aber leer — die UI-Einstellung gilt; Wert setzen = harter Override).
- `plugins/pluradash/src/services/githubAppService.ts`
  - `fetchSyncLogLevel()` / `updateSyncLogLevel(level)` + Typen.
- `plugins/pluradash/src/pages/admin/GitHubAppsAdminPage.tsx`
  - Sync-Logs-Tab: Karte „Protokoll-Detailtiefe (Verbosity)“ mit Auswahl
    Aus/Standard/Verbose; bei Env-Override deaktiviert + Hinweistext.

## Impact Analysis

- **Database:** neue Tabelle `pluradash.admin_settings` (Migration 023, RLS:
  Super-Admin, Seed `sync_log_level='basic'`). `pluradash.sync_logs`
  (Migration 022) bleibt unverändert; Trace-Zeilen nutzen dieselben Spalten
  (`status: 'denied'|'error'`, `detail.trace: true`).
- **Runtime:** Log-Writes laufen jetzt über `waitUntil()` und blockieren die
  Response nicht; fehlgeschlagene Log-Writes bleiben Best-Effort (brechen die
  Operation nie). Bei Level `basic` entsteht kein zusätzliches Schreibvolumen.
- **API surface:** keine Änderungen an den Sync-Endpunkt-Verträgen. Neu:
  `GET/PUT /api/plugin/pluradash/admin/github/log-level` (Super-Admin).
