# PluraDash: KI-Credits — Credit-System für KI-Kosten (1000 Credits = 10 $)

Date: 2026-10-25

## Summary

PluraDash-Plugin-Änderung (EUPL: separates Werk, verbindlich dokumentiert im
Plugin-Repository). Die KI-Übersicht (`/pluradash/ai`) zeigt bisher nur
akkumulierte KI-Kosten ohne provisioniertes Maximum. Neu:

1. **Credit-System:** 1000 Credits = 10 $ (1 Credit = 0,01 $; 100 Credits
   pro 1 $). Verbrauch wird live aus den tatsächlichen Kosten abgeleitet
   (`SUM(ai_allocations.cost_incurred) × 100` pro Benutzer) — nie gespeichert.
2. **Provisioniertes Maximum pro Benutzerkonto**
   (`pluradash.ai_credit_provisions`, Plugin-Migration 032): automatisch
   provisioniert über SECURITY-DEFINER-Trigger bei Kontoerstellung —
   neue Konten **mit** `support`-Rolle → 1000 Credits, **ohne** → 0 Credits
   („kein zugewiesener Wert", aber die Provision-Zeile existiert per Default
   für jedes neue Konto). Spätere `support`-Zuweisung hebt auf 1000 an;
   manuelle Anpassungen (`source = 'manual'`) werden nie überschrieben.
3. **Backfill für Bestandskonten** — SQL-Skript, bewusst **nicht** in den
   registrierten Migrationen, manuell auszuführen:
   `plugins/pluradash/migrations/backfill/2026-10-25_ai_credit_provisions.sql`
   (Bestand mit `support` → 1000 Credits, sonst → 0; idempotent).
4. **Dashboard:** Karte „KI-Credit-Kontingente" in `/pluradash/ai`
   (provisioniert / verbraucht / verbleibend pro Benutzer, Auslastungsbalken,
   Überziehungs-Warnung) + Credit-Entsprechung in „Gesamtkosten".
5. **API:** `GET /api/plugin/pluradash/ai/credits` (bearer-required,
   support/super-admin) — dokumentiert in `/admin/api` (`pluradash-ai-credits`).

## Files Added

- `plugins/pluradash/migrations/032_create_ai_credit_provisions.sql` (+ `down/032…`)
- `plugins/pluradash/migrations/backfill/2026-10-25_ai_credit_provisions.sql` (manuell, nicht registriert)
- `plugins/pluradash/api/aiCreditMath.ts` — reine Credit-Mathematik
- `plugins/pluradash/api/aiCredits.ts` — Datenzugriff
- `plugins/pluradash/specs/changes/2026-10-25-ai-credit-provisioning.md` — verbindlicher Plugin-Änderungsdatensatz
- `tests/pluradashAiCredits.test.mjs` — 5 Regressionstests

## Files Changed

- `plugins/pluradash/plugin.json` — Migration 032 registriert; api_metadata-Route `pluradash-ai-credits`; Capability `pluradash-ai-credits`
- `plugins/pluradash/api/index.ts` — Endpunkt `GET /ai/credits`
- `plugins/pluradash/src/services/pluradashService.ts` — `fetchAiCredits()` + Typen
- `plugins/pluradash/src/pages/AiPage.tsx` — KI-Credit-Kontingente-Karte

## Impact Analysis

### Database

- Plugin-Migration 032 (idempotent, mit Downmigration): Tabelle
  `pluradash.ai_credit_provisions` im Plugin-Schema, RLS (Owner + support/
  super-admin lesen; super-admin schreibt), SECURITY-DEFINER-Trigger-
  Funktionen im Plugin-Schema.
- **Core-Plugin-Grenze:** Die zwei Trigger hängen als einzige Plugin-Objekte
  an Core-Tabellen (`public.user_profile` INSERT, `public.user_roles`
  INSERT) — Precedent: KB-Sync-Trigger (entfernt mit Migration 010). Dies
  ist der einzige Mechanismus, um auf Konto-/Rollen-Erstellung zu reagieren,
  da die Core-Kontoerstellung keinen Plugin-Hook anbietet. Die Trigger
  schreiben ausschließlich in die Plugin-Tabelle und sind idempotent.
- Backfill: kein registrierter Migrationsschritt; manuelle Ausführung nach 032.
- Keine Core-Migration nötig.

### Runtime

- Trigger-Overhead: ein zusätzlicher idempotenter INSERT pro
  Kontoerstellung bzw. Rollenzuweisung.
- `GET /ai/credits`: drei RLS-gescopete Queries pro Request.

### API surface

- Neu im Plugin-Scope: `GET /api/plugin/pluradash/ai/credits`
  (200; 401/403 ohne Rolle). Keine Core-API-Änderung.

## Compliance

- **EUPL / Core-Plugin-Grenze:** Keine Core-Dateien (`src/`, `api/`,
  `migrations/`) verändert; alle Änderungen im Plugin-Repo
  `plugins/pluradash` (separates Git-Repository, MIT-lizenziert). Die
  öffentliche Tabelle `public.user_profile`/`public.user_roles` wird nur
  per Trigger beobachtet (siehe oben, dokumentiert).
- **Dokumentation:** Verbindlicher Änderungsdatensatz im Plugin-Repo
  (`specs/changes/2026-10-25-ai-credit-provisioning.md`); dieser Eintrag
  spiegelt für den Core-Kontext wider.
- **Tests:** `npm test` grün (558 Tests, inkl. neuer Credit-Tests),
  `npm run typecheck` und `npm run build` erfolgreich;
  `typecheck:api` für die berührten Plugin-API-Dateien fehlerfrei
  (vorbestehende Plugin-Fehler unverändert).

## Operator notes

1. Plugin-Migrationen anwenden (erstellt Tabelle + Trigger für neue Konten).
2. **Backfill manuell ausführen:**
   `psql $DATABASE_URL -f plugins/pluradash/migrations/backfill/2026-10-25_ai_credit_provisions.sql`
3. Kontingente prüfen: `SELECT source, credits_total, count(*) FROM
   pluradash.ai_credit_provisions GROUP BY 1, 2;`
