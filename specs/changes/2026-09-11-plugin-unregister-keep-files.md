# 2026-09-11 — Plugin-Entfernung im TUI + Unregister-Modus (`--keep-files`)

## Summary

Zwei Probleme:

1. Der TUI-Menüpunkt **Remove a plugin** startete
   `scripts/uninstall-plugin.mjs` ohne Plugin-ID — der CLI-Skript druckte nur
   seine Usage und tat nichts.
2. Es gab keinen Weg, ein Plugin **sauber abzumelden, ohne lokale Dateien zu
   löschen** (gewünscht: später re-installierbar). Da die generierten
   Registries (`src/plugins/registry.ts`, `api/plugin-routes.ts`, …) aus
   *jedem* `plugins/<dir>` mit Manifest gebaut werden, reicht das Entfernen
   aus `plugins.json` nicht — das Verzeichnis muss aus `plugins/` raus.

## Files Changed

- `scripts/uninstall-plugin.mjs` — neuer Modus `--keep-files`:
  - Verschiebt `plugins/<id>/` nach `plugins/.uninstalled/<id>/` (gitignored
    via `plugins/*/`) statt es zu löschen; bricht ab, wenn der Move nicht
    gelingt (nichts wird dann unregistered).
  - Rest voll identisch zum Full-Uninstall: `plugins.json`-Eintrag, Registry-
    Rebuild (entfernt auch Wrangler-Bindings), `plugin-deps.json`, Deployment-
    State-/Claims-Rows, DB-Status → `registered`, Downmigrations-Angebot
    (interaktiv, Default Nein), Ledger-Hinweis.
  - `--prune-deps` wird im Keep-Files-Modus ignoriert (Warnung) — die
    npm-Pakete bleiben installiert, damit der Re-Install ohne Neu-Download
    funktioniert.
  - Summary „Re-install later": `mv plugins/.uninstalled/<id> plugins/<id>`
    + `npm run build`.
- `scripts/setup.mjs` — **Remove a plugin** fragt jetzt per `p.select` erst
  das Plugin (Workspace- + Source-Plugins, mit Verzeichnis/Version als Hint,
  Info wenn nichts installiert) und dann den Modus: **Unregister (keep
  files)** oder **Full uninstall (delete files)**; Abbruch überspringt.
  Menü-Hint entsprechend angepasst.
- `specs/plugins/installation.md` — §10 um den `--keep-files`-Modus und den
  Re-Install-Pfad ergänzt.
- `specs/platform/unified-setup-tui.md` — §2-Tabelle (Remove-Zeile) aktualisiert.

### Nachtrag: Windows `EBUSY`-Handling beim Move

Der erste Live-Lauf schlug mit `EBUSY: resource busy or locked` fehl — unter
Windows scheitert `rename()` an Verzeichnissen, in denen *irgendein* offener
File-Handle steckt (Editor-File-Watcher, laufendes `npm run dev`, Indexer).
Neuer Helfer `moveDirKeepFiles(src, dest)`:

1. `rename` mit 5 Retry-Versuchen (steigendem Delay) — EBUSY/EPERM/EACCES/
   EXDEV sind häufig transient
2. Fallback: rekursives `cp` (force, verträgt Read-Handles und überschreibt
   partielle Reste früherer Versuche) + `rm` des Originals mit Retries
3. Schlägt selbst das Delete fehl: Best-Effort-Rückbau der Kopie (mit
   Retries + Warnung bei Restbestand) und Throw → der Uninstall bricht ab,
   **bevor** irgendetwas unregistriert wird — kein halb-registrierter Zustand

Fehlermeldung nennt jetzt konkrete Verursacher (Editoren, `npm run dev`,
Terminals mit CWD im Plugin-Ordner). Live verifiziert: Happy-Path via
`rename`, Locked-Case (PowerShell-Share-None-Handle) → sauberer Abbruch,
Retry nach Lock-Release via `copy` inkl. Overwrite eines stale Partial-Copy.

### Nachtrag 2: PGRST002 nach Uninstall — automatische Exposed-Schemas-Verwaltung

Nach dem Live-Uninstall lieferte PostgREST für **alle** REST-Queries persistent
`PGRST002 — Could not query the database for the schema cache` (DB selbst
healthy — GoTrue `/auth/v1/health` 200; Fehler isoliert auf PostgREST). Ursache:
das Plugin-Schema `pluradash` war für die Supabase-API **exposed** (Install-
Anforderung, siehe development.md §API exposure requirement), während die
Down-Migrations alle Tabellen droppten, down/003 `USAGE` von
`authenticated`/`service_role` entzog und das Schema ggf. komplett verschwand.
PostgREST kann ein exposed, nicht mehr zugreifbares Schema nicht mehr
introspectieren — der Schema-Cache-Reload scheitert permanent.

