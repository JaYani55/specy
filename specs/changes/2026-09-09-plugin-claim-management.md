# 2026-09-09 — Plugin Claim Management (Core Claims für Build-Time-Plugins)

## Summary

Implementierung des Claim-Management-Plans (`specs/plans/CLAIM_MANAGEMENT.md`,
Validierung siehe Konversation): Build-Time-Plugins deklarieren **custom JWT
Claims** im Manifest, registrieren Resolver per Migration, und der
Access-Token-Hook merged sie generisch bei Token-Minting. Designprinzip:
**Core owns the mechanism; plugins own the semantics** — der Hook wurde damit
zum letzten Mal pro-Feature erweitert, künftige Claims sind reine
Registry-Zeilen.

## Die vier Layer

1. **Declaration (build):** `claims_declarations[]` in `plugin.json`; die
   Registry-Logik (`collectPluginClaims` in `scripts/lib/plugin-workspace.mjs`)
   namespaces auf `claims.<plugin_id>`, rejected Reserved-Keys
   (`user_roles`, `is_agent`, `tenant_id`, JWT-Registered-Claims) und
   Duplicate-Keys (single-source), erzwingt das globale Budget
   (Σ ≤ `GLOBAL_CLAIM_BUDGET_BYTES` = 2048) und generiert `api/plugin-claims.ts`.
2. **Registration (install):** Plugin-Migration erstellt die Resolver-Funktion
   im Plugin-Schema (`SECURITY INVOKER`, pure/stable, NULL = abwesend) und
   upserted in `public.plugin_claims`; die Downmigration **löscht die Zeile**
   (Revertibilität, E-002).
3. **Merge (mint):** `Auth/Access_hook_plugin_claims.sql` erweitert
   `custom_access_token_hook` mit einem generischen Loop über die Registry —
   per-Resolver-Fehlerisolation (`RAISE WARNING`, Claim weggelassen, Mint
   läuft weiter), `octet_length`-Budget-Check, Fail-Closed, path-form
   `jsonb_set` (NULL-sicher).
4. **Dispatch (runtime):** `VerifiedAuthSession.claims` (Backend, unverändert),
   `User.claims` + `access.claims`-Prädikate im Frontend
   (`src/plugins/claimMatching.ts`, deep-subset match, fail-closed),
   Hook-Gating via `getPluginHooks(target, userRoles, tokenClaims)`,
   RLS liest `request.jwt.claims -> '<plugin_id>'` (Plugin-eigene Policies).

## Files Added

- `migrations/202609090001_plugin_claims_registry.sql` — core-owned
  `public.plugin_claims` (RLS: admin/super-admin read, keine User-Write-Paths,
  supabase_auth_admin grant, anon/authenticated revoked)
- `migrations/Auth/Access_hook_plugin_claims.sql` — finale generische
  Hook-Erweiterung (Permissions re-applied wie im bestehenden Pattern)
- `src/plugins/claimMatching.ts` — pure Claim-Prädikat-Evaluation
  (`claimValueMatches`, `pluginClaimMatches`)
- `api/plugin-claims.ts` — generiert (gitignored), descriptive Claim-Registry
- `tests/pluginClaimsRegistry.test.mjs` — 7 Tests: Namespacing, Reserved-Keys,
  Single-Source, Cross-Plugin-Same-Key, globales Budget, Malformed-Declarations,
  Leere-Declarationen
- `tests/pluginClaimMatching.test.mjs` — 6 Tests: Deep-Subset-Semantik,
  Namespaced-Lookup ohne Cross-Namespace-Leakage, Fail-Closed (E-001)
- `specs/auth/plugin-claims.md` — implementierter Contract (Layer-Referenz)
- `specs/changes/2026-09-09-plugin-claim-management.md` (dieses Dokument)

## Files Changed

- `scripts/lib/migration-order.mjs` — `202609090001_plugin_claims_registry.sql`
  + `Auth/Access_hook_plugin_claims.sql` nach `Auth/Access_hook_oauth_claims.sql`
  (Registry-Tabelle vor dem Hook)
- `scripts/lib/plugin-workspace.mjs` — `collectPluginClaims`,
  `RESERVED_CLAIM_KEYS`, `GLOBAL_CLAIM_BUDGET_BYTES`, `PLUGIN_CLAIMS_FILE`,
  `writePluginClaimsRegistry` (in `rebuildWorkspacePluginArtifacts`)
- `src/types/plugin.ts` — `PluginClaimDeclaration`, `PluginClaimValueType`,
  `claims_declarations` im Manifest, `PluginAccessRule.claims`
- `src/plugins/loader.ts` — `isPluginAccessible(plugin, userRoles, tokenClaims?)`,
  `getPlugins`/`getPluginHooks` Claims-Pass-through (fail-closed)
- `src/types/auth.ts` + `src/contexts/AuthContext.tsx` — `User.claims`
  (dekodiertes JWT-Payload inkl. Plugin-Namespace)
- `specs/auth/README.md`, `AGENTS.md` (Generated-Files-Liste),
  `specs/plans/CLAIM_MANAGEMENT.md` (Status: implementiert, Abweichungen notiert)

## Impact Analysis

- **Database:** Neue Tabelle `public.plugin_claims` + Hook-Erweiterung.
  Idempotent (IF NOT EXISTS, DROP/CREATE POLICY, CREATE OR REPLACE). Beide in
  `MIGRATION_ORDER` registriert — `tests/coreMigrations.test.mjs` (Order-Gate)
  grün. Keine bestehenden Tabellen verändert.
- **Runtime:** Der Hook greift nur, wenn `plugin_claims`-Zeilen existieren —
  ohne registrierte Claims ist das Verhalten bit-identisch zum vorherigen Hook
  (Core-Claims unverändert). Registry-Tabelle fehlt (Edge) → Warning + Skip.
- **API surface:** Keine neuen Endpunkte; `access.claims` erweitert die
  Plugin-Access-Regeln (fail-closed für Call-Sites ohne Claims-Pass-through).
- **Frontend:** `User.claims` ist additive Ergänzung; bestehende
  `anyRole`-Gates unverändert. Keine Plugins nutzen `access.claims` bisher —
  kein Verhaltenswechsel.
- **Tests:** 13 neue Tests (130 gesamt), typecheck + build grün.
- **Offen (aus Plan §6, unverändert OPEN):** Live-Supabase-Roundtrip
  (echter Hook + Resolver + Refresh-Timing), Supabase-Claims-Payload-Limit
  (~4 KB ASSUMPTION) verifizieren, `access.claims`-UX für abgelaufene Claims.

## Plugin-Seite (separates Repo)

PluraDash-Pilot (Resolver-Migration + `claims_declarations` im Manifest +
Downmigration mit `DELETE FROM public.plugin_claims`) gehört in das
Plugin-Repo und ist **nicht** Teil dieser Core-Änderung — Copy-Paste-Vorlage
in `specs/auth/plugin-claims.md` §1.3. Uninstall-Revertibilität ist
sichergestellt: bestehender Downmigration-Mechanismus des Uninstallers
führt das DELETE aus.
