# Objects × Products integration plan

**Status:** Plan only — no implementation authorized by this document.  
**Owner:** Core CMS.  
**Scope:** Make a Product's Object the canonical agent/frontend read model for that Product and its associated public Events, while retaining the current Product/Event tables and aggregate write paths as the operational source of truth.

> This plan was requested after reviewing `specs/agents/SPECY-MCP-DX-REPORT041026.md` and the existing Objects, Product, Event, MCP, and public Pages implementations. It deliberately does not prescribe putting operational values into `page_schemas.schema` or `pages.content`.

## 1. Goal and decisions

A Product is a reusable service offering; Events are scheduled occurrences of that Product. The public website needs one dynamic URL per Product which returns both the Product and its associated public Events, including current operational facts and explicitly public custom values. An authenticated MCP agent must be able to discover and read the same record through Specy's existing Objects tools/API.

**Recommended architecture:**

1. Continue to use `mentorbooking_products` / its `service_products` UUID projection as the canonical Product record, and `mentorbooking_events` as the canonical Event record. `pages.content` continues to own editorial presentation content and its publication lifecycle.
2. Create exactly one **read-only Object mirror per Product**. `objects.schema` describes a Product-with-Events JSON record, and `objects.data` contains a materialized projection of the current Product and its associated publicly deliverable Events.
3. Maintain the mirror synchronously in PostgreSQL triggers/aggregate transactions. Product, Event, page-publication, and per-Product field-definition changes must not leave the mirror stale after the transaction commits.
4. Keep the existing Objects API and `list_objects` / `get_object` MCP tools as the canonical read contract. Add a friendly Product URL, `GET /api/products/{workspaceSlug}/{productSlug}`, as an alias that resolves the mirror and returns the **same Object response shape**, rather than maintaining a second Product DTO implementation.
5. Custom-field **definitions are per Product**, not tenant-wide. Product custom values are stored on that Product; Event custom values are stored on the Event and use the custom-field definitions belonging to its selected Product. The Object's schema mirrors those definitions for agent discovery.
6. Public projection is explicit. Product and Event custom fields are included in the Object only when their per-Product definition is marked public. Private custom values never leak through Object's anonymous API merely because an Object mirror exists.
7. Objects sourced from Products are system-managed and read-only in ObjectEditor. Product fields and schemas are edited through Product/Event management, not by directly mutating the mirror.

## 2. Current implementation inventory

### 2.1 Objects (existing)

- `migrations/objects.sql` creates `public.objects` with UUID `id`, globally unique `slug`, `schema jsonb`, `data jsonb`, `status` (`published`/`archived`), `requires_auth`, and `api_enabled`.
- `migrations/202605310001_markdown_objects.sql` adds `object_type`, `agent_description`, `share_enabled`, and `share_slug`. `202605310002_markdown_object_share_scope.sql` scopes the share-slug unique index by `(tenant_id, share_slug)`.
- Tenant and owner columns, defaults, and RLS are added by the multi-tenancy migrations. Authenticated Object reads rely on RLS; anonymous reads require `status = published`, `api_enabled = true`, and `requires_auth = false`.
- `api/routes/objects.ts` exposes:
  - `GET /api/objects` — public/authenticated discovery.
  - `GET /api/objects/:idOrSlug` — full Object schema/data; authenticated reads rely on RLS, anonymous reads require the public flags above.
  - `GET /api/objects/share/:tenantName/:shareSlug` and `/api/objects/o/:tenantName/:shareSlug` — share lookup using tenant name/slug/organization slug plus `share_enabled` and `requires_auth` checks.
  - Object create/update/archive routes and internal creation helpers.
- MCP already exposes `list_objects` and `get_object`. They return Object identity and its schema/data, so no new `specy_products_*`-specific response format is necessary for the data stream.
- `src/pages/ObjectEditor.tsx` authors an Object schema and its JSON/Markdown data. Its field types include string, number, boolean, array, object, URL, email, date, and price. `src/services/objectService.ts` and `src/types/objects.ts` are the frontend access/type layer.
- Object slugs are globally unique. Share slugs are unique per tenant. `tenant_id`, `api_enabled`, `requires_auth`, and `share_enabled` have distinct authorization meanings and must not be conflated with Product/Event publication.

