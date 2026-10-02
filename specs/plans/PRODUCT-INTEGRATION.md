# Products × Pages integration — rebuild plan

**Status:** Proposed; not implemented. **Audit date:** 2026-10-02.  
**Scope:** Core service-product catalogue, Pages integration, independent staff/freelancer/guest management, optional single-table customer-organization CRM, public event catalogue, and typed external-service handoff.  
**Planning revision:** 2026-10-02 — staff/account separation and optional CRM are required foundations, not optional cleanup. §§11–14 detail their contracts and risk closure.  
**Implementation constraint:** This document authorizes no code changes or database operations. File additions, edits, renames, removals, and contracts below are proposals.

## 1. Outcome and architectural decisions

An agent/developer defines the content contract in a decoupled frontend, initially Astro, uploads it through authenticated Specy MCP, and connects frontend delivery targets. A tenant then creates and manages a service product in one backend workspace, with its page edited through the existing schema-driven Pages editor. A second schema can define the public event catalogue. Optional team presentation selects real staff profiles without requiring those people to hold a particular login role.

**Recommended decisions:**

1. Keep business products and page content distinct, but present them as one editing workflow. Business fields belong in `service_products`; arbitrary presentation JSON belongs in `pages.content`. Do not create a second product-content table or a second block editor.
2. Add schema classification outside the developer's content JSON: `entity_kind = page | service-product | event`. The ordinary schema UI offers **„Als Produktschema verwenden“**; turning it on selects `service-product`. Event classification is supplied by the event integration/MCP contract, not another option in the product form.
3. Reuse canonical `/pages/schema/:tenantSlug/:schemaSlug` routes, stable `api_slug` API identifiers, frontend target registration, and publication. Products is a filtered business entry point into Pages, not another content system.
4. Give each product exactly one canonical page in the MVP. Products may use different product schemas. That schema's frontend targets may include a catalogue collection slot, an optional detail page, or both. A catalogue schema describes **one entry**, not a single page containing an array of every product.
5. Preserve developer keys, nesting, JSON values, extension metadata, and custom blocks through upload → editor → save → public delivery → export. Fix existing lossy normalization before migrating products into this editor.
6. Use `staff.id` as the identity for staff relations. A staff record describes a collaborator, including freelancers and guests; it is neither an auth account nor a tenant membership. Keep optional account linkage in a separate relation. Separate **staff featured on a page**, **staff eligible to deliver a service**, and **staff assigned to an event**.
7. Keep public event presentation separate from private operational scheduling. A scheduled service instance references a product; its optional public page references an event schema. Operational status is never a publication flag.
8. Use transactional, tenant-checked aggregate mutations shared by dashboard, REST, and MCP. Generic page tools must not bypass product/event invariants.
9. Expand/backfill/cut over/contract. Preserve IDs, content, and history; remove executable legacy code only after verified migration. Never delete or rewrite shipped migrations to erase terminology.
10. Customer organizations are optional private CRM records in one `companies` table. They do not represent the supplier's tenant, staff affiliation, employers, or login identities. Never auto-create a customer from free text during event save.
11. Define versioned, runtime-validated DTOs for frontend/public content and separately authorized business handoff. Typed dates, IDs, money, addresses, nullability, and explicit external references must not depend on German labels or arbitrary page layouts.

### Explicit non-goals

No physical-product inventory, checkout, taxation engine, payment integration, booking marketplace, generic relationship graph, arbitrary executable schema code, or Astro rendering inside Specy. No mandatory hero/CTA/FAQ layout. No automatic conversion of every scheduled private appointment into a public event. No new plugin-specific logic in core.

## 2. Audit: actual implementation and failure points

The findings below come from repository inspection, not a running production database. Older architecture documents contain historical duplicate sections and still call `pages` the `products` table; current code and ordered migrations take precedence. Live constraint/policy/data verification is a phase-zero requirement.

| Area / concrete files | Current behavior | Required correction |
|---|---|---|
| `src/pages/VerwaltungAllProducts.tsx`, `VerwaltungCreateProduct.tsx`, `ProductDetail.tsx` | Separate admin list/detail/forms; fetch mentor groups and mentor accounts; hardcoded gradients, salary, and mentor requirements dominate the UX. Some calls omit active workspace filtering. | Replace with tenant-scoped catalogue entry point and shared aggregate editor; remove duplicate details/forms. |
| `src/components/events/ProductManagementModal.tsx`, `ProductForm.tsx`, `src/hooks/useProductManagement.ts` | Products are implemented inside Events. Repeated sanitization, delayed resets, debug UI, and column-name guessing for usage checks. Usage errors permit deletion. | No modal management subsystem. Explicit typed usage queries; fail closed; query hooks and atomic mutations. |
| `src/components/products/form/ProductFormHeader.tsx`, `src/pages/PageBuilder.tsx` | Header opens `/pagebuilder/<numeric product ID>`. PageBuilder branches between schema mode and legacy mode; casts arbitrary page JSON to `PageBuilderData`; does not verify loaded page belongs to routed schema. | Product edits resolve canonical page/schema routes; validate tenant/schema/page tuple; use plain JSON types. |
| `src/components/pagebuilder/PageBuilderForm.tsx`, `HeroForm.tsx`, `CtaForm.tsx`, `CardsForm.tsx`, `FeaturesForm.tsx`, `FaqForm.tsx` | Hardcoded legacy marketing page and `'trainer-module'` boolean. | Retire after migration; no layout assumptions in new product pages. |
| `src/services/productPageService.ts`, legacy section of `src/services/pageService.ts` | Wrapper plus `getProductPageData` / `saveProductPage`; resolves `service-product` by unqualified slug, creates and links pages in separate requests. | Remove legacy writers after cutover. Resolve explicit schema IDs in the correct tenant; transaction protects linkage. |
| `migrations/mentorbooking_products.sql`, `products.sql`, `pages.sql` | `products` was the old page table, renamed to `pages`. Actual business products remain `mentorbooking_products`, numeric IDs and `product_page_id`. The historical FK has **ON DELETE CASCADE from page to product**. | New business name `service_products`, preserving numeric IDs; page deletion must not delete the business record. |
| `src/services/events/productService.ts` | Type omits page/schema/tenant linkage; `fetchMentors` searches role `mentor`; deletion deletes linked page first, then product, and continues after errors. | Replace with general product service and staff registry; remove destructive multi-request deletion. |
| `src/pages/Pages.tsx`, `PagesSchemaDetail.tsx`, `SchemaEditor.tsx` | Pages hub, tenant-qualified routes, schema editor, registration, page list, publishing, frontend target controls already exist. Waiting schemas replace the page list with a registration screen. | Extend these surfaces, do not rebuild them. Product drafts must remain editable during pending/waiting registration. |
| `SchemaPageBuilderForm.tsx` | Recursive fields/arrays/content blocks exist. Normalization rebuilds root/nested objects from known fields. Optional `false`, `0`, empty strings/collections and `null` are considered inactive, and inactive fields are omitted on save. Media objects may become strings. | Lossless data editing; absent is distinct from present-but-empty. Unknown keys must survive; invalid data must be flagged, not silently replaced. |
| `SchemaEditor.tsx`, `JsonImporter.tsx` | Schema serialization reconstructs a limited metadata subset. Import warns unknown content keys will be ignored; block import lists only six types although shared types include forms/audio. | Preserve raw schema and content extensions; unify validation/renderer registry; eliminate import/editor disagreement. |
| `api/routes/mcp.ts`, `api/lib/schemaCreation.ts` | OAuth schema creation and page management exist. There is no built-in schema-definition update tool, product aggregate creation, or staff presentation contract. Page tool descriptions promise schema conformity, but inspected insert/update handlers do not perform recursive content validation. | Add explicit schema update and aggregate operations; shared validation, revisions, role-aware page tools. Do not claim this already works. |
| `api/routes/schemas.ts`, `api/lib/frontendManifest.ts` | Public registered-schema page endpoints return published arbitrary JSON; collection/detail target contract is established. Public delivery intentionally uses a server-side privileged client behind published-schema checks. | Preserve that narrow public boundary; add allowlisted relation projections, never `select('*')` over products/staff/events. |
| `src/services/staffRegistryService.ts`, `migrations/staff_registry.sql` | General staff registry and traits exist, including staff without an account. Service falls back to role/account directory on missing relation **or empty results**; fallback has no tenant argument. | Reuse registry, remove fallback after migration; an empty tenant directory must stay empty. Public profile opt-in and exact tenant checks. |
| `src/components/events/StaffCombobox.tsx`, `src/services/staff/staffService.ts`, `src/utils/staffUtils.ts` | Several staff sources/caches still resolve account IDs/roles, not registry IDs. | One tenant-scoped staff selector/directory; explicit account-to-staff mapping for historical records. |
| `src/types/event.ts`, `src/contexts/DataContext.tsx`, `CreateEvent.tsx`, `EditEvent.tsx` | Events use product IDs, staff arrays, legacy mentor arrays and counts side-by-side. UI workspace selection is not consistently passed into direct create/update paths. | Keep integer product references; tenant-check all relations; reconcile identities/statuses before removing old fields. |
| `src/services/events/mentorService.ts` | Queries camelCase `acceptedMentors` / `requestingMentors` although SQL defines snake_case columns. | Replace, do not merely rename the file. |
| `migrations/mentorbooking_events_archive.sql` | Historical product FK is `pillar_id`; additional coach/backup arrays remain. | Include archive references and snapshots in migration inventory. |
| `migrations/staff_registry.sql`, `src/pages/VerwaltungAddMentor.tsx` | `staff.account_user_id` has a global unique constraint. Staff editor fetches account directory on mount even for accountless people. | Separate account link table with tenant-local identity checks; account lookup is optional, explicit and permission-aware. |
| `src/services/company/companyService.ts`, `src/components/events/EventForm.tsx`, `CreateEvent.tsx`, `EditEvent.tsx` | Company name is required and `ensureCompanyRecord` matches by `ilike`, or creates a record on event save, without explicit active-tenant arguments. | Optional customer ID, independent event title, explicit CRM create/select; no fuzzy-name upsert or silent fallback after invalid ID. |
| `migrations/companies.sql`, `CompanyCombobox.tsx`, `EventFormSections/CompanySection.tsx` | Basic single-table organization fields already exist, but UI has two competing identity inputs and directory queries omit workspace filtering. | Reuse/evolve the single table; one optional tenant-scoped picker with explicit create and clear. |
| `src/components/auth/authHelpers.ts`, `src/contexts/AuthContext.tsx`, `src/services/employer/employerService.ts`, `migrations/employers.sql` | Auth hydration still fetches employer data (unused result in inspected caller). Companies backfill embeds employer login/job-limit flags in `custom_data`. | Decouple customer/staff records from auth; inventory and preserve legacy employer data privately before retiring unused executable consumers. Never export legacy flags as customer metadata. |

