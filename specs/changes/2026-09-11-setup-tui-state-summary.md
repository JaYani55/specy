# 2026-09-11 — Setup-TUI State Summary liest `deployment_state` (Plugin-aware)

## Summary

Der Status-Footer des Setup-TUI („Installation & deployment state“,
`scripts/setup.mjs` → `showStateSummary`) hat bisher ausschließlich die
**Legacy**-EAV-Store `system_config` (Namespace `core_update`) gelesen. Dieser
Store ist per Konstruktion core-only — Plugins wurden im Footer daher nie
gezählt („Migrations 70 recorded applied“ zählte nur `migration:*`-Keys,
„Worker commit — (never recorded)“). Der Footer liest jetzt primär die typisierte
Registry `public.deployment_state` (core- **und** Plugin-Zeilen) und zeigt
pro Plugin recorded Version, Migrationen, Bindings und Claims; die Legacy-Store
bleibt als Fallback (vor Migration / Tabelle fehlt) erhalten.

## Files Changed

- `scripts/lib/deployment-state.mjs` — neue pure Funktion
  `summarizeDeploymentRows(rows)`: aggregiert `readDeploymentState()`-Zeilen zu
  einem kompakten Summary-Objekt (core: Migrations-/Edge-Function-Counts,
  Worker-/Core-Commit; plugins: `{slug, version, migrations, bindings, claims}`).
- `scripts/setup.mjs` — `readRemoteDeployment()` liest primär
  `readDeploymentState` (+ `summarizeDeploymentRows`), mit Fallback auf
  `fetchCoreUpdateState` (Legacy-Shape, `plugins: []`);
  `showStateSummary()` rendert zusätzlich `Edge funcs` und pro Plugin eine
  `Plugin state <slug>`-Zeile bzw. einen Backfill-Hinweis
  (`npm run state:recheck --sync`), wenn die Registry leer ist.
  Folgerung (gleicher Tag): der TUI-Menüpunkt **Re-check deployment states**
  startete `state-recheck.mjs` ohne Argumente — also immer als Dry-Run. Jetzt
  fragt ein `p.select` zuerst den Modus ab: **Report only (dry-run)** oder
  **Repair (sync, `--sync`)**; Abbruch überspringt die Ausführung. Der Menü-Hint
  wurde entsprechend angepasst.
  Folgerung 2 (gleicher Tag): der Integrity Check führt zusätzlich einen
  Tooling-Test-Gate aus (`runIntegrityTests()` in `scripts/setup.mjs`) — die
  14 Suite-Dateien in `tests/`, die die geprüften Systeme abdecken (registries,
  bindings, claims, state, migrations, wrangler config), laufen per
  `node --test` mit gecapturetem Output; bei Erfolg eine Summary-Zeile, bei
  Fehlschlag ein kondensierter Report (betroffene Dateien + failing Tests)
  mit Verweis auf `npm test`. Timeout 120 s. Die Suite-Liste
  (`INTEGRITY_TEST_SUITES`) ist explizit statt glob-basiert, damit der Gate
  deterministisch und schnell bleibt; neue Tooling-Suiten werden dort ergänzt.
  Folgerung 3 (gleicher Tag): Git-Transparenz im State-Footer und eine
  Migrations-Guard im TUI:
  1. `readLocalState()` liefert jetzt `git: readGitStatus()` (Zweig, HEAD,
     Upstream, ahead/behind via `git rev-list --left-right --count
     HEAD...@{u}`); der Footer zeigt statt `Git head <sha>` die Zeile
     `Git <formatGitStatusLine(git)>` — inkl. `↓N behind <upstream>`, wenn der
     Checkout hinter dem Upstream-Branch liegt.
  2. Der TUI-Menüpunkt **Apply core migrations** prüft vor dem Delegieren an
     `migrate.mjs` auf uncommittete Migrations-SQL-Dateien
     (`git status --porcelain migrations/`, gefiltert auf `*.sql`); bei Treffern
     werden sie aufgelistet und ein Confirm (Default: Nein) verlangt. Begründung:
     eine angewendete, aber nicht committete Migration hinterlässt DB-State zu
     einer Datei, die ein Checkout verlieren kann — permanente Drift.
     Die CLI (`npm run migrations`) bleibt bewusst ohne Git-Gate.
- `tests/state.test.mjs` — 4 neue Tests für die Git-Helfer
  (`parseAheadBehind`, `parseUncommittedPaths`, `filterMigrationSqlChanges`,
  `formatGitStatusLine` inkl. Detached-HEAD und Windows-Pfadvarianten).
- `specs/platform/unified-setup-tui.md` — §5.5 um die neue Summary-Quelle
  ergänzt.

## Verhalten

- **Primärquelle** `public.deployment_state`: zählt `core`-Zeilen der
  Komponenten `migrations`/`edge_functions`, liest `worker/worker` →
  `commit`/`deployed_at` und `worker/core_commit` → `commit`; Plugin-Zeilen
  werden pro Slug gruppiert (`code` → Version, `migrations`/`bindings` →
  Counts, `claims` → Flag), sortiert nach Slug.
- **Legacy-Fallback** (vor `202609100001_deployment_state.sql` oder wenn die
  Tabelle fehlt): bisheriges Verhalten — `migration:*`-Count, `deployment:*`
  Commits, keine Plugin-Zeilen.
- Solange Plugin-Zeilen nicht recorded sind (Installer schreibt
  Migrations-State bewusst nicht, siehe Deviation 3 in
  `2026-09-10-deployment-state-tracking.md`), zeigt der Footer den
  Backfill-Hinweis; nach `state:recheck --sync` erscheint z. B.:
  `Plugin state pluradash · v1.4.2 · 24 migrations recorded · 3 bindings recorded`.

## Impact Analysis

- **Database:** nur Reads gegen `deployment_state` (bestehende
  `readDeploymentState`-Abfrage inkl. `plugins`-Join); keine Writes, keine
  Schema-Änderung.
- **Runtime/API surface:** keine Änderung an Worker-/API-Code; reines
  TUI-Tooling.
- **Verhalten:** der Footer zeigt Plugin-State aus derselben Quelle wie
  `state:recheck` — eine Quelle, ein Bild. Der Re-check-Menüpunkt fragt den
  Modus ab (Dry-Run schreibt nichts; Sync repariert wie `--sync` auf der CLI —
  inkl. Delete **staler Plugin-Zeilen**, daher explizite Modus-Wahl statt
  stiller Implizit-Aktion). Der Integrity Check meldet jetzt auch
  Tooling-Test-Failures direkt beim TUI-Start.
- **Sicherheit:** Read-Pfade unverändert (Supabase PAT, Service-Role). Der
  Test-Gate führt ausschließlich lokales `node --test` aus (kein Netzzugriff
  über die geprüften Suiten hinaus).
- **Tests:** `tests/deploymentState.test.mjs` 26/26 grün; `tests/state.test.mjs`
  5/5 grün (4 neu); `npm test` gesamt grün. Der Integrity-Test-Gate selbst ist
  Smoke-getestet (Pass-Pfad zählt korrekt; simulierter Fail-Pfad kondensiert
  Dateien + failing Tests). Live-Verifikation: `readGitStatus()`/
  `readUncommittedMigrations()` gegen den echten Checkout (dev @ afbea61,
  up to date; temporär angelegte untracked Migrations-Datei wird erkannt).
- **Nicht verifiziert:** Live-Durchlauf im TUI gegen das echte Projekt (PAT /
  interaktiv) — Rendering und Aggregation sind über einen direkten
  Funktions-Smoke-Test verifiziert.