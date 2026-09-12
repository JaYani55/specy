# 2026-09-11 — Mail-Queue Cron Gate (Idle-Invocation Skip)

## Summary

Der pg_cron-Job `mail-queue-processor` (Migration 202609070001) feuerte den
`send_email` Edge Function **jede Minute** (`* * * * *`) — auch bei komplett
leerer Queue. Das ergibt exakt 1.440 Invocations/Tag, von denen praktisch alle
einfach `reclaimedOnly: true` zurückgaben. Die neue Migration
`202609110001_mail_queue_cron_gate.sql` ersetzt
`public.trigger_mail_queue_processing()` durch eine Variante mit
Work-Presence-Gate: der HTTP-POST an den Edge Function findet nur noch statt,
wenn tatsächlich Arbeit ansteht.

## Files Added

- `migrations/202609110001_mail_queue_cron_gate.sql` — `CREATE OR REPLACE
  FUNCTION public.trigger_mail_queue_processing()` mit Gate; idempotent.
- `specs/changes/2026-09-11-mail-queue-cron-gate.md` (dieses Dokument).

## Files Changed

- `scripts/lib/migration-order.mjs` — Migration am Ende der Kette
  registriert (nach `202609100002`; Abhängigkeiten: `202609070001` legt
  Funktion + Cron-Schedule an, `mail_delivery.sql` legt `mail_delivery_jobs`
  an). Wird von `scripts/setup.mjs` (MIGRATION_ORDER) und
  `tests/coreMigrations.test.mjs` über `MIGRATION_ORDER_CORE` bezogen.

## Verhalten

Der Cron-Tick (weiterhin jede Minute, Latenz für echte Mails unverändert)
führt jetzt vor dem POST aus:

1. **Due pending jobs?** `status = 'pending' and (next_attempt_at is null or
   next_attempt_at <= now())`
2. **Stale processing jobs?** `status = 'processing' and last_attempt_at <
   now() - interval '5 minutes'` — spiegelt `PROCESSING_STALE_MS = 5 min`
   bzw. die `reclaimStaleProcessingJobs()`-Query in
   `functions/send_email/index.ts` (Reclaim-Fenster exakt identisch).

Nur wenn eines der beiden zutrifft, wird `net.http_post(... mode:
'process-pending' ...)` ausgeführt; sonst beendet sich der Tick nach zwei
indexierten EXISTS-Checks. Effekt auf ruhenden Projekten: die
Edge-Function-Invocations sinken von 1.440/Tag auf ~0 (plus reale
Deliveries), der Scheduler-Overhead bleibt ein SQL-SELECT pro Minute.

## Impact Analysis

- **Database:** nur `CREATE OR REPLACE FUNCTION` auf bestehender Signatur —
  idempotent, kein Schema-/Daten-Change. Der Cron-Schedule bleibt unverändert
  bei `202609070001` registriert. Keine Downmigration nötig (Core-Migration;
  Rollback = alter Funktionskörper aus 202609070001 re-anwenden, der dort
  idempotent per `create or replace` steht).
- **Runtime/API surface:** keine Änderung an `functions/send_email/index.ts`
  oder Worker-Code; der Edge Function-Kontrakt bleibt identisch. Dadurch, dass
  Idle-Ticks den Function nicht mehr erreichen, ändert sich an dessen
  Verhalten nichts — auch das Stale-Reclaim trifft den Function jetzt nur,
  wenn wirklich stale Jobs existieren (vorher ebenfalls, nur öfter).
- **Verhalten:** E-Mails behalten ihre ≤1-Minuten-Queue-Latenz; Retries mit
  `next_attempt_at` werden erst nach Fälligkeit invociert (vorher auch
  sinnlos vor der Fälligkeit). `deliver-job`-Direktaufrufe (Form-Submit,
  Retry, Test-Connection) sind von der Gate unabhängig und unverändert.
- **Sicherheit:** keine neuen Privilegien; Funktion bleibt `security definer`
  mit gleichem `search_path`. Keine Secrets im Gate.
- **Tests:** `tests/coreMigrations.test.mjs` validiert die neue Position in
  der Dependency-Kette (referenziert `public.mail_delivery_jobs` → nach
  `mail_delivery.sql`); `npm test` gesamt 206/206 grün.
- **Nicht verifiziert:** Live-DB-Durchlauf (Funktion neu anwenden und
  Cron-Tick beobachten) — SQL-Körper ist 1:1 aus der bestehenden, in Produktion
  laufenden Funktion abgeleitet und nur um die EXISTS-Gates erweitert.