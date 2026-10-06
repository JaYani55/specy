# PageBuilder content editing

## Purpose and ownership

The PageBuilder is the **content-editing layer** above a schema contract. Developers and technical administrators define field structure in a schema; content managers edit entry values through a simpler form derived from that schema.

The PageBuilder does not edit `page_schemas.schema`, registration settings, frontend targets, or schema revisions. It edits `pages.name`, `pages.slug`, and `pages.content` through the appropriate ordinary-page, service-product, or event-page save adapter. Content managers can save `pages.content` as a reusable template scoped to that exact schema and load it into another page using the same schema. Templates never copy event scheduling fields, publication state, URL slug, or page title. The Schema Editor remains a separate technical feature; see [`schema-editor.md`](schema-editor.md).

## Routes

| Route | Responsibility |
|---|---|
| `/pages/schema/new` | Technical schema authoring in Schema Editor. |
| `/pages/schema/:tenantSlug/:schemaSlug/settings` (and the legacy one-segment equivalent) | Technical schema/configuration editing in Schema Editor. |
| `/pages/schema/:tenantSlug/:schemaSlug/new` | Create an ordinary page using the schema-driven PageBuilder. |
| `/pages/schema/:tenantSlug/:schemaSlug/edit/:pageId` | Edit the canonical page entry using the schema-driven PageBuilder. This is also the canonical content route for service products and event pages. |
| `/pagebuilder/:legacyProductId` | Compatibility route for old numeric product links. It resolves the legacy product to its linked page. If that page has a schema, it redirects to the canonical schema route; it never opens the fixed-layout legacy editor for schema-bound content. |

The schema route loads and verifies the page/schema/workspace tuple. Event pages are created through the event workflow and edited through an event-aware aggregate adapter; generic page creation is not used to create event occurrences.

## Feature structure

- `src/features/page-builder/PageBuilderPage.tsx` — route-level loader, canonical route resolver, and editor selection.
- `src/features/page-builder/SchemaContentEditor.tsx` — schema-driven content editor and save/publish state.
- `src/features/page-builder/editorPresentation.ts` — safe presentation-only label/group/order resolution from schema metadata.
- `src/features/page-builder/LegacyProductContentEditor.tsx` and `legacy/` — isolated fixed-layout editor for historical linked pages with no schema. This path cannot create a new schema-bound page or save content for a schema-bound page.
- `src/features/page-builder/legacy/productPageService.ts` — narrow compatibility reader/writer for that schema-less historical content.
- `src/components/pagebuilder/` — shared editor primitives also used by Objects, Forms, and other features; it is not the technical Schema Editor.
- `src/features/schema-editor/SchemaEditorPage.tsx` — separate technical schema authoring feature.

## Simple presentation derived from the schema

The field definition remains the source of truth for content keys, types, required status, enum options, and validation. The PageBuilder derives a human-readable editing projection:

1. Optional `editor_config.page_builder.fields` hints provide a label, help text, group, and order for a stable schema key.
2. Optional `editor_config.page_builder.groups` hints provide localized group labels/descriptions and group order.
3. Without hints, field keys are humanized, schema `description` supplies help text, `placeholder` supplies the input placeholder, and schema order is retained.
4. Widget behavior is determined by the schema type; presentation hints cannot change the schema type or validation rules.

Example presentation metadata (kept outside both schema field JSON and entry content):

```json
{
  "page_builder": {
    "groups": {
      "introduction": {
        "label": { "de": "Einführung", "en": "Introduction" },
        "order": 10
      }
    },
    "fields": {
      "intro_text": {
        "label": { "de": "Einleitung", "en": "Introduction text" },
        "help_text": { "de": "Kurzer Einstieg für Leserinnen und Leser." },
        "group": "introduction",
        "order": 10
      }
    }
  }
}
```

`editor_config` is non-executable JSON. Unknown or malformed presentation hints are ignored and safe labels are generated from the schema keys. `meta_description` remains API/agent context and is not rendered to content managers. The current Schema Editor does not provide a UI for `editor_config`; technical clients may set it through revision-checked REST/MCP schema-definition updates.

## Content and save invariants