### 2.2 Product and Event (existing)

- The old `/products/manage` workflow edits the integer-ID `mentorbooking_products` record through `ProductForm` / `ProductManagementModal`. Events reference it through integer `mentorbooking_events.product_id`.
- The newer service-product aggregate uses `mentorbooking_products.integration_id` as its public UUID through the `service_products` view. Its canonical page is `product_page_id`; `pages.status` controls publication. Product create/update/publish already use tenant/schema/version checks.
- Event-page integration similarly links a tenant Event row to a Page in a registered `event` schema. Event page publication is independent of internal event status.
- Commit `202610040003_product_event_custom_fields.sql` (current baseline) adds Product/Event `custom_fields` JSON objects, tenant-wide `tenant_custom_field_definitions`, a direct public Product DTO route, and aggregate plumbing. The user feedback clarifies that **tenant-wide field definitions are the wrong ownership model** and that this direct DTO route should not become a second canonical data model. This plan replaces that approach with per-Product definitions and an Object mirror.
- At the time of this plan, no `objects` column/FK/trigger maps an Object to a Product. Products do not create/synchronize Objects. The current `/api/products/:workspaceSlug/:productSlug` handler directly joins Product/Event/page tables and returns a custom response rather than the standard Object DTO.

## 3. Target Object schema/data contract

The stored Object is one JSON Object per Product, not one Object per Event. Its schema describes a stable envelope; its data is a refreshed projection. Exact optional names may be normalized to Specy DTO conventions during implementation, but the entity separation and nesting are required.

Illustrative Object `schema`:

```json
{
  "product": {
    "type": "object",
    "required": true,
    "properties": {
      "id": { "type": "string", "required": true },
      "name": { "type": "string", "required": true },
      "slug": { "type": "string" },
      "content": { "type": "object" },
      "description_de": { "type": "string" },
      "custom_fields": {
        "type": "object",
        "properties": {
          "product_custom_key": { "type": "string", "description": "..." }
        }
      }
    }
  },
  "events": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "name": { "type": "string" },
        "slug": { "type": "string" },
        "content": { "type": "object" },
        "date": { "type": "date" },
        "time": { "type": "string" },
        "end_time": { "type": "string" },
        "duration_minutes": { "type": "number" },
        "timezone": { "type": "string" },
        "mode": { "type": "string" },
        "custom_fields": {
          "type": "object",
          "properties": {
            "event_custom_key": { "type": "number", "description": "..." }
          }
        }
      }
    }
  }
}
```

Illustrative Object `data`:

```json
{
  "product": {
    "id": "<service-product-uuid>",
    "name": "Themenwerkstatt",
    "slug": "themenwerkstatt",
    "content": { "headline": "...", "price": "..." },
    "description_de": "...",
    "custom_fields": { "product_custom_key": "..." }
  },
  "events": [
    {
      "id": "<event-uuid>",
      "name": "Themenwerkstatt, 22.11.2026",
      "slug": "themenwerkstatt-2026-11-22-18-00",
      "content": { "teaser": "..." },
      "date": "2026-11-22",
      "time": "18:00",
      "end_time": "20:30",
      "duration_minutes": 150,
      "timezone": "Europe/Berlin",
      "mode": "online",
      "custom_fields": { "registration_status": "open", "participant_min": 3, "participant_max": 10 }
    }
  ]
}
```

Important contract points:

- Operational Event data comes from `mentorbooking_events`; presentation content/name/slug comes from the linked published event Page. The endpoint does not depend on manually duplicated schedule values in `pages.content`.
- Product identity uses the stable service-product UUID (`integration_id`), never the legacy integer ID. Event IDs remain UUIDs. Do not put company IDs, legacy product integers, account/staff IDs, or database join keys into the public DTO.
- The Object schema must describe custom Product and Event field keys/types. Object's current type system has no general `json`/any field type; implementation must either add a safe `json` schema type and teach ObjectEditor/schema validation about it, or document an explicit object/array-only restriction. Do not claim scalar/array/object support that the Object schema cannot accurately describe.
- Object `status` is only `published | archived`; it is not Product publication or Event registration state. A draft/unpublished Product mirror is not anonymous/API-enabled. Event registration state such as `open` is a per-Product Event custom field, not `page.status` or the internal scheduler status.

