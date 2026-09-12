# 2026-09-10 — Deployment State Tracking

## Summary

Implementierung von [`specs/plans/DEPLOYMENT-STATE-TRACKING.md`](../plans/DEPLOYMENT-STATE-TRACKING.md):
ein einziges, typisiertes **Deployment-State-Registry** in der Datenbank statt des
EAV-Namespace `core_update`. Neu: `public.deployment_state` mit
Ownership-Diskriminator (`core`/`plugin`), FK von Plugin-State → `public.plugins`
(`ON DELETE CASCADE`), einheitlicher `value`-Shape, Backfill aus Alt-Daten,
Dual-Write der Core-Writer (Legacy-Shim bleibt lesbar), Plugin-State-Schreibpfade
(Install/Uninstall/Provisioning), ein `npm run state:recheck`-Catch-up/Repair-Flow
und eine AGENTS.md-Regel für State-Publication.

## Analysis

Vorher lag der State an vier Orten (`system_config.core_update`,
`public.plugins`, `public.plugin_claims`, gitignorierte Sidecars), die sich weder
über Ownership noch referenzielle Integrität einig waren. Konsequenzen: keine
typisierte Antwort auf „was ist deployed, von wem, in welcher Version, und gilt
es noch?", kein FK auf `plugin_claims`, kein Catch-up-Pfad (ältere Prod-Deployments
divergierten still) und keine transaktionale Garantie beim Uninstall.

## Files Added

- `migrations/202609100001_deployment_state.sql` — Tabelle + partielle Unique-
  Indexe + FK (`plugins.id` cascade) + RLS + Backfill (core aus `core_update`,
  plugin `code`/`claims` aus `plugins`+`plugin_claims`).
- `migrations/202609100002_plugin_claims_ownership.sql` — `plugin_claims` erhält
  eine Companion-FK `plugins_id uuid REFERENCES public.plugins(id) ON DELETE
  CASCADE` + Trigger (siehe Deviations).
- `scripts/lib/deployment-state.mjs` — Writer/Reader/Leser für
  `public.deployment_state` (pure Helfer + dünne Executoren/Klassifikation).
- `scripts/state-recheck.mjs` — `npm run state:recheck` (default dry-run,
  `--sync` repariert idempotent).
- `tests/deploymentState.test.mjs` — 17 Regressionen (Owner-Normalisierung,
  Key-Mapping, SQL-Builder, Reconcile-Klassifikation).
- `specs/changes/2026-09-10-deployment-state-tracking.md` (dieses Dokument).

## Files Changed

- `scripts/lib/core-update.mjs` — `upsertCoreUpdateRecords` schreibt jetzt
  dual (Legacy `system_config` **und** `deployment_state`); `registerAuthHook`
  zeichnet `auth_hook`-State nach bestätigtem PATCH auf.
- `scripts/lib/migration-order.mjs` — beide neuen Migrationen registriert
  (nach `plugin_claims`/`plugins`/`system_config`).
- `scripts/install-plugins.mjs` — schreibt nach bestätigtem Install
  `code`/`claims`-State sowie `bindings`-State nach dem Provisioning.
- `scripts/uninstall-plugin.mjs` — Clean Uninstall: löscht
  `deployment_state`-Zeilen und `plugin_claims`-Zeilen explizit.
- `scripts/provision-bindings.mjs` — best-effort `bindings`-State nach
  erfolgreichem Provisioning (Supabase PAT optional).
- `scripts/setup.mjs` — TUI-Aktion „Re-check deployment states".
- `package.json` — Script `state:recheck`.
- `AGENTS.md` — neue Subsection „Deployment State Publication" (§5).
- `specs/platform/unified-setup-tui.md` — neuer Abschnitt §5 mit Schema,
  `value`-Shape und Component-Taxonomie; Open Items aktualisiert.
- `specs/plans/DEPLOYMENT-STATE-TRACKING.md` — Status → IMPLEMENTED,
  Phasen-Tabelle aktualisiert.

## Discussion / Deviations

1. **`plugin_claims` FK als Companion-Spalte statt Type-Change.** Der Plan
   schlägt vor, `plugin_claims.plugin_id` von `text` auf `uuid` umzustellen. Das
   würde den dokumentierten Layer-2-Contract brechen (Plugin-Migrationen
   insertieren den *Slug* als `plugin_id` — identisch mit `claim_key`). Statt
   dessen trägt eine neue `plugins_id uuid`-Spalte den echten FK
   (`ON DELETE CASCADE`); ein BEFORE-Trigger löst sie aus dem Slug auf. Gleiche
   referenzielle Integrität, kein Contract-Bruch.
2. **Legacy `core_update` bleibt als Read-Only-Shim** (Open Question 3) — kein
   zweiter Writer; der Backfill der Migration + `state:recheck --sync` ist der
   dokumentierte Prod-Catch-up-Pfad. Kein automatisches `DROP` der Alt-Zeilen.
3. **Plugin-Migrations-State wird nicht vom Installer geschrieben.** Der
   Installer-Pfad kann Migrationen überspringen (kein PAT / non-interaktiv /
   User lehnt ab), daher wäre ein pauschales `applied` falsch. Die
   Recheck-Klassifikation/`--sync` backfillt unrecorded Plugin-Migrationen
   (der Plan selbst stuft diese Zeilen als „nicht rekonstruierbar → recheck"
   ein).
4. **`config` bleibt inline auf `public.plugins`** (Open Question 2) — es ist
   Daten, kein State; die Taxonomie reserviert den Slot nur.

## Impact Analysis

- **Database:** neue Tabelle `public.deployment_state` (+ Indexe, Trigger für
  `updated_at`, RLS, partielle Unique-Constraints) und
  `plugin_claims.plugins_id` + FK + Trigger. Backfill idempotent
  (`ON CONFLICT DO NOTHING`). Keine Daten in `system_config` werden gelöscht.
- **Runtime/API surface:** keine Änderung an Worker-/API-Code; reines Tooling +
  Datenbank.
- **Verhalten:** Core-/Plugin-Mutationen publizieren jetzt State nach
  Bestätigung; `npm run state:recheck` liefert einen maschinenlesbaren
  Konvergenz-Report.
- **Sicherheit:** `deployment_state`-Writes laufen nur über Management-API/
  Service-Role (RLS: Admin/Super-Admin-Reads, keine User-Writes). Keine Secrets
  in State-Werten.
- **Tests:** `tests/deploymentState.test.mjs` (17) grün; `tests/coreMigrations.test.mjs`
  deckt die neue Migrations-Reihenfolge ab.
- **Nicht verifiziert:** Live-DB-Durchlauf (Backfill + RLS gegen ein echtes
  Projekt), interaktive TTY-Pfade, Cloudflare-Provisioning-State gegen echtes
  Konto.