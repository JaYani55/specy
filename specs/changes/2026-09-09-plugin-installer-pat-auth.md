# 2026-09-09 — Plugin Installer & Uninstaller: PAT-Auth statt interaktivem Supabase-Login

## Summary

`scripts/install-plugins.mjs` und `scripts/uninstall-plugin.mjs` fragen für
DB-Operationen nicht mehr E-Mail + Passwort per interaktivem Supabase-Login
(`signInWithPassword`) ab, sondern nutzen konsequent einen **Supabase Personal
Access Token (PAT)** über die Management API — denselben Mechanismus, den die
Migrations-Pfade bereits verwendeten. Der PAT wird aus der Umgebungsvariable
`SUPABASE_ACCESS_TOKEN` (oder `.env`/`.env.local`) gelesen, fehlt er, wird er
einmalig interaktiv abgefragt. Er wird nie persistiert.

**Begründung:** Auf dem lokalen Dev-Repo haben nur Admins Zugriff; der
interaktive Rollen-Login (JWT-basiert, RLS + Rollen-Check) war redundante
Reibung. Der PAT-Weg macht den Installer zusätzlich CI-tauglich
(`SUPABASE_ACCESS_TOKEN` als CI-Secret, kein TTY nötig).

**Sicherheitsmodell-Änderung:** Die Management API führt SQL mit
Projekt-Owner-Privilegien aus — **RLS greift nicht**. Der frühere
Admin-/Super-Admin-Rollen-Check im Installer entfällt; die Zugriffskontrolle
verlagert sich vollständig auf die Vertraulichkeit des PAT und der lokalen
 Umgebung. Ein geleakter PAT ist account-weit mächtiger als das bisherige
Projekt-JWT (siehe specs/plugins — Installations-Lifecycle).

## Verhalten

- **PAT-Quelle:** `process.env.SUPABASE_ACCESS_TOKEN` → `.env`/`.env.local`
  → interaktiver Prompt (paste-friendly, einmal pro Run).
- **Validierung:** Vor der ersten Operation wird der PAT per
  `select 1` gegen `api.supabase.com` verifiziert; ungültige Tokens brechen
  mit Exit-Code 1 ab.
- **DB-Operationen über SQL** (statt PostgREST): `fetchRegisteredPlugins`,
  `markPluginInstalled`, `syncPluginConfigSchema`, `markPluginError` und das
  `--list`-Listing laufen jetzt über `runSqlQuery` (Management API).
- **Kein Doppel-Prompt:** `_doInstall`/`_doUninstall` reichen den bereits
  aufgelösten PAT an die Migrations-Pfade weiter; der bisherige separate
  Migrations-Prompt entfällt, wenn schon eine PAT-Verbindung besteht.
- **Workspace-First-Flow:** `cmdPickAndInstall` scannt zuerst `plugins/*/plugin.json`
  (via `scanWorkspacePlugins`) und merged DB-registrierte Einträge dahinter
  (Dedupe per Slug). Lokale Workspace-Plugins werden nicht erneut heruntergeladen
  (`plugin.local` + existierender Ordner → Skip-Download); `syncToPluginsJson`
  nimmt keine Workspace-Einträge auf. `ensurePluginRegistered` upserted jedes
  installierte Plugin in die `plugins`-Tabelle (`INSERT … ON CONFLICT (slug)
  DO NOTHING`), damit Status-Updates (`installed`/`error`) immer eine Zeile haben.
  Fehlgeschlagene Installationen löschen Workspace-Ordner nicht mehr (nur
  heruntergeladene Artefakte) — der Ordner ist das User-eigene Plugin-Repo.
- **Maskierter PAT-Prompt:** Neue `promptSecret()`-Funktion (Raw-Mode, `*`-Feedback,
  paste-safe durch Zeichen-für-Zeichen-Iteration von Input-Chunks) ersetzt das
  Klartext-`promptLine` für alle PAT-Eingaben in Installer und Uninstaller.
  Fehlgeschlagene PAT-Verifikation führt zum Skip der DB-Operationen statt
  hartem Abbruch (Workspace-Install bleibt möglich).
