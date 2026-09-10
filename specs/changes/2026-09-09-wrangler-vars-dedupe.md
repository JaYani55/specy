# 2026-09-09 — Wrangler-Vars-Duplizierung behoben + ensure-registry npm-Fix

## Summary

Zwei Bugs im Build-Tooling:

1. **Doppelte GITHUB-Vars in `wrangler.jsonc`:** Der Plugin-Bindings-Injektor
   (`scripts/lib/plugin-workspace.mjs` → `rebuildWranglerPluginBindings`)
   splicete Plugin-`vars` in den Core-`vars`-Block, ohne zu prüfen, ob der
   Key dort bereits existiert. Da Core-Einträge (ohne `// <pluginId>`-Marker)
   vom Cleanup-Schritt nicht entfernt werden, entstanden bei jedem Rebuild
   doppelte JSON-Keys (`GITHUB_APP_ID/CLIENT_ID/INSTALLATION_ID` doppelt —
   Werte identisch, aber duplizierte Keys sind fehleranfällig und wrangler-
   abhängig vom Parser-Verhalten).
   **Fix:** Vor der Injektion werden die existierenden Core-Var-Keys erkannt;
   kollidierende Plugin-Vars werden mit Warning übersprungen
   („core value wins"). Bleibt nichts zum Injizieren übrig, wird der Block
   unangetastet gelassen (Secrets-Injection und finaler Write laufen weiter).
2. **`ensure-registry.mjs` npm-Reinstall schlug auf Windows immer fehl:**
   `spawnSync('npm.cmd', …, { stdio: 'pipe' })` ohne `shell` — aktuelle
   Node-Versionen verweigern das Ausführen von `.cmd` ohne Shell (status
   null, kein stderr). Fix: `shell: true` (gleiches Pattern wie `runCmd` im
   Installer).

## Files Changed

- `scripts/lib/plugin-workspace.mjs` — Core-Var-Key-Erkennung + Skip-Logik
  in der Vars-Injektion
- `scripts/ensure-registry.mjs` — `shell: true` für den npm-Reinstall

## Impact Analysis

- **Database/Runtime/API surface:** keine.
- **Verhalten:** Vars mit gleichem Key in Core **und** Plugin → Core-Wert
  gewinnt, Plugin-Wert wird mit Warning verworfen (vorher: duplizierter
  JSON-Key, letzter gewann — Werte waren hier identisch, daher bisher kein
  sichtbarer Schaden). Secrets-Injection dedupliziert bereits korrekt gegen
  Core-Einträge (war nicht betroffen).
- **Tests:** 133 grün; `wrangler.jsonc` nach Rebuild: GITHUB-Vars genau 3×
  (core), Plugin-Marker-Zeilen entfernt; ensure-registry npm-Reinstall
  erfolgreich („Plugin packages ready.").
- **Plugin-Seite (optional):** Die GITHUB-Vars könnten alternativ aus
  `wrangler_bindings.vars` des PluraDash-Manifests entfernt werden, wenn sie
  als reine Core-Deploy-Konfiguration betrachtet werden — Verhalten ist
  durch den Fix in beiden Varianten deterministisch.
