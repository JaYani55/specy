# Pages feature audit and MCP creation fix

## Summary

Audited the Specy pages feature after `create_page` failed with `column pages.frontend_url does not exist`.

The database model was correct: `frontend_url` belongs to `page_schemas`, while `domain_url` belongs to `pages`. The MCP handler incorrectly requested `frontend_url` from the `pages` insert-returning projection. The handler now keeps schema-level frontend metadata separate from page-level metadata.

The audit also repaired a stale linked-page deletion query, aligned schema metadata types, and reconciled setup migration ordering.

## Files Added

- `tests/pagesContract.test.mjs`
- `specs/changes/2026-08-03-pages-feature-audit.md`

## Files Changed

- `api/routes/mcp.ts`
  - Removed `frontend_url` from the `pages` projection.
  - Rejected `single-page` schemas in `create_page`.
  - Added German slug transliteration.
  - Omitted `tenant_id` when no explicit override is provided.
- `src/services/events/productService.ts`
  - Changed linked-page deletion from `products` to `pages`.
- `src/types/pagebuilder.ts`
  - Added explicit `content_scope` and `page_target` metadata types.
  - Removed the obsolete `page_target_key` representation.
- `scripts/setup.mjs`
  - Matched the canonical migration order used by `scripts/lib/core-update.mjs`.

## Impact analysis

### Database

No database migration is required for the reported error. No `pages.frontend_url` column is added. Existing ownership remains:

- `page_schemas.frontend_url`: registered frontend origin.
- `pages.domain_url`: optional page-level domain override.
- `schema_frontend_targets` and `page_schemas.page_target`: routing metadata.

The setup migration manifest now applies tenant storage and page-schema visibility migrations in the same order as the core update manifest.

### Runtime

MCP page creation no longer fails because of an invalid PostgREST projection. When no tenant override is supplied, the database can apply its current-tenant default. German page names produce the same transliterated slugs as the dashboard. Linked product-page deletion now targets the canonical `pages` table.

### API surface

`create_page` continues returning page-owned fields and constructs `preview_url` from schema-level frontend registration. It now clearly rejects `single-page` schemas, which must update an existing page surface rather than create a collection record.