- **Graceful Degradation:** Ohne PAT (Skip im Prompt, Non-TTY) werden
  DB-Status-Updates übersprungen wie bisher ohne Client; `--local` bleibt
  PAT-frei.
- **Windows-Fix:** `process.exit()` nach `fetch()` crasht auf Windows mit
  libuv-Assertion (Exit-Code 127). `die()` wirft im Installer ein
  `FatalError`-Sentinel, das der Entry-Point fängt; der Exit-Code wird über
  `process.exitCode = 1` gesetzt und der Event-Loop läuft sauber aus. Im
  Uninstaller wird der Abort-Pfad nach PAT-Verifikation über
  `process.exitCode = 0` + `return` gelöst.
- **Uninstaller (`scripts/uninstall-plugin.mjs`):** Derselbe PAT-Mechanismus,
  aber mit Best-Effort-Semantik — ein ungültiger/fehlender PAT bricht das
  lokale Cleanup nicht ab, sondern überspringt nur DB-Status-Update und
  Down-Migrations (wie bisher bei fehlgeschlagenem Login).
  `markPluginUninstalled` läuft über SQL (`status = 'registered',
  installed_at = NULL`), `applyDownMigrations` übernimmt den bereits
  aufgelösten PAT (kein zweiter Prompt, CI-fähig).

## Files Added

- `scripts/lib/sqlStr.mjs` — geteiltes SQL-Literal-Escaping für
  Management-API-Queries
- `tests/pluginInstallerPat.test.mjs` — Regressionstests für `sqlStr`
  (Quote-Escaping, Injection-Guard, Quote-Balance, Koersion)
- `specs/changes/2026-09-09-plugin-installer-pat-auth.md` (dieses Dokument)

## Files Changed

- `scripts/install-plugins.mjs` — PAT-basierte DB-Schicht (`resolvePat`,
  `createPatDb`, `patQuery`), Entfernung von `createAnonClient`,
  `getJwtRoles`, `promptPassword`, `loginInteractive`; DB-Helper auf SQL
  umgestellt; `applyPluginMigrations` akzeptiert bestehenden PAT;
  `die()`/Entry-Point-Fix für Windows; Header-/Help-Doku aktualisiert
- `scripts/uninstall-plugin.mjs` — PAT-basierte DB-Schicht (Best-Effort:
  `warn` statt `die` bei PAT-Fehlschlag), Entfernung von `createAnonClient`,
  `getJwtRoles`, `promptPassword`, `loginInteractive`;
  `markPluginUninstalled` auf SQL umgestellt; `applyDownMigrations`
  akzeptiert bestehenden PAT; Abort-Pfad ohne `process.exit()` nach fetch

## Impact Analysis

- **Database:** Keine Schema-Änderung. Die betroffenen Queries
  (`SELECT`/`UPDATE` auf `public.plugins`) sind inhaltlich identisch zur
  bisherigen PostgREST-Nutzung; Escaping geschieht jetzt über `sqlStr`
  (getestet).
- **Runtime:** Keine Auswirkung auf API, Dashboard oder Edge Functions —
  reines Tooling-Skript.
- **API surface:** Keine Änderung.
- **Sicherheit:** RLS wird für Installer-Operationen nicht mehr durchlaufen
  (Owner-Privilegien via PAT). Rollen-Check entfällt. Doku in
  `specs/plugins/installation-lifecycle.md` sollte beim nächsten Anfassen
  des Plugin-Lifecycles den PAT-Flow spiegeln.
- **Tests:** 4 neue Tests in `tests/pluginInstallerPat.test.mjs`; alle
  117 Tests grün, `npm run typecheck` exit 0, `npm run build` erfolgreich.
  Smoke-Tests: Installer `--list` ohne/ungültigem PAT, Uninstaller mit
  Wegwerf-Plugin und ungültigem PAT (lokales Cleanup erfolgreich, DB-Skip
  korrekt). Nicht verifiziert: Happy Path mit echtem PAT gegen ein
  Live-Projekt, interaktive TTY-Prompts.