Existing tests include `pagesContract`, `schemaAgentTools`, `schemaPaths`, `schemaRouting`, `targetContracts`, and `coreMigrations`. Some older contract tests reproduce logic rather than exercising the implementation; new tests must import the real helpers and include database integration checks.

## 3. User journeys and information architecture

### 3.1 Developer/agent: frontend-first setup

1. Design Astro catalogue/detail components and define the entry schema locally. Choose any field names and supported structural composition; no reserved `hero`, `description_de`, `trainer-module`, `price`, or `staff` content key.
2. Authenticate the MCP connection via existing OAuth 2.1. Discover schemas and select the intended tenant explicitly; the browser's localStorage workspace selection is not an MCP tenant selector.
3. Upload the schema with `entity_kind: service-product`, `content_scope: page-collection`, and optional editor hints. Upload a separate `entity_kind: event` entry schema when a public event catalogue is wanted.
4. Obtain the returned schema ID, tenant-local slug, stable `api_slug`, revision, content contract, and manifest. Round-trip compare the uploaded JSON; do not infer successful import from a tool description.
5. Start registration and register the deployed frontend through existing tools with collection/detail targets. Product and event schemas register independently, even if both use the same Astro origin.
6. Create test drafts through aggregate MCP tools, then explicitly publish approved entries. Test public output with no bearer token; test preview with authenticated delivery.
7. Export updated contracts/content to the frontend repository when needed. Schema/content files are API/MCP JSON contracts, not Worker filesystem artifacts.

### 3.2 Tenant: create and maintain a service product

- **„Produkte“** opens a lightweight filtered Pages view showing product catalogues and entries. **„Seiten“** still shows all schemas. Both open the same editor and records.
- **„Neues Produkt“**: if one eligible tenant product schema exists, select it automatically. If several exist, show one schema picker. With none, show **„Noch kein Produktkatalog vorhanden“** and a permission-aware **„Katalog einrichten“** action; do not dump MCP instructions into the operator interface.
- Create a draft aggregate and open it on the canonical schema route. One page title, one name field, one save action; no nested modals or competing product/page save buttons.
- Three sections/tabs: **„Produkt“**, **„Seiteninhalt“**, **„Team“**. Team is collapsed/disabled by default. Product contains only operational service settings; page content uses the existing schema-driven block editor. Publication and preview controls sit in a common header/footer.
- Persist one aggregate per explicit save. Preserve unsaved changes when moving between tabs. Warn before navigation/workspace switching and before removing nonempty optional sections. Show inline validation, keyboard focus on errors, loading/retry states, and German operation-level errors.
- List defaults: name, catalogue, page publication state, last update, optional team count. Search and a small status filter; archive/delete in overflow actions. No mandatory gradient picker, salary columns, eligibility badges, or grid/list configuration wall.
- **„Speichern“** stores a draft or updates the current record; **„Veröffentlichen“** explicitly publishes. In MVP, editing an already published record changes live content after save; show **„Änderungen speichern“**, not a misleading draft label. A future draft/live revision system is separate scope.
- Technical routing, raw JSON, registration, and schema configuration live in the schema/developer workspace, not product editor help text.

### 3.3 Schema management and safe toggle semantics

The toggle changes schema metadata only, not its content JSON. Product/event schemas require `page-collection` and a tenant owner. Global default schemas remain reusable templates, not mutable tenant product catalogues.

- Empty tenant schema: toggling on/off is allowed after checking permission and scope.
- Existing ordinary pages: enabling product classification requires a conversion preview and transactional business-row backfill; no silent reclassification.
- Linked products/events: toggling off or changing tenant is blocked until an explicit migration detaches/converts all aggregates. No dangling product pages.
- Changing content definitions requires revision checks and an impact report; never silently rewrite all existing content.

### 3.4 Events

A product is a reusable service offering; an event is a concrete occurrence. The event editor remains responsible for an independent event title, date/time, timezone, optional customer organization, mode, capacity, and assignments. Products, public events and staff creation work without CRM records; no dummy company is required. It offers **„Öffentliche Veranstaltungsseite“** only when an event schema is selected. The public catalogue lists these published pages, not all internal appointments. Product detail may show upcoming public events through an explicit relation request.

Do not require staff on every public event page or every product. Event-page layout remains developer-defined. Existing scheduling workflows may retain a staff requirement until their operational rules are deliberately changed.

## 4. Data model and invariants

### 4.1 Schema metadata (new fields)

On `page_schemas`:

- `entity_kind text not null default 'page'`, checked against the three classifications.
- `definition_revision bigint not null default 1`, incremented on definition/editor-contract change.
- `editor_config jsonb` for labels, widget hints, ordering/grouping, and discriminated custom-block editor configuration. Separate from content shape; never executable code.

Preserve existing `schema`, `content_scope`, `page_target`, `integration_requirements`, `api_slug`, and `schema_frontend_targets`. Classification is not frontend placement. Retain unknown non-executable schema metadata even when a UI cannot interpret it.

### 4.2 Business product aggregate

Recommended physical name: `public.service_products` (not `products`, which remains an ambiguous historical page name).

- Preserve existing integer `id`, timestamps, tenant/owner attribution, and legacy product IDs used by events.
- Unique non-null `page_id → pages.id` for migrated/active aggregates, **ON DELETE RESTRICT**. Transitional unmigrated rows may remain nullable but cannot be publicly delivered or edited through the new aggregate path until repaired.
- `retired_at` for business retirement; `pages.status` remains the publication source. No independent `product.is_published` flag.
- Operational service settings only: delivery mode/duration defaults where genuinely needed, internal effort/compensation, optional eligibility configuration. Do not treat `salary` as a customer sale price.
- `team_enabled boolean default false`: presentation only. This does not mean „staff required to deliver this service“.
- Eligibility, if still needed, uses separate `product_eligible_staff` / `product_required_traits` relations and `min_staff` / `max_staff` operational settings. Keep them out of the initial simple UI and public output.

**Ownership:** Product owns the canonical page lifecycle. Product schema + page + product must share a tenant; only a product-role page can be linked; one page cannot back two products or both a product and event. Enforce with unique keys, same-tenant composite FK checks where practical, and constraint triggers for classification/aggregate completeness. Do not rely solely on application validation or RLS.

Creation inserts page and business row atomically. A product-role page cannot commit without its business row. Archive transitions publication and retirement atomically where requested. Generic page deletion of linked records is refused. Permanent aggregate deletion is allowed only when no operational/archive references remain, with a transaction deleting children/product/page in the safe order; otherwise offer archive. Schema deletion/tenant reassignment must not orphan aggregates.

### 4.3 Staff display and privacy

Use the existing `staff` registry, `staff_traits`, and `staff_trait_assignments`. Add:

- `staff_public_profiles`: tenant + `staff_id`, explicit publication/consent state, public display name, biography, avatar reference, job title, and a documented optional public JSON profile. Only explicitly curated fields are public; never copy private `staff.profile` wholesale.
- `product_staff_display`: tenant, product ID, staff ID, unique membership, `sort_order`, optional presentation role/short per-product introduction.
- `event_staff_display`: equivalent relation only when separately curated public event speakers/team are needed. Operational assignments do not automatically become public.

Off → on enables curation. Off preserves saved selections privately but public output becomes empty. The staff **record is managed by** the product/event tenant and has an opted-in public profile; the person does not need to belong to that organization or hold tenant membership. Inactive/archived or consent-revoked staff are excluded from public delivery immediately. A missing profile produces a clear validation/selection state, not an account-directory fallback.

`staff.id != account_user_id`: staff may have no login. Move optional identity linkage out of `staff` into `staff_account_links` as specified in §11; remove the globally unique account constraint only after migration. Map historical approved/assigned account UUIDs to registry IDs using both account link and tenant. Ambiguous or missing mappings require review. Login permissions and notifications use verified account links and independent access grants, never compare `auth.uid()` directly to `staff.id`, and never grant organization access merely because a staff profile was created. Accountless staff can be assigned, displayed and exported without account creation.

