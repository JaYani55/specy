# Page-domain (TLD) tenant ownership and display naming

## Summary

TLDs in the Pages feature were previously purely derived from
`page_schemas.frontend_url` grouping — they had no owner and no name of their
own. This change introduces a first-class `public.page_domains` registry with:

1. **Tenant ownership** — super-admins (custom claim `user_roles`) can move a
   TLD to a different tenant via an atomic, cascading reassignment RPC,
   mirroring the PluraDash GitHub-Apps workspace-assignment model.
2. **Arbitrary display names** — super-admins can rename a TLD independently of
   the domain URL itself, which stays unchanged and remains the default
   assigned name (empty/null falls back to the domain host).

## Files Added

- `migrations/202610110001_page_domains.sql` — `public.page_domains` table
  (`domain_url` unique, `tenant_id` → tenants, `display_name` ≤120 chars),
  RLS (select for tenant members/null-owner rows; write super-admin only),
  `reassign_page_domain_tenant(uuid, uuid)` SECURITY DEFINER RPC with
  in-function super-admin check and atomic cascade, plus idempotent backfill of
  pre-existing domains (first non-null tenant id — uuid has no `min()`
  aggregate).
- `specs/features/page-domains.md` — feature documentation (registry lifecycle,
  reassignment semantics, ordering paradox, RLS, API surface).
- `specs/changes/2026-10-11-page-domain-tenant-ownership-and-naming.md` — this
  record.
- `tests/pageDomains.test.mjs` — contract checks (migration order/content, API
  role guards, frontend wiring, catalog registration).

## Files Changed

- `scripts/lib/migration-order.mjs` — register `202610110001_page_domains.sql`
  after every table/helper it references.
- `api/lib/schemaRegistration.ts` — registration now ensures a `page_domains`
  row for the frontend origin (ownership assigned only on first sight; unique
  races tolerated).
- `api/routes/schemas.ts` — super-admin endpoints `GET /api/schemas/admin/domains`
  and `PATCH /api/schemas/admin/domains/:id` (ownership move via the RPC
  invoked with the **user's bearer token** — the JWT `user_roles` claim must
  reach the database session for the in-function `is_super_admin()` guard;
  display-name update; 409 for blocked cascades). The GET endpoint additionally
  returns a migration-scope preview per domain (`page_count`, `product_count`,
  `event_count`, `company_count`, `blocking_company_names`,
  `blocking_product_names`) mirroring exactly what the RPC moves — including
  event-referenced products without a canonical page.
- `src/types/pagebuilder.ts` — `TLDRegistryEntry` type; `TLDGroup.domain_registry`.
- `src/services/pageService.ts` — `getAdminPageDomains()`,
  `updateAdminPageDomain(id, patch)`; `groupSchemasByTLD` accepts a registry map;
  `deleteSchema(apiSlug)` now performs a guarded hard delete through the API
  (previously an unused soft-archive helper).
- `src/pages/PagesSchemaDetail.tsx` — destructive **Schema löschen** action
  (super-admin, disabled while pages are attached) with confirmation dialog;
  navigates back to `/pages` after deletion.
- `src/pages/Pages.tsx` — TLD cards show display-name title with raw domain as
  description; super-admin-only workspace select that opens a migration-scope
  **move dialog** (no browser confirm): scope list (schemas/pages/events/
  products/companies), blocking-company warning, inline error with retry;
  Rename dialog; "Mixed ownership" drift badge.
- `src/lib/apiCatalog.ts` — both admin endpoints documented.
- `specs/features/README.md` — register `page-domains.md`.

## Impact analysis

### Database

New table `public.page_domains` with `updated_at` trigger and RLS; new SECURITY
DEFINER function `public.reassign_page_domain_tenant` (granted to
`authenticated`; guarded by `is_super_admin()` from the JWT). The cascade moves
`page_schemas`, `pages`, `schema_frontend_targets`, `page_content_templates`,
`mentorbooking_products`, `mentorbooking_events`, the **companies and
(event-referenced, possibly pageless) products** assigned to the moved events
(with pre-checks blocking moves when a company/product is also referenced by
events outside the domain or a product's page lives outside it) and the
registry row in one transaction. The `enforce_event_page_link` constraint trigger on `pages` is
temporarily disabled inside the transaction to resolve the ordering paradox
with the event BEFORE trigger; ALTER TABLE is transactional, so a rollback
re-enables it automatically. The catalogue guard triggers reject direct event-
page writes, so the RPC enables the aggregate escape hatches
(`specy.event_page_write`, `specy.product_schema_reassignment`) locally for its
transaction — the same pattern the aggregate services use. No existing data is
rewritten except the idempotent domain backfill (insert-only,
`on conflict do nothing`).

### Runtime

Registration writes one extra row (best-effort upsert-if-missing). The
dashboard `/pages` page performs two additional best-effort reads for
super-admins (`/api/schemas/admin/domains`, tenant list); non-super-admin
sessions are unchanged. Reassignment failures (e.g. event aggregates whose
company stays in the old workspace) surface as toasts with the database reason;
there is no partial move.

### API surface

Two new super-admin-only endpoints (documented in `src/lib/apiCatalog.ts`),
plus a super-admin-only `DELETE /api/schemas/:slug` for permanent deletion of
unused schemas (guards: default schemas and schemas with attached pages are
refused; secret removed, targets/specs/templates cascade, registry row kept).
Unassignment of a TLD is intentionally unsupported (`tenant_id` must be a
tenant UUID).

## Verification

- `npm run typecheck` / `npm run build` — pass (see test run below).
- `npm test` — pass, including `tests/coreMigrations.test.mjs` ordering for the
  new migration and `tests/pageDomains.test.mjs` contract checks.
- Live database verification (RLS behavior, real tenant move with event/company
  aggregates) pending — requires a configured environment.

## Related

- `specs/features/page-domains.md`
- `specs/features/pluradash-github-app-integration.md` (assignment model
  reference)
- `specs/changes/2026-10-05-product-schema-management-and-reassignment.md`
  (tenant guards on pages this RPC interacts with)