# 2026-09-09 — Plugin-Binding-Doku an Code angeglichen (Docs↔Code-Drift)

## Summary

`development.md` §3.1, `installation.md` und `AGENTS.md` behaupteten,
`vars` und `secrets_store_secrets` seien core-owned und könnten nicht in
`wrangler_bindings` deklariert werden. Der Code
(`scripts/lib/plugin-workspace.mjs`) akzeptiert und injiziert beide jedoch
seit der Secrets-Store-Injection (dokumentiert in
`specs/platform/core-extension-audio-queues-secrets.md` §3) mit
Konflikterkennung. Nur `r2_buckets` wird abgelehnt (Warning, core-owned).
Die Dokumente wurden an den Code angeglichen — Code wins per KB-Regeln.

## Korrigierte Stellen

| Datei | Änderung |
|---|---|
| `specs/plugins/development.md` §3.1 | Note korrigiert (nur `r2_buckets` core-owned; `vars`/`secrets_store_secrets` mit Konflikterkennung injiziert); `PluginWranglerBindings`-Interface um `queues`, `vars`, `secrets_store_secrets` ergänzt (Namen exakt wie `src/types/plugin.ts`); Verweis auf Types als Source of Truth |
| `specs/plugins/installation.md` | Supported-Types-Liste um `queues`, `vars`, `secrets_store_secrets` ergänzt; falsche Core-Ownership-Claim ersetzt; Konfliktverhalten präzisiert |
| `AGENTS.md` §4 | Bullet korrigiert (nur `r2_buckets` core-owned; Merge + Konflikterkennung für `vars`/`secrets_store_secrets`) |

Bereits korrekt und unverändert: `specs/agents/r2-file-storage.md` („nur
`r2_buckets` core-owned") und `specs/platform/core-extension-audio-queues-secrets.md`
(Injektionsmechanik).

## Verifiziertes Code-Verhalten (Referenz)

- `vars` (`Record<string, string>`) → Merge in den Core-`vars`-Block;
  doppelter Key über Plugins → `x Var conflict …` + `process.exit(1)`
  (`plugin-workspace.mjs` ~Z. 375–390).
- `secrets_store_secrets` (`{binding, store_id, secret_name}`) → Merge in
  das Core-Array; doppeltes `binding` → `x Secrets conflict …` +
  `process.exit(1)` (~Z. 392–411).
- `queues` (producers/consumers) → Merge in Core-`queues`; Duplikate →
  `process.exit(1)` (~Z. 289–350).
- `r2_buckets` → Warning „owned by core. Add entries directly to
  wrangler.jsonc instead." (~Z. 416–424).

## Files Changed

- `specs/plugins/development.md`
- `specs/plugins/installation.md`
- `AGENTS.md`
- `specs/changes/2026-09-09-plugin-binding-docs-drift-fix.md` (dieses Dokument)

## Impact Analysis

- **Database/Runtime/API surface:** keine — reine Dokumentationskorrektur.
- **Kein Code-Change:** `scripts/lib/plugin-workspace.mjs` und
  `src/types/plugin.ts` bleiben unverändert und sind Referenz.