### 4.4 Event/page connection

Add a real `title` independent of company name. Canonical API uses nullable `customer_organization_id`; existing `company_id` can remain the physical FK during migration. Retire required free-text `company` as an identity/title field after preserving history. Validate a supplied customer ID in the exact event tenant, or reject it; omitted/null means no customer, not automatic creation. Details are in §12.

Keep event UUIDs and integer product references. Add unique nullable `page_id` to operational events, with same-tenant, event-schema classification checks and delete restriction. No page is required for private events. Move assignment identity toward an `event_staff_assignments` relation; preserve request/accept/decline history separately if that workflow is retained. Do not equate a public page's `published` state with `successComplete` or `locked` scheduling status.

Public event projection: curated title, starts/ends timestamps with timezone, public location/mode, and optional public product reference. Exclude company/client details, internal description, Teams links, eligibility, compensation, request arrays, and account IDs. Client appointments are private by default. Existing date/time strings need a confirmed tenant timezone before deriving an instant; never guess the timezone during backfill.

## 5. Developer freedom and lossless editing

### 5.1 Contract layers

Three separate contracts:

1. **Content definition:** developer-owned JSON shape in `schema` and arbitrary entry JSON in `content`.
2. **Editor hints:** labels, grouping/order, textarea/media widgets, optional block-discriminator hints; do not affect public data structure.
3. **Integration metadata:** entity classification, stable API identity, revision, targets, and available safe relation DTOs.

The existing schema format is a Specy field map, not full JSON Schema. Keep it compatible in MVP: strings, numbers, booleans, arrays, nested objects, enum, media, shared content/code blocks. Extend it deliberately for nullable values, numeric constraints, and custom discriminated object-array blocks. Do not advertise complete JSON Schema `$ref`, `oneOf`, or arbitrary validator support without implementing it. Unsupported authoring constructs must produce a diagnostic or a lossless raw-JSON editing fallback, not silently become strings. Supporting arbitrary frontend design does not require accepting executable schema code or inventing a second validation language.

### 5.2 Required editor changes

- Keep original schema JSON plus a derived editor model. Edit known attributes in place; preserve unknown attributes at every nesting level. No full reconstruction from a limited whitelist on unrelated edits.
- Keep original content plus explicit field changes/removals. Preserve unknown keys and custom block fields. Arrays retain order and arbitrary field names retain case, punctuation, and spaces.
- Optional activation is based on **key presence**, not truthiness. Preserve `false`, `0`, `null`, `""`, `[]`, and `{}` where allowed. Removing a field is an explicit operation distinct from hiding/collapsing it.
- Never coerce invalid objects/media to strings or default values during loading. Use safe display adapters that retain the raw value and mark a type conflict; require an explicit repair.
- Use JSON Pointer internally for paths, escaping `/` and `~`; reject prototype-mutating paths. No implicit dot-path interpretation of arbitrary keys.
- Share validators and block registry across import, visual editor, Worker mutations, and MCP. Built-in form/audio blocks must be accepted consistently. Custom discriminated blocks use developer-defined object properties and editor hints; no obligatory marketing sections.
- Validate recursively on save/publish. Enforce required presence, type/nullability, enums, numeric bounds and array/object rules; do not normalize or strip values to make validation pass. Unknown keys are preserved unless the declared contract explicitly forbids them.
- Limit JSON depth, payload size, array size, and processing cost. Validation performs no remote fetches and runs no submitted JS/HTML. Frontend rendering remains responsible for escaping and safe rich-text rendering.
- Schema changes use expected revision and report affected paths/records. Additive changes can be adopted without rewriting old entries. Breaking changes require explicit conversion and content diff; block publication when invalid, while allowing lossless inspection/repair of old data.
- `meta_description` and developer instructions stay API/spec-only. Human labels/help must be genuinely editorial, not implementation documentation.

### 5.3 Illustrative upload and delivery

The following is a **proposed contract example**, not an existing endpoint payload:

```json
{
  "tenant_id": "<tenant-uuid>",
  "name": "Servicekatalog",
  "entity_kind": "service-product",
  "content_scope": "page-collection",
  "schema": {
    "Intro Headline": { "type": "string", "required": true },
    "sections": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "variant": { "type": "string", "enum": ["intro", "benefits", "people"] },
          "copy": { "type": "string" },
          "layout-token": { "type": "string" }
        }
      }
    },
    "teamPresentation": {
      "type": "object",
      "properties": {
        "heading": { "type": "string" },
        "variant": { "type": "string" }
      }
    }
  }
}
```

Public delivery keeps today's page fields and adds an opt-in relation envelope, for example `?include=entity,team`. Only allow named supported includes, not arbitrary table joins. An illustrative entry:

```json
{
  "id": "<page-uuid>",
  "slug": "strategy-workshop",
  "name": "Strategieworkshop",
  "status": "published",
  "content": {
    "Intro Headline": "Raum für neue Perspektiven",
    "sections": [{ "variant": "benefits", "copy": "...", "layout-token": "asymmetric" }],
    "teamPresentation": { "heading": "Unser Team", "variant": "portraits" }
  },
  "relations": {
    "entity": { "kind": "service-product", "id": 42 },
    "team": [{ "id": "<staff-registry-uuid>", "display_name": "Ada", "job_title": "Beratung", "avatar": null }]
  }
}
```

`content` is exactly the stored developer payload (JSONB semantic equality, not byte-for-byte whitespace/key order). The relation envelope does not inject reserved keys into it. Astro can map those DTOs into any local component/data shape; Specy does not prescribe CSS, component names, DOM positions, or how many people to display. Team layout text remains arbitrary content, while memberships have one authoritative relation source. There is no parallel staff-ID array in content. Defer arbitrary server-side projection/mapping DSLs: ordinary frontend code already provides full design freedom.

Expose a JSON schema contract/export containing the untouched definition, hints, integration metadata and revision. `spec.txt` is explanatory, not a substitute for the machine-readable source. Export page content separately from business/private metadata. The public manifest advertises entity kind and supported includes but never secrets, registration codes, private joins, or ownership metadata.

## 6. API, MCP, authorization, and reliability

### 6.1 Proposed authenticated operations

Route names are proposed; reuse existing `/api/schemas/:apiSlug/...` namespaces and existing page tools where possible.

| Operation | Contract |
|---|---|
| Schema definition update: `PATCH /api/schemas/:apiSlug/definition` | Definition + hints + classification, expected revision; returns diff/impact and new revision. Separate from today's `system-data` patch. |
| Product aggregate create: `POST /api/products` | Tenant + schema ID/API slug + name + content + optional operational/team data; idempotency key; returns product/page IDs and canonical editor URL. |
| Product aggregate get/update: `GET/PATCH /api/products/:id` | Tenant-checked aggregate, expected version, explicit changes; atomic page/product/team save. |
| Product archive/delete | Archive first; delete only after known reference checks including archive history. Never infer columns or proceed after usage-query failure. |
| Event page attach/update | Explicit event ID + event schema + content; transaction checks tenant, ownership and public-event permission. |
| Publish/unpublish | Shared entity-aware service validates aggregate/content and updates page publication, then schedules invalidation after confirmed commit. |
| Staff directory and CRUD: `/api/staff` | Tenant-scoped registry for employees/freelancers/guests; no auth account needed; separate account-link management and explicit public-profile publication. |
| Customer CRM: `/api/customer-organizations` | Optional single-table customer CRUD/search/archive/export; separate authorization from public page access; explicit create, no name-based implicit upsert. |
| Integration handoff | Versioned authenticated DTOs, cursor lists/exports, explicit external references, idempotent upsert and optional scoped change delivery; see §13. |

Existing `create_schema` gains classification/hints/revision output. Add `specy_pages_schemas_update_definition` and narrowly scoped product/event aggregate tools, proposed `specy_products_create/get/update/archive/publish` and `specy_events_attach_page`. They call the same application services as REST, not duplicate Supabase mutations. Existing `specy_pages_schemas_create_page/update_page` resolve classification: create via aggregate or refuse with a concrete aggregate-tool instruction; content edits/publication delegate to entity-aware services. Ordinary pages remain compatible.

Update MCP authenticated-tool lists, well-known discovery, `start_here`, error attribution, input/output schemas, and agent documentation together. Use genuine MCP tool errors with logical status, not a success-shaped JSON error. Invalid payload → 400, inaccessible record → 404 without tenant leakage, version/link/usage conflict → 409. Never ask operators to copy OAuth tokens into chat.

### 6.2 Tenant and permission rules

Every relation and mutation requires explicit tenant context derived/verified against the authoritative schema/record, not a browser-provided tenant alone. An active workspace filters UX but is not authorization. A missing tenant must not mean "query every tenant" in new services.

Reuse current ownership/membership helpers, then verify a capability matrix against real RLS: permitted content editors can create/edit owned aggregates; publication requires the documented editor capability; tenant admins manage their tenant staff/public profiles; unrelated tenants and anonymous users cannot mutate. Global role checks in `usePermissions` are presentation hints only. Do not broaden global `admin`/`support`/`super-admin` access as an incidental refactor. Privileged Worker clients remain limited to the existing narrow public delivery and necessary registration boundaries; authenticated mutations use caller JWT/RLS.

