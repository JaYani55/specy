# 2026-09-10 — Unified Setup TUI & Installation-State Tracking

## Summary

`npm run setup` ist jetzt ein **phasenbewusster Dispatcher** statt eines reinen
First-Time-Wizards: ein frischer Checkout (kein `wrangler.jsonc` oder noch
Platzhalter) startet den bisherigen Wizard; ein konfiguriertes Deployment
bekommt eine **Maintenance-TUI** — Installations-/Deployment-Status, Integritäts-
Audit und ein Menü zu jedem mutierenden Flow (Update, Deploy, Provisioning,
Plugins, Migrationen, Auth). Die TUI ist ein Launcher + Integritäts-Gate +
State-Tracker, **keine** Neuimplementierung — jede Aktion delegiert an das
bestehende Skript (eine Implementierung pro Operation).

Daneben: massive Deduplizierung der Tooling-Libs und die Schließung der
**„ist Core deployed?"-Lücke** durch ein neues `deployment:worker`-State-Record.

## Analyse (Ausgangslage)

Zwölf Entry-Points mit überlappenden Zuständigkeiten; der Operator musste
Reihenfolge und Fehlerreaktion selbst kennen. Dupliziert und entfernt:

- `loadDotEnv()` — 4 Kopien → `scripts/lib/env.mjs`
- `runSqlQuery()` / `extractProjectRef()` — 5 Kopien → `scripts/lib/remote-sql.mjs`
- `promptSecret()` (maskierter PAT-Prompt) — 4 Kopien → `scripts/lib/prompts.mjs`
- `resolvePat()` / `createPatDb()` / `patQuery()` — 3 Kopien → `remote-sql.mjs`
- Plugin-Migrations-Validator — 2 Kopien → `scripts/lib/migration-validation.mjs`
- `rebuildRegistry` / `rebuildPluginRoutes` / `rebuildHookRegistry` /
  `rebuildPluginMetadata` — **toter Code** in Installer und Uninstaller,
  ersetzt durch `rebuildWorkspacePluginArtifacts()` (`plugin-workspace.mjs`)

## Installation-State („ist Core deployed?")

Vorher wurde Migrations- und Edge-Function-Zustand in
`public.system_config` (Namespace `core_update`) getrackt, **aber nicht**, ob/welcher
Commit auf dem Worker läuft. Neu: `deployment:worker`
(`{ commit, workerName, deployedAt }`) wird nach erfolgreichem `wrangler deploy`
geschrieben (Write-after-Confirm: das externe System bestätigt, bevor State
persistiert wird).

## Files Added

- `scripts/lib/prompts.mjs` — geteilte `promptLine` / `promptSecret`
- `scripts/lib/state.mjs` — Phasenerkennung + lokaler Installations-State-Summary
  (`detectPhase`, `readLocalState`, `wranglerHasPlaceholders`)
- `scripts/lib/first-time-setup.mjs` — der bisherige `setup.mjs`-Wizard als
  aufrufbarer Flow (`runFirstTimeSetup`)
- `tests/state.test.mjs` — Regression für `wranglerHasPlaceholders`
- `specs/platform/unified-setup-tui.md` — Design/Contract (Analyse + Empfehlung)
- `specs/changes/2026-09-10-unified-setup-tui.md` (dieses Dokument)

## Files Changed

- `scripts/setup.mjs` — neu: phasenbewusster Dispatcher + Maintenance-TUI
  (State-Summary, Integritäts-Check, Aktionsmenü, `invokedDirectly`-Guard)
- `scripts/lib/remote-sql.mjs` — `promptSecret` aus `prompts.mjs` importiert
- `scripts/lib/core-update.mjs` — `recordWorkerDeployment()` ergänzt
- `scripts/cf-update.mjs` — `deployment:worker`-Record nach `deploy()`; PAT/
  ProjectRef modulweit gehalten (kein Doppel-Prompt)
- `scripts/install-plugins.mjs` — lokale PAT-/SQL-/Prompt-/Env-Duplikate durch
  `remote-sql.mjs` + `prompts.mjs` + `env.mjs` ersetzt; toter
  Registry-Rebuild-Code entfernt
- `scripts/uninstall-plugin.mjs` — dito; lokale Migrations-Validator-Kopien durch
  `migration-validation.mjs` ersetzt; toter Registry-Rebuild-Code entfernt
- `scripts/provision-bindings.mjs` — `loadDotEnv`/`promptSecret` aus geteilten Libs
- `specs/platform/README.md` — `unified-setup-tui.md` registriert

## Impact Analysis

- **Database:** keine Schema-Änderung. Neue Zeile(n) in bestehendem
  `public.system_config` (`core_update` → `deployment:worker`), geschrieben über
  die bestehende `upsertCoreUpdateRecords` (idempotent, `ON CONFLICT`).
- **Runtime/API surface:** keine — reines Tooling.
- **Verhalten:** `npm run setup`-Aufruf auf konfiguriertem Repo zeigt jetzt die
  TUI statt des Wizards; der Wizard läuft unverändert bei frischem Checkout
  (`runFirstTimeSetup`).
- **Sicherheit:** PAT-/CF_Token-Handling unverändert (verdeckter Prompt, env-first,
  nur im Speicher). `deployment:worker` enthält nur Commit-SHA + Timestamp, keine
  Secrets.
- **Tests:** 176 grün (1 neu: `tests/state.test.mjs`); `npm run typecheck` exit 0;
  `npm run build` erfolgreich. Smoke: `install-plugins.mjs --list`,
  `uninstall-plugin.mjs --list`, `provision-bindings.mjs --dry-run`,
  `state.mjs`-Import (side-effect-frei) manuell verifiziert.
- **Nicht verifiziert:** interaktive TTY-Durchläufe der Maintenance-TUI und des
  Wizards (kein TTY in dieser Umgebung); Live-`deployment:worker`-Write gegen
  ein echtes Projekt.
