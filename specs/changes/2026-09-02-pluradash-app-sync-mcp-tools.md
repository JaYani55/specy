# 2026-09-02 — PluraDash App-Sync MCP Tools

## Summary

Das PluraDash-Plugin registriert die Workspace-App-Sync-Workflows jetzt als
native MCP-Server-Tools (`app_sync_*`) über den Core-Hook `mcp.tools`.
Zuvor konnten Agenten die Sync-Engine nur über die HTTP-Endpunkte
(`/api/plugin/pluradash/sync/*`) nutzen; über MCP fehlte jede Oberfläche.
Das war die Root Cause des Incidents „Repository not found for this
workspace or access denied (RLS)“: Ein Agent rief `POST /sync/save` mit einem
erfundenen `repoId: 2` auf (echte GitHub-Repo-ID der Zuweisung:
1335001432), der gefilterte Query auf `pluradash.workspace_repos` lief ins
Leere → 404. Die neuen Tools beheben die Informationslücke: `app_sync_list`
liefert die korrekten `repoId`-Werte, `workspaceId`/`repoId` sind überall
optional (Defaults: `tenant_id`-Claim bzw. erstes zugewiesenes Repo).

**Plugin-Änderung** — das Plugin ist ein eigenes Repository
(`plugins/pluradash/`, gitignored); die Tool-Verträge sind in
`plugins/pluradash/specs/app-sync-mcp-tools.md` dokumentiert.

## Files Added

- `plugins/pluradash/api/sync/mcpTools.ts` — Registrierung der sechs
  `app_sync_*`-MCP-Tools (Thin Wrapper über die Sync-Engine, Auth-Gate:
  authentifizierte MCP-Session + `SYNC_ROLES`, Autorisierung bleibt bei RLS
  in der Engine).
- `plugins/pluradash/specs/app-sync-mcp-tools.md` — Tool-Verträge,
  Auth-Modell, Ergonomie-Konventionen, bewusst nicht exponierte Workflows
  (deploy/archive), bekannte Audit-Lücke (keine sync_logs-Einträge für
  MCP-Aufrufe).

## Files Changed

- `plugins/pluradash/api/sync/engine.ts` — `isProbablyText` und
  `arrayBufferToBase64` exportiert (Wiederverwendung durch `mcpTools.ts`
  für Text/Binär-Erkennung beim Datei-Lesen). Kein Verhaltenswechsel.
- `plugins/pluradash/api/storageHooks.ts` — neuer Hook-Beitrag
  `pluradash-mcp-app-sync-tools` (target `mcp.tools`, order 100).
- `plugins/pluradash/plugin.json` — Hook-Beitrag im Plugin-Manifest
  registriert.
- `specs/agents/plurapi-file-sync-integration.md` — §8.1 „MCP tools“
  ergänzt (ersetzt den Vermerk „planned follow-up“).

## Impact Analysis

### Database

Keine Änderungen. Keine Migration. Gelesen wird nur bestehend
`pluradash.workspace_repos` (RLS-gebunden).

### Runtime

- Neue `mcp.tools`-Hook-Beitrag wird über den bestehenden
  Registrierungsmechanismus geladen (`api/plugin-hooks.ts` importiert
  `storageHooks.ts` ungeändert wholesale — kein Generated-File-Wandel).
- MCP-`tools/list` enthält die sechs Tools nur für authentifizierte Caller
  mit Sync-Rolle; anonyme Verbindungen unverändert.
- Tool-Handler fügen Fehler als `isError: true`-Ergebnis mit Klartext-
  Meldung zurück (SyncError-Nachrichten inkl. 409/400-Führung).

### API Surface

- MCP-Tool-Namespace `app_sync_*` neu: `app_sync_list`, `app_sync_pull`,
  `app_sync_list_files`, `app_sync_read_file`, `app_sync_save`,
  `app_sync_commit`.
- Bewusst nicht exponiert: `deploy` (human-only, Branch-Isolation) und
  `archive` (ZIP-Binärstrom ungeeignet für MCP-Ergebnisse).
- HTTP-Endpunkte unverändert und weiterhin die Referenz für PluraPi
  (siehe `specs/agents/plurapi-file-sync-integration.md`).

## Bekannte Lücken (bewusst nicht in diesem Change)

- MCP-Aufrufe erzeugen keine `pluradash.sync_logs`-Einträge (Logging
  lebt in den HTTP-Routen). Ein MCP-Logging-Weg ist möglicher
  Folge-Schritt — dokumentiert in
  `plugins/pluradash/specs/app-sync-mcp-tools.md`.
