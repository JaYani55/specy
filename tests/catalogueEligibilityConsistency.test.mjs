// Guards against the "no eligible schema state" trap: the API layer and the
// FINAL migration definition of every product-aggregate RPC must agree on the
// unified catalogue eligibility (entity_kind 'event' + page-collection).
// Regression for the live incident where a drifted database (recorded-applied
// unification) kept the pre-unification 'service-product' check while the API
// required 'event' — no schema state could ever satisfy both layers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MIGRATION_ORDER_CORE } from '../scripts/lib/migration-order.mjs';

const apiAggregate = await readFile('api/lib/productAggregateService.ts', 'utf8');
const mcpRoutes = await readFile('api/routes/mcp.ts', 'utf8');

/** Last migration in the canonical order defining the given function. */
async function lastDefinitionOf(functionName) {
  let last = null;
  let lastIndex = -1;
  for (const file of MIGRATION_ORDER_CORE) {
    const content = await readFile(`migrations/${file}`, 'utf8').catch(() => null);
    if (!content) continue;
    const index = content.indexOf(`create or replace function public.${functionName}(`);
    if (index !== -1) { last = content; lastIndex = MIGRATION_ORDER_CORE.indexOf(file); }
  }
  return { file: last != null ? MIGRATION_ORDER_CORE[lastIndex] : null, content: last };
}

const RPCS = [
  'create_service_product_aggregate',
  'update_service_product_aggregate',
  'publish_service_product_aggregate',
  'archive_service_product_aggregate',
  'update_service_product_aggregate_with_custom_fields',
  'change_service_product_schema_aggregate',
];

test('API layer and final DB definitions agree on the unified catalogue eligibility', async () => {
  // API: requires 'event' (post-unification catalogue kind)
  assert.match(apiAggregate, /schema\.entity_kind !== 'event' \|\| schema\.content_scope !== 'page-collection'/);
  assert.ok(!/entity_kind !== 'service-product'/.test(apiAggregate), 'API must not require the retired kind');
  assert.match(apiAggregate, /Catalogue schemas use entity_kind "event"/);

  // DB: the final definition of each product RPC must accept the catalogue kind
  for (const name of RPCS) {
    const { file, content } = await lastDefinitionOf(name);
    assert.ok(file, `${name} not found in the ordered migrations`);
    assert.ok(
      content.includes("entity_kind is distinct from 'event'") || content.includes("entity_kind = 'event'"),
      `${file} (final definition of ${name}) must key eligibility on the unified catalogue kind 'event'`,
    );
    assert.ok(
      !content.includes('Schema is not an eligible service-product collection.'),
      `${file} must not carry the pre-unification eligibility message`,
    );
  }
});

test('the repair migration stays the last definition and the catalogue unification keeps its contract', () => {
  assert.equal(MIGRATION_ORDER_CORE[MIGRATION_ORDER_CORE.length - 1], '202610120001_repair_catalogue_product_aggregate_rpcs.sql');
  // The runner only re-applies checksum-drifted migrations; the repair must
  // never be edited in place after release, or drift re-application resurrects
  // whatever content it had at recording time.
});

test('agent-facing guidance no longer steers into the retired kind', () => {
  // The tool description previously told agents to use a service-product
  // schema — after the unification that kind makes product creation fail.
  assert.match(mcpRoutes, /Use a tenant-owned catalogue schema \(entity_kind event, content_scope page-collection\)\./);
  assert.ok(!/Use specy_products_create for service-product schemas\./.test(mcpRoutes));
});
