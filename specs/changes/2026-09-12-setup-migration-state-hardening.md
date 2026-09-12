# 2026-09-12 — Setup-, Migrations- und State-Tooling-Härtung (Pre-Prod-Review)

## Summary

Risikoreview vor dem ersten `dev → main`-Merge. Vier gefährliche
Sollbruchstellen im Migration-/State-Tooling behoben, zwei
Sicherheitsverhalten entschärft, Dokumentations-Drift beseitigt:

1. **Checksummen sind ab jetzt EOL-unabhängig.** Migration-/Edge-Function-
   Checksummen werden vor dem SHA-256 auf LF normalisiert
   (`normalizeSqlEol`). Vorher meldete ein Windows-Checkout
   (`core.autocrlf = true`, CRLF on disk) False-Drift für jede Migration,
   die von einem LF-Checkout (CI/Linux) recorded wurde — und umgekehrt.
   Betroffen: `buildMigrationManifest`, `buildFunctionManifest` und die
   Plugin-Migrations-Hashes in `state-recheck.mjs`.
2. **Bootstrap-Guard in `migrate.mjs`.** Vorher wurde bei leerem
   Remote-State das komplette Manifest als "applied" recorded, ohne
   irgendetwas anzuwenden — auf einer tatsächlich hinterherlaufenden
   Instanz wurden nie gelaufene Migrationen stillschweigend als erledigt
   markiert. Jetzt: der Live-Schema wird per `information_schema` abgefragt;
   Migrationen, deren erzeugte Tabellen sämtlich fehlen, werden **nicht**
   gebaseline, sondern regulär angewendet (`planBaseline()` in
   `core-update.mjs`, pure + getestet). Prompt-Texte unterscheiden jetzt
   "leeres Schema" vs. "existierendes Setup".
3. **Write-after-confirm im First-Time-Setup.** `stepMigrations()` recordet
   jetzt nach jedem erfolgreich angewendeten Migration-File den
   Deployment-State (gepuffert, Flush nach dem Loop — `system_config`
   existiert erst nach einer frühen Migration in der Order). Übersprungene
   Migrationen werden **nicht** recorded und mit konkretem
   `--replay`-Nachholbefehl gemeldet. Damit richtet sich ein frisches Setup
   nie mehr selbst als "vergessen" ein (Bootstrap-Falle).
4. **`state:recheck --sync` bestätigt Core-Drift pro Zeile** bevor der
   lokale Wert als Wahrheit re-recorded wird (Non-Interactive: Core-Drift
   bleibt unverändert mit Warnung). Plugin-Drift wird weiterhin automatisch
   re-recorded (lokal erzeugte Wahrheit). Der bisher falsche Hinweis
   `--force <file>` wurde zu `--replay <file>` korrigiert.
5. **Snapshot-Restore warnt vor Nicht-Atomarität** (im Prompt und in
   `specs/platform/db-snapshots.md` §4.1 mit empfohlenem Ablauf).
6. **Dokumentations-Drift:** AGENTS.md §5 und `.pi/skills/tests/SKILL.md`
   verweisen jetzt auf `scripts/lib/migration-order.mjs` →
   `MIGRATION_ORDER_CORE` (nicht mehr auf das alte `scripts/setup.mjs`).

Kleinigkeiten: `dbSnapshots`-Suite in den TUI-Integrity-Testkatalog
aufgenommen; `setup.mjs` meldet Sub-Prozess-Fehlexits jetzt im Menü
(`p.log.error`) statt sie nur über stdio sichtbar zu machen.

## Files Added

- `specs/changes/2026-09-12-setup-migration-state-hardening.md` (dieses Dokument)

## Files Changed

- `scripts/lib/core-update.mjs` — `normalizeSqlEol()` (exportiert),
  Checksummen-Normalisierung in `buildMigrationManifest` +
  `buildFunctionManifest`; neu: `migrationCreatedTables()`, `planBaseline()`.
- `scripts/migrate.mjs` — Bootstrap-Zweig: Schema-Probe, `planBaseline`,
  getrennte Baseline/Pending-Pfade, State-Recording-Fehler-Guard,
  `canRecordState` nur wenn `system_config` existiert.
- `scripts/lib/first-time-setup.mjs` — `stepMigrations()`: State-Buffer +
  Flush (`upsertCoreUpdateRecords`), Skip-Tracking mit `--replay`-Hint,
  Abort recordet bereits angewendete Migrationen.
- `scripts/state-recheck.mjs` — `partitionDriftByOwner()` (exportiert),
  per-Zeile-Bestätigung für Core-Drift, `--replay`-Hint korrigiert,
  Plugin-Migrations-Checksummen EOL-normalisiert.
- `scripts/snapshots.mjs` — Nicht-Atomaritäts-Warnung im Restore-Confirm.
- `scripts/setup.mjs` — `dbSnapshots` in `INTEGRITY_TEST_SUITES`;
  `nodeScript()` meldet Fehlexits im TUI.
- `AGENTS.md`, `.pi/skills/tests/SKILL.md` — Migration-Order-Pfad korrigiert.
- `specs/platform/db-snapshots.md` — §4.1 „Restore safety — non-atomicity".
- `tests/updateTooling.test.mjs` — 3 neue Tests (EOL-Parität, `planBaseline`,
  Checksummen-Parität Wizard ↔ Manifest).
- `tests/state.test.mjs` — neuer Test für `partitionDriftByOwner`.

## Impact-Analyse

- **Datenbank:** Keine Schema-Änderung. Keine neuen Migrationen.
- **Runtime:** Nur Operator-Tooling (`scripts/`), kein Worker-/Frontend-Code.
- **API-Surface:** Unverändert.
- **Kompatibilitätshinweis:** Durch die EOL-Normalisierung ändern sich alle
  berechneten Checksummen. Bestehende Instanzen, deren State mit dem alten
  (rohen) Hash recorded wurde, melden beim nächsten Re-Check Drift —
  einmalig `state:recheck --sync` (Core-Drift pro Zeile bestätigen)
  konvertiert die Rows auf die normalisierten Hashes. Der passende Zeitpunkt
  dafür ist genau jetzt, vor dem Prod-Merge, solange noch kein State
  recorded ist.

## Tests

- `npm test` — alle Suiten grün (inkl. 4 neuer Testfälle).
- `npm run typecheck`, `npm run build` — grün.
- `node scripts/migrate.mjs --dry-run` — Smoke (wartet erwartungsgemäß auf
  PAT, kein Crash).
