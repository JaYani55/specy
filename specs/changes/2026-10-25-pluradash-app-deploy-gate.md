# PluraDash: App-Deploy-Button, Build-Gate & externer Deploy-Endpunkt

Date: 2026-10-25

## Summary

PluraDash-Plugin-Änderung (EUPL: separates Werk, dokumentiert im
Plugin-Repository). Drei Teile:

1. **Deploy-Button** in der Apps-Übersicht (`/plugins/pluradash/apps`):
   merged den neuesten `dev`-Stand in den Produktiv-Branch. Der
   Produktiv-Branch kommt aus dem **Standard-Branch-Feld von
   `/admin/github-apps`** (`workspace_repos.default_branch`, Fallback
   `main`) — nicht mehr fest codiert.
2. **Build-Gate**: Produktiv-Deploys sind nur möglich, wenn der neueste
   Dev-Branch-Build (check_run-Feedback-Schleife,
   `pluradash.repo_deployments`) erfolgreich war und auf genau dem Commit
   gebaut wurde, auf dem `dev` aktuell zeigt. Sonst 409 (kein Build /
   Build läuft / Build fehlgeschlagen / veralteter Build).
3. **Externer, authentifizierter API-Endpunkt**
   `POST /api/plugin/pluradash/apps/deploy` — teilt Handler, Autorisierung
   (human-only, Workspace-Admin/Super-Admin), Gate und Sync-Log mit
   `POST /sync/deploy`; dokumentiert im Plugin-Endpunkt-Katalog unter
   `/admin/api` (`api_metadata`-Route `pluradash-apps-deploy` in
   `plugin.json`).

## Files Added

- `plugins/pluradash/api/sync/deployGate.ts` — reine Gate-Logik
- `plugins/pluradash/specs/changes/2026-10-25-app-deploy-gate.md` — Plugin-Änderungsdatensatz (verbindlich, Plugin-Repo)
- `tests/pluradashDeployGate.test.mjs` — 8 Gate-Regressionstests

## Files Changed

- `plugins/pluradash/api/sync/engine.ts` — `deployProduction`: Ziel-Branch aus `default_branch`, Gate vor Merge, per-Branch R2-Snapshot
- `plugins/pluradash/api/sync/github.ts` — `mergeDevIntoProduction(octokit, repo, productionBranch, message)`
- `plugins/pluradash/api/sync/routes.ts` — `handleDeploy` exportiert; `POST /sync/deploy` + `POST /apps/deploy` teilen den Handler
- `plugins/pluradash/api/sync/types.ts` — `SyncDeployResult.gate`
- `plugins/pluradash/api/index.ts` — Mount `POST /apps/deploy`
- `plugins/pluradash/plugin.json` — api_metadata-Route `pluradash-apps-deploy`, Capability `pluradash-app-deploy`
- `plugins/pluradash/src/services/githubAppService.ts` — `deployWorkspaceApp()`
- `plugins/pluradash/src/pages/AppsPage.tsx` — Deploy-Button (nur bei grünem Dev-Build aktiv)

## Impact Analysis

### Database

- Keine Migration (core oder plugin). Das Gate liest bestehende
  `pluradash.repo_deployments`-Zeilen (Unique `(github_repo_id, branch)`,
  Migration 026) per RLS.

### Runtime

- Zusätzlicher GitHub-`getRef` (Dev-Head) pro Deploy- Versuch; Gate-
  Ablehnungen kosten sonst nichts.
- R2-Produktiv-Snapshots liegen ab jetzt unter dem echten
  Standard-Branch-Segment (Repos mit `master` statt `main` korrekt).

### API surface

- Neu im Plugin-Scope: `POST /api/plugin/pluradash/apps/deploy`
  (bearer-required, 200/403/404/409; Agenten 403 — strikte
  Branch-Isolation). Keine Core-API-Änderung.

## Compliance

- **EUPL / Core-Plugin-Grenze:** Es wurden keine Core-Dateien (`src/`,
  `api/`, `migrations/`) verändert; alle Änderungen liegen im Plugin-Repo
  `plugins/pluradash` (separates Git-Repository, MIT-lizenziert).
- **Dokumentation:** Verbindlicher Änderungsdatensatz im Plugin-Repo
  (`plugins/pluradash/specs/changes/2026-10-25-app-deploy-gate.md`); dieser
  Eintrag spiegelt die Änderung für den Core-Kontext wider.
- **Tests:** `npm test` grün (inkl. neuer Gate-Tests), `npm run typecheck`,
  `npm run typecheck:api` (nur vorbestehende Plugin-API-Fehler) und
  `npm run build` erfolgreich.

## Gates (Detail)

| Neuester Dev-Build                        | Ergebnis                | HTTP |
|-------------------------------------------|-------------------------|------|
| keine Zeile / kein Status                 | abgelehnt (`no-build`)  | 409  |
| `running`                                 | abgelehnt (`running`)   | 409  |
| `failed`                                  | abgelehnt (`failed`)    | 409  |
| `succeeded`, `commit_sha ≠ dev`-Head      | abgelehnt (`stale-build`)| 409 |
| `succeeded`, `commit_sha = dev`-Head      | erlaubt                 | 200  |
