# PageBuilder content editing

## Purpose and ownership

The PageBuilder is the **content-editing layer** above a schema contract. Developers and technical administrators define field structure in a schema; content managers edit entry values through a simpler form derived from that schema.

The PageBuilder does not edit `page_schemas.schema`, registration settings, frontend targets, or schema revisions. It edits `pages.name`, `pages.slug`, and `pages.content` through the appropriate page or service-product save adapter. The Schema Editor remains a separate technical feature; see [`schema-editor.md`](schema-editor.md).

## Routes

| Route | Responsibility |
|---|---|
| `/pages/schema/new` | Technical schema authoring in Schema Editor. |
| `/pages/schema/:tenantSlug/:schemaSlug/settings` (and the legacy one-segment equivalent) | Technical schema/configuration editing in Schema Editor. |
| `/pages/schema/:tenantSlug/:schemaSlug/new` | Create an ordinary page using the schema-driven PageBuilder. |
| `/pages/schema/:tenantSlug/:schemaSlug/edit/:pageId` | Edit the canonical page entry using the schema-driven PageBuilder. This is also the canonical content route for service products. |
| `/pagebuilder/:legacyProductId` | Compatibility route for old numeric product links. It resolves the legacy product to its linked page. If that page has a schema, it redirects to the canonical schema route; it never opens the fixed-layout legacy editor for schema-bound content. |

The schema route loads and verifies the page/schema/workspace tuple. Event-classified schemas do not yet have an event aggregate editor and are refused by this route.

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
- `service-product` schemas save through `updateServiceProduct()` with the aggregate UUID/version and schema definition revision. Publication uses the aggregate publish operation. Generic page writes and the legacy editor are not allowed to bypass these checks.
- Raw JSON import and technical diagnostics are available only in the administrator-only developer-tools disclosure; they are not part of the default content-manager workflow.

## Legacy boundary

The old `/pagebuilder/:legacyProductId` route and fixed Hero/CTA/Cards/Features/FAQ form exist only for historical product pages that have no schema association. A missing page link produces a safe recovery message rather than creating a page by looking up a global `service-product` slug. `saveLegacyProductPage()` rejects schema-bound pages. Legacy content conversion/backfill remains a separate migration phase; existing data is not silently rewritten.

## Related documentation

- [Schema Editor](schema-editor.md)
- [Schema/content contracts](schema-contracts.md)
- [Service products](service-products.md)
- [PageBuilder architecture](../architecture/page-builder.md)
