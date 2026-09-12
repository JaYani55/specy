# 2026-09-12 — State-Sync Plugin-Registrierung & Migrations-Idempotenz (Fix-Pass)

## Summary

Drei Fehler, die beim ersten echten Prod-Catch-up (dev → main Merge,
`state:recheck --sync` gegen eine Bestandsinstanz) sichtbar wurden:

1. **`state:recheck --sync` crashte bei Plugin-Rows ohne `public.plugins`-Zeile.**
   Plugin-State-Rows lösen `plugin_id` per
   `select id from public.plugins where slug = …` auf. Für Plugins, die vor dem
   Installer-Registrierungsschritt eingerichtet wurden (hier: pluradash), ist das
   Ergebnis NULL → `deployment_state_owner_check`-Violation → die gesamte Sync-
   Backfill-Anweisung scheiterte mit Exception (Werkzeug-Abbruch, Core-Rows der
   selben Anweisung bereits geschrieben).
2. **`migrations/202608020001_schema_frontend_targets.sql` war nicht idempotent.**
   Der erste Backfill-Insert (`'default'` Detail-Page-Target) hatte nur
   `on conflict (schema_id, target_key)` — ein Schema, das bereits eine
   enabled+primary-Row mit *anderem* target_key besaß (z. B. per RPC auf der
   Live-Instanz erzeugt), verletzte den Partial-Unique-Index
   `schema_frontend_targets_primary_unique` → `migrate.mjs` brach die komplette
   Pending-Kette ab. Jetzt: zusätzliches `not exists`-Guard auf
   „Schema hat bereits eine enabled+primary-Row beliebigen Keys“.
3. **Obsoler Legacy-State-Restposten.** Vier Rows im alten `core_update`-Format
   (`deployment:functions`, `deployment:core_commit`, `core_commit`, `deployed`)
   bleiben nach der Taxonomie-Migration als „stale“ stehen — Sync löscht Core-Rows
   grundsätzlich nie (Doktrin). Manuelles Aufräumen (optional, rein kosmetisch):

   ```sql
   delete from public.deployment_state
   where owner_kind = 'core'
     and (
       (component = 'edge_functions' and key in ('deployment:functions', 'deployed'))
       or (component = 'worker' and key in ('deployment:core_commit', 'core_commit'))
     );
   ```

   (Bewusst kein Auto-Delete im Tooling: die Report-only-Doktrin für Core-Rows
   bleibt unverändert.)

### Verhaltensänderung im Sync

`applySync()` stellt jetzt **vor** jedem State-Write sicher, dass jedes in
unrecorded/drifted Rows referenzierte Plugin in `public.plugins` registriert ist
(`ensurePluginsRegistered` — nutzt `manifest.repository` als `repo_url`, wie der
Installer). Fehlende `repo_url` und fehlgeschlagene Plugin-Backfills sind
**Warnungen statt Abbrüche** — Core-Rows werden weiterhin recorded, ein Re-Run
setzt fort (alle Writes sind idempotente Upserts). Das entspricht der
State-Write-Fehlertoleranz, die `migrate.mjs` bereits hat.

## Files Changed

- `scripts/lib/deployment-state.mjs` — neu: `buildPluginRegistrationSql()`
  (pure, exportiert; wirft ohne `repo_url`, da
  `plugins_kind_url_consistency` sonst die Row zurückweist).
- `scripts/state-recheck.mjs` — `ensurePluginsRegistered()` vor dem Backfill;
  Backfill- und Plugin-Drift-Writes in try/catch (Warnung statt Crash).
- `migrations/202608020001_schema_frontend_targets.sql` — `not exists`-Guard am
  ersten Backfill-Insert (echte Idempotenz; die Checksumme ändert sich → einmalig als
  Drift gemeldet, per `--sync` bestätigen oder `npm run migrations -- --replay`).
- `tests/pluginRegistration.test.mjs` — 3 Regressionstests (Repo-URL-Pflicht,
  `on conflict do nothing`, Versions-Fallback).

## Impact-Analyse

- **Datenbank:** Keine Schema-Änderung; der Migrations-Edit macht einen
  Bestands-Migration-File idempotent (AGENTS.md §5), keine neue Migration,
  `MIGRATION_ORDER_CORE` unverändert.
- **Runtime/API surface:** Keine (nur Operator-Tooling).
- **Kompatibilität:** Der Migrations-Edit ändert die Checksumme von
  `202608020001` — Instanzen, die den alten Stand recorded haben, sehen einmalig
  Drift für genau diesen File (per `--sync` bestätigen oder `--replay`).
  Auf der Bestandsinstanz, auf der der File nie sauber lief, ist der neue Stand
  der erste recorded.

## Tests

- `npm test` — 266 Tests grün (3 neu).
- `npm run build` — grün (inkl. typecheck).
- Nicht live verifiziert: Sync-Lauf gegen eine Bestands-DB ohne registriertes
  Plugin (die reproduzierende Konstellation) — der Fix ist durch Unit-Tests des
  SQL-Builders + try/catch-Toleranz abgedeckt; der nächste reale Sync validiert.
