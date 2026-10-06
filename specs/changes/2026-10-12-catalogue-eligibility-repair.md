# Catalogue eligibility repair — product creation impossible on drifted state

## Summary

A live workspace migration (page-domain tenant reassignment, 2026-10-06/07) surfaced a
hard blocker: `specy_products_create` failed with
`Schema is not an eligible service-product collection.` (409/23514) for **every**
schema state — `event` or `service-product`, registered or pending. Post-unification,
`entity_kind = 'event'` is the only eligible catalogue kind (the legacy
`service-product` kind is converted by `202610060001_catalogue_schema_unification.sql`),
and the repository's API layer already enforced that correctly. The reported error,
however, is the **pre-unification message text**, which only exists in the old RPC
definition installed by `202610020003_service_product_aggregates.sql` — proof that the
queried system was still running the pre-unification eligibility check.

Root cause class: `scripts/migrate.mjs` only re-applies migrations whose **checksum
drifted** since recording. A database that recorded `202610060001` as applied without
its function bodies taking effect (checksum-clean recording, partial historical state,
or restore from an older backup) keeps the old `'service-product'`-only check
permanently — the runner will never re-execute a checksum-clean file. With the API
requiring `'event'`, no schema state was eligible. Same failure mode as
`202609290001_repair_current_user_roles_json_claims.sql` (claims helpers), which is the
established remedy pattern.

## Files Added

- `migrations/202610120001_repair_catalogue_product_aggregate_rpcs.sql` — re-asserts the
  canonical definitions of all catalogue product-aggregate RPCs
  (`create/update/publish/archive`, `update_…_with_custom_fields`,
  `change_…_schema_aggregate`, `delete_mentorbooking_product_aggregate`,
  `validate_service_product_page_owner`, `enforce_event_page_link`,
  `guard_event_page_mutation`, `sync_product_object`) plus their grants/triggers,
  extracted verbatim from the unification migration. Idempotent (`create or replace` /
  `drop if exists`); must remain the **last** migration defining these RPCs.
- `tests/catalogueEligibilityConsistency.test.mjs` — contract tests:
  - API layer and the **final migration definition** of every product RPC must agree on
    the unified `entity_kind = 'event'` eligibility;
  - no final definition may carry the pre-unification message;
  - the repair migration stays the last definition (it must never be edited in place —
    the runner re-applies drifted files, which would resurrect old content);
  - agent-facing guidance no longer steers into the retired kind.
- `specs/changes/2026-10-12-catalogue-eligibility-repair.md` — this record.

## Files Changed

- `api/routes/mcp.ts` — `specy_products_create` tool description now names the unified
  catalogue kind (`entity_kind event`, page-collection) instead of the retired
  `service-product` requirement; both aggregate-operation-required guard messages
  rephrased (product vs event dispatch) — the old wording steered agents into
  reclassifying schemas to `service-product`, which then fails the DB RPC check.
- `specs/agents/product-catalogue-integration.md` — the integration runbook told agents
  to create schemas with `entity_kind: "service-product"` (the exact assumption that
  broke product creation after the unification); now instructs `entity_kind: "event"`
  and documents the eligibility contract.
- `specs/agents/agent-system-prompt.md` — schema-classification guidance updated to the
  unified catalogue model.
- `scripts/lib/migration-order.mjs` — registers the repair migration as the final entry.
- `specs/features/service-products.md` — eligibility contract already documented
  (2026-10-11); unchanged.

## Impact analysis

### Database

No schema changes. The repair migration only re-issues `create or replace function`
definitions of the catalogue aggregate RPCs and re-declares their triggers/grants —
identical to the post-unification canonical state. On a healthy database it is a no-op;
on a drifted database it restores the unified eligibility.

### Runtime

None beyond what the canonical RPCs already define. The deployed Worker must be
redeployed to pick up the 2026-10-11 API-layer fix (`entity_kind !== 'service-product'`
→ unified check) — the observed error text matches the pre-fix Worker build
(`978c372`).

### API surface

Tool-description text only; no signatures or behavior changed.

## Verification

- `npm run typecheck` — pass.
- `npm test` — 458 tests pass, including the new consistency tests.
- `npm run build` — pass.
- Live re-run: `npm run migrations` applies the repair (idempotent), then redeploy the
  Worker; product creation against the migrated catalogue schema (`entity_kind event`)
  then succeeds. Remaining data-level step for the incident: link the re-created event
  to the product (`event.product_id`) once the product exists.

## Related

- `specs/changes/2026-10-06-catalogue-schema-unification.md` — the unification that
  retired the `service-product` kind.
- `specs/changes/2026-09-29` repair record for the claims helpers (same runner failure
  mode; see `202609290001_repair_current_user_roles_json_claims.sql`).
- `specs/features/service-products.md` — eligibility contract.
- `specs/changes/2026-10-11-page-domain-tenant-ownership-and-naming.md` — the workspace
  migration context and the API-layer eligibility fix.