Transactions must protect multi-table writes. Prefer user-scoped RPCs with security-invoker behavior; if a narrowly scoped definer function is necessary, verify caller/tenant/ownership explicitly, lock rows, set a safe search path, restrict grants, and test direct invocation. Composite tenant checks and constraint triggers must reject cross-tenant associations even for accidental privileged writes.

### 6.3 Publication and cache lifecycle

- Draft/archived pages are never served publicly; only registered schemas deliver published pages.
- Product retirement suppresses its public page. Unhook suppresses public delivery without deleting data. Consent revocation removes public staff independently of content publication.
- **MVP uses current live-edit semantics:** saved edits to a published page are live. Do not promise private work-in-progress drafts for published entries. If stakeholders require staged editing, introduce a complete published aggregate snapshot (content + safe relations + public event facts) before rollout; a content-only snapshot is insufficient. This is a separate approval gate, not a hidden half-implementation.
- Invalidate after published content changes, publish/unpublish/archive/delete, slug changes, team/public-profile changes, and safe event facts changing. Include collection paths plus old/new detail paths. Product/event cross-catalogue dependencies must be enumerated, not guessed from content keys.
- Reuse target/path/secret machinery. Store an idempotent pending delivery/invalidation record atomically with the successful mutation; execute existing revalidation with bounded retry after commit. Failure does not undo a database save or pretend the frontend updated.
- Staff-profile revocation also needs dependency invalidation. Cached static frontends cannot guarantee instantaneous removal: define and test maximum cache TTL/purge behavior; privacy-critical displays should fetch the revocable safe profile at request time.
- Astro static builds need an actual build/deploy integration to introduce new routes. Astro SSR can fetch at request time; hybrid/CDN setups need genuine purge/rebuild support. The current manifest's unconditional `supports_new_routes: true` must become a verified capability, not a promise. Health checks alone do not verify delivery freshness.
- Query keys include tenant, schema, entity/page IDs and revision. Invalidate product lists, event selectors, page lists and relation caches after mutations; no role-only/global staff name caches across workspace changes. Use optimistic concurrency to avoid agent/operator overwrite.

## 7. Concrete implementation file map

The following paths identify work, not changes performed by this planning task. Proposed new file names may be adjusted to repository conventions during implementation.

### 7.1 Edit/rebuild existing core files

| Files | Planned work |
|---|---|
| `src/App.tsx`, `src/components/layout/AppSidebar.tsx`, `src/pages/Verwaltung.tsx`, `src/utils/forms.ts` | Add Products filtered entry point and staff-neutral routes; retain safe legacy redirects; update navigation and reserved route names. No second content editor. |
| `src/pages/Pages.tsx`, `PagesSchemaDetail.tsx`, `SchemaEditor.tsx` | Classification badge/toggle, product/event list actions, revision/impact checks, nonblocking registration state, developer configuration separation, raw-schema preservation. |
| `src/pages/PageBuilder.tsx` | Schema-only aggregate loader; verify page/schema/tenant; delegate to shared shell and content fields; remove unsafe `PageBuilderData` casts. |
| `src/components/pagebuilder/SchemaPageBuilderForm.tsx`, `JsonImporter.tsx`, `StandaloneContentBlockEditor.tsx`, `AddContentBlock.tsx` | Extract reusable field editor/validation/state; lossless import/edit/save; consistent shared/custom block behavior; aggregate save adapter. |
| `src/types/pagebuilder.ts`, `src/types/event.ts` | Separate JSON/page schema and entity contracts from removed legacy marketing types; canonical staff IDs and role-aware metadata. |
| `src/services/pageService.ts`, `src/services/specService.ts` | Authenticated shared mutations, schema classification/revisions/export; remove legacy product wrappers; no default-null tenant reassignment on saves. |
| `src/services/staffRegistryService.ts`, `src/services/staff/staffService.ts`, `src/utils/staffUtils.ts` | Independent collaborator model, optional account-link relation, registry-authoritative directory, tenant-scoped selection/cache, curated public profiles; remove account fallback only after migration. |
| `src/services/company/companyService.ts`, `src/components/events/CompanyCombobox.tsx`, `EventFormSections/CompanySection.tsx`, `EventInfoCard.tsx` | Optional customer selection, single-table CRM CRUD, explicit tenant filters, no forced creation or duplicate name inputs; move to neutral customer DTOs/picker. |
| `src/components/auth/authHelpers.ts`, `src/contexts/AuthContext.tsx`, `src/types/auth.ts`, `src/services/accountService.ts` | Remove CRM/employer hydration dependency; account lookup only for explicit linking; no customer/staff-derived access claims. Preserve unrelated account behavior. |
| `src/contexts/DataContext.tsx`, `src/constants/queryKeys.ts`, `src/contexts/ActiveWorkspaceContext.tsx` | Tenant-scoped products/events/staff caches, refreshed aggregate data and safe workspace-switch handling. |
| `src/components/events/ProductCombobox.tsx`, `EventForm.tsx`, `EventFormSections/ProductSection.tsx`, `StaffSection.tsx`, `LockAndMentorCountSection.tsx`, `EventStaffAssignment.tsx` | Consume new product/staff services; hide irrelevant compensation/design details; explicit operational staffing defaults; event public-page action. |
| `src/pages/CreateEvent.tsx`, `EditEvent.tsx`, `EventDetail.tsx`, `Events.tsx`, `List.tsx`, `Calendar.tsx` | Tenant-aware writes and identity mapping; safe public-page association; staff-neutral event consumers. |
| `src/hooks/useEventActions.tsx`, `useEventDetail.ts`, `useEventFilters.ts`, `useUserEventStatus.ts`, `src/utils/eventUtils.ts`, `userEventStatusUtils.ts`, `src/hooks/usePermissions.tsx` | Registry/account separation, shared status semantics, neutral staff terminology; preserve genuine request history rather than blindly removing it. |
| `src/pages/VerwaltungAllMentors.tsx`, `VerwaltungAddMentor.tsx`, `VerwaltungMentorGroups.tsx`, `VerwaltungMentorGiveTraits.tsx`, `src/components/admin/ImprovedMentorList.tsx`, `MentorCard.tsx`, `MentorSearch.tsx`, `TraitAssignment.tsx` | Move/rename to staff-neutral UI and registry traits. Preserve permission-aware management and public-profile curation. |
| `api/routes/schemas.ts`, `mcp.ts`, `api/lib/schemaCreation.ts`, `schemaPages.ts`, `schemaRegistration.ts`, `frontendManifest.ts`, `specRegistry.ts`, `api/index.ts` | Shared contracts/validation, aggregate routing, safe public includes, revision/export/discovery, delivery capability accuracy. Preserve existing frontend targets and OAuth. |
| `api/middleware/agentLogger.ts`, `api/lib/mcpObservability.ts`, `src/lib/apiCatalog.ts` | Register/log new operation names; redact private staff/client fields, secrets and consent-sensitive data. |
| `src/config/schemaTemplates.ts`, `src/default-schemas/*` | Optional lossless neutral service/event starter templates, not prescribed runtime content. No shared default-schema mutation. |
| `scripts/lib/migration-order.mjs`, `scripts/lib/core-update.mjs`, `scripts/setup.mjs` | Register ordered new migrations and migration/state reconciliation where required; verify shared manifest consumption rather than adding divergent lists. |
| Existing tests and topical specs below | Keep old Pages contracts compatible; test real shared implementations and document new supported contracts. |

### 7.2 Proposed additions

- `src/types/products.ts`, `src/types/staff.ts`, `src/types/customers.ts`, `src/types/integrations.ts`: public/private/versioned DTOs; shared runtime schemas, not separate drifting copies.
- `src/pages/Staff.tsx`, `StaffEditor.tsx`, `Customers.tsx`, `CustomerEditor.tsx`, `src/components/customers/CustomerPicker.tsx`, `src/services/customerService.ts`, `src/hooks/useCustomers.ts`: staff-neutral directory/editor and minimal optional CRM; do not add account management to either default form.
- `api/routes/staff.ts`, `customers.ts`, `integrations.ts`, `api/lib/staffAccounts.ts`, `customerRecords.ts`, `integrationContracts.ts`, `integrationDelivery.ts`: authenticated shared services, curated exports and optional outbox delivery; no vendor-specific invoice logic.
- Ordered migrations for staff/account-link separation, CRM typing/versioning, event customer optionality/title/time fields, stable integration IDs/external mappings and integration outbox. The CRM entity itself remains one table; linking/outbox infrastructure is not a contact/deal CRM subsystem.
- `src/services/productService.ts`, `src/services/eventPageService.ts`, `src/hooks/useProducts.ts`, `src/hooks/useProductEditor.ts`: shared typed aggregate services/query hooks.
- `src/pages/Products.tsx`, `src/components/products/ProductEditorShell.tsx`, `ProductOperationalFields.tsx`, `ProductTeamSection.tsx`: minimal list and integrated shell. Reuse schema content editor, do not fork it.
- `src/components/staff/StaffPicker.tsx`, `PublicStaffProfileEditor.tsx`: one registry selector, consent-aware public presentation.
- `src/lib/schemaContent.ts` plus small shared pure schema helpers in an appropriate neutral directory: JSON-preserving editor model/path operations, not duplicate backend validators.
- `api/routes/products.ts`, `api/routes/eventPages.ts`, `api/lib/productAggregates.ts`, `publicEntityProjection.ts`, `schemaContentValidation.ts`, `contentInvalidation.ts`: thin route adapters and tested shared logic.
- Ordered, zero-padded, idempotent migrations for schema classification/revisions; product aggregate links/staff/public profiles; event page/assignment integration; backfill safety; invalidation records; final legacy contraction. Allocate actual migration filenames at implementation time and register them after all dependencies.
- `scripts/product-integration-audit.mjs` and `scripts/migrate-product-pages.mjs`: dry-run reports and resumable explicit transformations, not a second migration runner.
- `tests/productIntegration.test.mjs`, `schemaContentRoundTrip.test.mjs`, `publicEntityProjection.test.mjs`, `productMigration.test.mjs`: actual helper tests plus a local/staging SQL integration suite for transactions/RLS.
- Authoritative implementation docs under `specs/features/service-products.md` and `event-catalogue.md`, plus agent contracts under `specs/agents/product-catalogue-integration.md`, with corresponding index entries when implemented.

