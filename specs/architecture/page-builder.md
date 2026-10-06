# PageBuilder and Schema Editor architecture

## Editor hierarchy

Specy has two distinct editing features with a one-way dependency:

```text
Frontend developer / technical administrator
  └─ Schema Editor: defines the versioned entry contract and site integration
       └─ PageBuilder: reads that contract and edits one entry's content
            └─ Save adapter: ordinary page save OR service-product/event aggregate save
```

The **Schema Editor** owns `page_schemas.schema` and technical schema/integration metadata. The **PageBuilder** is a content editor projected from that contract. It does not edit the schema definition. Content managers can edit an entry without changing field structure, required rules, frontend targets, or schema revisions.

The source features are separated accordingly:

- `src/features/schema-editor/SchemaEditorPage.tsx` — technical schema creation/settings.
- `src/features/page-builder/` — PageBuilder route resolution, schema content editor, presentation projection, and isolated legacy compatibility editor.
- `src/components/pagebuilder/` — shared UI primitives used by PageBuilder and other features such as Objects; this is not the Schema Editor.

## Routes

| Route | Feature | Responsibility |
|---|---|---|
| `/pages/schema/new` | Schema Editor | Create a technical schema definition. |
| `/pages/schema/:tenantSlug/:schemaSlug/settings` (and the legacy one-segment equivalent) | Schema Editor | Edit the schema definition and integration configuration. |
| `/pages/schema/:tenantSlug/:schemaSlug` | Schema detail | List entries and navigate to content editing or technical settings. |
| `/pages/schema/:tenantSlug/:schemaSlug/new` | PageBuilder | Create an ordinary page using the selected schema. |
| `/pages/schema/:tenantSlug/:schemaSlug/edit/:pageId` | PageBuilder | Edit the canonical page entry. Service products and event pages use their entity-aware aggregate update/publication operations. |
| `/pagebuilder/:legacyProductId` | Compatibility alias | Resolve an old numeric product reference. If it has a schema-linked page, redirect to that page's canonical schema route. Only linked schema-less historical pages use the fixed-layout legacy editor. |

The schema route verifies the page/schema/workspace tuple. Event pages use an event-aware aggregate writer; new event occurrences must be created through the event workflow rather than generic page creation.

## PageBuilder source behavior

### Route controller

`src/features/page-builder/PageBuilderPage.tsx` loads either a canonical schema route or a legacy numeric product alias. For canonical routes it loads the schema and page, verifies ownership, and loads the appropriate service-product or event aggregate when needed. For a legacy alias it resolves `mentorbooking_products.product_page_id`; schema-bound pages redirect with history replacement before any legacy form renders.

### Schema content editor

`src/features/page-builder/SchemaContentEditor.tsx` renders schema fields as content-oriented widgets for strings, numbers, booleans, enums, media, arrays, objects, content blocks, and code blocks. It initializes defaults without overwriting saved values. Unknown keys and custom block data remain intact. Incompatible saved values are preserved and reported rather than coerced.

- Ordinary `page` entries save through `savePage()` after schema/workspace ownership checks.
- `service-product` entries save through `updateServiceProduct()` using the aggregate UUID, expected aggregate version, and schema definition revision. Publication uses the product aggregate publish operation.
- `event` pages save and publish through the event-page aggregate RPC using tenant, schema definition revision, and optimistic page `updated_at` checks. Schedule facts remain on the event row and are delivered through an allow-listed relation.
- Schema-bound content cannot be written through the old `saveLegacyProductPage()` adapter or generic page save.

### Presentation derived from schema

`src/features/page-builder/editorPresentation.ts` creates a safe presentation model from schema fields and optional `editor_config.page_builder` hints. Hints may supply localized labels/help, field grouping, and ordering. Without hints, the editor humanizes JSON keys, uses schema `description` as help and `placeholder` as an input placeholder, and preserves schema order.

Example (presentation-only metadata, not part of an entry's `content`):

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

Hints are non-executable and cannot override content keys, types, required/nullable rules, or enum values. Malformed/unknown hints are ignored. `meta_description` remains API/agent context and is never shown as editing help. The technical Schema Editor currently does not expose a form for `editor_config`; MCP/REST schema-definition updates can supply it, and the PageBuilder has useful defaults without it.

The normal content-manager view hides type badges, raw keys where a readable label can be derived, URL-slug controls, schema/domain details, JSON import, and raw incompatible values. Administrator-only advanced controls retain URL management, plugin entity actions, JSON import, and technical diagnostics.

Page preview links require an **explicitly set preview slug structure** — an enabled `detail-page` frontend target whose `host_path` contains the `:slug` token plus a registered `frontend_url`. There is no implicit fallback to the schema slug structure; schemas work without previews and the preview view errors out with guidance when the structure is unset. See the [PageBuilder feature contract](../features/page-builder.md#preview-explicit-slug-structure). Optional values are activated by key presence, so `false`, `0`, `null`, empty strings, arrays and objects remain distinct from absent values. Removing an optional field is explicit.

### Legacy compatibility editor

`src/features/page-builder/LegacyProductContentEditor.tsx` and `legacy/` hold the old hard-coded Hero/CTA/Cards/Features/FAQ layout only for historical product pages with no schema association. It is not a second editor for schema-backed content. A product with no linked content page gets a recovery message rather than creating a page by looking up a global `service-product` slug. `legacy/productPageService.ts` refuses to write any schema-bound page.

Legacy records and schema-less content are not backfilled by this source refactor. Conversion/contraction remains an explicit migration phase. Shared primitives such as `StandaloneContentBlockEditor` and `ImageUploader` remain under `src/components/pagebuilder/` because other features use them.

## Technical Schema Editor

`src/features/schema-editor/SchemaEditorPage.tsx` remains the technical contract editor. It edits schema identity, field definitions, workspace/classification, frontend integration requirements/targets, and related technical configuration. Definition changes use the expected `definition_revision`. It does not edit `pages.content` and is not embedded in PageBuilder.

## Related feature contracts

- [PageBuilder content editing](../features/page-builder.md)
- [Technical Schema Editor](../features/schema-editor.md)
- [Schema/content contracts](../features/schema-contracts.md)
- [Service products](../features/service-products.md)
- [Event catalogue pages](../features/event-catalogue.md)
