# 2026-10-24 — Dependency Audit Fix (npm audit: 24 Schwachstellen → 0)

## Summary

Behebung aller 24 gemeldeten `npm audit`-Schwachstellen (8 moderate, 15 high,
1 critical) durch gezielte Updates der direkten Abhängigkeiten, In-Range-Updates
der Transitiv-Abhängigkeiten (`npm audit fix`) und drei dokumentierte
**Security-Overrides** in `package.json` für Fälle, in denen der von npm
vorgeschlagene Fix eine fehlerhafte oder destruktive Auflösung hatte.

**Gründe für die Overrides (statt `npm audit fix --force`):**

| Override | Problem | Lösung |
|---|---|---|
| `postcss-selector-parser: ^7.1.6` | Kein 6.x-Fix existiert; Tailwind v3-Kette (tailwindcss, postcss-nested, @tailwindcss/typography) pinnt 6.x. npms Vorschlag (`@tailwindcss/typography@0.5.4`) wäre ein **Downgrade** und hätte das Problem nicht gelöst; Tailwind-4-Migration ist out of scope. | Override auf ≥7.1.6; Tailwind-Build funktional verifiziert (Test mit `@apply` + Nested CSS). |
| `undici: ^7.30.1` | miniflare pinnt exakt vulnerable `7.29.1`; fix ist `≥7.30.1` (gleiche Major-Version, minimales Patch-Drift). | Globales Override; betrifft `wrangler dev`-Stack (miniflare) und shadcn. |
| `@earendil-works/pi-coding-agent → undici: 8.12.3` | pi-coding-agent pinnt vulnerable `8.10.2`; miniflare benötigt indes 7.x — **ein globales Override kann beide Majors nicht erfüllen**. | Nested Override (npm `overrides`-Nesting) setzt nur für pi-coding-agent die 8.x-Fixversion. Das Paket wird im Core-Code nicht importiert (nur Dev-Agent-Tooling). |

**Major-Version-Bumps (npms empfohlene Fixes):**

- `shadcn` 3.5.0 → 4.22.1 — dessen Nested-Copy `zod@3.25.76` war der verwundbare
  Bestandteil (shadcn 4.22.1 nutzt zod ^4). Wird ausschließlich als Dev-CLI
  verwendet (kein Import im Code).
- `@hono/mcp` 0.2.3 → 0.3.2 — Peer-Range explizit auf MCP-SDK ≥ 1.29 ausgerichtet
  (installiertes SDK: 1.32.2); `hono-rate-limiter`-Peer (^0.5.3) unverändert
  kompatibel.
- `@earendil-works/pi-coding-agent` 0.84.3 → 1.4.0 (+ `pi-agent-core`,
  `pi-ai` → 1.4.0) — keine Imports im Core-Code; pinned vulnerable undici.
- In-Range-Erhöhung der deklarierten Floors dokumentiert die Sicherheitsanforderung:
  `@modelcontextprotocol/sdk ^1.32.2`, `hono ^4.13.11`, `zod ^4.6.6`,
  `vite ^7.3.7`, `wrangler ^4.152.0` (bringt miniflare 5.20261019.2-beta mit
  gefixtem sharp 0.35.5).

**Regression-Schutz:** Neuer Test `tests/dependencyIntegrity.test.mjs` (33 Tests)
— Version-Floor-Assertions gegen die Advisory-Ranges (aufgelöst aus dem realen
`node_modules`-Baum inkl. Nested-Copies) + funktionale Smoke-Tests der
umgestellten/overrideden Pakete. Entfernt ein Override oder wird ein
verwundbares Package wieder installiert, schlägt der Test fehl.

## Files Added

- `tests/dependencyIntegrity.test.mjs` — Security-Integrity- und Smoke-Tests
- `specs/changes/2026-10-24-dependency-audit-fix.md` — dieses Dokument

## Files Changed

- `package.json` — Floors der Direkt-Abhängigkeiten erhöht (MCP SDK, hono, zod,
  vite, wrangler, shadcn, @hono/mcp, pi-coding-agent/pi-agent-core/pi-ai); 3
  Security-Overrides ergänzt (`minimatch`-Override blieb unverändert)
- `package-lock.json` — neu aufgelöster Dependency-Baum (npm install + audit fix)
- `tests/mcpSdkProtocol.test.mjs` — MCP-SDK-Protokoll-Integrity-Tests (siehe unten)

## Impact-Analyse

### Datenbank

- Keine. Reine Abhängigkeitsänderung, keine Migrationen.

### Runtime