### 7.3 Remove or replace legacy executable code

**Remove after verified cutover:**

- `src/services/productPageService.ts`; `getProductPageData` / `saveProductPage` in `pageService.ts`.
- `src/components/pagebuilder/PageBuilderForm.tsx`, `HeroForm.tsx`, `CtaForm.tsx`, `CardsForm.tsx`, `FeaturesForm.tsx`, `FaqForm.tsx`; remove legacy `PageBuilderData`, Hero/CTA/card-specific types once all consumers are migrated. Shared `ContentBlock`, code/media types remain.
- `src/components/events/ProductManagementModal.tsx`, `ProductForm.tsx`, `src/hooks/useProductManagement.ts`: superseded by aggregate editor/query hooks, not retained as another workflow.
- `src/pages/VerwaltungAllProducts.tsx`, `VerwaltungCreateProduct.tsx`, `ProductDetail.tsx`: replace with canonical entry point/editor; route compatibility becomes redirects, not copies of these screens.
- `src/components/products/form/ProductFormMentorToggle.tsx`, `ProductFormMentorRequirements.tsx`, `ProductFormApprovedMentors.tsx`, `ProductFormDebugInfo.tsx`; replace operational/eligibility needs with staff-neutral fields. Remove obsolete form-only exports in `src/components/products/index.ts` and legacy definitions in `types.ts`.
- `ProductFormGradient.tsx`, `ProductColorGradientSelector.tsx`, `ProductFormDelivery.tsx`, `ProductFormBasicInfo.tsx`, `ProductFormCompensation.tsx`, `ProductFormHeader.tsx`, `ProductFormFooter.tsx`: retire old form implementations; relocate only genuinely necessary business behavior into new fields. Gradient/icon content remains schema-defined, not mandatory business UI.
- `src/hooks/useMentorGroupsAndMentors.ts` and product-specific `fetchMentors`; move consumers to tenant staff registry.
- `src/services/events/productService.ts`: keep a short compatibility facade during rollout, then remove after every import moves to `src/services/productService.ts`.

**Rename/rebuild with all consumers, not delete blindly:**

- `src/services/mentorGroupService.ts`, `src/hooks/useMentorTraits.ts`, `useMentorProfileLoader.ts`: staff registry/traits equivalents; preserve profile consumers in `src/pages/Profile.tsx` and `src/components/profile/SupabaseProfileData.tsx`.
- `src/services/events/mentorService.ts`, `src/hooks/useMentorRequests.ts`, `useManualMentorApproval.tsx`, `src/components/events/ManualMentorApproval.tsx`, `MentorRequestsModal.tsx`, `MentorSelector.tsx`, `MentorStatusTabs.tsx`: classify real request/acceptance behavior before rebuilding as staff operations. Some current permission helpers disable requests, but UI/data consumers still exist. Do not infer safe deletion from a disabled button.
- `src/components/events/ProductApprovedMentorSelector.tsx`, `EventFormSections/ProductApprovedMentorSelectSection.tsx`: replace retained eligibility UI with registry picker, or delete after confirming no callers. Public team selection does not use approval lists.
- `src/styles/traitsmentorassign.css`, staff administration routes/components with Mentor names, event/list request prop names: replace vocabulary in the same dependent slice.
- `src/services/company/companyService.ts`: remove `ensureCompanyRecord`; replace its two event callers before deletion. Remove implicit name matching/creation, not explicit customer creation.
- `src/services/employer/employerService.ts`, `authHelpers.fetchEmployerInfo`, unused employer hydration in `AuthContext.tsx`: retire after consumer audit. Historical `employers` data/migrations stay until an approved contraction preserves all genuine consumers; login must not depend on CRM availability.

**Remove only after import/reference scan confirms exclusive legacy use:** `ContentBlockEditor.tsx`, `IconPicker.tsx`, `CoachCombobox.tsx`, `src/components/mentors/*`, stale assets/styles. Do not remove the whole `pagebuilder` folder. `ImageUploader`, `MarkdownEditor`, `StandaloneContentBlockEditor`, `AgentLogs`, `SchemaWaitingScreen`, and shared blocks are used by Forms, Objects, Settings, profiles and other Pages flows.

**Database terminology contraction:** eventually retire `mentorbooking_products` in favor of `service_products`; migrate `product_page_id → page_id`, `is_mentor_product → separate staffing/presentation concepts`, `min/max_amount_mentors → min/max_staff`, and arrays/groups to checked relations. Later migrate operational `mentorbooking_events`, archive and notifications to neutral names (`service_events`, `service_events_archive`, `service_event_notifications`) and retained request columns to staff terminology. Keep old table/column adapters only for a defined compatibility window, with RLS-safe behavior. Public contracts expose no mentor vocabulary.

Never delete historical `migrations/products.sql`, `pages.sql`, `mentorbooking_*.sql`, `mentor_groups.sql`, or rewrite their references: fresh installs must still replay the chain before new migration(s) establish the canonical state. Historical change records and developer-defined content strings are not targets for blind search/replace. Remove current code/schema instructions that presume a mentor domain; preserve customer-authored historical content until explicitly transformed.

## 8. Migration and rollout plan

### Phase 0 — inventory, product decisions and safety gate

Produce a dry-run report covering products, linked/unlinked/schema-less pages, shared page IDs, tenant mismatches, default/global schemas, published states/slugs, active event product references, archive `pillar_id`, approved account IDs, traits, and staff mappings. Capture live policies, triggers, grants, FK delete actions and external consumers. Inventory plugin integration through documented hooks/APIs; plugin changes stay in their separate repositories.

Extend the inventory with global staff/account uniqueness, freelancer/guest records, nonmember account links, CRM duplicates and invalid address shapes, company-free events, legacy employer flags, and integration consumers. Confirm whether private drafts of published entries are required, whether event requests/eligibility remain supported, tenant timezones, public staff profile fields/consent, and which private data each integration may access. Take and validate a database snapshot. Do not migrate unidentified ownership or fabricate assignments.

**Exit:** reviewed report, explicit transformation mappings and unresolved-row quarantine list, tested restore, confirmed MVP publication semantics.

### Phase 1 — lossless Pages/editor contract

Extract shared parser/path/validation/editor primitives; preserve raw schema/content extensions; add schema classification and revision metadata; allow editing while registration is pending. Add schema update/export tool and impact handling. Maintain ordinary Pages behavior and target contracts.

**Exit:** round-trip fixtures pass via actual editor helpers, REST/MCP validators agree, cross-schema edit URLs are rejected, generic Pages regression tests pass.

### Phase 2 — expand schema and transactional aggregates

Add product links/public staff relations and aggregate services while old paths still work. Remove dangerous page→product cascade before enabling any new delete path. Preserve integer product IDs and UUID page IDs. Create constraints after cleaning duplicate/cross-tenant links. New product creation always uses aggregate service; prevent generic page tools from producing incomplete product-role pages.

Use an additive compatibility layer first if production cannot perform a synchronized table rename. Avoid two writable authoritative product tables: either evolve the existing table and later rename, or provide tested same-data adapters. Rename constraints/indexes/grants and confirm realtime/publication consumers when renaming tables.

**Exit:** transaction rollback/tenant/RLS/reference tests pass, retrying create cannot duplicate rows, generic page mutations respect aggregate invariants.

### Phase 2A — independent staff and optional CRM foundations

Introduce `staff_account_links`; preserve existing staff IDs and migrate verified links before removing the inline account FK/unique constraint. Support accountless collaborators with no account-directory fetch. Adopt registry IDs in all product/team/assignment writers before migrating history; remove implicit role fallbacks. Freeze legacy writers during identity cutover or provide a tested temporary adapter translating through the same verified mapping, never dual-write account and registry IDs into one array.

Evolve the existing `companies` single table and versioned customer DTO. Remove automatic customer creation and required-company validation; introduce independent event titles and nullable customer links. Backfill only exact tenant-verified company IDs; preserve free-text labels/history without guessing customer identity or merging by name/email. Stage typed address/contact/billing validation and retain legacy data privately until repaired. Remove unused auth/employer reads before CRM decommissioning.

**Exit:** freelancer/guest create → assign → display succeeds with no login/membership; unlink/delete account preserves collaborator/history; event/product save with no customer succeeds; invalid customer IDs reject rather than auto-create; both foundations pass actual RLS and migration tests. These are prerequisites for new product/event UX, not later cosmetic cleanup.

### Phase 3 — explicit legacy content conversion

