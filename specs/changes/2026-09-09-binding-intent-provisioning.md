# 2026-09-09 — Binding Intent & Provisioning System (BIPS) implemented

## Summary

Implementierung von `specs/plans/BINDING-MANAGEMENT.md`: Build-Time-Plugins
deklarieren Cloudflare-Bindings als **Intents** (`wrangler_intents` in
`plugin.json`) statt als konkrete Instanzen; Core löst jeden Intent
deterministisch pro Deployment auf (`{worker-name}--{plugin-id}--{purpose}`),
provisioniert Instanzen (create-or-get via Cloudflare API) und injiziert die
aufgelösten Einträge in `wrangler.jsonc`.

**Auslösender Vorfall (behoben):** Beim Plugin-Install-Build im Dev-Environment
wurde die Queue `isibot-sms-notifications` (prod, account-global) injiziert —
der Deploy scheiterte mit „duplicate consumer", weil Prod bereits Consumer
derselben Queue war. Mit BIPS ist die Kollision strukturell unmöglich: Der
Dev-Deploy erhält seine eigene Queue (`specy-dev--pluradash--sms-notifications`),
Producer und Consumer werden atomisch auf dieselbe aufgelöste Instanz
verdrahtet. Verifiziert am lokalen Workspace (generierter Abschnitt referenziert
null Instanzen von `isibot-sms-notifications`).

**Doktrin (dokumentiert):** Binding Management ist Teil eines Plugins —
Entwickler deklarieren ihre Cloud-System-Bindings **basierend auf dem
Deployment-Pfad** (`deployment_path` in `plugin.json`); **Cloudflare ist der
aktuelle Default und einzige Deployment-Pfad**. Unbekannte Pfade werden zur
Build-/Install-Zeit abgelehnt. Erweiterbarkeit für zukünftige Vendor-Systeme:
uniformes Intent-Schema (`{kind, binding, purpose, scope, config}`), Pfad-
Whitelist in `scripts/lib/binding-intents.mjs`, Provisioner pro Pfad in
`scripts/lib/binding-provisioner.mjs`.

## Design (4 Layer, analog Claim Management)

1. **Declaration** — `wrangler_intents` (+ `deployment_path`) im Manifest.
2. **Resolution** — deterministisch: `environment`-Scope →
   `{worker-name}--{plugin-id}--{purpose}`, `shared`-Scope (Opt-in) →
   `{plugin-id}--{purpose}`. Worker-Name = Environment (ein Worker pro
   Deployment, generiertes `wrangler.jsonc`).
3. **Provisioning** — `npm run bindings:provision`: create-or-get via Cloudflare
   API (Queues, KV), Secrets-Store-Link-Verifikation, Resource-Ledger
   `.bindings-ledger.json` (gitignored), `--teardown` für environment-scoped
   Instanzen (Downmigration-Analog). Provisioning-Fehler sind Config-Fehler
   **vor** `wrangler deploy`.
4. **Injection** — aufgelöste Einträge im AUTO-GENERATED-Plugin-Bindings-Block;
   KV-IDs aus dem Ledger; Secret-`store_id` resolved aus Core-`SECRETS_STORE_ID`;
   Vars-Merge unverändert (Core-Wert gewinnt).

## Files Added

- `scripts/lib/binding-intents.mjs` — pure Logik: Validierung, Normalisierung,
  deterministische Resolution, Konflikterkennung, Collected-Map-Übersetzung,
  Ledger-Lookup
- `scripts/lib/binding-provisioner.mjs` — Cloudflare-API-Fassade, Queue-/KV-
  create-or-get (mit Ledger-Skip), Secret-Link-Verifikation, Ledger-Write/
  Remove, Teardown, **Remote-Drift-Detection** (`fetchRemoteBindings`,
  `normalizeRemoteBinding`, `normalizeLocalBindings`, `diffBindings` — reine
  Diff-Logik)
- `scripts/lib/wrangler-config.mjs` — `parseJsoncConfig` (URL-sicheres
  JSONC-Parsing)
- `scripts/provision-bindings.mjs` — CLI (`npm run bindings:provision`):
  `--dry-run`, `--check-remote` (klassifizierter Deploy-Diff statt
  wrangler-Prompt), `--teardown <plugin>`
- `tests/bindingIntents.test.mjs` — 26 Tests (Resolution, Validierung,
  Konflikte, Collected-Shape, Legacy-Fallback, Deployment-Path-Ablehnung)
