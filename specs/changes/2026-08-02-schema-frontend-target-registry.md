# Schema Frontend Target Registry

## Summary

Introduces the first implementation slice for separating arbitrary schema content from frontend placement. A schema can now describe collection-slot and detail-page targets without changing its stored schema definition or page content.

The target registry is designed to support a blog collection rendered in a landing-page section such as `/` with a semantic placement key such as `home.posts`. A browser fragment such as `#posts` remains frontend-local and is not persisted or used for server revalidation.

## Files Added

- `migrations/202608020001_schema_frontend_targets.sql`
- `specs/changes/2026-08-02-schema-frontend-target-registry.md`

## Files Changed

- `src/types/pagebuilder.ts`
  - Added frontend target and target-level revalidation contracts.
- `api/lib/schemaRouting.ts`
  - Added collection host-path and frontend-target validation.
- `scripts/setup.mjs`
  - Registered the target migration for fresh setup.
- `scripts/lib/core-update.mjs`
  - Registered the target migration for incremental updates and aligned the later poll/visibility migrations.

## Database impact

The migration adds `public.schema_frontend_targets` with tenant-aware foreign keys, target-shape constraints, indexes, timestamp maintenance, tenant consistency validation, and authenticated parent-schema RLS policies.

The migration backfills target metadata only:

- Existing `:slug` routes become primary `detail-page` targets.
- A legacy requirement of `/` becomes a root `collection-slot` using a deterministic semantic placement key such as `home.blog`.

The migration does not update `page_schemas.schema`, `page_schemas.integration_requirements`, `pages.content`, page slugs, page status, or content-block IDs.

## Runtime and API impact

This change now includes shared REST/MCP registration, public schema delivery, dashboard target editing, and target-aware revalidation. Subsequent work focuses on production hardening, compatibility repair, and canonical Worker URL consistency.

Existing scalar `slug_structure` behavior remains unchanged. Existing blog schema fields—including nested objects, arrays, media values, `ContentBlock[]`, `CodeBlock[]`, legacy `string[]`, title-cased keys, and hyphenated keys—remain opaque to this migration.

## Compatibility and security notes

- `/#posts` is intentionally not accepted as a server target.
- Collection slots require semantic placement keys and do not produce per-record previews.
- Detail routes continue to require exactly one `:slug` token.
- Target rows must have the same tenant ID as their parent schema.
- Target rows are not anonymous-readable directly; a later API slice will expose sanitized public target/content metadata through the Worker after registration.
- Existing editor round-trip concerns around legacy `string[]`, nested `CodeBlock[]` item metadata, and content-block importer coverage are intentionally outside this metadata-only migration.