Fix (Core-Repo): die Exposed-Schemas-Verwaltung ist jetzt **automatisiert und
bidirektional**:

- **Uninstall** (Nachtrag oben): `unexposePluginSchema()` entfernt das
  Plugin-Schema aus `pgrst.db_schemas` und lädt die Config neu.
- **Install** (Nachtrag 3): `exposePluginSchema()` in
  `scripts/install-plugins.mjs` fügt das Schema nach erfolgreichem Install
  (State-Recording) symmetrisch wieder hinzu — unset GUC fällt auf
  `public` zurück (`public` verlässt die Liste nie, sonst bricht der Core-REST
  Zugriff). Manuelles Dashboard-Handling bleibt nur als Fallback (kein PAT /
  Update fehlgeschlagen).
- Neues Modul `scripts/lib/exposed-schemas.mjs` mit beiden Executors + puren
  Helfern (`parseExposedSchemas`, `removeSchemaFromExposedList`,
  `addSchemaToExposedList`, `quoteSqlLiteral`); `tests/exposedSchemas.test.mjs`
  (11 Tests) läuft im TUI-Integrity-Gate mit. specs/plugins/development.md
  §API exposure requirement und specs/plugins/installation.md (§3/§10)
  dokumentieren die Automatisierung.

Operator-Runbook gegen einen akuten PGRST002-Zustand (ohne automatischen
Cleanup möglich, z. B. kein PAT):
1. Exposed Schema im Dashboard entfernen (löst automatisch ein PostgREST-Reload aus)
2. falls nötig `notify pgrst, 'reload schema';` im SQL Editor
3. falls weiterhin 503: Projekt pausieren + fortsetzen (garantierter
   PostgREST-Restart) — danach REST sofort wieder verfügbar.

## Verhalten

- **Unregister (keep files)**: Plugin aus allen Registries/Registern entfernt
  (Registry-Rebuild, `plugins.json`, `plugin-deps.json`, `deployment_state`-
  Zeilen, `plugin_claims`, DB-Status `registered`), Cloud-Bindings aus
  `wrangler.jsonc` entfernt, Code bleibt unter `plugins/.uninstalled/<id>/`.
  Downmigrations-Prompt bleibt interaktiv mit Default **Nein** — Schema/Daten
  bleiben für den Re-Install erhalten, es sei denn, der Operator wählt Rollback.
- **Full uninstall**: unverändertes bisheriges Verhalten (Verzeichnis wird
  gelöscht).
- Smoke-Test (Fake-Plugin `fakeplugin`): Move nach `.uninstalled`,
  Registry-Scan danach nur noch `pluradash`, generierte Artefakte ohne
  Residue, Re-Install-Hinweise korrekt; Test-Reste wieder entfernt.

## Impact Analysis

- **Database:** keine Schema-Änderung; Uninstall schreibt wie bisher
  (`deployment_state`-Delete, Claims-Delete, `plugins.status`-Update).
- **Runtime/API surface:** keine Änderung; Registry-Rebuild erzeugt dieselben
  Artefakte ohne das entfernte Plugin.
- **Verhalten:** TUI-Entfernung funktioniert erstmals überhaupt (vorher
  Usage-Dump); neuer nicht-destruktiver Unregister-Pfad.
- **Sicherheit:** keine neuen Berechtigungen; `.uninstalled/` ist durch die
  bestehende `plugins/*/`-Gitignore-Regel abgedeckt (verifiziert via
  `git check-ignore`).
- **Tests:** manuelle Smoke-Tests (CLI `--help`, `--keep-files`-Durchlauf,
  Registry-Scan, Gitignore); `npm test`/`npm run build` grün.
- **Nicht verifiziert:** der interaktive `p.select`-Flow im echten TUI
  (headless nicht ausführbar); DB-Pfade des Uninstall gegen das echte Projekt.
## Nachtrag 3 (2026-09-11): TUI-Hang bei Install/Remove + korrekte Exposition über Management-API

1. **TUI-Hang:** `applyDownMigrations` (uninstall) bzw. `applyPluginMigrations`
   (install) erzeugten ein `readline.Interface` auf `process.stdin`
   **unbedingt** — schlossen es aber nur im Question-Callback. Mit vorhandener
   PAT (TUI setzt `SUPABASE_ACCESS_TOKEN`) wurde die Frage nie gestellt, das
   Interface blieb offen, der Node-Event-Loop lief weiter → das Kindprozess
   beendete sich nie → `spawnSync` im TUI hing „beim Deploy-Hinweis“.
   Fix: Interface wird nur erzeugt, wenn tatsächlich gepromptet wird
   (`scripts/uninstall-plugin.mjs`, `scripts/install-plugins.mjs`).
