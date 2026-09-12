# 2026-09-09 — Plugin-Hook-Dokumentation: vollständige Target-Registry

## Summary

Neue autoritative Hook-Dokumentation [`specs/agents/plugin-hooks.md`](../agents/plugin-hooks.md):
sämtliche Hook-Targets mit Target-Name, Scope, Kind, Dispatch-Punkt,
Context-Shape und Status (§2 Dispatch-Table), plus Architektur (§1: EUPL
Provider/Implementer-Modell, Build-Time-Integration, strenge Scope-Trennung),
Gap-Analyse (§3) und Anleitung für neue Targets (§5).

Anlass: PluraDash deklariert 18 Manifest-Hooks (u. a. event-getriebene Targets
`system.scheduled` und `queue.message`) — die Dokumentationsfläche lag dahinter.

## Verifizierte Befunde (Code-Audit)

- **Gewired (✅):** 7 UI-Targets (`settings.defaultLanding.*`,
  `media.url.resolve`, `forms.fileUpload.builder`,
  `knowledgeBase.entity.actions`, `knowledgeBase.entity.afterCreate`,
  `isibot.flow.types`) und 6 API-Targets (`mcp.tools`,
  `knowledgeBase.sync.invoke`, `storage.tenant.policy/sources`,
  `forms.fileUpload.upload/notification`, `queue.message`).
- **Dead Collectors (❌):** 5 API-Collector-Funktionen ohne Call-Site —
  `knowledgeBase.sync.sources`, `knowledgeBase.prompt.context`,
  `knowledgeBase.settings.sections`, `knowledgeBase.settings.visibility`,
  `admin.connections.sections`. Registrierte Handler laufen ins Leere.
- **Scope-Mismatch (⚠️):** `isibot.flow.types` wird nur UI-seitig dispatcht;
  PluraDash implementiert es api-seitig → Handler unerreichbar.
- **Deklariert ohne Wiring (⚠️):** `system.scheduled` (Manifest-Hook ohne
  Core-Dispatch — `scheduled()` führt nur Core-Form-Reminders aus),
  `workspace.organization` (kein Handler, kein Dispatch).
- **Metadata-Drift:** `hook_metadata` divergiert beidseitig von den
  implementierten Handlern (2 deklariert-ohne-Handler, 3
  implementiert-ohne-Deklaration).

## Files Added

- `specs/agents/plugin-hooks.md` (diese Referenz)
- `specs/changes/2026-09-09-plugin-hook-target-registry.md` (dieses Dokument)

## Files Changed

- `specs/agents/README.md` — Registry-Eintrag für `plugin-hooks.md`
- `AGENTS.md` §4 — Neue Regel: **Jedes neue Plugin-Hook-Target muss in
  `specs/agents/plugin-hooks.md` dokumentiert werden** (§2 Dispatch-Table);
  undokumentierte Hooks gelten als unvollständig; deklarierte-but-unwired
  Targets müssen dort mit ⚠️ markiert werden.

## Impact Analysis

- **Database/Runtime/API surface:** keine — reine Dokumentation.
- **Folgearbeit (nicht Teil dieser Änderung):** Dead Collectors wirken oder
  entfernen (Core-Entscheidung, §3.1); `system.scheduled`-Dispatch
  implementieren oder Manifest-Deklaration zurückziehen; Scope-Mismatch bei
  `isibot.flow.types` auflösen; `hook_metadata` synchronisieren.