- The presentation projection never renames a JSON key. A label such as “Introduction text” still writes to the schema's original `intro_text` key.
- Optional fields are activated by presence, preserving `false`, `0`, `null`, empty strings, arrays, and objects.
- Unknown keys and custom block data are preserved when known fields change. An incompatible saved value is shown as unchanged rather than silently coerced.
- Ordinary `page` schemas save through `savePage()` after schema/workspace checks.
- `service-product` schemas save through `updateServiceProduct()` with the aggregate UUID/version and schema definition revision. Publication uses the product aggregate publish operation.
- `event` schemas save through the event-page aggregate adapter with tenant, schema definition revision, and optimistic page `updated_at` checks. Publication uses the event-page operation; event scheduling status is separate. Generic page writes and the legacy editor cannot bypass these checks.
- Raw JSON import and technical diagnostics are available only in the administrator-only developer-tools disclosure; they are not part of the default content-manager workflow.
- Schema-scoped page content templates store only the page content JSON. Loading one replaces the editor content and activates optional fields present in the template, while leaving the page title, slug, publication state, and any event schedule unchanged.
- Revalidation failures leave the saved content intact. The feedback displays a concise status and keeps endpoint, HTTP status, target path, and upstream error details collapsed until the operator opens the details disclosure.

## Preview (explicit slug structure)

Page previews are **opt-in** and require an **explicitly set preview slug structure**:

- A dedicated preview target — an enabled `detail-page` frontend target with `supports_preview: true` whose `host_path` contains the `:slug` token (e.g. `/preview/:slug`). For legacy schemas with a single detail target, that target's `host_path` is the preview slug structure.
- When `integration_requirements.preview_slug_structure` is set (a separate non-public preview route), **only** a dedicated `supports_preview: true` target resolves previews, and it must exactly match that structure (exempt from `route_base_path`).
- A registered `frontend_url` on the schema.

Preview slugs resolve **draft pages only**. Published pages always use the public detail route; the backend (`specy_pages_schemas_preview`, dashboard eye button, editor save alert) therefore never sends published entries to the preview route. Drafts are served statelessly via the draft delivery Bearer contract and rebuilt via the backend ISR push — see [frontend-targets.md](frontend-targets.md#draft-delivery--backend-isr-push).

There is **no implicit fallback**: neither the schema's `slug_structure` nor the frontend contract's `required_slug_structure` is used to synthesize a preview URL. The database constraint on `schema_frontend_targets` already guarantees that `detail-page` targets contain `:slug` exactly once. A public detail route (`supports_preview: false`, matching `required_slug_structure`) and a non-public preview route can be registered side by side; the full validation rule chain and an error catalog are documented in [frontend-targets.md](frontend-targets.md).

There is **no implicit fallback**: neither the schema's `slug_structure` nor the frontend contract's `required_slug_structure` is used to synthesize a preview URL. The database constraint on `schema_frontend_targets` already guarantees that `detail-page` targets contain `:slug` exactly once.

Behavior when the preview slug structure has **not** been set:

- The whole pages feature works normally. Saving, publishing, revalidation, and collection slots are unaffected — previews are an additive layer.
- The PageBuilder save feedback shows an explicit error state (`Preview unavailable: no preview slug structure set …`) with guidance instead of a preview button.
- The published-page eye button on the schema detail page is withheld.
- The preview tool `specy_pages_schemas_preview` (MCP) fails with code `preview_not_configured`.

Preview state is surfaced on the `/pages` menu: every schema card shows a `Preview set`/`Vorschau gesetzt` or `No preview`/`Keine Vorschau` badge, and the schema detail page shows the configured structure (or the unset state) in the Frontend Contract card. Preview URLs are always built from the explicit detail-page target: `${frontend_url}${host_path with :slug replaced}`.

To set a preview: define a `detail-page` frontend target during frontend registration, or update targets later through `specy_pages_schemas_replace_frontend_targets` (MCP) or the Schema Editor; correct a `frontend_url` through `specy_pages_schemas_update_system_data`.

## Legacy boundary

The old `/pagebuilder/:legacyProductId` route and fixed Hero/CTA/Cards/Features/FAQ form exist only for historical product pages that have no schema association. A missing page link produces a safe recovery message rather than creating a page by looking up a global `service-product` slug. `saveLegacyProductPage()` rejects schema-bound pages. Legacy content conversion/backfill remains a separate migration phase; existing data is not silently rewritten.

## Related documentation

- [Schema Editor](schema-editor.md)
- [Schema/content contracts](schema-contracts.md)
- [Service products](service-products.md)
- [PageBuilder architecture](../architecture/page-builder.md)