2. **Install-seitige Exposition — falscher Mechanismus:** Die erste
   Implementierung schrieb das in-DB-GUC `pgrst.db_schemas`
   (`UPDATE pg_db_role_setting`). Auf gehostetem Supabase ist „Exposed
   schemas“ aber **Plattform-Konfiguration** (Dashboard-Toggle → Plattform →
   `PGRST_DB_SCHEMAS`-Env des PostgREST-Containers), welche die in-DB-GUC
   übersteuert — der SQL-Weg griff ins Leere (0 betroffene Zeilen → Verify
   fehlgeschlagen → Fallback-Warnung). **Kein Supabase-Bug**, sondern der
   falsche Hebel: korrekt ist die Management-API
   `GET/PATCH /v1/projects/{ref}/postgrest` (`db_schemas`). Neu in
   `scripts/lib/exposed-schemas.mjs`: API-first (primary), GUC als Fallback
   (self-hosted), jeweils mit Verify-Read; die Ausgabe nennt den Mechanismus
   (`via api` / `via guc`).
3. **Reihenfolge:** Install-Exposition läuft jetzt **nach** den Migrationen
   (das Schema existiert dann — eine exposed, noch nicht existierende Schema
   würde denselben PGRST002-Wedge auslösen); Un-Exposition im Uninstall läuft
   jetzt **vor** den Down-Migrations (kein Wedge-Fenster zwischen
   `DROP SCHEMA` und Un-Expose).

Gates: `npm test` 217 Tests grün (2 Workspace-Skips), `npm run build` grün.
Nicht live verifiziert: der `PATCH /v1/projects/{ref}/postgrest`-Aufruf gegen
das echte Projekt (kein PAT in dieser Session) — `db_schemas` wird als String
ODER Array normalisiert; bei Fehlschlag erscheint die manuelle Fallback-Anleitung.

## Nachtrag 4 (2026-09-11): Deploy baut immer vor dem Deploy

Der Live-Test zeigte: nach Un-Install + Deploy ohne vorherigen Rebuild blieb
die alte Plugin-UI live — `scripts/deploy.mjs` deployte den stale `dist/`-
Bundle. Neu: `npm run deploy` führt **immer** zuerst `npm run build`
(Typecheck + Vite + Prebuild-Registry-Regeneration) aus; ein fehlgeschlagener
Build bricht das Deploy ab. Opt-out: `--skip-build` (deployt `dist/` as-is).
Pipeline-Reihenfolge: Registries → Build → Consistency-Audit → Remote-Drift →
wrangler deploy. Dokumentiert in specs/platform/unified-setup-tui.md §2 und im
deploy.mjs-Header.

## Nachtrag 5 (2026-09-11): Core-Referenzen auf PluraDash-Schema entfernt

Nach sauberem Uninstall + Rebuild + Deploy lieferte `GET /rest/v1/organizations`
406 — Ursache: **Core-Code** referenzierte das Plugin-Schema direkt
(`Accept-Profile: pluradash`), was jede Rebuild-Überlebt, da es Core-Quellcode
war (Verstoß gegen AGENTS.md §4 Core/Plugin-Boundary):

- `src/services/tenantService.ts` (`getVisibleTenants`) enrichierte Tenant-
  Namen aus `pluradash.organizations` → entfernt; `organization_name` ist
  jetzt immer `null` (AppSidebar fällt auf `tenant.name` zurück).
- `api/routes/forms.ts` (`resolveFormDisplayName`) bevorzugte den PluraDash-
  Organisationsnamen für Formular-Anzeigenamen → entfernt; Fallback auf
  `tenants.name` (identisches Verhalten zum bisherigen Fehlerpfad).

Plugin-Hinweis: die Organisationsnamen-Anreicherung muss bei Re-Add des
Plugins über ein **dokumentiertes Hook-Target** (`src/plugins/hooks-registry.ts`
transform) wiederhergestellt werden — nicht über direkte Schema-Queries im
Core (vermerkt in plugins/.uninstalled/pluradash/CHANGELOG-downmigration-fix).

Gates: `npm test` 215/217 pass (2 Workspace-Skips), `npm run build` grün;
`grep` bestätigt keine verbleibenden `.schema('pluradash')`-Referenzen in
`src/`/`api/`.
