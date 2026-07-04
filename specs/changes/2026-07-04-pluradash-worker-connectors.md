# PluraDash Worker Connector Documentation

Date: 2026-07-04

## Summary

This change documents the introduction of PluraDash-specific worker connector endpoints for registering direct-uploaded files in managed tenant storage.

The runtime connector itself lives entirely inside the PluraDash plugin under `/api/plugin/pluradash/connectors/isibot/*`. The core application does not gain a new shared REST namespace, new shared storage abstraction, or new database objects for this feature.

The only core change is to the operator-facing `/admin/api` documentation layer so that super-admin users can see and review the two plugin-contributed endpoints in the same API catalog as the rest of the worker surface.

## Files Added

- `plugins/pluradash/specs/isibot-worker-secret-context.md`
- `specs/changes/2026-07-04-pluradash-worker-connectors.md`

## Files Changed

- `plugins/pluradash/api/index.ts`
- `plugins/pluradash/README.md`
- `plugins/pluradash/specs/isibot-fon.md`
- `src/lib/apiCatalog.ts`

## Core Impact

### Runtime behavior

No core runtime route was added.

The connector endpoints are mounted through the existing generated plugin mount path:

- `/api/plugin/pluradash/connectors/isibot/recordings`
- `/api/plugin/pluradash/connectors/isibot/archive-files`

This preserves the existing EUPL separation model described in `specs/EUPL_Compliance.md`: PluraDash communicates with the CMS through plugin hooks and generated plugin route mounting rather than by extending core REST handlers directly.

### Admin API documentation

`src/lib/apiCatalog.ts` now includes two static catalog entries for the PluraDash connector endpoints so they appear in `/admin/api`.

Those entries describe:

- worker-secret authentication
- request payload structure
- storage-table side effects
- idempotency and folder-path constraints
- the fact that binaries are uploaded directly to R2 before metadata registration

The generated-plugin placeholder entry in the catalog was also updated so it no longer claims that no plugin API routes are installed.

## What Did Not Change In Core

The following areas are intentionally unchanged:

- no new core migrations
- no new core tables, policies, or triggers
- no new core storage-management APIs
- no new shared auth model for workers beyond the existing route-level patterns
- no change to plugin mounting mechanics in `api/plugin-routes.ts`

## Security Considerations

The connector uses a worker-secret model documented in the plugin spec, but the secret validation is implemented inside the plugin route handler, not in a shared core auth layer.

That is intentional for this iteration because:

- the routes are plugin-specific
- the ownership resolution rules are plugin-specific
- the allowed folder roots are plugin-specific

If additional plugins later need the same worker-secret pattern, the shared pieces can be promoted into a core helper at that point.

## Operator Notes

Operators should understand that `/admin/api` now documents plugin-contributed routes that are mounted through generated plugin wiring. Documentation visibility in the admin interface does not imply that the endpoints are part of the core public API surface.

The source of truth for connector behavior remains inside the plugin:

- `plugins/pluradash/api/index.ts`
- `plugins/pluradash/specs/isibot-fon.md`
- `plugins/pluradash/specs/isibot-worker-secret-context.md`

## Related Documents

- `specs/EUPL_Compliance.md`
- `plugins/pluradash/specs/isibot-fon.md`
- `plugins/pluradash/specs/isibot-worker-secret-context.md`