## 4. Per-Product custom-field ownership

The previous tenant-wide definitions make every Product/Event share one field set, which the user rejected. The target must be **per Product**:

1. Store each Product's field contract in `mentorbooking_products.custom_field_schema jsonb` (or a similarly named JSON column) with two namespaces, for example:

   ```json
   {
     "product": { "public_label": { "label": "Public label", "type": "string", "is_public": true } },
     "event": { "registration_status": { "label": "Registration", "type": "string", "is_public": true } }
   }
   ```

2. Store Product values in `mentorbooking_products.custom_fields jsonb` and occurrence values in `mentorbooking_events.custom_fields jsonb`. An Event's editable definitions are loaded from its currently selected Product. It does not get a workspace-global set of fields.
3. “Eigene Felder” is opened for a **specific Product**. Its Product/Event tabs edit that Product's custom-field schema. Creating a different Product starts with its own schema. If a Product is retired, its field schema remains with its record/Object for history.
4. The Event editor loads Event definitions from the selected Product. If the Event's Product is changed, preserve values whose keys are no longer defined (do not silently erase data), show only fields defined by the new Product, and validate/submit those visible fields. Product association must be checked in the Event's tenant.
5. Field types should cover string, number, boolean, date, URL, email, and opaque JSON. Definitions also carry label, description, required, and `is_public`; public visibility is opt-in/default-off. Validate keys/types/size on every UI and API/RPC write, not only in React.
6. The Object mirror's schema is generated from this Product-specific field schema. `product.custom_fields` and each nested `event.custom_fields` contain only values authorized for the Object's public contract. Hidden/private values remain in operational rows and authenticated Product/Event reads, not in an anonymous Object mirror.

### Current tenant-wide definitions in the branch

The present `tenant_custom_field_definitions` table/UI from `202610040003_product_event_custom_fields.sql` is not the target ownership model. Before implementation, inspect `public.deployment_state`/migration history and the configured databases:

- Never edit/replay an applied migration to pretend the workspace-wide definitions never existed.
- If that migration has not shipped/applied and release policy explicitly permits amending the pre-release change, update the release plan before rollout; otherwise add a forward migration.
- Do not blindly copy every tenant-wide field definition to every Product. If existing definitions/values are present, export/review them and map a definition only to Products that actually use it. Keep the old table read-only during the transition; remove it only after no UI/API consumer uses it and reviewed data is preserved.

## 5. Product-to-Object identity and lifecycle

Add an internal source relation on Objects, recommended as `objects.source_product_id integer` referencing `mentorbooking_products(id)` with a unique partial index. The value is an internal join key only and must not be included by `serializeObject`, public DTOs, or MCP output. This avoids a second mirror per Product and gives triggers a deterministic upsert key. The Object's public `data.product.id` remains the stable Product UUID.

Mirror Object properties:

- `objects.slug`: stable globally unique slug derived from the Product UUID, e.g. `product-<integration_id>`; never depend on a mutable Product name for the Object's identity.
- `objects.name`/`description`: human-readable Product mirror label.
- `objects.object_type = 'json'`; `objects.schema` and `objects.data` use the envelope in §3.
- `objects.tenant_id` and `owner_user_id`: copied from the Product row; `source_product_id` is immutable through ordinary Object routes.
- `objects.status = 'archived'` when the Product is retired; otherwise use the Object table's allowed `published` value. Gate anonymous delivery with `api_enabled` and `share_enabled`, enabled only when the linked Product Page is published and its service-product schema is registered. A legacy/no-page Product may have an internal mirror for authenticated/MCP use but it is not publicly enabled.
- `objects.requires_auth = false` only for this intentionally public projection. It contains only the public allow-list. If a future use needs private Object mirrors, define a separate authenticated Object contract rather than mixing private fields into a public mirror.
- `objects.share_slug`: use the human product page slug (with a deterministic collision suffix if required by the existing `(tenant_id, share_slug)` unique index). Keep the Object's globally unique `slug` separate.

