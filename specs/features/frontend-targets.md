# Frontend targets & slug-structure validation

## Purpose

`schema_frontend_targets` is the registry that tells the CMS **where** a registered
frontend renders a schema's pages. Targets are validated on every write path
(frontend registration, `PUT /api/schemas/:slug/frontend-targets`, MCP
`specy_pages_schemas_replace_frontend_targets`) through one shared implementation
(`replaceSchemaFrontendTargets` / `validateSchemaFrontendTargetInputs` in
`api/lib/schemaRegistration.ts`). The MCP surface never self-fetches the Worker's
own URL for target writes (Worker-to-self subrequests can fail with Cloudflare 522
while the API is healthy).

## Target kinds

| Kind | host_path | Extra | Meaning |
|---|---|---|---|
| `collection-slot` | server path **without** `:slug` | `placement_key` (semantic, e.g. `home.posts`) | Content rendered inside an existing landing/listing page. |
| `detail-page` | server path with `:slug` exactly once | `supports_preview` | One page per entry at its own route. |

## Validation rule chain (authoritative)

Applied to every full target-list replacement:

1. **Target keys** — `target_key` must match `^[a-z][a-z0-9_.-]{0,99}$` and be unique in the list.
2. **Primary** — the list must define **exactly one enabled primary target** (`is_primary: true`, enabled).
3. **Detail structure** — every `detail-page` host_path must contain `:slug` exactly once, no whitespace (enforced by validation and by the DB `schema_frontend_targets_shape_check` constraint).
4. **Public detail namespace** — a detail target **without** `supports_preview` must **exactly match** `integration_requirements.required_slug_structure` (if set) and must stay under `integration_requirements.route_base_path` (if set, and not `/`).
5. **Preview namespace** — a detail target **with** `supports_preview: true` must exactly match `integration_requirements.preview_slug_structure` when that key is set. Preview targets are **exempt from `route_base_path`** (the preview route is internal: not linked, noindex).
   - When `preview_slug_structure` is **not** set, preview-capable targets follow rule 4 like public targets.
   - `preview_slug_structure` itself must contain `:slug` exactly once, start with `/`, and contain no whitespace; it is validated both in `specy_pages_schemas_update_definition` (via `parseSchemaDefinitionPatch`) and before target validation.
6. **Duplicate host paths** — enabled detail targets must have unique `host_path` (validation error naming the target, plus DB unique index `schema_frontend_targets_detail_host_unique`).
7. **`supports_preview` is honored as supplied** — `false` marks the public detail route, `true` the non-public preview route. It is **not** coerced. Legacy single-detail registrations registered before the flag existed (coerced `true`) remain preview-capable through fallback resolution.

Failures **name the offending target** (`target "event-preview" (/preview/:slug): …`) and aggregate **all** mismatches into one response (`errors: []`) instead of aborting at the first.

## Dual configuration: public route + non-public preview route

Schemas can register a public detail route and a separate non-public preview route
side by side:

```json
{
  "integration_requirements": {
    "required_slug_structure": "/veranstaltungen/:slug",
    "preview_slug_structure": "/preview/:slug",
    "route_base_path": "/veranstaltungen"
  },
  "targets": [
    { "target_key": "home-events",    "kind": "collection-slot", "host_path": "/",                  "placement_key": "home.events", "is_primary": true },
    { "target_key": "event-detail",   "kind": "detail-page",     "host_path": "/veranstaltungen/:slug", "supports_preview": false },
    { "target_key": "event-preview",  "kind": "detail-page",     "host_path": "/preview/:slug",         "supports_preview": true }
  ]
}
```

- Public URLs are built from the non-preview detail target (published pages only).
- Preview URLs are built **only** from the preview target and emitted by the
  backend (`specy_pages_schemas_preview`); the frontend route itself must be
  noindex, unlinked, and serve drafts (frontend responsibility, not the CMS's).
- Setting `preview_slug_structure` requires a `definition_revision` bump
  (`integration_requirements` changes bump the optimistic revision), so
  concurrent `specy_pages_schemas_update_definition` calls conflict instead of
  overwriting.

## Preview resolution order (`specy_pages_schemas_preview` / dashboard)

1. With `preview_slug_structure` set → **only** the enabled `detail-page` target with `supports_preview: true`.
2. Without it → the enabled `detail-page` target with `supports_preview: true`, else (legacy fallback) the single enabled `detail-page` target.
3. Otherwise → **no preview** (`preview_not_configured`). There is never an implicit fallback to `slug_structure` or `required_slug_structure`; schemas work fully without previews.

## `integration_requirements` keys actually evaluated

| Key | Evaluated by |
|---|---|
| `required_slug_structure` | Target validation (rule 4), `update_system_data` slug_structure check |
| `preview_slug_structure` | Target validation (rule 5), preview resolution, `update_definition` template validation |
| `route_base_path` | Target validation (rule 4; preview targets exempt) |
| `canonical_frontend_url`, `allow_temporary_frontend_urls` | frontend_url checks (`isFrontendUrlAllowed`) |
| `content_scope`, `page_target` | Content contract, single-page handling |
| `route_ownership`, `page_discovery_mode`, `schema_identification_hint`, `registration_notes` | Display/registration guidance |

**Unknown keys are accepted and silently ignored.** They have no effect on any
validation or tool — do not invent keys (e.g. `preview_slug_structure` had no
effect before it was implemented; it does now).

## Error catalog

| Error | Cause | Remedy |
|---|---|---|
| `Invalid or duplicate target_key: X` | key malformed or repeated | rename one target |
| `target "X" (path): slug_structure must match the schema requirement Y` | detail target violates rule 4/5 | match the named structure, or (for preview targets) set `preview_slug_structure` via `update_definition` |
| `target "X" (path): slug_structure must stay under the configured base path Y` | rule 4 namespace violation | keep public routes under `route_base_path`; preview targets are exempt only when `preview_slug_structure` is set |
| `target "X": duplicate enabled detail-page host_path "P"` | rule 6 | give each detail target a distinct host_path |
| `integration_requirements.preview_slug_structure must include :slug exactly once` | malformed preview template | fix the template in `update_definition` |
| `Targets must define exactly one enabled primary target` | zero or multiple primaries | mark exactly one enabled target `is_primary: true` |
| `Frontend-target update failed (5xx)` | transient backend/proxy failure | safe to retry the same call; target replacement is a full atomic replacement |

## Related documentation

- [PageBuilder preview](page-builder.md)
- [MCP exposition](../agents/mcp-exposition.md)
- [Schema Editor](schema-editor.md)