For each verified tenant, clone/select a tenant-owned product schema. Do not infer ownership from the unqualified `service-product` slug. Reuse existing page ID/slug/content whenever compatible; create draft pages atomically for products without pages. Preserve existing publication only when conversion is valid and verified; never silently publish a previously private product.

Provide a neutral **legacy compatibility schema** matching existing hero/CTA/FAQ content where needed. This is migration support, not the mandated new developer shape. Conversion to an arbitrary newly uploaded schema requires a developer/operator-supplied mapping, before/after JSON diff, validation and approval. Unmapped data stays backed up and reported, not discarded.

Map legacy `'trainer-module'` separately from `is_mentor_product`: the former is page presentation intent; the latter gates eligibility/business settings. Neither auto-publishes approved people. Backfill public team membership only after staff identity and public-profile consent are confirmed. Compensation stays internal. Preserve eligibility/history independently.

A resumable migration ledger records old/new IDs, schema revisions, source checksum, transformation version and outcome without secrets. Repeat runs do not create duplicate pages/staff links or re-transform content. Exceptions remain visible to operators and inaccessible to public delivery until resolved.

**Exit:** per-tenant row/reference counts, content diffs, publication/slug checks, and exception reports approved; rerun is a no-op.

### Phase 4 — product UX and public frontend delivery

Enable the integrated editor and Products filtered entry point. Legacy `/pagebuilder/:productId` resolves business product → page → tenant/schema path and redirects with history replacement after authorization. Other old product/staff admin links redirect similarly. Missing/unmigrated rows show a safe repair state, never launch the legacy builder.

Extend safe public include DTOs/manifest, invalidation and Astro integration fixtures. Keep content output backward compatible for clients that omit includes. Verify new detail routes truly become renderable in the chosen Astro deployment mode.

**Exit:** operator and agent acceptance journey works end-to-end; unpublished/private data absent from anonymous delivery; stale routes and cache failures handled honestly.

### Phase 5 — event catalogue and staff-neutral operational bridge

Add optional event pages and safe occurrence projections; update product selectors and event-page editing. Move staff selection/assignments to registry identity, reconcile DB triggers and client status calculations, and preserve authenticated notification recipients via account links. Include calendar/list/past-event/archive consumers. Rename mentor-domain request behavior only where retained, removing dead controls after proof of no consumers.

**Exit:** private events never appear publicly; public event/product relation filtering works; no mixed account/registry IDs in new writes; scheduling/status/history regressions pass.

### Phase 5A — typed handoff and integration acceptance

Publish shared runtime-validated business contracts, OpenAPI/JSON Schema descriptions and optional generated client types. Provide authenticated customer/staff/product/occurrence CRUD and cursor export. Test an Astro consumer, a second CMS import and a vendor-neutral invoice draft adapter against canonical IDs, decimal money and nullable customer fields. Introduce signed outbox/webhooks only with explicit subscription permissions, restricted projections, retries and loop prevention; polling/export remains a complete supported path without webhooks.

**Exit:** no private business data exposed through public Pages; replay/import does not duplicate records; invoice draft is blocked with actionable missing billing fields rather than invented values; IDs and field names remain stable across clients.

### Phase 6 — contract and removal

After a declared compatibility release window, disable old writers, remove superseded components/services/types, finish neutral database names and remove unused legacy columns/adapters with additive contraction migrations. Keep route redirects as long as bookmarks need them; a redirect is not a legacy editor.

Run reference scans across `src/`, `api/`, scripts, migrations, auth hooks and documented plugin surfaces. Historical SQL/docs may retain old names; new executable feature code must not depend on them. Verify fresh installation as well as upgraded installation. Remove unused dependencies only after a repository-wide import scan.

**Exit:** single product writer/editor, canonical page routes only, no current mentor-specific product contract, validated rollback/backup retention policy and updated authoritative documentation.

### Rollback and deployment ordering

Deploy additive DB support before code requiring it; deploy cutover code only after backfill verification. Do not run contraction while old workers/frontends still write legacy shapes. Prefer disabling the new entry point and rolling application code back within the expanded compatible schema, rather than destructive SQL rollback after new writes. Before restoring a snapshot, account for post-snapshot writes and privacy revocations; restored staff consent must not accidentally republish revoked profiles.

All new migrations must be idempotent and registered in `MIGRATION_ORDER_CORE` after dependencies. Record successful migration/deploy state only after confirmation using existing deployment-state infrastructure; add taxonomy/test coverage if new component state keys are necessary. Do not invent unregistered state categories for a backfill script.

## 9. Verification and acceptance

### Automated coverage

- **Round-trip:** custom case/spaced/punctuation keys, nested arrays/objects, unknown metadata/content, false/zero/null/empty values, media objects, custom block fields, form/audio/code blocks; edit one field and prove all unrelated JSON is unchanged.
- **Validation:** required/type/enum/nullable/bounds, unsafe paths, size/depth limits, invalid schema constructors, additive vs breaking schema updates, stale revisions and stale aggregate versions.
- **Aggregate:** atomic creation/link/save/delete rollback; retry idempotency; uniqueness; role classification; page/schema/tenant mismatch; forbidden linked-page deletion; active and archive references prevent hard deletion.
- **Staff:** accountless staff, wrong-tenant IDs, empty-directory behavior, duplicate/reordered selection, toggle off/on, opt-in/revocation, inactive staff, no private profile/contact/notes/account data in public output.
- **Events:** no automatic public page creation; timezone handling; private client/meeting fields absent; product reference preserved; assignment identity and DB/client scheduling status parity; archive relations maintained.
- **REST/MCP parity:** ordinary vs product/event schema page creation, recursive validation, aggregate delegation, authentication/discovery/tool error status, classified schema export, no secrets in specs/manifest/logs.
- **Public delivery:** unregistered/draft/archived/retired records suppressed; include allowlist; collection/detail parity; unchanged arbitrary content; opt-in relation joins filtered to same tenant and public entities; query batching/pagination prevents unbounded joins.
- **Invalidation:** publish, published save, unpublish/archive/delete, slug old/new paths, team/staff revocation and event facts; retries after partial failure; actual new-route generation in Astro fixture.
- **Migration:** fresh install and upgrade, run new migrations twice, rerun backfill, invalid/ambiguous mapping quarantine, IDs/counts/history preserved, compatibility adapters/RLS and restoration rehearsal.

Use `.pi/skills/tests/SKILL.md` when implementing: `npm run typecheck`, `npm run typecheck:api` for API changes, `npm test`, then `npm run build`; migration-order tests must pass. Add database integration tests with real JWT personas and direct SQL/RPC attempts; source-string tests alone cannot prove RLS/transaction behavior. Run frontend/API dev smoke tests and inspect browser errors. Plugin failures must be isolated/reported, not "fixed" by modifying their separate repositories from core.

### Manual UX/DX matrix

Test tenant editor, tenant admin, regular member without write rights, unrelated tenant, relevant existing privileged roles, anonymous frontend and authenticated MCP agent. Include direct deep links, workspace switch with dirty form, pending registration, no schemas, multiple schemas, no staff, accountless staff, public-profile revocation and API failure.

A complete MVP is accepted only when:

1. Astro agent uploads a service-product entry schema and separate event schema through MCP, reads back an unchanged definition and receives stable API identifiers.
2. Tenant creates a product with one simple schema choice, edits operational settings and arbitrary blocks in one shell, and reaches the same editor from Products and Pages.
3. Team can be enabled, curated, ordered and disabled using registry profiles without any mentor/login-role dependency or data leakage.
4. Product/event catalogue and optional detail frontend render through schema-scoped published delivery with arbitrary developer design and true deployment-mode refresh behavior.
5. Private appointments and internal compensation/client details remain private; public events are explicitly selected and published.
6. Existing records/URLs/history survive conversion; deleting or unpublishing a page cannot cascade-delete operational products/events.
7. No-op visual edits preserve developer JSON, including unknown values and deliberately empty optional fields.
8. Legacy editor/forms are removed after cutover; redirects do not invoke old implementations.
9. Freelancer/guest can be created, assigned and presented without an auth account, tenant membership, employer or customer record; account linking/unlinking never changes access implicitly or destroys business history.
10. Customer organizations are optional, explicitly managed in one basic CRM table. Company-free events work; login/auth hydration never depends on staff or CRM. Names are not identity keys.
11. Authenticated handoff to another CMS or invoice adapter uses versioned DTOs with stable opaque IDs, typed addresses/time/money, explicit privacy permissions and replay-safe external mappings. Public page payloads remain arbitrary and free of private CRM/staff fields.

## 10. Documentation and implementation impact

When shipping, register new feature/agent docs in their topical indexes and update `specs/architecture/page-builder.md` (remove obsolete duplicate legacy architecture), `system-overview.md`, `specs/platform/multi-tenancy.md`, `specs/agents/frontend-integration-manifest.md`, `mcp-exposition.md`, `frontend-prompt-specs.md`, and the relevant authentication/authorization documentation. Update `specs/agents/plugin-hooks.md` if any new hook target is introduced. MVP needs no new product-specific plugin hook: retain documented page/event entity actions/after-create semantics, dispatch once after confirmed creation, and document any additional product entity context before exposing it.

**Database impact when implemented:** additive classification/revision/relationship/public-profile/invalidation support, separate staff/account links, single-table CRM refinement, optional customer/event links, typed time/business values and integration identities/outbox; backfill and constrained lifecycle links, then explicit neutral-name/legacy contraction; no unchecked destructive rename/drop.