The DB mirror is a generated read model, not a second editable record. Product-backed Objects must not be creatable, updateable, or archivable through generic Object POST/PUT/DELETE routes, even by the product owner. ObjectEditor should hide mirrors from its manual authoring list and, if a direct mirror URL is opened, route to the Product editor with a read-only/source explanation. `list_objects` and `get_object` remain available to authorized MCP callers; list/get results should make the Product mirror discoverable.

## 6. Synchronization contract — one transaction, no best-effort dual writes

A Product create/update from the legacy Product editor, schema-backed aggregate, REST, or MCP must not commit while its Object mirror is stale. Use one idempotent `SECURITY DEFINER` sync function with fixed `search_path = public`; it recomputes `objects.schema`, `objects.data`, public flags, and `updated_at` from canonical database rows. Call it inside the source transaction through triggers or aggregate RPCs. Never have a browser call the Objects API as a second save request.

Required sync points:

| Source mutation | Object consequence |
|---|---|
| Product row create/update/retire | Create/upsert mirror; refresh standard Product data/custom values; set public flags from Product Page/schema publication; archive mirror when Product is retired. |
| Product page name/slug/content/status update | Refresh `data.product` and share slug; public enablement follows published + registered checks. |
| Product schema registration change | Re-evaluate public enablement and Object schema/content contract. |
| Product custom-field schema/value update | Refresh Product custom schema and data in the same Product transaction. |
| Event create/update/product reassignment/delete | Refresh the old and/or new Product's nested event list. Event times, timezone, mode, content, custom values, and public state are always read from the Event/Page rows. |
| Event page title/slug/content/publication update | Refresh the owning Product mirror; draft/unpublished/unregistered Event pages are removed from the public nested list. |
| Per-Product custom-field schema edit | Update `mentorbooking_products.custom_field_schema`, validate stored values, and rebuild the Product Object's matching schema/data. |

Recommended implementation shape:

- Add a unique source key on `objects`; the mirror sync function uses `INSERT ... ON CONFLICT ... DO UPDATE` and returns the mirror Object ID/slug.
- Triggers on Product, Event, Page, and relevant schema-registration/custom-schema changes call the same sync function. For Event reassignment, synchronize both previous and next Products.
- Product aggregate `create_service_product_aggregate`, update/publication/archive paths already define Product/page transactions. Invoke/retain sync inside those transactions. Legacy direct ProductForm writes need equivalent DB triggers so they cannot bypass mirroring.
- Event-page creation is already an atomic Event+Page aggregate. Its custom-field wrapper and mirror synchronization must be in that same transaction; do not add a later HTTP write.
- Product mirror Object changes must not trigger Product sync again. Direct Object write policies reject a row with `source_product_id IS NOT NULL`.
- A tenant's custom schema changes trigger re-sync only for Products in that tenant. The field schema itself remains per Product, not tenant-global.
- Avoid fetching all tenants' data in the sync function. Every lookup and update is pinned to `tenant_id` plus Product identity; public output is an explicit allow-list.

## 7. API and MCP contract

### Canonical Object read

The canonical generated data stream is the existing Object contract:

- `GET /api/objects/{object_slug}` for published `api_enabled` non-auth mirrors.
- Existing authenticated Object reads and MCP `get_object` can read owner/member-visible mirrors through Objects RLS.
- Existing share endpoint can serve the Object when its Product is public and the share slug is enabled.
- Existing Object response shape is preserved: Object metadata plus `schema` and `data`. Do not return raw `mentorbooking_*` rows.

### Friendly Product alias

Keep `GET /api/products/:workspaceSlug/:productSlug` as a friendly Product URL. Resolve the published service-product page in the named tenant, resolve its Product source relation and Object mirror, enforce the same public flags as Objects, and serialize the **same Object envelope**. It must not implement an independent second join/projection. The product page slug is the `productSlug`; workspace slug is `tenants.slug`.

