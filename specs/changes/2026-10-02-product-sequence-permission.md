# Service-product sequence permission

## Summary

Added the least-privilege sequence grant needed by the `SECURITY INVOKER` product aggregate create RPC. The product table's RLS policies remain authoritative; authenticated callers receive sequence `USAGE` only, with no grant to `anon` or `public`.

The reported 42501 (`permission denied for sequence mentorbooking_products_id_seq`) means this migration must be applied to the database before retrying product creation. It has not been applied to the live database from this session.

## Files Added

- `migrations/202610020005_product_sequence_permissions.sql` — grant sequence `USAGE` to `authenticated`.
- `tests/productSequencePermissions.test.mjs` — least-privilege grant contract test.

## Files Changed

- `scripts/lib/migration-order.mjs` — register the permission migration after product aggregate schema/functions.

## Impact analysis

- **Database:** One additive, idempotent sequence grant. Does not alter table RLS or expose product rows.
- **Runtime:** Authenticated aggregate inserts can obtain the legacy serial ID; the RPC remains subject to caller RLS and transactional constraints.
- **API:** No route/schema changes. Product REST/MCP creation succeeds only after this migration is applied.

## Verification

- Migration-order and sequence-grant tests are included in `npm test`.
- No live database grant was executed; apply through the normal migration runner after the workspace's backup/snapshot gate.