- **API (Worker):** `hono` 4.12.x → 4.13.13 (Bugfix-Releases, kein Breaking Change
  in der verwendeten Oberfläche), `@modelcontextprotocol/sdk` 1.27.x → 1.32.2,
  `zod` 4.3.6 → 4.6.7 (Patch-/Minor-Line 4.x). Verifiziert via `typecheck:api`
  (die verbleibenden Fehler in generiertem `api/plugin-metadata.ts` sind
  vorbestehendes Plugin-Drift aus dem gitignored Plugin-Workspace, unabhängig
  von Abhängigkeitsversionen) und der bestehenden Testsuite.
- **Frontend-Build:** `vite` 7.3.6 → 7.3.7, Tailwind-Kette mit
  postcss-selector-parser-Override 6.x → 7.1.7 — funktional verifiziert
  (dedizierter PostCSS-Compile-Test + vollständiger `npm run build`).
- **Dev-Tooling:** `wrangler` 4.126.0 → 4.152.0 (miniflare 5.20261019.2-beta,
  sharp 0.35.5 mit gefixtem libheif/librsvg), `shadcn` 4.x (nur CLI),
  `pi-coding-agent` 1.4.0 (nicht im Core-Code importiert).
- `sharp`-Native-Bindings werden durch einen Smoke-Test abgesichert
  (1×1-PNG → metadata/raw).

### API-Surface

- Keine Änderung an Core-Routen, Hooks oder Plugin-Verträgen. Plugin-Hooks und
  generierte Registries sind unverändert betroffenlos (Regenerierung läuft
  unverändert über `predev`/`prebuild`).

### MCP-SDK 1.27.1 → 1.32.2 — gezielte Verifikation (Breaking-Change-Prüfung)

Das Repo nutzt aus dem SDK ausschließlich `McpServer` (31 Tools via
`server.tool(name, description, zodShape, handler)`) plus `@hono/mcp`
`StreamableHTTPTransport`; OAuth-Ressourcen-Metadaten sind eigenständig
implementiert (keine SDK-Auth-Subpfade im Core). Verifiziert mit
`tests/mcpSdkProtocol.test.mjs` über echte Protokoll-Round-Trips:

- **zod-4-Nahtstelle:** Das SDK deklariert `zod ^3.25 || ^4.0` und löst auf die
  Root-zod 4.6.7 auf — die Repo-eigenen zod-4-Schemas fließen direkt in die
  Tool-Registrierung. Getestet: Schema-Generierung im `tools/list` (JSON Schema
  aus zod 4), Parsing gültiger Argumente, Fehler bei ungültigen Argumenten.
- **Verhaltensänderung SDK ≥ 1.31 (bekannt, abgesichert):** Invalid-Input bei
  `tools/call` wird als **`isError: true` CallToolResult** innerhalb HTTP 200
  gemeldet (Text enthält `-32602` + Feldnamen) statt als JSON-RPC-Fehler.
  `extractMcpToolOutcome` in `api/lib/mcpObservability.ts` behandelt genau
  diesen Pfad bereits (failed=true, statusCode=null) — kein Bruch des
  Observability-Vertrags; der Test fixiert das Verhalten als Regressionsschutz.
- **@hono/mcp-Transport:** End-to-End über einen Hono-App-Request gemäß
  `api/routes/mcp.ts` (frischer Server + Transport pro Verbindung):
  `initialize` (Protokollversion `2025-06-18` verhandelt) → `tools/list` →
  `tools/call` (gültig + ungültig). Session-Id-Header ist bei stateless-
  Transport optional und wird vom Test nicht gefordert.
- **Tool-Fehlerkontrakt:** Auslösen im Handler → `isError: true` mit
  Fehlermeldung (identisch zum `mcpToolFailure`-Verhalten der Repo-Tools).

## Verifikation

- `npm audit` → **0 vulnerabilities** (vorher: 24 / 1 critical)
- `npm test` → 543 Tests, alle grün (inkl. 33 Dependency-Integrity- und 4
  MCP-Protokoll-Tests)
- `npm run build` (prebuild → typecheck → vite build) → erfolgreich
- `npm run typecheck:api` → Core `api/` fehlerfrei; einzige Meldung in
  generiertem, gitignored Plugin-Metadaten (vorbestehend, siehe oben)
- `tests/mcpSdkProtocol.test.mjs` → MCP-Round-Trips (InMemory +
  StreamableHTTPTransport) grün gegen SDK 1.32.2 / @hono/mcp 0.3.2 / zod 4.6.7