- `tests/bindingDrift.test.mjs` — 7 Tests (JSONC-Parsing, Remote-Normalisierung,
  Diff-Klassifikation added/removed/changed/same)
- `specs/platform/binding-management.md` — implementierter Vertrag
- `specs/changes/2026-09-09-binding-intent-provisioning.md` (dieses Dokument)

## Files Changed

- `scripts/lib/plugin-workspace.mjs` — `collectWranglerBindingsWithIntents`
  (Intent-Pipeline + verbatim-Legacy-Merge mit Cross-Set-Konflikterkennung);
  `writePluginBindingsRegistry` generiert `api/plugin-bindings.ts`
- `scripts/lib/binding-consistency.mjs` — Konsistenz-Audit über alle beweglichen
  Teile (Intents, Provisionierung, Secrets, Ledger-Frische, Config-Sync) +
  Report-Drucker; läuft dynamisch in Install-, Provision- und Update-Flow
- `scripts/lib/binding-consistency-remote.mjs` — Remote-Drift-Check als
  wiederverwendbare Funktion (Update-Flow vor Deploy + `--check-remote`)
- `scripts/install-plugins.mjs` — Intent-Validierung direkt nach der
  Migrations-Validierung (fail-early); **Binding-Pipeline mit Schritt-Detektion**
  nach dem Registry-Rebuild: jeder Intent wird auf seinen Abschlusszustand für
  das aktuelle Environment klassifiziert (provisioniert via Ledger / pending /
  Secret-Link zu verifizieren), nur tatsächlich Fehlendes wird provisioniert
  (Ledger-Zeilen überspringen den API-Call), die Manual-Steps-Zusammenfassung
  ist dynamisch (erledigt = ✓, ausstehend = exakter Befehl). Ohne
  `CF_API_TOKEN`: nichts provisioniert, aber Pending-Schritte werden trotzdem
  aufgelistet (nicht-fatal); Re-Resolve nach erfolgreicher Provisionierung;
  **Consistency-Audit + Ready-to-deploy-Verdict** am Ende; Dispatch nur bei
  Direktaufruf (side-effect-free für Import durch update.mjs)
- `scripts/deploy.mjs` — `npm run deploy`: Consistency-Audit (bricht bei
  nicht-konvergentem Zustand mit Fix-Befehlen ab) → Remote-Drift-Report →
  `wrangler deploy`. Kanonischer Deploy-Pfad; `deploy:raw` umgeht die Prüfung.
- `scripts/auth-diagnostics.mjs` — `npm run auth:check`: Diagnose des Auth-Hooks
  auf der Live-DB (Hook-Version, Registry-Zustand, direkter Hook-Aufruf mit
  synthetischem Event → exakter Postgres-Fehler statt GoTrue-500)
- `scripts/migrate.mjs` — `npm run migrations`: wendet ausstehende CORE-Migrationen
  aus dem Workspace ohne Git-Gate an (kein Pull, kein Dirty-Check, kein Deploy) —
  checksummenbasiert idempotent, Drift-Reapply (--force/interaktiv),
  Auth-Hook-Registrierungsprüfung; für DB-Repairs bei uncommitted Arbeit
- `migrations/Auth/Access_hook_plugin_claims.sql` — **Availability-First-**
  Härtung: `default_tenant_for_user`-Fehler degradieren (Tenant-Claim entfällt),
  unlesbare Registry degradiert (Plugin-Claims übersprungen), der äußere
  `RAISE EXCEPTION` wurde zu Pass-Through (`RAISE WARNING` + Rückgabe des
  Events ohne injizierte Claims) — ein Hook-Defekt erzeugt keinen Login-500
  mehr; RLS schließt fehlende Claims (fail-closed), statt Logins zu brechen.
  **Root-Cause-Fix (durch `npm run auth:check` Debug-Twin gefunden):** die
  Rollen-Aggregation nutzte `r` als Tabellen-Alias, während die
  Plugin-Claims-Schleife `FOR r IN` dieselbe Variable deklariert — PL/pgSQL
  substituiert die Schleifen-Variable in `r.name`/`r.id` („record \"r\" is not
  assigned yet“) und degradierte damit JEDE Mint. Alias → `role_row`.
- `scripts/update.mjs` — Plugin-Phase: nach dem Registry-Rebuild provisioniert
  sie aktualisierte Manifests nach (über den exportierten
  `provisionPluginBindingIntents`) und führt dasselbe Consistency-Audit aus;
  die Build-&-Deploy-Phase führt den Remote-Drift-Check vor dem
  wrangler-Prompt aus (nicht-fatal ohne Token)
