# Object Datastream API access settings

## Summary

Added API access controls directly to the Objects → Datastreams dashboard. The controls are shared with ObjectEditor rather than duplicated. Manual Objects update their existing API settings; generated Product Objects persist settings on their Product source. Effective anonymous availability remains gated by Product retirement, Page publication, and registered `service-product` schema eligibility. The dashboard reports the gate that prevents activation instead of implying that the toggle alone makes a Product Object public.

## Files Added

- `migrations/202610040007_product_object_api_access.sql` — Product-owned API preferences, caller-scoped update RPC, publication-gated generated Object enforcement, and idempotent mirror resync.
- `src/components/objects/ObjectApiAccessControls.tsx` — shared API-enabled/JWT-required controls.

## Files Changed

- `scripts/lib/migration-order.mjs`, `specs/platform/unified-setup-tui.md`, `specs/architecture/system-overview.md` — register/classify the follow-up migration.
- `api/routes/objects.ts` — `PATCH /api/objects/:id/access` dispatches manual Object edits or the tenant-scoped Product source RPC; Datastream inventory reports requested settings and Product publication gate reason.
- `src/pages/ObjectEditor.tsx`, `src/pages/ObjectDatastreams.tsx`, `src/services/objectService.ts` — reuse the same controls and save API settings from the Datastreams UI.
- `src/lib/apiCatalog.ts` — document the authenticated access update endpoint.
- `specs/features/service-products.md` — document settings ownership and publication gates.
- `tests/objectDatastreams.test.mjs` — shared-controls and Product gate regression checks.

## Impact analysis

### Database

Adds `mentorbooking_products.object_api_enabled` (default `true`) and `object_requires_auth` (default `false`). The generated Object mirror still requires a live published Product Page in a registered service-product schema for anonymous availability; persisted API preferences cannot bypass that gate. A caller-scoped RPC updates the Product preference row, which triggers the existing synchronous mirror refresh. Existing effective behavior is retained by the defaults, subject to the same publication gate.

### Runtime

The Datastreams dialog edits the same `API enabled` and `Require Auth JWT` settings shown by ObjectEditor. For Product mirrors, the settings apply to the source Product and survive subsequent mirror synchronization. If the Product Page/schema is ineligible, the requested setting is retained but the public endpoint remains unavailable, with a reason shown in the UI. No generated Object payload is made directly editable.

### API surface

Adds authenticated `PATCH /api/objects/:id/access` with `{ api_enabled, requires_auth }`. Manual Objects update their corresponding columns. Generated Product Objects dispatch to `update_product_object_api_access` under the caller's RLS identity. The existing public Object GET continues to require `status=published`, `api_enabled=true`, and `requires_auth=false`.

## Rollout

Migration `202610040007_product_object_api_access.sql` must be applied before deploying the updated Worker/dashboard. Verify the API settings dialog against a manual Object and a generated Product Object, including a published/registered Product and a Product whose publication gate is closed.
