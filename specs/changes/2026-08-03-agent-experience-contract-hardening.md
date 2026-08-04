# Specy agent-experience contract hardening

## Summary

Implemented the first runtime hardening pass based on the Astro/Field Notes integration audit.

The changes establish latest-publication timestamp semantics, target-aware revalidation, a secret-free frontend integration manifest, improved MCP workflow messaging, and corrected API catalog metadata.

## Files Added

- `api/lib/apiError.ts`
- `api/lib/frontendManifest.ts`
- `migrations/202608030001_page_publication_timestamp.sql`
- `specs/Frontend_Integration_Manifest.md`
- `specs/changes/2026-08-03-agent-experience-contract-hardening.md`

## Files Changed

- `api/routes/mcp.ts`
- `api/routes/schemas.ts`
- `src/lib/apiCatalog.ts`
- `src/services/pageService.ts`
- `scripts/setup.mjs`
- `scripts/lib/core-update.mjs`
- `tests/pagesContract.test.mjs`

## Impact analysis

### Database

The new migration adds a page trigger that treats `published_at` as the latest publication transition timestamp. It sets the timestamp when a page enters `published` and clears it when the page leaves `published`. Existing inconsistent rows are normalized during migration.

### Runtime

- Public collection/detail responses include `published_at`.
- Revalidation sends one request per enabled frontend target and returns per-target results.
- The API catalog now describes registration secrets as required and schema revalidation as bearer-protected.
- A secret-free versioned frontend manifest is available at `GET /api/schemas/:slug/manifest`.
- MCP schema-creation messaging now points to `start_schema_registration` instead of instructing the agent to use the CMS UI.

### API surface

The new manifest exposes normalized schema identity, public data URLs, targets, revalidation capabilities, publication visibility, and legacy route metadata without exposing secrets.

The existing page and registration endpoints remain available for backward compatibility.
