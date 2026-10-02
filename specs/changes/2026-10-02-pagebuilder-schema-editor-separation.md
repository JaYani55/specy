# PageBuilder and Schema Editor separation

## Summary

Separated the PageBuilder content-editing feature from the technical Schema Editor in both source layout and documentation. The PageBuilder now handles schema-derived content presentation with optional localized labels/groups, while the Schema Editor remains the technical schema-definition surface. Legacy numeric product links resolve to canonical schema/page editing rather than sending schema-bound content through the fixed-layout legacy writer.

## Files Added

- `src/features/page-builder/PageBuilderPage.tsx` — PageBuilder route controller and legacy-link resolver.
- `src/features/page-builder/SchemaContentEditor.tsx` — schema-derived content editor.
- `src/features/page-builder/editorPresentation.ts` — safe schema-to-editor labels/group/order projection.
- `src/features/page-builder/LegacyProductContentEditor.tsx` — isolated schema-less historical content editor.
- `src/features/page-builder/legacy/productPageService.ts` — restricted legacy page adapter.
- `src/features/page-builder/legacy/*` — legacy fixed-layout form sections.
- `src/features/page-builder/JsonImporter.tsx` — administrator-only developer content importer.
- `src/features/schema-editor/SchemaEditorPage.tsx` — relocated technical schema editor.
- `tests/pageBuilderPresentation.test.mjs` — tests localized labels, grouping/order, and safe fallbacks.
- `specs/features/page-builder.md` — PageBuilder contract and compatibility boundary.
- `specs/features/schema-editor.md` — technical Schema Editor responsibility and route contract.

## Files Changed

- `src/App.tsx` — routes to the separated feature entry points.
- `src/services/pageService.ts`, `src/services/productPageService.ts` — removed schema-bound writes from the legacy product page adapter and retained a compatibility re-export.
- `src/services/events/productService.ts`, `src/components/products/form/ProductFormHeader.tsx` — expose page linkage and show the content editor action only when a page is linked.
- `src/features/page-builder/SchemaContentEditor.tsx` — uses schema/editor hints for simplified field labels and sections, hides technical controls from content managers, and preserves the existing lossless/aggregate save behavior.
- `src/features/page-builder/LegacyProductContentEditor.tsx`, `src/features/page-builder/legacy/*` — isolate the historical fixed-layout editor and report invalid form submissions.
- `src/pages/PageBuilder.tsx`, `src/components/pagebuilder/PageBuilderForm.tsx`, `SchemaPageBuilderForm.tsx`, and the legacy section forms — relocated/split into the PageBuilder feature; shared block/media components remain under `src/components/pagebuilder/`.
- `src/pages/SchemaEditor.tsx` — relocated to the separate Schema Editor feature without changing its technical editing UI.
- `specs/features/README.md`, `specs/features/schema-contracts.md`, `specs/features/service-products.md`, `specs/architecture/page-builder.md`, `specs/architecture/system-overview.md`, `specs/platform/multi-tenancy.md`, `specs/agents/product-catalogue-integration.md`, `specs/agents/plugin-hooks.md`, `specs/plans/PRODUCT-INTEGRATION.md` — document the feature boundary and current route/source paths.

## Impact analysis

### Database

No database changes or migrations.

### Runtime

Schema-bound products opened from an old numeric product link resolve to the linked page and redirect to its canonical tenant/schema route. The dynamic PageBuilder edits ordinary pages through `savePage` and service products through aggregate operations; the legacy writer refuses schema-bound or unlinked product pages. Content managers see humanized field labels, descriptions, optional editor-config groups/order, and simplified content controls. Technical schema definition remains in the separate Schema Editor. Legacy fixed-layout editing remains only for already-linked schema-less pages.

### API surface

No REST, MCP, or database API behavior changed. Existing service-product aggregate endpoints remain the required writer for schema-bound products. `editor_config.page_builder` is read as non-executable presentation metadata; existing MCP/REST schema-definition updates can carry these hints.

## Verification

- `npm run typecheck` — passed.
- `npm test` — passed (361 tests).
- `npm run build` — passed; existing plugin dynamic-import and bundle-size warnings remain.
- Vite served a schema-edit deep route and transformed the PageBuilder, Schema Editor, and legacy compatibility modules. An authenticated browser interaction was not available.