The current branch's `/api/products/:workspaceSlug/:productSlug` handler returns a Product-specific `{ product: { ..., events } }` DTO. Before release, decide whether it has external consumers. If not, replace its response with the Object DTO directly. If already consumed, retain a documented/versioned compatibility response while making Object data the source; do not silently break an Astro client.

### MCP discovery

- Product aggregate `list/get/create/update` outputs should include the mirror Object `id`, stable `slug`, and Object URL when available; do not expose `source_product_id` or legacy integer IDs.
- `specy_products_get` identifies the exact Object for a Product. `get_object` then returns the same Product + nested Events stream the frontend receives.
- `list_objects` should identify Product mirrors clearly and include their stable Object slug/URL. Preserve ordinary user-authored Objects and tenant RLS behavior.
- Product custom-field definitions/values remain available through the authenticated Product MCP operations; per-Product Event field definitions/values use the Event create/update read/write path and do not get flattened into `pages.content`.

## 8. Public projection, safety, and freshness

The Object is public only for an intentionally published Product page in a registered `service-product` schema. Nested Events are included only when their Event Page is linked to the same Product/tenant, published, in a registered `event` schema, and has a valid IANA timezone. Product/Event publication remains separate from internal scheduler/request status.

Allowed product data: stable Product UUID, display name, page slug, published product `pages.content`, safe standard public fields agreed in DTO review, and `product.custom_fields` values marked public. Allowed Event data: UUID, display name/slug, published page content, ISO date, local time/end time, duration, IANA timezone, mode, and `event.custom_fields` values marked public.

Never include company/customer IDs/names, Teams/meeting URLs, internal event status, staff/account IDs, mentor request/approval arrays, compensation, private notes, raw tenant IDs, legacy integer Product IDs, or custom fields not marked public. Product/Event owner APIs remain authenticated and tenant-scoped.

Object mirror updates synchronously with operational writes. The dynamic API URL reads the current mirror on every request; it does not depend on Astro ISR to update database values. Astro may still cache the GET response; if using static/ISR rendering, revalidate the Product route and affected Event routes after Object sync. Preserve the current revalidation diagnostics/secrets-redaction behavior.

## 9. Migration, backfill, and release plan

1. **Inventory/staging gate:** check `public.deployment_state` and the actual database for every migration already applied; take a snapshot. Confirm Object slug/share constraints, Object RLS, Product/event FK ownership, and tenant membership behavior with at least two tenant personas.
2. **Per-Product schema transition:** the current branch's `202610040003_product_event_custom_fields.sql` introduced tenant-global definitions, contrary to the requested per-Product contract. Never edit/replay an applied migration. Add an ordered forward migration for `mentorbooking_products.custom_field_schema` and explicitly reviewed tenant-global-definition migration/retirement. Do not copy one tenant-wide definition to every Product without review; field definitions must become Product-specific.
3. **Object source relation:** add the source Product FK/unique index, Object schema/data sync function, source-write protection policies, and triggers. Register the migration after Product aggregate, Object, Event, tenant, and custom-field tables/functions exist. Include the new migration key in the unified setup component taxonomy and tests.
4. **Backfill:** after a snapshot and reviewed workspace inventory, create one mirror for each Product row. Derive page association only from an existing valid same-tenant `product_page_id`; do not infer a page/schema from matching names. Mirrors for retired/draft/unlinked Products remain non-public. Re-run sync idempotently and compare counts/source IDs/custom values before enabling public reads.
5. **Cutover:** deploy Product/Event schema/value UI, Object sync, and the Product URL alias together. For any already-used Product DTO response, use the compatibility decision from §7. Update Astro clients to consume the Object `schema`/`data` contract and do not keep manual copies of schedule facts in page JSON.
6. **Observe then contract:** monitor trigger errors, Object/product count drift, API 404/409s, stale public flags, and revalidation diagnostics. Retire direct response projections/tenant-wide field UI only after consumers and data are migrated. Never drop the legacy fields or tenant-wide table without an explicit backup/usage inventory.

