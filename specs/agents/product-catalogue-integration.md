# Product catalogue integration

## Status

Service-product schema upload/classification and the product aggregate workflow are implemented in core. A focused optional event-page workflow is also implemented; see [`event-catalogue-integration.md`](event-catalogue-integration.md). Migrations through `202610040005_product_object_projection.sql` have been deployed and tested per the current rollout report. Staff presentation/identity migration, CRM, dedicated event collection tools, external invoice handoff, durable outbox delivery, and conversion of historical records into schema-backed aggregates remain out of scope.

## Frontend-first setup

1. Use OAuth 2.1 MCP and explicitly select a tenant. Never infer MCP workspace from browser state.
2. Upload/create a tenant-owned page-collection schema with `entity_kind: "service-product"` and the developer's field map. The schema contract is arbitrary entry JSON plus separately stored `editor_config` hints.
3. Read back the schema UUID, tenant-local slug, stable `api_slug`, `definition_revision`, editor config, and frontend targets. Definition changes use `specy_pages_schemas_update_definition` with the expected revision.
4. Register the frontend using the existing target registration contract. A product schema's collection is a collection of individual product entries.
5. Create a draft aggregate with `specy_products_create`, passing the schema's current `definition_revision`; do not use generic `create_page` for classified schemas.
6. Edit the canonical `/pages/schema/:tenantSlug/:schemaSlug/edit/:pageId` route with the PageBuilder, or call `specy_products_update`; then explicitly publish with `specy_products_publish`.
7. Fetch public published entries without credentials from `/api/schemas/:apiSlug/pages`. Request `?include=entity` only when the frontend needs the allow-listed product UUID reference.

The PageBuilder edits entry content only; the Schema Editor edits the technical contract. The legacy `/pagebuilder/:legacyProductId` URL resolves a linked schema page and redirects to its canonical route. See [`../features/page-builder.md`](../features/page-builder.md) and [`../features/schema-editor.md`](../features/schema-editor.md) for the user/editor boundary.

## MCP product tools

All operations require the authenticated caller's permissions and an explicit workspace UUID:

| Tool | Required inputs / effect |
|---|---|
| `specy_products_list` | `tenant_id`; lists active workspace products |
| `specy_products_create` | `tenant_id`, `schema_id`, `expected_definition_revision`, `name`, optional `slug`/`content`/UUID `idempotency_key`; creates draft aggregate and canonical page atomically |
| `specy_products_get` | product UUID `id`, `tenant_id` |
| `specy_products_update` | UUID `id`, `tenant_id`, `expected_version`, `expected_definition_revision`, and replacement fields |
| `specy_products_publish` | UUID `id`, `tenant_id`, `expected_version`, `expected_definition_revision`, `status: draft | published` |
| `specy_products_archive` | UUID `id`, `tenant_id`, `expected_version`; retirement/archive is atomic |
| `specy_products_delete` | UUID `id`, `tenant_id`, `expected_version`; permanently deletes Product, related Events, Event Pages, archive history, canonical Product Page and generated Object in one transaction |

Schema definition `definition_revision` and product aggregate `version` are distinct concurrency tokens. Create, update, and publication check the schema revision; update/publication also check aggregate version. Idempotency protects aggregate creation; a repeated key with changed payload conflicts.

Generic page writes remain disallowed for service-product schemas, which use `specy_products_*`. For event schemas, `specy_pages_schemas_create_page` and `specy_pages_schemas_update_page` dispatch to the event aggregate workflow when the caller supplies the required tenant, schema revision, event fields, and page revision. Ordinary page schemas continue using generic page operations.

## Public page relation

Default content is the exact stored JSONB payload. Only the optional named include adds an envelope:

```json
{
  "content": { "any developer-defined keys": "unchanged" },
  "relations": {
    "entity": { "kind": "service-product", "id": "<opaque-product-uuid>" }
  }
}
```

No arbitrary table joins/includes are supported. Product delivery excludes retired products and non-published pages. No staff, CRM, internal compensation, approval arrays, account IDs, or customer fields are public.

## Dynamic Product and Event data

Each Product has one generated, read-only Object mirror. `GET /api/objects/{objectSlug}` is the canonical dynamic read and returns the normal Object `{ schema, data }` contract. Its `api_enabled`/`requires_auth` policy is edited in the Objects Datastreams UI and is independent of Page publication/revalidation; Product retirement disables the stream. The friendly `GET /api/products/:workspaceSlug/:productSlug` remains a Page-oriented alias and resolves only a published Product page. Pages own editorial content/publication and use the revalidation transport; the Object stream contains current Product/Event operational values and Page references, not copied `pages.content`. Event records include schedule, registration status, participant capacity, and only custom values explicitly marked public in the selected Product's field schema. Objects are synchronized transactionally and are never edited in ObjectEditor; users edit Page content in PageBuilder and Product/Event facts in their dedicated forms.

## Contract and safety limits

- Product creation requires a tenant-owned service-product page-collection schema.
- Product/page/tenant creation, update, publication, and retirement use transaction-backed database RPCs under caller RLS.
- Update/publish requests validate content against the current schema and return field-path errors; clients must read the new aggregate version after a successful write.
- Generic page deletion cannot delete a linked product. Archive remains the reversible retirement path. Explicit Product deletion is tenant/version checked and permanently removes the Product, all linked active Events and Event Pages, archived Event history, its canonical Product Page, and generated Object atomically.
- Public manifest `supports_new_routes` is `null` until the connected deployment proves route generation/purge capability.

See [`../features/service-products.md`](../features/service-products.md) for the full current core contract and its migration limits.
