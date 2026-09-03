# 2026-09-03 — Shared Storage Quota, `apps` Scope statt `apps` Allocation

## Summary

Die in `202608300001_tenant_storage_allocation_types.sql` eingeführte
dedizierte `apps`-Allocation (`allocation_type`-Spalte mit eigenem
Quota-Bucket für PluraDash-Workspace-Dateien) beruhte auf einem
Missverständnis und war die Root Cause wiederholter
`Storage quota exceeded.`-Fehler (Incident vom 03.09., Workspace
`2cf52cad-3ab8-4805-8088-45924097eed0`): Der Usage-Sync-Trigger legte bei
erstem Auftreten eines `.../files/apps/...`-Katalogobjekts automatisch eine
Allocation-Zeile mit `quota_bytes = 0` an. `ensureTenantStorageSummary()`
wendet die Hook-Konfiguration (2 GiB) nur bei *Neu*-Provisionierung an —
bestehende Zeilen wurden nie reconciled, somit blieb der Bucket dauerhaft bei
0 Byte Restkontingent, während der generische `files`-Bucket (500 MB, fast
unbenutzt) im Dashboard „viel Speicher frei“ anzeigte.

Neues Modell (nun dokumentierte Intention):

- **Ein gemeinsamer Quota-Bucket** pro `(tenant_id, user_id)` — für alle
  Scopes (`media`, `files`, `apps`). Die Spalte `allocation_type` entfällt,
  der Primary Key von `tenant_storage_allocations` ist wieder
  `(tenant_id, user_id)`.
- **Workspace-App-Dateien werden nur noch kategorial unterschieden**: neuer
  Scope-Wert `apps` in `tenant_storage_objects.scope`. Der Sync-Engine-Write
  (`putWorkspaceFile`) registriert Katalogzeilen mit `scope = 'apps'`.
- Der Usage-Sync-Trigger ist auf die ursprüngliche Single-Bucket-Semantik
  zurückgesetzt (nur UPDATE, **kein** Auto-INSERT von Allocation-Zeilen) —
  Provisionierung erfolgt ausschließlich über
  `ensureTenantStorageSummary()`.
- Sicherheitsnetz: `ensureTenantStorageSummary()` reconciled bestehende
  Zero-Quota-Zeilen mit dem konfigurierten Hook-Quota (0 → konfigurierter
  Wert), sodass sich die Fehlerklasse nicht wiederholen kann.
- `TENANT_STORAGE_SCOPES` (client-facing) bleibt `media`/`files`; `apps` ist
  ein engine-verwalteter Scope und bewusst nicht client-schreibbar.

## Files Added

- `migrations/202609030001_tenant_storage_shared_apps_scope.sql` —
  idempotente Migration: Trigger-Restore, Scope-Constraint-Erweiterung
  (`media`, `files`, `apps`), Back-fill `scope='apps'` für
  `.../files/apps/...`-Keys, Usage-Neuberechnung aus dem Katalog (fixt
  historischen `used_bytes_cached`-Drift), Carry-over/Entfernung der
  `apps`-Allocation-Zeilen, PK-Rückbau auf `(tenant_id, user_id)`,
  Drop von Check-Constraint und Spalte `allocation_type`.

## Files Changed

- `api/lib/tenantStorageHooks.ts` — `TenantStorageScope` um `'apps'`
  erweitert; `allocationType` aus `TenantStoragePolicyContext` entfernt.
- `api/lib/tenantStorageMgt.ts` — `allocation_type`-Filterung/Provisionierung
  entfernt; `readTenantStorageUsageBytes` zählt alle Scopes; Zero-Quota-
  Reconciliation in `ensureTenantStorageSummary()`; `allocationType`-Parameter
  bleibt als deprecated No-Op zur Kompatibilität bestehen.
- `scripts/setup.mjs` — neue Migration in `MIGRATION_ORDER` registriert.
- `specs/agents/r2-file-storage.md`,
  `specs/features/pluradash-r2-sync-engine.md`,
  `specs/agents/plurapi-file-sync-integration.md` — Doku auf das
  Shared-Bucket-Modell umgestellt.

### Plugin-Änderung (eigenes Repository `plugins/pluradash/`, gitignored)

- `api/sync/engine.ts` — `ensureQuota` ohne `allocationType`, Scope `apps`
  (nur Policy-Kontext; Quota ist der gemeinsame Bucket).
- `api/sync/storage.ts` — `putWorkspaceFile` registriert Katalogzeilen mit
  `scope: 'apps'`.
- `api/storageHooks.ts` — Policy-Hook ohne `apps`-Branch; Support-User
  erhalten den bisherigen `DEFAULT_SUPPORT_QUOTA_BYTES` (500 MB) als
  gemeinsames Kontingent.
- Doku: `plugins/pluradash/specs/changes/2026-09-03-shared-storage-quota.md`,
  `plugins/pluradash/specs/app-sync-mcp-tools.md` (§Quota-Check).

## Impact Analysis

### Database

- Migration **destruktiv in einem Punkt**: Spalte `allocation_type` wird
  gedroppt. Vorher werden `apps`-Zeilen entfernt; Quota-Einstellungen von
  Tenants, die *nur* eine `apps`-Zeile besaßen, werden in eine `files`-Zeile
  übernommen (Quota 0 → wird beim nächsten
  `ensureTenantStorageSummary()`-Aufruf durch die Reconciliation auf den
  Hook-Konfigurationswert gehoben).
- `used_bytes_cached` wird aus dem Katalog neu berechnet (alle Scopes) —
  behebt bestehenden Zähler-Drift.
- Keine RLS-Änderung; Policies greifen unverändert.

### Runtime

- Trigger zählt wieder alle Objekte in genau eine Allocation-Zeile.
- Speichern/Pullen im Sync-Engine-Workspace prüft das gemeinsame Kontingent
  des angemeldeten Benutzers (Tenant-Fallback-Verhalten von `resolveTenant`
  unverändert).
- Der Incident-Workspace (`2cf52cad-…`) ist nach der Migration unblockiert:
  seine `files`-Zeile (500 MB, ~9 MB belegt) trägt fortan auch die
  ~257 KB Workspace-Dateien.

### API Surface

- Keine Routen-Änderungen. `TenantStoragePolicyContext.allocationType`
  entfällt (Breaking für Plugin-Hooks, die das Feld lesen — nur PluraDash
  betroffen, angepasst). `allocationType`-Parameter von
  `ensureTenantStorageSummary` wird akzeptiert, aber ignoriert (deprecated).