**Runtime impact when implemented:** one aggregate writer/editor, shared validators, lossless content state, tenant query boundaries, safe public joins and reliable invalidation; no hardcoded frontend templates.

**API impact when implemented:** additive schema-definition/aggregate MCP and REST contracts; backward-compatible published page payload without includes; classified schema page tools enforce aggregate completeness; deprecation window for legacy direct writers.

**This planning change:** documentation only. No application code, generated registries, SQL, production data, or deployed API behavior changes. Record implementation work in separate date-prefixed change records, not by claiming this plan is shipped.

## 11. Staff rebuild: collaborators, accounts and membership are independent

### 11.1 Identity and ownership contract

A staff record is a tenant-managed business profile of a person who delivers, supports or appears on a service. In the operator UI use **„Team“**, **„Person hinzufügen“**, and optional **„Zusammenarbeit“** values **„Intern“**, **„Freelance“**, **„Gast“**, **„Sonstige“**. Never infer citizenship, employment law status, authorization or tenant membership from those labels.

| Concept | Source of truth | Meaning |
|---|---|---|
| Collaborator | `staff.id`, tenant-owned | Person used in service/team/assignment records; can be completely accountless. |
| Auth account | Supabase user ID + user profile | Login identity, not a staff business record. |
| Tenant member | `tenant_users` | Permission-bearing organization membership; never auto-created from staff/customer records. |
| Optional identity link | `staff_account_links` | Verified association between an existing collaborator and account; grants no access itself. |
| Public profile | `staff_public_profiles` | Explicitly curated/consented public presentation, separate from private collaborator data. |
| Customer organization | `companies.id` | Recipient/client organization; no implication of staff employer or supplier tenant. |

`tenant_id` says **who manages this record**, not which company employs the person. The same freelancer can have separate records in multiple supplier tenants, even if they later link the same account. These records have distinct IDs, private notes, consent and public content; no cross-tenant global person directory or silent synchronization. An empty tenant directory stays empty.

### 11.2 Proposed private staff fields and link constraints

Retain registry UUIDs. Private canonical record: `id`, `tenant_id`, `display_name`, optional `given_name`, `family_name`, contact email/phone, job title, avatar media reference, `collaboration_kind` (`internal | freelancer | guest | other`, nullable if unknown), `status` (`active | inactive | archived`), private notes, `metadata`, `external_refs`, timestamps and optimistic-concurrency `version`. Only name and tenant are required. No customer/company FK, account or email is required.

Use `staff_account_links(tenant_id, staff_id, account_user_id, linked_at, linked_by, verified_at)` with same-tenant staff FK and uniqueness on `(tenant_id, staff_id)` and `(tenant_id, account_user_id)` for the MVP. This permits one account linked to one staff record **per tenant**, not global uniqueness. Require authorized explicit linking plus proof/consent of target account association; do not discover/link by email alone. Account lookup must not reveal unrelated tenants' account lists. A nonmember collaborator may remain accountless; optionally linking their existing external account still does not grant tenant access. If approved external-account linking is unavailable through current APIs, disable that optional action rather than broadening account search.

Account deletion removes the optional link, never the staff record/public page/assignment history. Unlink is an atomic association operation, not deleting/recreating staff. Staff archival prevents new assignments and public delivery while preserving history; permanent deletion is restricted by operational references. Contact details are not automatically overwritten by an account's current email/name. Delete/disable account must not undo published-profile consent state, and privacy revocation remains an independent operation.

### 11.3 Access, notifications and UX

Creating/assigning staff does not create an account, send an invitation, attach roles, or grant access. Default form is name plus optional collaboration/contact details. **„Zugang verknüpfen“** is an advanced, separate permission-controlled action; **„Zur Organisation einladen“** belongs to membership administration and requires its own explicit confirmation. Staff edits must work when account lookup fails or is unauthorized.

All product/event/trait relations use registry UUIDs. For “my assignments”, resolve a verified account link within the tenant and then check an explicit event/self-service access permission; the link alone is insufficient. Existing login-based notifications resolve a permitted linked account. Accountless notification is an explicit consent-aware email operation with approved recipient projection, not a synthetic auth user. Missing delivery access yields a delivery status, not a failed assignment or fabricated account. Public profiles never expose account IDs, private email, notes, traits, compensation or external references.

## 12. Companies rebuild: optional, one-table customer CRM

### 12.1 Scope and UX

Evolve `public.companies` as the **single authoritative CRM entity table**; expose it as `customer-organizations` in the neutral API and **„Kunden“** in the dashboard. Preserve current UUIDs/FKs. No CRM contacts table, deals, pipelines, customer login, employer management, tax engine or automated invoice generation. One optional primary contact and billing address live on the organization row. Shared integration/outbox infrastructure is not another CRM domain table.

CRM is an optional workflow, not a prerequisite for Products, Staff, Pages, events or authentication. No organization affiliation is required for collaborators. Event default is **„Kein Kunde zugeordnet“**, with one picker **„Kunde zuordnen“** and explicit **„Neuer Kunde“** action. Creating a customer needs a name only; editing billing/contact details is collapsed. Clearing selection writes `null`; it does not delete a customer. Customer creation during event work must be explicitly requested and transactionally linked when combined, never triggered by saving free text.

Basic customer list: name, optional contact, status; search, create/edit/archive. Do not auto-merge matching names or emails: two legal organizations can share a trade name/contact, and names can change. Supplier organization/tenant branding is separate from customer identity. A public event can have no customer; a customer association never becomes a public sponsor/testimonial automatically.

### 12.2 Single-table fields and sensible types

| Canonical field | Storage / API type | Rule |
|---|---|---|
| `id`, `tenant_id` | UUID / opaque string | Stable record and manager tenant identities, not auth IDs. |
| `name`, `legal_name` | Text / string and nullable string | Name required; legal name optional until an external billing workflow requires it. |
| `status` | Checked text / `prospect | active | inactive | archived` | Reuse existing values; independent of membership/publication. |
| `website_url` | Text / nullable HTTP(S) URL | Validate, never automatically fetch arbitrary customer URLs. |
| `primary_contact` | Existing scalar columns / nullable typed object | Name/email/phone optional; stored on this row, no account association. |
| `billing_email` | Text / nullable email | Distinct from primary contact; no automatic disclosure/notification. |
| `billing_address` | JSONB / nullable typed postal address | Lines array, locality, region, postal code as strings, ISO 3166-1 alpha-2 country code. No numeric postal codes or locale-dependent concatenation. |
| `vat_id`, `registration_number`, `customer_number` | Text / nullable string | Optional; identifiers are not numbers. Tenant-local customer number can be unique when supplied. Do not treat VAT ID as a cross-tenant identity key. |
| `notes` | Text / nullable string | Private; never public delivery or default external export. |
| `metadata`, `external_refs` | Validated JSONB / namespaced objects | Extension escape hatch; no credentials or automatic public copying. |
| `created_at`, `updated_at`, `version` | `timestamptz`, integer / RFC3339 UTC, integer | Explicit optimistic concurrency; UTC timestamps, not German display strings. |

Keep or deprecate existing industry/size/logo fields based on consumers, not as mandatory UI. Map `address` and `custom_data` to canonical DTOs explicitly; invalid legacy shapes remain private repair data, not silently coerced. Preserve old employer-job-limit/auth flags in migration backup/private legacy metadata; they are not customer fields and are never exported by default.

Name-based search is advisory; exact ID or a tenant-scoped trusted external reference determines identity. Unknown/inaccessible supplied ID rejects (404), wrong version conflicts (409), invalid payload rejects (400). Do not recover by making another company. Archive is preferred; referenced customer deletion is restricted, or an explicit authorized unlink preserves historical customer-name/billing snapshots. No deletion cascades into service/event/account records. Snapshotting finalized invoices belongs to the invoice service, not a live CRM FK; don't promise invoices update when a customer is renamed.

## 13. DX and external-service handoff

### 13.1 Separate canonical business DTOs from arbitrary public content

Use one shared runtime schema source for REST, MCP, export, documentation and TypeScript types. Publish versioned OpenAPI/JSON Schema contracts and examples; generated TS types alone do not validate input. DTO conventions: snake_case machine keys; omission means unchanged in PATCH, explicit `null` clears nullable values; collection emptiness is `[]`; unknown is not `0`/false/empty-string. `metadata` is the designated namespaced extension container, never a substitute for typed standard fields.

