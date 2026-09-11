# 2026-09-11 — State Re-check: Anchor-Field Drift Semantics

## Summary

Fix der Drift-Klassifikation in `npm run state:recheck`: Zeilen werden jetzt
nur noch anhand ihres **stärksten beidseitig vorhandenen Ankerfelds**
(Präzedenz `checksum` > `version` > `commit`) als „drifted“ eingestuft, und der
Report zeigt das tatsächlich abweichende Feld samt Werten statt eines
Checksum-Fallbacks.

Vorher trug jede Core-Migrations-/Edge-Function-Zeile lokal `commit: <git head>`.
Da `isDrifted()` alle drei Felder kumulativ verglich, markierte **jeder Commit
ins Repo (auch reine Dokumentations-Commits) sämtliche Migrations-Zeilen als
„drifted“** — obwohl der SQL-Inhalt (Checksum) byte-identisch war. Der Report
druckte nur die Checksummen, sodass identische Hashes als Drift erschienen
(`5e5578… → 5e5578…`). `--sync` re-recordete daraufhin 70 Zeilen, die beim
nächsten Commit sofort wieder „drifteten“ — der Report war in einem aktiv
entwickelten Repo nie konvergent.

## Files Changed

- `scripts/lib/deployment-state.mjs` — neue exportierte Funktion
  `driftFields(local, recorded)` (Ankerfeld-Präzedenz, uncomparabel → kein
  Drift); `isDrifted()` delegiert darauf.
- `scripts/state-recheck.mjs` — Drift-Report zeigt pro Zeile die abweichenden
  Felder (`checksum: <rec> → <local>`, Werte auf 12 Zeichen gekürzt) statt des
  bisherigen `checksum ?? version ?? commit`-Fallbacks.
- `tests/deploymentState.test.mjs` — 6 neue Regressionen (Commit-Move ≠ Drift
  bei Content-Anker, Checksum-Drift, Commit-Drift nur für commit-only-Zeilen,
  Version-Drift für Plugin-`code`, Anker-Präzedenz).
- `specs/plans/DEPLOYMENT-STATE-TRACKING.md` — drifted-Definition auf
  Ankerfeld-Semantik aktualisiert.
- `specs/platform/unified-setup-tui.md` — §5.5 um Drift-Semantik ergänzt.

## Verhalten

- **migrations / edge_functions** (Checkpoint `checksum`): Content-Anker. Ein
  bewegter Git-Head allein ist **kein** Drift mehr; nur geänderter Dateiinhalt
  driftet.
- **plugin `code`** (Checkpoint `version`): drifitet auf Version.
- **worker** (nur `commit`): drifitet weiterhin auf Commit — dort ist „welcher
  Build läuft live?“ die relevante Frage.
- Fehlt das stärkere Feld auf einer Seite, fällt der Vergleich auf das nächste
  Ankerfeld durch; ist kein Feld beidseitig vorhanden, konvergiert die Zeile
  (wie bisher bei `auth_hook`).
- Der Drift-Report nennt jetzt das Feld und die (gekürzten) Werte — z. B.
  `migrations preamble.sql  commit: 9f2a44b… → afbea61…` bzw. bei echtem
  Content-Drift `checksum: 5e5578… → f09df83…`.

## Impact Analysis

- **Database:** keine Schema-Änderungen; `--sync`-Upserts unverändert
  idempotent (`ON CONFLICT DO UPDATE`).
- **Runtime/API surface:** keine Änderung an Worker-/API-Code; reines
  Tooling-Verhalten.
- **Verhalten:** `state:recheck` (dry-run und `--sync`) klassifiziert
  content-anchored Zeilen nach Checksum; nach einem `--sync` bleibt der Report
  konvergent, bis sich tatsächlich Inhalte ändern.
- **Sicherheit:** keine neuen Writes/Reads; gleiche PAT-/Service-Role-Pfade.
- **Tests:** `tests/deploymentState.test.mjs` (23, davon 6 neu) grün;
  `npm test` gesamt 199 grün; `npm run build` (inkl. Typecheck) erfolgreich.
- **Nicht verifiziert:** Live-Durchlauf gegen das echte Supabase-Projekt
  (`--sync`) — die Klassifikation ist unit-getestet, der DB-Rundlauf der
  Recheck-Ausgabe nach dieser Änderung wurde nicht live ausgeführt.