- `scripts/uninstall-plugin.mjs` — Ledger-Report + Teardown-Hinweis im
  Manual-Steps-Summary
- `src/types/plugin.ts` — `PluginBindingIntents`, `PluginDeploymentPath`,
  `PluginBindingScope`, Intent-Interfaces, `PluginBindingIntentDescriptor`;
  `deployment_path` + `wrangler_intents` am Manifest; `wrangler_bindings` als
  `@deprecated` markiert
- `package.json` — `bindings:provision` Script
- `.gitignore` — `api/plugin-bindings.ts`, `.bindings-ledger.json`
- `AGENTS.md` — §4 Cloudflare Worker Bindings (Intents, Deployment-Pfad,
  Ledger, Provision-CLI), Generated-Files-Liste
- `specs/plugins/development.md` — §3.1 als deprecated markiert, neuer §3.2
  „Binding Intents (preferred)" mit Deployment-Pfad-Doktrin
- `specs/plugins/installation.md` — Install-Ablauf (Validierung + Provisioning),
  Run-Order install → provision → build → deploy, Teardown im Uninstall,
  Troubleshooting (duplicate-consumer, KV-ID fehlt)
- `specs/plans/BINDING-MANAGEMENT.md` — Implementierungsstatus + Abweichungen
- `specs/platform/README.md` — Dokument registriert
- `wrangler.jsonc` (lokal, gitignored) — PLUGIN-BINDINGS-Abschnitt referenziert
  die resolveden Instanznamen (regeneriert)
- `plugins/pluradash/plugin.json` (Plugin-Repo, gitignored — **Change ist im
  Plugin-Repository zu dokumentieren**): Migration auf `wrangler_intents`
  (`deployment_path: "cloudflare"`, Queue-Intent mit purpose
  `sms-notifications`, Secrets als shared Link-Intents, vars übernommen;
  `wrangler_bindings` entfernt). **Legacy-Support bleibt vollständig erhalten**
  — die Migration zeigt zugleich den empfohlenen Migrationsweg für andere
  Plugins (Rezept in specs/platform/binding-management.md).
  **Nachbesserung:** Die erste Migration ließ den `ai`-Binding-Eintrag fallen
  (wrangler deploy warnte, die Remote-Config würde `ai: { binding: "AI" }`
  entfernen); korrigiert — `wrangler_intents.ai` ist wieder gesetzt und die
  Migrationsrezeptur (§9 in specs/platform/binding-management.md) weist
  explizit darauf hin, `ai`/`vars`/`durable_objects` 1:1 zu übernehmen.

## Impact Analysis

- **Database:** keine Änderung. Keine Migration. (Ledger ist gitignorierter
  JSON-Sidecar, kein DB-Table — Core-DB-Ledger bleibt offen.)
- **Runtime:** Worker-Code unverändert — Plugins lesen weiterhin
  `env.<BINDING>`; nur die Instanz dahinter ist jetzt environment-lokal.
  Generierter `wrangler.jsonc`-Abschnitt: gleiche Struktur, aufgelöste Namen.
- **API surface:** keine. Neu generiert: `api/plugin-bindings.ts`
  (deskriptiv, wie `plugin-claims.ts`).
- **Build:** `predev`/`prebuild` validiert Intents (Build-Error bei Verletzung)
  und injiziert resolvede Einträge; Legacy-Manifeste verhalten sich wie bisher
  (verbatim) mit Deprecation-Warning. Gemischte Workspaces: Cross-Set-
  Konflikte brechen den Build ab.
- **Provisioning:** Netzwerk-Calls nur bei `bindings:provision` bzw. Installer
  mit vorhandener `CF_API_TOKEN`. Ohne Token: informative Skip-Meldung
  (nicht-fatal). Secret-Werte verlassen nie das Manifest/den Secrets Store.
- **Tests:** 159 grün (26 neu in `tests/bindingIntents.test.mjs`);
  `npm run typecheck` (App) und `npm run typecheck:api` grün (nur bekannte,
  nicht-kernseitige PluraDash-Workspace-Fehler in `typecheck:api`); `npm run
  build` erfolgreich; `register-plugins.mjs`/`provision-bindings.mjs --dry-run`
  manuell gegen den lokalen Workspace (Legacy- und Intent-Modus) verifiziert.