| Value | Canonical contract |
|---|---|
| Identity | Opaque string IDs, no slug/email/name identity matching. Add product `integration_id` UUID while preserving integer DB IDs/event FKs; new versioned business API uses UUID, legacy adapters use integer explicitly. Public Pages v1 example `relations.entity.id: 42` remains legacy; advertise versioned UUID contracts separately rather than silently changing its type. |
| Time | `starts_at` / `ends_at` RFC3339 instants plus IANA `timezone` for scheduled events; integer duration minutes. DB `timestamptz` stores instant, separate zone field stores intent. Never infer UTC from historical local time. All-day dates, if supported, are separate date-only fields. |
| Money | `{ "amount": "1250.00", "currency": "EUR" }`; amount is decimal string, currency ISO 4217; bounded PostgreSQL `numeric`, decimal-aware arithmetic. No floats, German formatting, implicit EUR, or default zero. Currency rounding belongs to an explicit validator/consumer rule. |
| Customer pricing | Optional discriminated `pricing: null | { kind: "on_request" } | { kind: "fixed", money: Money } | { kind: "per_unit", money: Money, unit: "hour" }`. Machine units use documented tokens. Scope is a quote/handoff hint, not tax/invoice computation. Internal staff compensation is a separate private typed contract, never migrated into sale price. |
| Postal/contact data | Typed address as §12; phone as nullable international string when verified, not numeric; email validation does not imply identity ownership. Country/language/currency use standardized codes. |
| Media | Stable managed asset reference plus resolvable URL/expiry metadata; don't persist temporary signed URLs as canonical avatar identity. Private/public media access follows the projection. |
| Relationships | Explicit nullable customer reference, product UUID reference, registry staff references; expansions named and allowlisted. No implicit graph traversal or auth-identifier joins. |
| Concurrency | Version integer and `ETag`/expected-version semantics; schema revision distinct from business version. Changes to team relations also increment aggregate version. |

Illustrative **authorized private handoff**, not public Pages output:

```json
{
  "contract_version": "1",
  "id": "a51ea5d7-cff2-434c-9bbc-940ec8a42940",
  "entity_type": "service_occurrence",
  "version": 7,
  "title": "Strategieworkshop",
  "product_id": "7c6cef9a-dc3f-43aa-946c-8669ed099de1",
  "customer_organization_id": null,
  "starts_at": "2026-11-05T08:00:00Z",
  "ends_at": "2026-11-05T10:00:00Z",
  "timezone": "Europe/Berlin",
  "staff_ids": ["f7aadcb5-707b-42fe-bbf6-ee168131a9d3"],
  "pricing": { "kind": "on_request" },
  "metadata": { "example.scheduler": { "reference": "consultation-118" } }
}
```

The frontend may adapt these business DTOs into any component shape; developer-defined `pages.content` is still arbitrary/lossless. Structured operational fields are not inferred from page text. When a developer wants a public structured price/date/profile, request the curated projection explicitly; no private-business wildcard expansion. Public prices must be explicitly approved for display. Customer data remains private in all default page includes. Invoice generators use the authenticated customer/occurrence handoff, not scrape page content.

### 13.2 Identity, ownership and sync boundaries

`external_refs` maps an integration namespace to provider ID and optional source revision, e.g. `{ "invoice.example": { "id": "customer-203" } }`. No vendor-specific DB columns or hidden credential storage. Provider mapping is tenant-scoped and write-restricted to the approved connection/operator. Enforce uniqueness on `(tenant, integration, external ID)` using indexes/transactional locking as appropriate; identical provider IDs in different tenants are unrelated. Names/email never drive automatic upsert. Deduping/merging is explicit and preserves references/history.

Declare source-of-truth per integration/field family: Specy content, external invoicing billing data, or explicit one-way export. Conflicting versions fail with a reviewable diff; no last-writer-wins silent overwrite. Carry origin/source revision and correlation/idempotency keys to prevent echo loops. External changes never implicitly publish pages, opt staff into public display, create memberships or grant roles. Business facts and presentation can have different source owners without duplicating identity.

Minimum complete integration path: authenticated CRUD + paginated cursor lists + scoped JSON export/import. Include stable IDs, versions and timestamps; define repeatable export watermark semantics and cursor ordering `(updated_at, id)` with overlap/deduplication for incremental polling. Archived/deleted records need tombstones/change-feed coverage, not only lists of live rows. Bulk import supports validation/dry run, per-row outcomes and resumable batches; retries with the same idempotency key/payload return the same result, changed payload conflicts.

### 13.3 Permission and transport boundaries

Separate projections/capabilities: public content, private operational scheduling, staff contacts, customer billing, internal notes/compensation and account-link administration. A content-reading OAuth integration is not automatically a CRM-exporting integration. Define explicit tenant-scoped consent/grants checked alongside caller JWT/RLS; this finer-grained integration permission layer is proposed, not claimed to exist in today's OAuth implementation. Human MCP tools use the caller's permissions and require explicit requests for private exports. No browser/service-role secrets or long-lived credentials in frontend schema files.

Default exports are allowlisted; notes, personal contacts, internal compensation, account IDs, auth claims and external refs require the particular approved private projection. Account IDs are never business/public staff identifiers. Logging stores operation/result/version and redacts CRM/staff/invoice payloads by default. Define tenant retention/erase requirements and permission-revocation behavior for queued exports.

Optional webhooks use a tenant-scoped outbox written after/with confirmed mutation, stable event ID, entity UUID/version, change type, occurrence timestamp and origin. Send reference-only notifications by default; receiver fetches authorized projection. Signed bounded payloads, key rotation, timestamp/replay verification, SSRF-safe destination validation, bounded retries/dead-letter state and tenant-visible delivery status are required. Delivery is at-least-once: consumers dedupe and ignore stale versions; no exactly-once claim. Recheck grant before delivery. Consent/privacy revocation events remain deliverable as minimal tombstones, but must not contain revoked profile data. Reuse compatible queue/invalidation infrastructure; don't publish arbitrary private aggregate payloads on existing public revalidation calls.

Vendor adapters belong in external services or separate plugins through documented APIs/hooks. Core does not implement an invoice vendor's tax rules, credential UI, or private plugin logic. A failed external invoice/export must not roll back a successfully saved product/event or show a false success status.

### 13.4 Consumer acceptance

- Astro renders arbitrary content plus curated staff/price/event DTOs without login/account concepts.
- Another CMS imports stable product/staff identities and extension metadata without losing arbitrary schema/content data; replay updates the same entity.
- Invoice adapter fetches authorized customer billing + occurrence/product facts. Missing customer/legal/address/currency/pricing yields a concrete incomplete-draft diagnostic. It never invents a customer, derives price from salary or issues an invoice merely because an event was published.
- A scheduling tool can assign an accountless guest using staff UUID without importing auth directory data.

## 14. Risk closure and additional mandatory gates

| Risk | Planned control | Release proof |
|---|---|---|
| Page deletion destroys products/history | Restrict FK before new delete UI; transactional aggregate deletion and archive-reference checks. | Direct SQL/RPC/page API delete cannot destroy linked business rows; forced transaction failure rolls back. |
| Staff means account/employee/member | Independent registry, separate verified tenant-local links, optional collaboration label, independent access grants. | Freelancer/guest create/assign/publish/export with no account/customer/membership; same account can link distinct tenant records. |
| Account unlink/delete loses collaborators | Link lifecycle separate from business records and history. | Account deletion preserves staff IDs/assignments; no implicit privileges upon linking; unauthorized lookup/link rejects. |
| Mandatory/auto-created CRM customers | Nullable customer FK, independent event title, explicit tenant-scoped create/select, no `ensureCompanyRecord`. | Company-free event/product saves; invalid supplied ID fails; repeated names don't merge/create implicitly. |
| CRM or auth employer data leaks | Private customer DTOs, no customer public include, allowlisted handoff, legacy flags quarantined. | Anonymous and content-only OAuth/MCP cannot retrieve billing/contact data; auth works while CRM is unavailable. |
| Developer JSON erased | Lossless raw-state editing, presence semantics, recursive shared validation. | Actual editor round-trip fixtures preserve unknown keys and all empty/false/zero values. |
| Integration amount/time/ID ambiguity | UUID handoff IDs, decimal money, currency codes, timezone/instant separation, typed addresses. | Runtime schemas reject localized numbers, missing currencies, invalid timezones/IDs; DST/zero-price/nullable-field tests. |
| Duplicate or cyclic cross-system writes | External-ID uniqueness, source ownership, versions, origin and idempotency. | Retry/import replay and webhook reorder/echo tests produce no duplicates or silent conflict overwrite. |
| Stale public profiles/privacy revoke | Live safe-profile checks, dependency invalidation, documented cache limits and purge behavior. | Revocation with failed frontend purge is visible/retriable; old profile data never re-exported by queued delivery. |
| Tenant leakage via fallback/cache/link | Explicit tenant filters and composite relations, no global role directory fallback, tenant-keyed caches. | Unrelated tenant, empty directory, same account in two tenants and direct RPC negative tests. |

Add real-source unit/integration coverage in proposed `tests/staffIdentity.test.mjs`, `customerRecords.test.mjs`, `businessHandoffContracts.test.mjs`, `integrationSync.test.mjs`, plus local/staging SQL/RLS suites. Test optional customer clear, no-company archive/history, account deletion/unlink, same-name organizations, address migration, nonmember/guest identity, exact provider namespace matching, webhook revocation/dead-letter behavior and permissions by projection.

Additional concrete implementation paths: `src/types/event.ts`, `src/components/events/EventDetailHeader.tsx`, `EventsGridView.tsx`, `src/components/lists/ListTable.tsx`, `src/pages/Calendar.tsx`, and product-usage dialogs must stop using company as mandatory event label; `migrations/staff_registry.sql`, `companies.sql`, `employers.sql` and event/archive definitions are audit inputs **not shipped files to rewrite**. New migrations change inline links, CRM/event constraints, identity/time fields and privacy-safe data backfills. New feature docs should cover staff independence and optional customer CRM under `specs/features/`, with an integration handoff contract under `specs/agents/`, all indexed when implemented.

**Planning-only verification:** no live DB assertions, code edits or builds are implied by these controls. Implementation cannot be accepted until the listed negative/security, migration, UX and consumer tests pass.
