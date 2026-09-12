# 2026-09-09 — Update-Tooling: npm run update (Core + Plugins, TUI-Checklist)

## Summary

Saubere Repo-Updates für Prod-Deployments:

- **`npm run update`** (`scripts/update.mjs`) — Orchestrator mit drei Phasen:
  1. **Core** (delegiert an `scripts/cf-update.mjs`: git-Remote-/Worktree-Checks,
     checksum-basierter Migrations-Ledger via `public.system_config`, Edge
     Functions, Drift-Detection)
  2. **Plugins** — TUI-**Checklist** (`@clack/prompts multiselect`, space/a/enter)
     aller erkannten Plugins mit Behind-Status-Hints
  3. Build + Deploy auf Bestätigung
  Ein PAT wird einmalig verdeckt abgefragt (`SUPABASE_ACCESS_TOKEN`-Passthrough
  an beide Phasen; nie persistiert) — oder aus der Umgebung gelesen.
- **`npm run update:core`** → bestehendes `cf-update.mjs` (unverändert).
- **`npm run update:plugins`** (`scripts/update-plugins.mjs`) — CLI für
  Plugin-Updates: `--list` (Status je Plugin), `--all`, oder Plugin-IDs.
  Erkennt Workspace-Git-Clones (`git fetch` + behind-count, `pull --ff-only`
  bei sauberem Tree), Registry-only-Einträge (Hinweis auf Installer) und
  lokale Plugins ohne Git. Danach Migrations-Validierung + Apply über die
  Management API + Status-Refresh in `public.plugins` + Registry-Rebuild.

## Bugfix unterwegs

`scripts/lib/core-update.mjs` hatte eine **veraltete hardcoded
`MIGRATION_ORDER`** (fehlten alle Migrationen ab ~202606: Poll-Extensions,
Schema-Targets, Mail-Queue-Retry, Auth-Hooks, Plugin-Claims, Support-RLS …).
Ersetzt durch Import von `MIGRATION_ORDER_CORE` aus
`scripts/lib/migration-order.mjs` (Source of Truth, vom Order-Gate-Test
validiert). Dadurch erkennt `cf:update` die zuletzt hinzugekommenen
Migrationen wieder als anwendbar.

## Files Added

- `scripts/update.mjs` — Orchestrator (Phasen, Checklist-TUI, Build/Deploy)
- `scripts/update-plugins.mjs` — Plugin-Update-Engine (CLI + exportierbare
  Funktionen `detectUpdatablePlugins`, `checkGitUpdate`, `updatePlugin`,
  `applyPluginMigrations`)
- `scripts/lib/remote-sql.mjs` — geteilter PAT/Management-API-Zugriff
  (`resolvePat` mit maskiertem Prompt, `createPatDb`, `runSqlQuery`)
- `scripts/lib/env.mjs` — geteilter `.env`-Loader + ROOT
- `scripts/lib/migration-validation.mjs` — aus `install-plugins.mjs`
  extrahierter Plugin-Migrationsvalidator (8 Funktionen, Plugin-Schema-Only-
  DDL-Regeln), von Installer und Update-Tooling geteilt genutzt
- `tests/updateTooling.test.mjs` — 3 Tests: Validator akzeptiert PluraDash,
  Validator lehnt public-Schema-DDL ab, Plugin-Erkennung
- `specs/changes/2026-09-09-update-tooling.md` (dieses Dokument)

## Files Changed

- `scripts/lib/core-update.mjs` — MIGRATION_ORDER-Drift-Fix (s. o.)
- `scripts/install-plugins.mjs` — Validator-Funktionen durch Lib-Import
  ersetzt (Verhalten identisch, `pluginsDir` jetzt Parameter)
- `package.json` — Scripts `update`, `update:core`, `update:plugins`

## Impact Analysis

- **Database:** Keine neuen Tabellen/Objekte. `cf-update` nutzt weiterhin
  `public.system_config` als Ledger (bootstrap/drift detection unverändert).
- **Runtime/API surface:** Keine.
- **Sicherheit:** PAT-Handling identisch zum Installer (verdeckter Prompt,
  env-first, nur im Speicher). Management-API-Zugriff wie bisher.
- **Tests:** 133 Tests grün (3 neu), typecheck + build erfolgreich.
- **Nicht verifiziert:** Live-Durchlauf gegen Supabase (PAT + git pull) —
  Smoke-Tests deckten Fehlerpfade ab (invalid PAT → sauberer Abbruch,
  dry-run-Plugin-Phase, --list); Happy Path mit echtem PAT beim nächsten
  echten Update.
