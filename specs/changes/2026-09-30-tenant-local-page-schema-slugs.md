# 2026-09-30 — Tenant-local page schema slugs

## Summary

Page schema slugs are now tenant-local, allowing separate workspaces to use the same generic slug (for example, `blog`). Tenant-owned schemas use tenant-qualified CMS routes (`/pages/schema/{tenant_slug}/{schema_slug}`). A stable `api_slug` preserves the former globally unique slug for existing schema API URLs and provides an unambiguous API identifier for new schemas.

Legacy one-segment CMS routes continue to resolve through `api_slug`. Existing schemas are backfilled with `api_slug = slug`, so pre-existing links and integrations remain valid.

## Files Added

- `migrations/202609300001_tenant_local_page_schema_slugs.sql` — backfills stable API identifiers, replaces global schema-slug uniqueness with tenant-scoped/global partial unique indexes, and assigns API identifiers to new rows.
- `src/utils/schemaPaths.ts` — builds tenant-qualified console paths while retaining legacy route behavior.
- `tests/schemaPaths.test.mjs` — covers tenant-local paths and legacy aliases.

## Files Changed

- `scripts/lib/migration-order.mjs` — registers the migration after schema tenancy/content-scope migrations.
- `src/types/pagebuilder.ts`, `src/services/pageService.ts` — represent local slug/API identifier separately and create/resolve slugs within the selected tenant.
- `src/App.tsx`, `src/pages/Pages.tsx`, `src/pages/PagesSchemaDetail.tsx`, `src/pages/SchemaEditor.tsx`, `src/pages/PageBuilder.tsx`, `src/components/pagebuilder/SchemaPageBuilderForm.tsx`, `src/components/pagebuilder/SchemaWaitingScreen.tsx`, `src/components/navigation/Breadcrumb.tsx` — add tenant-qualified console routes and use stable API identifiers for Worker calls.
- `api/lib/schemaCreation.ts`, `api/lib/schemaRegistration.ts`, `api/lib/frontendManifest.ts`, `api/routes/schemas.ts`, `api/routes/mcp.ts`, `api/routes/specs.ts`, `api/routes/health.ts`, `api/middleware/agentLogger.ts` — use `api_slug` for existing slug-addressed API routes while exposing the tenant-local schema slug separately in discovery/metadata.
- `specs/architecture/page-builder.md` — documents tenant-local schema identity and the legacy API alias.

## Impact Analysis

### Database

Adds `page_schemas.api_slug`. Existing rows retain their former `slug` as `api_slug`; newly inserted schemas receive a stable UUID API identifier. `page_schemas.slug` is unique per non-null tenant, while global/system schemas remain unique among themselves. Existing page and schema records are not rewritten beyond the API-slug backfill.

### Runtime

Tenant-owned schemas navigate through `/pages/schema/{tenant_slug}/{schema_slug}`. Existing one-segment CMS links remain valid. Tenant selection and RLS continue to determine which schema rows are visible. API integrations continue addressing existing schemas with their old URL segment.

### API Surface

Existing `/api/schemas/:slug/...` routes retain their shape and use `api_slug` as the path identifier. Discovery adds `schema_slug` for the tenant-local name and `api_slug` for the stable API identifier; the legacy `slug` response field remains the API identifier for compatibility. New schemas should use `api_slug` for API URLs.