## 10. Validation and acceptance matrix

### Object and consistency

- Creating a legacy Product or service-product aggregate creates exactly one Object mirror in the same transaction.
- Repeating an idempotent product create does not duplicate the Object.
- Product name/content/slug/custom value changes update Object schema/data and keep a stable Object ID/slug.
- Event create/update/delete, custom fields, page publish/unpublish, and reassignment synchronize old/new Product objects.
- Product retirement disables public API/share; deletion removes its mirror by FK/cascade according to the aggregate lifecycle.
- Direct Object update/delete of a Product mirror is denied; ObjectEditor hides it or routes to its Product source. Manual Objects remain fully editable.
- RLS prevents cross-tenant Product/Object discovery and update. Anonymous API sees only published Product/Event projections.

### Payload/API/MCP

- `GET /api/products/{tenantSlug}/{productPageSlug}`, `GET /api/objects/{objectSlug}`, and Object share URL return the same Object `schema`/`data` shape.
- The root shape is `data.product` with associated `data.events`; the schedule is read from operational events, not duplicated from schema content.
- Only `is_public: true` custom keys appear in Object schema/data. Company, meeting, staff, internal status, compensation, private custom fields, and legacy integer IDs are absent.
- A product with draft/unregistered page, an Event with draft/unregistered page, invalid timezone, archived Product, or wrong tenant is not anonymously deliverable.
- MCP `list/get` Product includes Object pointer information; `get_object` retrieves a structurally identical stream. Test authenticated owners, another same-tenant member, tenant admin, super-admin, and anonymous clients separately.
- Custom field schemas are per Product. Two Products in the same tenant can have different Product/Event field definitions. Event editor shows only its selected Product's Event definitions, preserves unknown old values on Product switch, and validates required typed values.

### Migration and frontend

- Apply the migration twice to a local/staging database; verify constraints, RLS, triggers, policy grants, and unique slug/share behavior.
- Run migration ordering/state tests and unit tests that import real projection/sync helpers. Add transaction tests for sync atomicity/rollback and two-tenant leakage.
- Astro tests fetch the Product URL dynamically, parse `Object.schema`/`Object.data`, render nested public Events, and verify an Event schedule update is visible on the next GET without a schema/page definition update.
- Test ISR separately for any Astro static route that caches Object data; HTTP 200 registration alone does not prove new route generation.

## 11. Expected implementation touchpoints (not changes made here)

- Migrations: Product-specific custom schema/value storage, `objects.source_product_id`, mirror sync functions/triggers, Object RLS immutability for source mirrors, reviewed backfill.
- API: Objects serializer/source metadata internally, Product aggregate DTO mirror pointers, Object-backed `/api/products/:workspaceSlug/:productSlug` alias, Object/MCP discovery adjustments, public-field projection tests.
- Dashboard: Product-specific “Eigene Felder” Product/Event tabs, typed custom field editor in legacy ProductForm and schema-backed Product PageBuilder, EventForm definition lookup by selected Product, Object mirror read-only messaging.
- Services/types: Product aggregate custom schema/object pointers, event associated Product field schema/custom values, shared field definitions/value validator.
- Specs/tests: Object DTO example, privacy policy, per-Product custom-field contract, migration/state taxonomy, RLS/transaction/reconciliation and Astro integration tests.

## 12. Explicit non-goals

- Making Objects the authoritative Product/Event write store; Product/Event aggregate rows remain authoritative operational data.
- Editing a Product mirror independently in ObjectEditor or synchronizing arbitrary Object mutations back into Product/Event tables.
- Making all tenant custom fields global again.
- Exposing all legacy Events just because they have a `product_id`; event page publication is the public occurrence gate.
- Adding private financial, company, meeting, staff, or internal event status fields to a public Object.
- Treating `page.status`, `objects.status`, internal Event status, and registration status as the same state.
- Inferring links from names/slugs, silently changing existing product/event page data, or applying migrations to production without the rollout gate.
