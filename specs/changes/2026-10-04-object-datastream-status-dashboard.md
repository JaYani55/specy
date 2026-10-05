# Object Datastreams status dashboard

## Summary

Added an **Objects → Datastreams** view that inventories all RLS-visible Object API streams, including generated Product Objects that are not editable in the manual Object Editor list. The dashboard shows source kind, publication/API/auth flags, endpoint path, update time, and actual anonymous HTTP status from a lightweight HEAD probe. Unexpected 404s for objects configured as public are highlighted.

## Files Added

- `src/pages/ObjectDatastreams.tsx` — Datastream inventory/status UI.
- `tests/objectDatastreams.test.mjs` — inventory inclusion, anonymous probe, and navigation regression checks.

## Files Changed

- `api/routes/objects.ts` — authenticated tenant-scoped `GET /api/objects/datastreams` including generated Product mirrors and `HEAD /api/objects/:idOrSlug` for lightweight anonymous availability checks.
- `src/services/objectService.ts` — datastream inventory and anonymous HEAD probe clients/types.
- `src/App.tsx`, `src/components/layout/AppSidebar.tsx` — protected `/objects/datastreams` route and Objects submenu.
- `src/lib/apiCatalog.ts` — document the authenticated Object datastream inventory endpoint and clarify manual-list behavior.
- `specs/features/service-products.md` — document the Objects dashboard contract.

## Impact analysis

### Database

No schema or migration change. The inventory reads Objects visible under the caller's RLS policy and uses service-role lookup only to label source Products; it does not return internal Product row IDs or Object payloads. Public availability probes use anonymous database access and the same `published`, `api_enabled`, and `requires_auth` gates as anonymous Object GET.

### Runtime

The new dashboard presents manual and generated Object datastreams together without making generated Product Objects editable. It probes endpoints with HEAD requests in bounded batches and without a CMS bearer token. A 404 for a configured-public stream is surfaced as an unexpected availability mismatch.

### API surface

Adds authenticated `GET /api/objects/datastreams?tenantId=<uuid>` and anonymous-compatible `HEAD /api/objects/:idOrSlug`. Existing Object GET and MCP `list_objects`/`get_object` response contracts remain unchanged.
