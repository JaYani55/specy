# 2026-09-09 — Support-Role-RLS von PluraDash 009 nach Core verlagert

## Summary

Die PluraDash-Migration `009_secondbrain_rls_support_override.sql` enthielt
DDL auf Core-Tabellen (`CREATE OR REPLACE FUNCTION public.is_support()` +
7 RLS-Policies auf `public.tenants`, `public.tenant_storage_objects`,
`public.tenant_storage_allocations`) — ein Verstoß gegen die Core/Plugin-
Grenze (AGENTS.md §4: Plugin-Migrationen dürfen nur DDL im eigenen Schema).
Die Statements wurden **1:1** (gleiche Policy-Namen, gleiche USING/WITH CHECK-
Ausdrücke — keine semantische Änderung) in die Core-Migration
`202609090002_support_role_core_rls.sql` verlagert; die Plugin-Migration
behält nur die `pluradash.*`-Policies.

Damit ist PluraDash wieder installierbar (Installer-Migrations-Validierung
grün) und die Support-Visibility auf Core-Tabellen ist Core-Policy —
konsistent mit der Dokumentation in
`specs/auth/authentication-authorization.md` (Z. 221: `is_support()` als
Core-Pattern).

## Files Added

- `migrations/202609090002_support_role_core_rls.sql` — `is_support()`,
  7 Core-Tabellen-Policies (1:1 aus PluraDash 009), Seed der `support`-Rolle
  in `public.roles` (fehlte bisher — ohne Seed gibt `is_support()` permanent
  false; gleiches Insert-Pattern wie `roles.sql`)

## Files Changed

- `scripts/lib/migration-order.mjs` — Migration registriert (nach der
  Auth-Hook-Gruppe; vor Plugin-Installationen, die `public.is_support()`
  referenzieren)
- `plugins/pluradash/migrations/009_…sql` + `down/009_…sql` — **im
  Plugin-Repo** (JaYani55/pluradash, gitignored Workspace): Core-Tabellen-
  Statements entfernt, Verweiskommentare ergänzt. Dort committen/pushen.

## Impact Analysis

- **Database:** Policies werden per `DROP POLICY IF EXISTS` + `CREATE` mit
  identischem Namen/Inhalt neu geschrieben — auf Bestands-Instanzen, die 009
  bereits ausführten, ist das Ergebnis identisch (kein Verhaltenswechsel).
  Neu: die `support`-Rolle existiert nach der Migration garantiert in
  `public.roles` (bislang manuell angelegt). Neue Policy-Zuweisung (bewusste
  Entscheidung): `support`-Rolle erhält Lesezugriff auf `public.tenants` und
  Lese-/Schreibzugriff auf Tenant-Storage-Objekte/Allocations neben
  `super-admin`/Tenant-Mitgliedern — dokumentiert in
  `specs/auth/authentication-authorization.md` Z. 141.
- **Runtime:** Keine. `is_support()` ist STABLE/sql, wird nur in RLS-Klauseln
  referenziert.
- **Ordering:** Migration liegt in `MIGRATION_ORDER` vor jeder
  Plugin-Installation; Plugin-Migration 009 referenziert `public.is_support()`
  und setzt daher voraus, dass Core-Migrationen aktuell sind (lautstarker
  Fehler, falls nicht — kein stilles Verhalten).
- **Tests/Gates:** 130 Tests grün, typecheck + build erfolgreich,
  Installer-Migrations-Validierung für PluraDash: `ok: true`.
- **Plugin-Repo-Doku:** Die Änderung an 009 muss im PluraDash-Repo mit einem
  eigenen Change-Record dokumentiert werden (dortige AGENTS-Regel).
