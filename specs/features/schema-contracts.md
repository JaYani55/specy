# Schema contracts, classification, and lossless content editing

## Scope

`page_schemas.schema` remains developer-owned JSON describing entry fields. `pages.content` remains arbitrary JSON data. Classification, editor hints, and definition revisions are metadata on `page_schemas`; they are not injected into either JSON payload.

This document describes the implemented schema/content contract foundation. A first service-product aggregate workflow is available through Products, REST, and MCP. Event aggregates/public event pages, staff presentation, customer CRM, and the typed external-service handoff are not yet enabled.

## Schema metadata

The additive schema metadata fields are:

- `entity_kind`: `page` (default), `service-product`, or `event`.
- `definition_revision`: positive integer, initially `1`, incremented by the database when `schema`, `editor_config`, `entity_kind`, or `content_scope` changes.
- `editor_config`: non-executable JSON object for future editor labels/widget/grouping hints.

Product/event classifications require a tenant-owned `page-collection` schema. Existing schemas with page entries cannot be reclassified or moved to a different workspace until a reviewed conversion workflow is available. The database rejects invalid classification/scope combinations.

Authenticated REST clients can update the schema contract with:

```text
PATCH /api/schemas/:apiSlug/definition
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "expected_revision": 3,
  "schema": { "Intro Headline": { "type": "string", "required": true } },
  "editor_config": {},
  "entity_kind": "service-product"
}
```

The response includes the new revision and changed fields. Stale revisions return `409`; malformed metadata returns `400`; inaccessible schemas return `404`. Reclassification/moving a schema with existing pages returns a conflict rather than rewriting content. MCP exposes the same operation as `specy_pages_schemas_update_definition`.

## Content editing behavior

The schema-driven page editor now:

- initializes known widget defaults without normalizing stored values;
- activates optional fields based on key presence, preserving `false`, `0`, `null`, `""`, `[]`, and `{}`;
- preserves unknown root/nested content keys and custom block fields when known fields are edited;
- preserves unsupported schema-field attributes when using the visual schema editor;
- treats optional-field removal as an explicit deletion, separate from an empty value;
- displays incompatible field values without coercing or overwriting them; and
- imports unknown keys and custom block types without silently stripping or synthesizing IDs.

Unknown or malformed content blocks are shown as retained JSON instead of being forced through a built-in block editor. Known text/image/video/audio/form blocks continue to preserve extension fields when edited.

## Entity write and public-delivery boundary

Generic page create/update tools reject schemas classified as `service-product` or `event`. The generic dashboard `savePage` path rejects those entity kinds and validates the routed page/schema/workspace tuple. Product pages must be created/updated/published/archived through the service-product aggregate API. Event aggregate writes remain unavailable.

The current public `GET /api/schemas/:apiSlug/pages` and detail endpoint serve ordinary `page` and `service-product` schemas. Product entries are filtered to published pages with a non-retired product row; `?include=entity` adds only `{ kind, id }` under a separate `relations` envelope. Event-classified schemas remain unavailable and return not found. Product publication and retirement suppress delivery; content remains unchanged.

## Routing capability honesty

The frontend manifest now reports `revalidation.supports_new_routes: null` (unknown). Schema registration and health checks do not prove that a static deployment generates new detail routes. Frontends that need new routes must have a separately verified build/deploy or request-time delivery capability.

## Compatibility and rollout

- Existing schema/page records default to ordinary `page`; their JSON is not transformed by the metadata migration.
- Stable `api_slug`, tenant-local schema slugs, frontend targets, and the existing published-page contract for ordinary pages remain unchanged.
- Product aggregate writes now use the additive compatibility layer and are not a substitute for the live inventory/backfill gate in [`../plans/PRODUCT-INTEGRATION.md`](../plans/PRODUCT-INTEGRATION.md) §§8–9. Staff identity, customer CRM, event aggregates/public event pages, typed handoff, invalidation, and legacy contraction remain future phases.
