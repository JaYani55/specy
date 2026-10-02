# Schema Editor

## Purpose and hierarchy

The Schema Editor is the **technical contract-authoring layer**. It defines which fields an entry may contain and how those fields are typed. It is intentionally separate from the PageBuilder, which reads the saved contract and lets content managers edit one entry without changing the contract.

- Schema Editor owns `page_schemas.schema`, schema identity/description, entity classification, workspace ownership, and frontend integration configuration.
- PageBuilder owns the editing experience for one entry and writes entry content to `pages.content` (or through the service-product aggregate).
- A content save never changes the schema definition or its `definition_revision`.

See [`page-builder.md`](page-builder.md) for the content editing feature.

## Routes and source

- `/pages/schema/new` — create a schema.
- `/pages/schema/:tenantSlug/:schemaSlug/settings` — edit a tenant-owned schema.
- `/pages/schema/:schemaSlug/settings` — compatibility/settings route for existing one-segment schema links.
- Feature page: `src/features/schema-editor/SchemaEditorPage.tsx`.

`src/pages/PagesSchemaDetail.tsx` is the schema catalogue/detail surface. It displays pages for a schema and links into the PageBuilder for entry creation/editing; it is not the schema-definition editor.

## What the editor changes

The technical form edits schema identity and field definitions, plus the existing workspace, entity classification, integration requirements, frontend targets, agent/MCP assignments, and registration-related settings. Field definitions include stable JSON keys, types, required/nullability, descriptions, placeholders, enums, and nested object/array definitions. The Schema JSON parser supports bulk technical authoring.

Schema definition updates use the expected `definition_revision`; a stale revision conflicts instead of silently overwriting another developer's change. Product/event classification and tenant/scope constraints remain enforced by the schema/API contract.

## Presentation hints and PageBuilder

`editor_config` is separate, non-executable metadata on the schema. The PageBuilder consumes the optional `editor_config.page_builder` field/group hints described in [`page-builder.md`](page-builder.md); they affect labels, help, grouping, and ordering only. They never change content keys, field types, required rules, public JSON, or schema validation.

The current Schema Editor UI does not yet provide controls for authoring `editor_config`. A technical client can supply it through the revision-checked REST definition endpoint or `specy_pages_schemas_update_definition` MCP tool. If a later UI for these hints is added, it should be a distinct technical section and must not mix entry content into schema editing.

## Safety boundary

Schema Editor users change the future/current entry contract; content managers do not use this route to edit product text. Conversely, editing a page in the PageBuilder does not alter the schema. For `service-product` entries, the PageBuilder delegates to the aggregate API rather than generic page CRUD, preserving schema/product revisions and tenant ownership.
