import { getPluginApiRoutes } from '@/plugins/loader';

export type ApiParameterLocation = 'path' | 'query' | 'header' | 'body';

export type ApiEndpointMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiParameterDefinition {
  name: string;
  in: ApiParameterLocation;
  required: boolean;
  type: string;
  description: string;
}

export interface ApiResponseDefinition {
  status: number;
  description: string;
  example?: string;
}

export interface ApiEndpointDefinition {
  id: string;
  tag: string;
  method: ApiEndpointMethod;
  path: string;
  summary: string;
  description: string;
  auth: 'public' | 'bearer-optional' | 'bearer-required' | 'worker-secret';
  mountsAt: string;
  sourceFile: string;
  logging: 'agentLogger' | 'internal' | 'none';
  parameters?: ApiParameterDefinition[];
  requestExample?: string;
  responseExamples: ApiResponseDefinition[];
  sideEffects?: string[];
  tables?: string[];
  notes?: string[];
}

export function buildLoggingEndpointKey(endpoint: Pick<ApiEndpointDefinition, 'method' | 'path'>): string {
  return `${endpoint.method} ${endpoint.path}`;
}

export const CORE_API_CATALOG: ApiEndpointDefinition[] = [
  {
    id: 'root-discovery',
    tag: 'Platform',
    method: 'GET',
    path: '/',
    summary: 'Worker root discovery document',
    description: 'Returns the top-level discovery payload for the deployed worker, including canonical links to schema discovery, plugin discovery, and MCP transport.',
    auth: 'public',
    mountsAt: 'root',
    sourceFile: 'api/index.ts',
    logging: 'none',
    responseExamples: [
      {
        status: 200,
        description: 'Discovery payload with API entrypoints.',
        example: `{
  "service": "specy-api",
  "status": "ok",
  "timestamp": "2026-04-06T12:00:00.000Z",
  "endpoints": {
    "schemas": "https://cms.example.com/api/schemas",
    "specs": "https://cms.example.com/api/specs",
    "objects": "https://cms.example.com/api/objects",
    "plugins": "https://cms.example.com/api/plugins",
    "mcp": "https://cms.example.com/mcp"
  }
}`,
      },
    ],
    notes: [
      'Useful as a service liveness check and manual discovery step for agents.',
      'Not wrapped by agent logging middleware because it sits outside /api and /mcp.',
    ],
  },
  {
    id: 'schemas-list',
    tag: 'Schemas',
    method: 'GET',
    path: '/api/schemas',
    summary: 'List all registered page schemas',
    description: 'Primary discovery endpoint for external frontends and agents. Returns a stable API slug for URLs and a tenant-local schema_slug for workspace identity, plus spec and register URLs.',
    auth: 'public',
    mountsAt: '/api/schemas',
    sourceFile: 'api/routes/schemas.ts',
    logging: 'agentLogger',
    responseExamples: [
      {
        status: 200,
        description: 'Schema discovery list.',
        example: `{
  "service": "specy-api",
  "description": "Available page schemas.",
  "schemas": [
    {
      "slug": "blog",
      "schema_slug": "blog",
      "api_slug": "blog",
      "name": "Blog",
      "spec_url": "https://cms.example.com/api/schemas/blog/spec.txt",
      "register_url": "https://cms.example.com/api/schemas/blog/register"
    }
  ]
}`,
      },
    ],
    tables: ['page_schemas'],
    notes: ['Public read surface for page schema discovery.', 'Ordered by default schemas first, then by name.'],
  },
  {
    id: 'products-list',
    tag: 'Products',
    method: 'GET',
    path: '/api/products',
    summary: 'List service products for one workspace',
    description: 'Authenticated, tenant-scoped service-product aggregate list. Requires tenant_id and returns UUID identities plus canonical page summaries.',
    auth: 'bearer-required',
    mountsAt: '/api/products',
    sourceFile: 'api/routes/products.ts',
    logging: 'agentLogger',
    responseExamples: [{ status: 200, description: 'Products scoped to the requested workspace.', example: '{ "products": [], "total": 0 }' }],
    parameters: [{ name: 'tenant_id', in: 'query', required: true, type: 'string', description: 'Explicit workspace UUID.' }],
    tables: ['service_products', 'pages'],
  },
  {
    id: 'products-public-details',
    tag: 'Products',
    method: 'GET',
    path: '/api/products/:workspaceSlug/:productSlug',
    summary: 'Fetch a product and its published events',
    description: 'Friendly public URL for a generated Product Object. Resolves a workspace slug and published Product page slug, then returns the same Object envelope as /api/objects/{objectSlug}. This alias depends on a published Product Page; the canonical Object endpoint follows Object API access settings independently of Page revalidation/publication.',
    auth: 'public',
    mountsAt: '/api/products',
    sourceFile: 'api/routes/products.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'workspaceSlug', in: 'path', required: true, type: 'string', description: 'Workspace slug from public.tenants.slug.' },
      { name: 'productSlug', in: 'path', required: true, type: 'string', description: 'Slug of the published product page in a registered service-product schema.' },
    ],
    responseExamples: [{ status: 200, description: 'Canonical generated Product Object envelope.', example: '{ "id": "<object-uuid>", "slug": "product-<product-uuid>", "schema": { "product": {}, "events": {} }, "data": { "product": { "id": "<product-uuid>", "page_id": "<page-uuid>", "slug": "workshop", "custom_fields": {} }, "events": [{ "id": "<event-uuid>", "page_id": "<page-uuid>", "slug": "workshop-2026-11-22-18-00", "date": "2026-11-22", "time": "18:00", "timezone": "Europe/Berlin", "registration_status": "open", "participant_min": 3, "participant_max": 10, "custom_fields": {} }] } }' }],
    tables: ['tenants', 'mentorbooking_products', 'mentorbooking_events', 'objects', 'pages', 'page_schemas'],
    notes: ['Only custom fields marked public in the owning Product definition are projected.', 'Pages API is the editorial/revalidation contract; Objects API is the dynamic operational stream.', 'Customer/company data, internal scheduler status, staff IDs, meeting links, compensation, and private custom fields are excluded.'],
  },
  {
    id: 'products-create',
    tag: 'Products',
    method: 'POST',
    path: '/api/products',
    summary: 'Create a service-product aggregate',
    description: 'Creates one draft product and canonical schema page atomically. Requires a tenant-owned product schema, expected definition revision, and idempotency key.',
    auth: 'bearer-required',
    mountsAt: '/api/products',
    sourceFile: 'api/routes/products.ts',
    logging: 'agentLogger',
    responseExamples: [{ status: 201, description: 'Created draft aggregate and canonical editor URL.', example: '{ "product": { "id": "<uuid>", "page_id": "<uuid>" }, "editor_url": "..." }' }],
    tables: ['mentorbooking_products', 'pages', 'page_schemas'],
  },
  {
    id: 'products-update',
    tag: 'Products',
    method: 'PATCH',
    path: '/api/products/:id',
    summary: 'Update a service-product aggregate',
    description: 'Atomically updates product/page fields with expected product and schema revisions and recursive schema-content validation. Optional custom_fields updates workspace-defined product JSON separately from page content.',
    auth: 'bearer-required',
    mountsAt: '/api/products',
    sourceFile: 'api/routes/products.ts',
    logging: 'agentLogger',
    responseExamples: [{ status: 200, description: 'Updated product aggregate with incremented version.', example: '{ "product": { "id": "<uuid>", "version": 2 } }' }],
    tables: ['mentorbooking_products', 'pages', 'page_schemas'],
  },
  {
    id: 'products-change-schema',
    tag: 'Products',
    method: 'PATCH',
    path: '/api/products/:id/schema',
    summary: 'Change the schema used by a service product',
    description: 'Moves the canonical Product Page to another eligible Product schema in the same workspace, preserving its content and page identity. Requires expected product version and target schema revision. Published pages are returned to draft for review against the new schema.',
    auth: 'bearer-required',
    mountsAt: '/api/products',
    sourceFile: 'api/routes/products.ts',
    logging: 'agentLogger',
    requestExample: '{ "tenant_id": "<tenant-uuid>", "expected_version": 4, "schema_id": "<schema-uuid>", "expected_definition_revision": 2 }',
    responseExamples: [{ status: 200, description: 'Product page associated with the selected schema.', example: '{ "product": { "id": "<product-uuid>", "schema_id": "<schema-uuid>", "status": "draft", "version": 5 } }' }],
    tables: ['mentorbooking_products', 'pages', 'page_schemas'],
  },
  {
    id: 'products-publish',
    tag: 'Products',
    method: 'POST',
    path: '/api/products/:id/publish',
    summary: 'Publish or unpublish a service product',
    description: 'Explicitly updates page publication through the product aggregate after version/schema/content checks.',
    auth: 'bearer-required',
    mountsAt: '/api/products',
    sourceFile: 'api/routes/products.ts',
    logging: 'agentLogger',
    responseExamples: [{ status: 200, description: 'Published or drafted product page.', example: '{ "product": { "id": "<uuid>", "status": "published" } }' }],
    tables: ['mentorbooking_products', 'pages', 'page_schemas'],
  },
  {
    id: 'products-archive',
    tag: 'Products',
    method: 'POST',
    path: '/api/products/:id/archive',
    summary: 'Archive a service product',
    description: 'Atomically retires the product and archives its canonical page.',
    auth: 'bearer-required',
    mountsAt: '/api/products',
    sourceFile: 'api/routes/products.ts',
    logging: 'agentLogger',
    responseExamples: [{ status: 200, description: 'Retired product and archived page.', example: '{ "product": { "id": "<uuid>", "retired_at": "...", "status": "archived" } }' }],
    tables: ['mentorbooking_products', 'pages'],
  },
  {
    id: 'products-delete',
    tag: 'Products',
    method: 'DELETE',
    path: '/api/products/:id',
    summary: 'Permanently delete a product and its Events',
    description: 'Tenant- and expected-version-checked hard delete. Atomically deletes all linked active Events/Event Pages, archived Event history, the Product Page, and generated Product Object. Irreversible; archive is the reversible alternative.',
    auth: 'bearer-required',
    mountsAt: '/api/products',
    sourceFile: 'api/routes/products.ts',
    logging: 'agentLogger',
    parameters: [{ name: 'id', in: 'path', required: true, type: 'string', description: 'Service-product UUID.' }],
    requestExample: '{ "tenant_id": "<tenant-uuid>", "expected_version": 4 }',
    responseExamples: [{ status: 200, description: 'Product and linked history deleted.', example: '{ "deleted": true, "product_id": "<product-uuid>" }' }],
    tables: ['mentorbooking_products', 'mentorbooking_events', 'mentorbooking_events_archive', 'pages', 'objects'],
  },
  {
    id: 'schema-pages-list',
    tag: 'Schemas',
    method: 'GET',
    path: '/api/schemas/:slug/pages',
    summary: 'Deliver published pages for a schema',
    description: 'Public frontend delivery endpoint. Returns records only for a registered schema and status=published. Event schemas support allow-listed event/product relations; this GET route is not a draft/content management API.',
    auth: 'public',
    mountsAt: '/api/schemas',
    sourceFile: 'api/routes/schemas.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'slug', in: 'path', required: true, type: 'string', description: 'Stable schema API identifier (api_slug), not the tenant-local schema_slug.' },
    ],
    responseExamples: [{
      status: 200,
      description: 'Registered schema and its published pages.',
      example: '{ "schema": { "api_slug": "...", "targets": [] }, "pages": [{ "id": "...", "status": "published", "content": {} }] }',
    }],
    tables: ['page_schemas', 'pages', 'schema_frontend_targets'],
    notes: ['Intentionally public so deployed frontends can fetch content without a CMS session.', 'Only published pages are returned; drafts and archived rows are excluded.', 'Optional event includes: entity,event,product; product relation is returned only for a published registered service-product page.'],
  },
  {
    id: 'schema-pages-create',
    tag: 'Schemas',
    method: 'POST',
    path: '/api/schemas/:slug/pages',
    summary: 'Create a schema page or event-page aggregate',
    description: 'Authenticated page-post endpoint. Ordinary page schemas create a page row. Event schemas require explicit tenant, definition revision, page content and operational event details and create the event plus draft page atomically. Service-product schemas use POST /api/products.',
    auth: 'bearer-required',
    mountsAt: '/api/schemas',
    sourceFile: 'api/routes/schemas.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'slug', in: 'path', required: true, type: 'string', description: 'Stable schema API identifier (api_slug).' },
      { name: 'tenant_id', in: 'body', required: false, type: 'string', description: 'Explicit workspace UUID; required for event entries and must match the event schema.' },
      { name: 'expected_definition_revision', in: 'body', required: false, type: 'integer', description: 'Current event schema definition_revision; required for event entries.' },
      { name: 'name', in: 'body', required: true, type: 'string', description: 'Public page title.' },
      { name: 'content', in: 'body', required: true, type: 'object', description: 'Schema-driven public page content; preserved as authored.' },
      { name: 'event', in: 'body', required: false, type: 'object', description: 'Required for event schemas. Operational details: company label, date, time, duration, IANA timezone, optional service-product UUID, and workspace-defined custom_fields.' },
    ],
    requestExample: '{ "tenant_id": "<uuid>", "expected_definition_revision": 2, "name": "Workshop Berlin", "content": {}, "event": { "company": "Customer label", "date": "2026-11-05", "time": "09:00", "duration_minutes": 60, "timezone": "Europe/Berlin", "product_id": "<service-product-uuid>" } }',
    responseExamples: [{ status: 201, description: 'Created operational event and draft schema page.', example: '{ "event": { "id": "<event-uuid>", "page_id": "<page-uuid>" }, "page": { "status": "draft" }, "editor_url": "..." }' }],
    tables: ['mentorbooking_events', 'mentorbooking_products', 'pages', 'page_schemas'],
  },
  {
    id: 'schema-page-update',
    tag: 'Schemas',
    method: 'PATCH',
    path: '/api/schemas/:slug/pages/:pageId',
    summary: 'Update a schema page or event page',
    description: 'Authenticated schema entry update. Event pages require tenant_id, expected_definition_revision, and expected_page_updated_at and are saved/published through the event aggregate. Service-product pages use the product aggregate API.',
    auth: 'bearer-required',
    mountsAt: '/api/schemas',
    sourceFile: 'api/routes/schemas.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'slug', in: 'path', required: true, type: 'string', description: 'Stable schema API identifier (api_slug).' },
      { name: 'pageId', in: 'path', required: true, type: 'string', description: 'Page UUID.' },
      { name: 'tenant_id', in: 'body', required: false, type: 'string', description: 'Required for event pages and must match the schema workspace.' },
      { name: 'expected_definition_revision', in: 'body', required: false, type: 'integer', description: 'Required for event pages.' },
      { name: 'expected_page_updated_at', in: 'body', required: false, type: 'string', description: 'Required optimistic page revision for event pages.' },
      { name: 'status', in: 'body', required: false, type: 'string', description: 'Event page draft/published/archived status; event pages publish independently from scheduling status.' },
    ],
    responseExamples: [{ status: 200, description: 'Updated page and current page revision.', example: '{ "success": true, "page": { "page_id": "<uuid>", "status": "published", "updated_at": "..." } }' }],
    tables: ['mentorbooking_events', 'pages', 'page_schemas'],
  },
  {
    id: 'schema-page-detail',
    tag: 'Schemas',
    method: 'GET',
    path: '/api/schemas/:slug/pages/:pageSlug',
    summary: 'Deliver one published page by slug',
    description: 'Public frontend delivery endpoint for a published page belonging to a registered schema. It does not expose drafts or provide management operations.',
    auth: 'public',
    mountsAt: '/api/schemas',
    sourceFile: 'api/routes/schemas.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'slug', in: 'path', required: true, type: 'string', description: 'Stable schema API identifier (api_slug).' },
      { name: 'pageSlug', in: 'path', required: true, type: 'string', description: 'Page URL slug belonging to the schema.' },
    ],
    responseExamples: [{ status: 200, description: 'Schema and published page record.', example: '{ "schema": { "api_slug": "..." }, "page": { "slug": "...", "status": "published", "content": {} } }' }],
    tables: ['page_schemas', 'pages'],
    notes: ['Intentionally public for frontend rendering; authenticated page management is provided through MCP.'],
  },
  {
    id: 'schema-spec',
    tag: 'Schemas',
    method: 'GET',
    path: '/api/schemas/:slug/spec.txt',
    summary: 'Return LLM-readable schema specification',
    description: 'Builds a plaintext specification containing schema metadata, JSON schema definition, content block model, optional LLM instructions, and registration hints.',
    auth: 'public',
    mountsAt: '/api/schemas',
    sourceFile: 'api/routes/schemas.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'slug', in: 'path', required: true, type: 'string', description: 'Stable schema API identifier (api_slug). Existing schemas keep their former slug as this value.' },
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Plaintext spec file.',
        example: `SCHEMA SPECIFICATION: Blog\nSlug: blog\n--- SCHEMA DEFINITION ---\n{ ... }`,
      },
      {
        status: 404,
        description: 'Unknown schema slug.',
        example: `Schema "missing" not found.`,
      },
    ],
    tables: ['page_schemas', 'pages'],
    notes: ['Counts the number of pages bound to the schema.', 'Response content-type is text/plain.'],
  },
  {
    id: 'schema-register',
    tag: 'Schemas',
    method: 'POST',
    path: '/api/schemas/:slug/register',
    summary: 'Register an external frontend for a schema',
    description: 'Completes the schema registration handshake by validating the one-time registration code, storing frontend metadata, and moving any provided revalidation secret into the server-managed secret system.',
    auth: 'public',
    mountsAt: '/api/schemas',
    sourceFile: 'api/routes/schemas.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'slug', in: 'path', required: true, type: 'string', description: 'Stable schema API identifier (api_slug) awaiting registration.' },
      { name: 'code', in: 'body', required: true, type: 'string', description: 'Registration code issued by the CMS.' },
      { name: 'frontend_url', in: 'body', required: true, type: 'string', description: 'Base URL of the consuming frontend.' },
        { name: 'revalidation_endpoint', in: 'body', required: true, type: 'string', description: 'Relative revalidation endpoint path.' },
        { name: 'revalidation_secret', in: 'body', required: true, type: 'string', description: 'Shared secret for outbound ISR calls. Stored server-side; not persisted in plaintext on page_schemas.' },
      { name: 'slug_structure', in: 'body', required: false, type: 'string', description: 'Frontend URL pattern. Must include :slug and match any schema-level route constraints.' },
      { name: 'targets', in: 'body', required: false, type: 'array', description: 'Frontend collection-slot and optional detail-page targets. Collection targets use a server host_path plus semantic placement_key; fragments are not accepted.' },
    ],
    requestExample: `{
  "code": "3f6f7a31-...",
  "frontend_url": "https://frontend.example.com",
  "revalidation_endpoint": "/api/revalidate",
  "revalidation_secret": "shared-secret",
    "targets": [
      { "target_key": "docs.detail", "kind": "detail-page", "host_path": "/docs/:slug", "is_primary": true }
    ]
}`,
    responseExamples: [
      {
        status: 200,
        description: 'Schema registration completed.',
        example: `{
  "success": true,
  "message": "Schema registration completed successfully"
}`,
      },
      {
        status: 403,
        description: 'Registration code mismatch.',
        example: `{
  "error": "Invalid registration code"
}`,
      },
    ],
    sideEffects: ['Updates page_schemas.registration_status and clears registration_code.', 'Stores revalidation secrets in the managed secret system when provided.'],
    tables: ['page_schemas', 'schema_frontend_targets', 'managed_secrets'],
  },
  {
    id: 'schema-frontend-targets',
    tag: 'Schemas',
    method: 'PUT',
    path: '/api/schemas/:slug/frontend-targets',
    summary: 'Replace frontend targets for a schema',
    description: 'Authenticated, validated replacement of collection-slot and optional detail-page target metadata. The replacement is performed atomically in the database and never modifies schema or page content JSON.',
    auth: 'bearer-required',
    mountsAt: '/api/schemas',
    sourceFile: 'api/routes/schemas.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'slug', in: 'path', required: true, type: 'string', description: 'Stable schema API identifier (api_slug).' },
      { name: 'targets', in: 'body', required: true, type: 'array', description: 'Target definitions with target_key, kind, host_path, and collection placement_key where applicable.' },
    ],
    requestExample: `{
  "targets": [
    { "target_key": "home.posts", "kind": "collection-slot", "host_path": "/", "placement_key": "home.posts", "is_primary": true },
    { "target_key": "posts.detail", "kind": "detail-page", "host_path": "/posts/:slug", "supports_preview": true }
  ]
}`,
    responseExamples: [{ status: 200, description: 'Targets replaced successfully.', example: '{ "success": true, "targets": [ ... ] }' }],
    sideEffects: ['Replaces enabled and disabled target metadata for the schema.', 'Does not change page_schemas.schema or pages.content.'],
    tables: ['schema_frontend_targets', 'page_schemas'],
  },
  {
    id: 'schema-system-data',
    tag: 'Schemas',
    method: 'PATCH',
    path: '/api/schemas/:slug/system-data',
    summary: 'Nicht geheime Schema-Integrationsdaten korrigieren',
    description: 'Authentifizierte Aktualisierung von frontend_url, dem Legacy-Feld slug_structure und revalidation_endpoint. Frontend-URLs werden auf sichere Ziele und die kanonischen Schema-Vorgaben geprüft. Schema-JSON, Seiteninhalte, Registrierungscodes und Geheimnisse werden nicht angenommen.',
    auth: 'bearer-required',
    mountsAt: '/api/schemas',
    sourceFile: 'api/routes/schemas.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'slug', in: 'path', required: true, type: 'string', description: 'Stabile Schema-API-Kennung (api_slug).' },
      { name: 'frontend_url', in: 'body', required: false, type: 'string', description: 'Korrigierte absolute Frontend-URL. Gespeichert wird der Origin.' },
      { name: 'slug_structure', in: 'body', required: false, type: 'string', description: 'Legacy-Detailroute mit genau einem :slug-Token.' },
      { name: 'revalidation_endpoint', in: 'body', required: false, type: 'string|null', description: 'Strikter relativer Revalidierungs-Pfad oder null zum Leeren.' },
    ],
    requestExample: `{
  "frontend_url": "https://www.example.com"
}`,
    responseExamples: [{ status: 200, description: 'Systemdaten wurden aktualisiert.', example: '{ "success": true, "schema": { "frontend_url": "https://www.example.com" } }' }],
    sideEffects: ['Aktualisiert nur die explizit angegebenen, nicht geheimen Integrationsfelder in page_schemas.', 'Ändert weder Schema-JSON noch Seiteninhalte, Registrierungsstatus oder verwaltete Geheimnisse.'],
    tables: ['page_schemas'],
  },
  {
    id: 'page-domains-admin-list',
    tag: 'Schemas',
    method: 'GET',
    path: '/api/schemas/admin/domains',
    summary: 'List page domains (TLDs) with ownership and naming data',
    description: 'Super-admin registry view over public.page_domains: every registered frontend origin with its owning tenant, arbitrary display name, schema usage, an ownership_consistent flag (true when all schemas on the domain belong to the owning tenant) and the migration-scope preview (page_count, product_count, event_count, company_count, blocking_company_names) that powers the dashboard move dialog.',
    auth: 'bearer-required',
    mountsAt: '/api/schemas',
    sourceFile: 'api/routes/schemas.ts',
    logging: 'agentLogger',
    responseExamples: [{
      status: 200,
      description: 'Registry rows with usage information.',
      example: `{ "domains": [
  {
    "id": "…",
    "domain_url": "https://www.example.com",
    "tenant_id": "…",
    "display_name": null,
    "schema_count": 3,
    "schema_tenant_ids": ["…"],
    "ownership_consistent": true,
    "page_count": 12,
    "product_count": 5,
    "event_count": 4,
    "company_count": 2,
    "blocking_company_names": []
  }
] }`,
    }],
    notes: ['Requires the super-admin role (custom claim).', 'Rows are created at registration time; display_name falls back to the domain URL.', 'The migration-scope counts mirror exactly what the reassignment RPC moves; blocking_company_names lists companies whose events span domains and would abort the move.'],
    tables: ['page_domains', 'page_schemas'],
  },
  {
    id: 'page-domains-admin-update',
    tag: 'Schemas',
    method: 'PATCH',
    path: '/api/schemas/admin/domains/:id',
    summary: 'Move page-domain ownership or rename a TLD',
    description: 'Super-admin management of a single page domain. tenant_id triggers the atomic, cascading reassignment RPC (schemas, pages, frontend targets, content templates, tenant-locked aggregates and the registry row all move in one transaction). display_name sets an arbitrary label that is independent of the domain URL; empty string or null resets to the domain URL as the shown name.',
    auth: 'bearer-required',
    mountsAt: '/api/schemas',
    sourceFile: 'api/routes/schemas.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'id', in: 'path', required: true, type: 'string', description: 'Page-domain registry row id (page_domains.id).' },
      { name: 'tenant_id', in: 'body', required: false, type: 'string', description: 'Target tenant UUID for the ownership move; unassignment is not supported.' },
      { name: 'display_name', in: 'body', required: false, type: 'string|null', description: 'Arbitrary display name (≤120 chars); null/empty falls back to the domain URL.' },
    ],
    requestExample: `{ "tenant_id": "6f1c…", "display_name": "Marketing-Website" }`,
    responseExamples: [
      { status: 200, description: 'Domain updated.', example: '{ "success": true, "domain": { "id": "…", "domain_url": "https://www.example.com", "tenant_id": "…", "display_name": "Marketing-Website" } }' },
      { status: 409, description: 'Reassignment blocked — a trigger-locked aggregate cannot follow (e.g. an event whose company stays in the old workspace).', example: '{ "error": "Tenant reassignment failed: …" }' },
    ],
    sideEffects: ['tenant_id: moves page_schemas, pages, schema_frontend_targets, page_content_templates, mentorbooking_products and mentorbooking_events of the domain to the target tenant plus the registry row.', 'display_name: updates page_domains.display_name only.'],
    tables: ['page_domains', 'page_schemas', 'pages', 'schema_frontend_targets', 'page_content_templates', 'mentorbooking_products', 'mentorbooking_events'],
  },
  {
    id: 'schema-revalidate',
    tag: 'Schemas',
    method: 'POST',
    path: '/api/schemas/:slug/revalidate',
    summary: 'Trigger frontend revalidation for one page slug',
      description: 'Builds one canonical page path per enabled frontend target and forwards an authenticated POST request to the registered frontend for each target.',
      auth: 'bearer-required',
    mountsAt: '/api/schemas',
    sourceFile: 'api/routes/schemas.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'slug', in: 'path', required: true, type: 'string', description: 'Registered schema API identifier (api_slug).' },
      { name: 'page_slug', in: 'body', required: true, type: 'string', description: 'Frontend page path or slug to revalidate.' },
    ],
    requestExample: `{
  "page_slug": "/blog/example-entry"
}`,
    responseExamples: [
      {
        status: 200,
        description: 'Outbound revalidation request result.',
        example: `{
  "success": true,
    "results": [
      { "target_key": "docs.detail", "path": "/docs/example-entry", "status": 200, "success": true }
    ]
}`,
      },
      {
        status: 400,
        description: 'Frontend registration incomplete.',
        example: `{
  "error": "Frontend revalidation not configured"
}`,
      },
    ],
    notes: ['Outbound fetch uses a 10 second timeout.', 'Acts as the CMS-to-frontend ISR bridge.'],
    tables: ['page_schemas'],
  },
  {
    id: 'schema-health',
    tag: 'Observability',
    method: 'GET',
    path: '/api/schemas/:slug/health',
    summary: 'Check reachability of a schema frontend',
    description: 'Performs a server-side HEAD request against the registered frontend URL for one schema and reports latency plus status.',
    auth: 'public',
    mountsAt: '/api/schemas',
    sourceFile: 'api/routes/health.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'slug', in: 'path', required: true, type: 'string', description: 'Stable schema API identifier (api_slug).' },
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Health status payload.',
        example: `{
  "status": "online",
  "latency_ms": 182,
  "http_status": 200
}`,
      },
      {
        status: 404,
        description: 'Schema not found.',
        example: `{
  "error": "Schema \\"missing\\" not found"
}`,
      },
    ],
    tables: ['page_schemas'],
  },
  {
    id: 'domain-health',
    tag: 'Observability',
    method: 'POST',
    path: '/api/schemas/health/domain',
    summary: 'Run an ad-hoc domain health check',
    description: 'Checks any supplied URL with a HEAD request. This is not tied to a stored schema registration.',
    auth: 'public',
    mountsAt: '/api/schemas',
    sourceFile: 'api/routes/health.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'url', in: 'body', required: true, type: 'string', description: 'Absolute URL to test.' },
    ],
    requestExample: `{
  "url": "https://frontend.example.com"
}`,
    responseExamples: [
      {
        status: 200,
        description: 'Health check result.',
        example: `{
  "status": "offline",
  "latency_ms": 5001,
  "reason": "Connection failed or timed out",
  "url": "https://frontend.example.com"
}`,
      },
    ],
    notes: ['Fetch timeout is 5 seconds.', 'Useful for diagnosis before registering a frontend.'],
  },
  {
    id: 'logs-list',
    tag: 'Observability',
    method: 'GET',
    path: '/api/schemas/logs',
    summary: 'List agent/API log entries',
    description: 'Returns paginated entries from agent_logs with optional filtering by schema slug, method, effective status band, and date range. MCP rows include operation_name, verified user_id/user_email when available, status_code for inner tool outcome, and transport_status_code for the outer HTTP response.',
    auth: 'bearer-required',
    mountsAt: '/api/schemas/logs',
    sourceFile: 'api/routes/logs.ts',
    logging: 'internal',
    parameters: [
      { name: 'page', in: 'query', required: false, type: 'number', description: 'Pagination page, default 1.' },
      { name: 'limit', in: 'query', required: false, type: 'number', description: 'Page size, max 200.' },
      { name: 'schema_slug', in: 'query', required: false, type: 'string', description: 'Restrict logs to one schema.' },
      { name: 'method', in: 'query', required: false, type: 'string', description: 'HTTP method filter.' },
      { name: 'min_status', in: 'query', required: false, type: 'number', description: 'Minimum HTTP status code.' },
      { name: 'from', in: 'query', required: false, type: 'string', description: 'ISO start timestamp.' },
      { name: 'to', in: 'query', required: false, type: 'string', description: 'ISO end timestamp.' },
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Paginated log payload.',
        example: `{
  "logs": [{ "id": "...", "method": "POST", "path": "/mcp", "operation_name": "tools/call:specy_pages_schemas_update_system_data", "status_code": 404, "transport_status_code": 200, "user_id": "...", "user_email": "editor@example.com", "error": "Schema was not found" }],
  "pagination": { "page": 1, "limit": 50, "total": 1, "pages": 1 }
}`,
      },
    ],
    tables: ['agent_logs'],
    notes: ['This endpoint is intentionally excluded from agentLogger recursion.', 'Requires a super-admin bearer token.', 'Useful for operational audits and incident review.'],
  },
  {
    id: 'logs-stats',
    tag: 'Observability',
    method: 'GET',
    path: '/api/schemas/logs/stats',
    summary: 'Return aggregate log counters',
    description: 'Builds dashboard-oriented counters for total traffic, last 24h traffic, effective error volume (including MCP tool failures carried by HTTP 200), and unique IP count.',
    auth: 'bearer-required',
    mountsAt: '/api/schemas/logs',
    sourceFile: 'api/routes/logs.ts',
    logging: 'internal',
    responseExamples: [
      {
        status: 200,
        description: 'Aggregate counters.',
        example: `{
  "total": 1024,
  "last_24h": 147,
  "errors": 6,
  "unique_agents": 23
}`,
      },
    ],
    tables: ['agent_logs'],
  },
  {
    id: 'logs-download',
    tag: 'Observability',
    method: 'GET',
    path: '/api/schemas/logs/download',
    summary: 'Export log entries as JSON',
    description: 'Returns up to 5000 log rows as a downloadable JSON file. Supports schema and date filtering.',
    auth: 'bearer-required',
    mountsAt: '/api/schemas/logs',
    sourceFile: 'api/routes/logs.ts',
    logging: 'internal',
    parameters: [
      { name: 'schema_slug', in: 'query', required: false, type: 'string', description: 'Optional schema filter.' },
      { name: 'from', in: 'query', required: false, type: 'string', description: 'ISO start timestamp.' },
      { name: 'to', in: 'query', required: false, type: 'string', description: 'ISO end timestamp.' },
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Attachment payload with application/json body.',
        example: `[
  { "id": "...", "path": "/api/forms" }
]`,
      },
    ],
    tables: ['agent_logs'],
  },
  {
    id: 'logs-delete',
    tag: 'Observability',
    method: 'DELETE',
    path: '/api/schemas/logs',
    summary: 'Bulk-delete log entries',
    description: 'Deletes logs by schema slug or age. If no filter is provided, the caller must supply confirm=true to allow full deletion.',
    auth: 'bearer-required',
    mountsAt: '/api/schemas/logs',
    sourceFile: 'api/routes/logs.ts',
    logging: 'internal',
    parameters: [
      { name: 'schema_slug', in: 'query', required: false, type: 'string', description: 'Delete only logs for one schema.' },
      { name: 'before', in: 'query', required: false, type: 'string', description: 'Delete entries older than ISO timestamp.' },
      { name: 'confirm', in: 'query', required: false, type: 'boolean', description: 'Required for full-table delete with no filter.' },
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Deletion accepted.',
        example: `{
  "success": true,
  "message": "Logs deleted"
}`,
      },
      {
        status: 400,
        description: 'Missing explicit delete confirmation.',
        example: `{
  "error": "Add ?confirm=true to delete all logs"
}`,
      },
    ],
    sideEffects: ['Deletes rows from agent_logs.'],
    tables: ['agent_logs'],
  },
  {
    id: 'log-delete-single',
    tag: 'Observability',
    method: 'DELETE',
    path: '/api/schemas/logs/:id',
    summary: 'Delete one log entry',
    description: 'Removes one log row by primary key.',
    auth: 'bearer-required',
    mountsAt: '/api/schemas/logs',
    sourceFile: 'api/routes/logs.ts',
    logging: 'internal',
    parameters: [
      { name: 'id', in: 'path', required: true, type: 'uuid', description: 'agent_logs.id' },
    ],
    responseExamples: [
      { status: 200, description: 'Deletion accepted.', example: `{
  "success": true
}` },
    ],
    sideEffects: ['Deletes a single row from agent_logs.'],
    tables: ['agent_logs'],
  },
  {
    id: 'plugins-list',
    tag: 'Plugins',
    method: 'GET',
    path: '/api/plugins',
    summary: 'List registered plugins',
    description: 'Returns public metadata for installed plugins, including version, license, repository URL, and status.',
    auth: 'public',
    mountsAt: '/api/plugins',
    sourceFile: 'api/routes/plugins.ts',
    logging: 'agentLogger',
    responseExamples: [
      {
        status: 200,
        description: 'Plugin registry snapshot.',
        example: `{
  "service": "specy-api",
  "plugins": [{ "slug": "sample-plugin", "version": "1.0.0" }]
}`,
      },
    ],
    tables: ['plugins'],
  },
  {
    id: 'media-config',
    tag: 'Media',
    method: 'GET',
    path: '/api/media/config',
    summary: 'Read active storage configuration',
    description: 'Resolves the active storage provider and bucket binding at runtime. Used by the CMS media UI to discover whether Supabase or R2 is active.',
    auth: 'public',
    mountsAt: '/api/media',
    sourceFile: 'api/routes/media.ts',
    logging: 'agentLogger',
    responseExamples: [
      {
        status: 200,
        description: 'Storage configuration state.',
        example: `{
  "provider": "supabase",
  "bucket": "booking_media",
  "configured": true
}`,
      },
    ],
    notes: ['Does not expose secret material.', 'Used by Connections UI and media browser flows.'],
  },
  {
    id: 'media-list',
    tag: 'Media',
    method: 'GET',
    path: '/api/media/list',
    summary: 'List files and folders from the active storage backend',
    description: 'Lists folder prefixes and files for either R2 or Supabase Storage depending on runtime configuration.',
    auth: 'bearer-optional',
    mountsAt: '/api/media',
    sourceFile: 'api/routes/media.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'path', in: 'query', required: false, type: 'string', description: 'Optional folder prefix to list.' },
      { name: 'Authorization', in: 'header', required: false, type: 'Bearer token', description: 'Needed when listing protected Supabase buckets under authenticated policies.' },
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Media listing.',
        example: `{
  "items": [
    { "name": "hero.png", "path": "product-images/hero.png", "url": "https://...", "isFolder": false }
  ]
}`,
      },
      {
        status: 503,
        description: 'Storage provider not configured.',
        example: `{
  "error": "Storage not configured"
}`,
      },
    ],
    notes: ['Supabase bucket auto-creation is attempted only when service key binding exists.', 'R2 listings use delimiter-based folder expansion.'],
  },
  {
    id: 'media-upload',
    tag: 'Media',
    method: 'POST',
    path: '/api/media/upload',
    summary: 'Upload a file to the active storage backend',
    description: 'Accepts multipart/form-data with one file plus optional folder path. Uploads now require an authenticated bearer token regardless of the active storage provider.',
    auth: 'bearer-required',
    mountsAt: '/api/media',
    sourceFile: 'api/routes/media.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'file', in: 'body', required: true, type: 'multipart file', description: 'Binary file payload.' },
      { name: 'path', in: 'body', required: false, type: 'string', description: 'Folder prefix for the uploaded file.' },
      { name: 'Authorization', in: 'header', required: true, type: 'Bearer token', description: 'Required for all media uploads.' },
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Upload accepted.',
        example: `{
  "url": "https://cdn.example.com/product-images/hero.png",
  "path": "product-images/hero.png"
}`,
      },
      {
        status: 401,
          description: 'Upload without token.',
        example: `{
        "error": "Authentication required."
}`,
      },
    ],
    sideEffects: ['Writes a file object to R2 or Supabase Storage.'],
  },
  {
    id: 'media-delete',
    tag: 'Media',
    method: 'DELETE',
    path: '/api/media/file',
    summary: 'Delete a media object',
    description: 'Deletes one file by storage path. Deletes now require an authenticated bearer token regardless of the active storage provider.',
    auth: 'bearer-required',
    mountsAt: '/api/media',
    sourceFile: 'api/routes/media.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'path', in: 'query', required: true, type: 'string', description: 'Storage key to delete.' },
      { name: 'Authorization', in: 'header', required: true, type: 'Bearer token', description: 'Required for all media deletes.' },
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Delete accepted.',
        example: `{
  "success": true
}`,
      },
    ],
    sideEffects: ['Deletes a file object from storage.'],
  },
  {
    id: 'forms-list',
    tag: 'Forms',
    method: 'GET',
    path: '/api/forms',
    summary: 'List published API-visible forms',
    description: 'Returns published forms that can be discovered by agents or other clients. Does not expose full form schema until a specific form endpoint is requested.',
    auth: 'bearer-optional',
    mountsAt: '/api/forms',
    sourceFile: 'api/routes/forms.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'Authorization', in: 'header', required: false, type: 'Bearer token', description: 'Optional token used when RLS requires authenticated access.' },
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Published forms list.',
        example: `{
  "forms": [
    { "id": "uuid", "name": "Lead Intake", "slug": "lead-intake", "api_enabled": true }
  ]
}`,
      },
    ],
    tables: ['forms'],
  },
  {
    id: 'objects-list',
    tag: 'Objects',
    method: 'GET',
    path: '/api/objects',
    summary: 'List published API-enabled data objects',
    description: 'Public callers see published API-enabled non-auth Objects; authenticated console users see their RLS-visible non-archived Objects. Product-managed Objects are listed in the datastream inventory endpoint.',
    auth: 'bearer-optional',
    mountsAt: '/api/objects',
    sourceFile: 'api/routes/objects.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'Authorization', in: 'header', required: false, type: 'Bearer token', description: 'Used to reveal internal or non-public objects for admins.' },
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Available objects list.',
        example: `{
  "objects": [
    { "id": "uuid", "name": "Price List", "slug": "prices", "requires_auth": false }
  ]
}`,
      },
    ],
    tables: ['objects'],
  },
  {
    id: 'objects-datastreams',
    tag: 'Objects',
    method: 'GET',
    path: '/api/objects/datastreams',
    summary: 'List all visible Object API datastreams',
    description: 'Authenticated Object inventory including manually authored Objects and generated Product Objects. Reports configured public-read eligibility and the canonical Object endpoint path without returning Object payloads or internal source database IDs.',
    auth: 'bearer-required',
    mountsAt: '/api/objects',
    sourceFile: 'api/routes/objects.ts',
    logging: 'agentLogger',
    parameters: [{ name: 'tenantId', in: 'query', required: false, type: 'string', description: 'Optional workspace UUID; the caller must be an active workspace member.' }],
    responseExamples: [{ status: 200, description: 'Visible Object stream inventory.', example: '{ "total": 1, "datastreams": [{ "id": "<object-uuid>", "name": "Workshop", "slug": "product-<uuid>", "status": "published", "api_enabled": true, "requires_auth": false, "publicly_readable": true, "endpoint_path": "/api/objects/product-<uuid>", "source": { "kind": "product", "id": "<product-uuid>", "name": "Workshop" } }] }' }],
    tables: ['objects', 'mentorbooking_products'],
  },
  {
    id: 'objects-get',
    tag: 'Objects',
    method: 'GET',
    path: '/api/objects/:idOrSlug',
    summary: 'Retrieve object data and schema',
    description: 'Returns the current JSONB data and schema definition for an Object by ID or slug. Anonymous reads require status=published, api_enabled=true, and requires_auth=false. Generated Product Objects provide the dynamic Product/Event stream and do not duplicate Pages content.',
    auth: 'bearer-optional',
    mountsAt: '/api/objects',
    sourceFile: 'api/routes/objects.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'idOrSlug', in: 'path', required: true, type: 'string', description: 'Object ID (UUID) or custom slug.' },
      { name: 'Authorization', in: 'header', required: false, type: 'Bearer token', description: 'Required for objects with requires_auth=true.' },
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Complete object payload.',
        example: `{
  "id": "uuid",
  "name": "Price List",
  "slug": "prices",
  "schema": { "items": { "type": "object", ... } },
  "data": { "items": [...] }
}`,
      },
      {
        status: 401,
        description: 'Authentication required for this object.',
        example: `{ "error": "Authentication required." }`,
      },
      {
        status: 404,
        description: 'Object not found or API disabled.',
        example: `{ "error": "Object not found." }`,
      },
    ],
    tables: ['objects'],
  },
  {
    id: 'objects-api-access-update',
    tag: 'Objects',
    method: 'PATCH',
    path: '/api/objects/:id/access',
    summary: 'Update Object API access settings',
    description: 'Updates API enabled and JWT-required settings. For generated Product Objects, settings are stored on the Product source and applied independently from Page publication/revalidation. Retired Products remain unavailable.',
    auth: 'bearer-required',
    mountsAt: '/api/objects',
    sourceFile: 'api/routes/objects.ts',
    logging: 'agentLogger',
    parameters: [{ name: 'id', in: 'path', required: true, type: 'string', description: 'Object UUID.' }],
    requestExample: '{ "api_enabled": true, "requires_auth": false }',
    responseExamples: [{ status: 200, description: 'Effective Object API settings.', example: '{ "object": { "id": "<object-uuid>", "status": "published", "api_enabled": true, "requires_auth": false, "requested_api_enabled": true } }' }],
    tables: ['objects', 'mentorbooking_products', 'pages', 'page_schemas'],
  },
  {
    id: 'forms-share-get',
    tag: 'Forms',
    method: 'GET',
    path: '/api/forms/share/:tenantName/:shareSlug',
    summary: 'Resolve a public or auth-gated share form definition',
    description: 'Returns one form definition by share slug, provided share links are enabled and auth requirements are satisfied.',
    auth: 'bearer-optional',
    mountsAt: '/api/forms',
    sourceFile: 'api/routes/forms.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'tenantName', in: 'path', required: true, type: 'string', description: 'Tenant/workspace public URL segment. Use tenants.slug for new links; legacy name-derived links remain readable for compatibility.' },
      { name: 'shareSlug', in: 'path', required: true, type: 'string', description: 'Public share slug stored in forms.share_slug.' },
      { name: 'Authorization', in: 'header', required: false, type: 'Bearer token', description: 'Required when the form requires authentication.' },
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Form schema plus share metadata.',
        example: `{
  "form": { "id": "uuid", "share_slug": "lead-form", "requires_auth": false },
  "fields": [{ "name": "email", "type": "email", "label": "Email" }]
}`,
      },
      {
        status: 401,
        description: 'Token required by form policy.',
        example: `{
  "error": "Authentication required."
}`,
      },
    ],
    tables: ['forms'],
  },
  {
    id: 'forms-share-submit',
    tag: 'Forms',
    method: 'POST',
    path: '/api/forms/share/:tenantName/:shareSlug/answers',
    summary: 'Submit answers through a share link',
    description: 'Validates incoming answers against the stored JSONB schema, writes one row to forms_answers, and enqueues configured notification e-mails.',
    auth: 'bearer-optional',
    mountsAt: '/api/forms',
    sourceFile: 'api/routes/forms.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'tenantName', in: 'path', required: true, type: 'string', description: 'Tenant/workspace public URL segment. Use tenants.slug for new links; legacy name-derived links remain readable for compatibility.' },
      { name: 'shareSlug', in: 'path', required: true, type: 'string', description: 'Public share slug.' },
      { name: 'answers', in: 'body', required: true, type: 'object', description: 'Field-value map keyed by schema field name.' },
      { name: 'source_slug', in: 'body', required: false, type: 'string', description: 'Origin page slug or surface identifier.' },
      { name: 'Authorization', in: 'header', required: false, type: 'Bearer token', description: 'Required when the form requires authentication.' },
    ],
    requestExample: `{
  "answers": {
    "email": "ops@example.com",
    "topics": ["Product", "Implementation"],
    "consent": true
  },
  "source_slug": "homepage"
}`,
    responseExamples: [
      {
        status: 200,
        description: 'Submission stored.',
        example: `{
  "success": true,
  "answer_id": "uuid"
}`,
      },
      {
        status: 400,
        description: 'Schema validation failure.',
        example: `{
  "error": "Validation failed.",
  "details": ["email must be a valid email address."]
}`,
      },
    ],
    sideEffects: ['Inserts one row into forms_answers.', 'Enqueues mail_delivery_jobs and queued mail_delivery_events when form notifications are configured.', 'Deletes the saved forms_answers row after all notification e-mails are sent when the form enables auto-deletion.', 'Stores ip_address, user_agent, and source_slug when available.'],
    tables: ['forms', 'forms_answers', 'form_notification_settings', 'form_notification_recipients', 'mail_delivery_jobs', 'mail_delivery_events'],
  },
  {
    id: 'forms-api-get',
    tag: 'Forms',
    method: 'GET',
    path: '/api/forms/:identifier',
    summary: 'Resolve an API-enabled form by UUID or slug',
    description: 'Returns one form schema for machine clients. The identifier can be a UUID or the internal form slug.',
    auth: 'bearer-optional',
    mountsAt: '/api/forms',
    sourceFile: 'api/routes/forms.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'identifier', in: 'path', required: true, type: 'uuid|string', description: 'Form UUID or slug.' },
      { name: 'Authorization', in: 'header', required: false, type: 'Bearer token', description: 'Required when the form requires authentication.' },
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Form definition returned.',
        example: `{
  "form": { "id": "uuid", "slug": "lead-intake", "api_enabled": true },
  "fields": [{ "name": "company", "type": "text", "required": true }]
}`,
      },
      {
        status: 403,
        description: 'Form API access disabled.',
        example: `{
  "error": "API access is disabled for this form."
}`,
      },
    ],
    tables: ['forms'],
  },
  {
    id: 'forms-api-submit',
    tag: 'Forms',
    method: 'POST',
    path: '/api/forms/:identifier/answers',
    summary: 'Submit answers to an API-enabled form',
    description: 'Machine-facing submission endpoint. Uses the same schema validator as the share flow, stores source_slug plus transport metadata, and enqueues configured notification e-mails.',
    auth: 'bearer-optional',
    mountsAt: '/api/forms',
    sourceFile: 'api/routes/forms.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'identifier', in: 'path', required: true, type: 'uuid|string', description: 'Form UUID or slug.' },
      { name: 'answers', in: 'body', required: true, type: 'object', description: 'Field-value map keyed by schema field name.' },
      { name: 'source_slug', in: 'body', required: false, type: 'string', description: 'Source surface slug or origin label.' },
      { name: 'Authorization', in: 'header', required: false, type: 'Bearer token', description: 'Required when the form requires authentication.' },
    ],
    requestExample: `{
  "answers": {
    "email": "agent@example.com",
    "team_size": 15,
    "topics": ["Migration"]
  },
  "source_slug": "agent-workflow"
}`,
    responseExamples: [
      {
        status: 200,
        description: 'Submission stored.',
        example: `{
  "success": true,
  "answer_id": "uuid"
}`,
      },
      {
        status: 401,
        description: 'Token required by form policy.',
        example: `{
  "error": "Authentication required."
}`,
      },
    ],
    sideEffects: ['Inserts one row into forms_answers with submitted_via=api.', 'Enqueues mail_delivery_jobs and queued mail_delivery_events when form notifications are configured.', 'Deletes the saved forms_answers row after all notification e-mails are sent when the form enables auto-deletion.'],
    tables: ['forms', 'forms_answers', 'form_notification_settings', 'form_notification_recipients', 'mail_delivery_jobs', 'mail_delivery_events'],
  },
  {
    id: 'forms-api-submit-tenant',
    tag: 'Forms',
    method: 'POST',
    path: '/api/forms/:tenantName/:formSlug/answers',
    summary: 'Submit answers to an API-enabled form (workspace-scoped)',
    description: 'Workspace-bound variant of the machine-facing submission endpoint. The tenant segment must match the form\'s workspace (tenant name, slug, or organization slug) — a mismatch returns 404. Otherwise behaves identically to /api/forms/:identifier/answers, including the poll deadline enforcement. Companion endpoints: GET /api/forms/:tenantName/:formSlug (schema) and POST /api/forms/:tenantName/:formSlug/upload (multipart).',
    auth: 'bearer-optional',
    mountsAt: '/api/forms',
    sourceFile: 'api/routes/forms.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'tenantName', in: 'path', required: true, type: 'string', description: 'Workspace name, slug, or organization slug.' },
      { name: 'formSlug', in: 'path', required: true, type: 'string', description: 'Form slug.' },
      { name: 'answers', in: 'body', required: true, type: 'object', description: 'Field-value map keyed by schema field name.' },
      { name: 'source_slug', in: 'body', required: false, type: 'string', description: 'Source surface slug or origin label.' },
      { name: 'Authorization', in: 'header', required: false, type: 'Bearer token', description: 'Required when the form requires authentication.' },
    ],
    requestExample: `{
  "answers": {
    "email": "agent@example.com",
    "team_size": 15,
    "topics": ["Migration"]
  },
  "source_slug": "agent-workflow"
}`,
    responseExamples: [
      {
        status: 200,
        description: 'Submission stored.',
        example: `{
  "success": true,
  "answer_id": "uuid"
}`,
      },
      {
        status: 404,
        description: 'Form not found or workspace segment does not belong to the form.',
        example: `{
  "error": "Form not found."
}`,
      },
    ],
    sideEffects: ['Inserts one row into forms_answers with submitted_via=api.', 'Enqueues mail_delivery_jobs and queued mail_delivery_events when form notifications are configured.', 'Deletes the saved forms_answers row after all notification e-mails are sent when the form enables auto-deletion.'],
    tables: ['forms', 'forms_answers', 'form_notification_settings', 'form_notification_recipients', 'mail_delivery_jobs', 'mail_delivery_events'],
  },
  {
    id: 'secrets-list',
    tag: 'Secrets',
    method: 'GET',
    path: '/api/secrets',
    summary: 'List Cloudflare Secrets Store entries',
    description: 'Proxy endpoint used by the Connections admin UI to list secret names and metadata without exposing values to the browser.',
    auth: 'bearer-required',
    mountsAt: '/api/secrets',
    sourceFile: 'api/routes/secrets.ts',
    logging: 'none',
    responseExamples: [
      {
        status: 200,
        description: 'Secret metadata list.',
        example: `{
  "secrets": [{ "id": "cf-secret-id", "name": "SUPABASE_URL" }]
}`,
      },
      {
        status: 503,
        description: 'Worker not configured with CF credentials.',
        example: `{
  "error": "CF_API_TOKEN is not set. Run: npx wrangler secret put CF_API_TOKEN"
}`,
      },
    ],
    notes: ['Requires a super-admin bearer token.', 'Also depends on worker environment configuration and Cloudflare credentials.', 'Never returns secret values.'],
  },
  {
    id: 'secrets-env-status',
    tag: 'Secrets',
    method: 'GET',
    path: '/api/secrets/env-status',
    summary: 'Check whether expected secrets are bound',
    description: 'Returns boolean presence for sensitive worker secrets and Secrets Store bindings. Used for setup and observability.',
    auth: 'bearer-required',
    mountsAt: '/api/secrets',
    sourceFile: 'api/routes/secrets.ts',
    logging: 'none',
    responseExamples: [
      {
        status: 200,
        description: 'Presence-only status map.',
        example: `{
  "status": [
    { "name": "SUPABASE_SECRET_KEY", "hasValue": true, "source": "secrets-store" },
    { "name": "SECRETS_ENCRYPTION_KEY", "hasValue": true, "source": "env-var" }
  ]
}`,
      },
    ],
  },
  {
    id: 'secrets-stores',
    tag: 'Secrets',
    method: 'GET',
    path: '/api/secrets/stores',
    summary: 'List Cloudflare Secrets Stores',
    description: 'Queries Cloudflare for available secrets stores in the configured account. Useful when discovering the store ID during setup.',
    auth: 'bearer-required',
    mountsAt: '/api/secrets',
    sourceFile: 'api/routes/secrets.ts',
    logging: 'none',
    responseExamples: [
      {
        status: 200,
        description: 'Secrets Store list.',
        example: `{
  "stores": [{ "id": "store-id", "name": "specy" }]
}`,
      },
    ],
  },
  {
    id: 'secrets-upsert',
    tag: 'Secrets',
    method: 'POST',
    path: '/api/secrets/:name',
    summary: 'Create or update one secret in Cloudflare Secrets Store',
    description: 'Idempotent secret upsert path used by the Connections admin page. Creates if missing, otherwise updates by secret ID.',
    auth: 'bearer-required',
    mountsAt: '/api/secrets',
    sourceFile: 'api/routes/secrets.ts',
    logging: 'none',
    parameters: [
      { name: 'name', in: 'path', required: true, type: 'string', description: 'Secret name.' },
      { name: 'value', in: 'body', required: true, type: 'string', description: 'Secret value.' },
      { name: 'comment', in: 'body', required: false, type: 'string', description: 'Secret comment for operators.' },
      { name: 'Authorization', in: 'header', required: true, type: 'Bearer token', description: 'Super-admin bearer token.' },
    ],
    requestExample: `{
  "value": "https://example.supabase.co",
  "comment": "Primary production project"
}`,
    responseExamples: [
      {
        status: 200,
        description: 'Secret created or updated.',
        example: `{
  "success": true,
  "action": "updated",
  "secret": { "name": "SUPABASE_URL", "id": "cf-secret-id" }
}`,
      },
      {
        status: 400,
        description: 'Malformed JSON or missing value.',
        example: `{
  "error": "Request body must include { value: string }"
}`,
      },
    ],
    sideEffects: ['Creates or updates secret material in Cloudflare Secrets Store.'],
  },
  {
    id: 'secrets-delete',
    tag: 'Secrets',
    method: 'DELETE',
    path: '/api/secrets/:name',
    summary: 'Delete one secret from Cloudflare Secrets Store',
    description: 'Looks up the secret by name and deletes it by Cloudflare secret ID.',
    auth: 'bearer-required',
    mountsAt: '/api/secrets',
    sourceFile: 'api/routes/secrets.ts',
    logging: 'none',
    parameters: [
      { name: 'name', in: 'path', required: true, type: 'string', description: 'Secret name.' },
      { name: 'Authorization', in: 'header', required: true, type: 'Bearer token', description: 'Super-admin bearer token.' },
    ],
    responseExamples: [
      { status: 200, description: 'Secret removed.', example: `{
  "success": true,
  "deleted": "SUPABASE_URL"
}` },
      { status: 404, description: 'Secret not found.', example: `{
  "error": "Secret \\"SUPABASE_URL\\" not found in store"
}` },
    ],
    sideEffects: ['Deletes secret material from Cloudflare Secrets Store.'],
  },
  {
    id: 'config-storage-get',
    tag: 'Configuration',
    method: 'GET',
    path: '/api/config/storage',
    summary: 'Read storage runtime configuration',
    description: 'Returns the current non-sensitive storage settings persisted in system_config for the Connections admin UI.',
    auth: 'bearer-required',
    mountsAt: '/api/config',
    sourceFile: 'api/routes/config.ts',
    logging: 'agentLogger',
    responseExamples: [
      {
        status: 200,
        description: 'Current storage configuration.',
        example: `{
  "storage": {
    "provider": "supabase",
    "bucket": "booking_media",
    "r2PublicUrl": ""
  }
}`,
      },
    ],
    tables: ['system_config'],
    notes: ['Super-admin only.', 'Falls back to worker env vars when system_config is empty.'],
  },
  {
    id: 'config-storage-put',
    tag: 'Configuration',
    method: 'PUT',
    path: '/api/config/storage',
    summary: 'Update storage runtime configuration',
    description: 'Persists non-sensitive media storage settings in system_config without routing them through the secrets store.',
    auth: 'bearer-required',
    mountsAt: '/api/config',
    sourceFile: 'api/routes/config.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'provider', in: 'body', required: true, type: 'supabase|r2', description: 'Storage backend selector.' },
      { name: 'bucket', in: 'body', required: true, type: 'string', description: 'Bucket or container name.' },
      { name: 'r2PublicUrl', in: 'body', required: false, type: 'string', description: 'Public URL prefix for R2-backed media.' },
      { name: 'Authorization', in: 'header', required: true, type: 'Bearer token', description: 'Super-admin bearer token.' },
    ],
    requestExample: `{
  "provider": "supabase",
  "bucket": "booking_media",
  "r2PublicUrl": ""
}`,
    responseExamples: [
      {
        status: 200,
        description: 'Settings updated.',
        example: `{
  "success": true
}`,
      },
    ],
    sideEffects: ['Upserts core storage rows in system_config.'],
    tables: ['system_config'],
  },
  {
    id: 'config-logging-get',
    tag: 'Configuration',
    method: 'GET',
    path: '/api/config/logging',
    summary: 'Read communication log verbosity settings',
    description: 'Returns the super-admin logging mode and selected agentLogger HTTP endpoint keys used by /admin/api. The POST /mcp key controls all MCP JSON-RPC operations; operation_name distinguishes each tool in resulting log rows.',
    auth: 'bearer-required',
    mountsAt: '/api/config',
    sourceFile: 'api/routes/config.ts',
    logging: 'agentLogger',
    responseExamples: [
      {
        status: 200,
        description: 'Logging settings payload.',
        example: `{
  "logging": {
    "mode": "custom",
    "enabledEndpointKeys": ["GET /api/schemas", "POST /mcp"]
  }
}`,
      },
    ],
    tables: ['system_config'],
    notes: ['Super-admin only.', 'When mode is "all", the middleware logs every supported route except explicitly skipped operational paths.', 'In custom mode, POST /mcp is one transport-level toggle for all MCP methods/tools; log rows still carry operation_name and effective tool status.'],
  },
  {
    id: 'config-logging-put',
    tag: 'Configuration',
    method: 'PUT',
    path: '/api/config/logging',
    summary: 'Update communication log verbosity settings',
    description: 'Stores a per-endpoint allowlist for agentLogger-backed routes in system_config without creating a dedicated settings table. The POST /mcp key enables or disables logging for the whole MCP transport, not individual tool names.',
    auth: 'bearer-required',
    mountsAt: '/api/config',
    sourceFile: 'api/routes/config.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'mode', in: 'body', required: false, type: 'all|custom', description: 'Whether to log all supported endpoints or only the provided allowlist.' },
      { name: 'enabledEndpointKeys', in: 'body', required: false, type: 'string[]', description: 'Allowlist entries in the form "METHOD /path/:param"; POST /mcp covers all MCP tools.' },
      { name: 'Authorization', in: 'header', required: true, type: 'Bearer token', description: 'Super-admin bearer token.' },
    ],
    requestExample: `{
  "mode": "custom",
  "enabledEndpointKeys": ["GET /api/schemas", "POST /mcp"]
}`,
    responseExamples: [
      {
        status: 200,
        description: 'Settings updated.',
        example: `{
  "success": true,
  "logging": {
    "mode": "custom",
    "enabledEndpointKeys": ["GET /api/schemas", "POST /mcp"]
  }
}`,
      },
    ],
    sideEffects: ['Upserts logging configuration rows in system_config.', 'Changes the runtime allowlist consulted by agentLogger after cache expiry.'],
    tables: ['system_config'],
  },
  {
    id: 'config-mail-get',
    tag: 'Configuration',
    method: 'GET',
    path: '/api/config/mail',
    summary: 'Read outbound mail configuration',
    description: 'Returns non-secret mail transport settings plus presence flags for the write-only managed secrets.',
    auth: 'bearer-required',
    mountsAt: '/api/config',
    sourceFile: 'api/routes/config.ts',
    logging: 'agentLogger',
    responseExamples: [
      {
        status: 200,
        description: 'Current mail settings and secret status.',
        example: `{
  "mail": {
    "provider": "smtp",
    "fromName": "ServiceCMS",
    "fromEmail": "noreply@example.com",
    "replyToEmail": "support@example.com",
    "smtpHost": "smtp.resend.com",
    "smtpPort": 587,
    "smtpSecure": false,
    "smtpUsername": "resend"
  },
  "secrets": {
    "smtpPasswordConfigured": true,
    "resendApiKeyConfigured": false
  }
}`,
      },
    ],
    tables: ['system_config', 'managed_secrets'],
  },
  {
    id: 'config-mail-put',
    tag: 'Configuration',
    method: 'PUT',
    path: '/api/config/mail',
    summary: 'Update outbound mail configuration',
    description: 'Writes non-secret mail transport settings to system_config and optionally rotates write-only provider secrets in managed_secrets.',
    auth: 'bearer-required',
    mountsAt: '/api/config',
    sourceFile: 'api/routes/config.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'provider', in: 'body', required: true, type: 'smtp|resend', description: 'Mail provider selector.' },
      { name: 'fromEmail', in: 'body', required: true, type: 'string', description: 'Validated sender address.' },
      { name: 'smtpPassword', in: 'body', required: false, type: 'string', description: 'Optional write-only SMTP password rotation.' },
      { name: 'resendApiKey', in: 'body', required: false, type: 'string', description: 'Optional write-only Resend API key rotation.' },
      { name: 'Authorization', in: 'header', required: true, type: 'Bearer token', description: 'Super-admin bearer token.' },
    ],
    requestExample: `{
  "provider": "smtp",
  "fromName": "ServiceCMS",
  "fromEmail": "noreply@example.com",
  "replyToEmail": "support@example.com",
  "smtpHost": "smtp.resend.com",
  "smtpPort": 587,
  "smtpSecure": false,
  "smtpUsername": "resend",
  "smtpPassword": "write-only-secret"
}`,
    responseExamples: [
      {
        status: 200,
        description: 'Mail settings saved.',
        example: `{
  "success": true,
  "mail": {
    "provider": "smtp"
  },
  "secrets": {
    "smtpPasswordConfigured": true,
    "resendApiKeyConfigured": false
  }
}`,
      },
    ],
    sideEffects: ['Upserts mail rows in system_config.', 'Writes provider credentials into managed_secrets when supplied.'],
    tables: ['system_config', 'managed_secrets'],
  },
  {
    id: 'config-mail-test',
    tag: 'Configuration',
    method: 'POST',
    path: '/api/config/mail/test',
    summary: 'Run outbound mail connectivity test',
    description: 'Invokes the send_email edge function in test mode and returns provider-specific connectivity diagnostics.',
    auth: 'bearer-required',
    mountsAt: '/api/config',
    sourceFile: 'api/routes/config.ts',
    logging: 'agentLogger',
    responseExamples: [
      {
        status: 200,
        description: 'Connectivity succeeded.',
        example: `{
  "success": true,
  "provider": "smtp",
  "detail": "Authenticated successfully"
}`,
      },
      {
        status: 502,
        description: 'Upstream edge function failed.',
        example: `{
  "error": "Mail test failed: Edge Function HTTP 500: ..."
}`,
      },
    ],
    notes: ['Super-admin only.', 'Delegates to the Supabase edge function send_email.'],
  },
  {
    id: 'mail-jobs-list',
    tag: 'Mail',
    method: 'GET',
    path: '/api/mail/jobs',
    summary: 'List tenant mail delivery jobs',
    description: 'Returns the mail delivery log (jobs with their event history) scoped to the caller\'s tenant via RLS. Global admins and super-admins see all jobs.',
    auth: 'bearer-required',
    mountsAt: '/api/mail',
    sourceFile: 'api/routes/mail.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'status', in: 'query', required: false, type: 'pending|processing|sent|failed', description: 'Optional status filter.' },
      { name: 'form_id', in: 'query', required: false, type: 'uuid', description: 'Optional form filter.' },
      { name: 'limit', in: 'query', required: false, type: 'number', description: 'Maximum jobs to return (1-200, default 100).' },
      { name: 'Authorization', in: 'header', required: true, type: 'Bearer token', description: 'Bearer token of any authenticated user (tenant-scoped via RLS).' },
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Delivery log entries.',
        example: `{
  "jobs": [
    {
      "id": "…",
      "status": "failed",
      "recipient_email": "user@example.com",
      "subject": "Neue Formularantwort: Kontakt",
      "attempt_count": 3,
      "max_attempts": 3,
      "last_error": "Resend send failed: HTTP 429 …",
      "mail_delivery_events": [ { "event_type": "failed", "message": "…" } ]
    }
  ]
}`,
      },
    ],
    tables: ['mail_delivery_jobs', 'mail_delivery_events'],
  },
  {
    id: 'mail-jobs-retry',
    tag: 'Mail',
    method: 'POST',
    path: '/api/mail/jobs/:id/retry',
    summary: 'Re-dispatch a failed mail job',
    description: 'Resets a failed mail delivery job back to the queue (attempt counter reset) and triggers an immediate delivery attempt via the send_email edge function. Failures fall back to the rate-limit-aware queue processor. Tenant-scoped via RLS.',
    auth: 'bearer-required',
    mountsAt: '/api/mail',
    sourceFile: 'api/routes/mail.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'id', in: 'path', required: true, type: 'uuid', description: 'Mail delivery job id.' },
      { name: 'Authorization', in: 'header', required: true, type: 'Bearer token', description: 'Bearer token of any authenticated user (tenant-scoped via RLS).' },
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Delivery succeeded immediately or the job was requeued.',
        example: `{
  "success": true,
  "sent": true,
  "requeued": false,
  "instantDelivery": true
}`,
      },
      {
        status: 404,
        description: 'Job not visible to the caller\'s tenant.',
        example: `{ "error": "Mail job not found." }`,
      },
    ],
    sideEffects: ['Resets the job row (status pending, attempt_count 0).', 'Writes a requeued mail_delivery_events entry.', 'Invokes the send_email edge function in deliver-job mode.'],
    tables: ['mail_delivery_jobs', 'mail_delivery_events'],
  },
  {
    id: 'mail-jobs-delete',
    tag: 'Mail',
    method: 'DELETE',
    path: '/api/mail/jobs/:id',
    summary: 'Delete a tenant mail delivery job',
    description: 'Permanently deletes a mail delivery job (event history cascades). Tenant visibility is verified through the caller JWT (RLS); jobs currently in delivery are rejected with 409.',
    auth: 'bearer-required',
    mountsAt: '/api/mail',
    sourceFile: 'api/routes/mail.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'id', in: 'path', required: true, type: 'uuid', description: 'Mail delivery job id.' },
      { name: 'Authorization', in: 'header', required: true, type: 'Bearer token', description: 'Bearer token of any authenticated user (tenant-scoped via RLS).' },
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Job deleted.',
        example: `{ "success": true, "deleted": 1 }`,
      },
      {
        status: 404,
        description: 'Job not visible to the caller\'s tenant.',
        example: `{ "error": "Mail job not found." }`,
      },
    ],
    sideEffects: ['Deletes the job row and cascades its mail_delivery_events entries.'],
    tables: ['mail_delivery_jobs', 'mail_delivery_events'],
  },
  {
    id: 'mail-jobs-clear-all',
    tag: 'Mail',
    method: 'DELETE',
    path: '/api/mail/jobs',
    summary: 'Clear tenant mail delivery log',
    description: 'Deletes every mail delivery job visible to the caller\'s tenant (up to 1000 per call; event history cascades). Optionally filtered by status. Jobs currently in delivery are skipped. Tenant visibility is resolved through the caller JWT (RLS).',
    auth: 'bearer-required',
    mountsAt: '/api/mail',
    sourceFile: 'api/routes/mail.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'status', in: 'query', required: false, type: 'pending|processing|sent|failed', description: 'Optional status filter (e.g. clear only failed jobs).' },
      { name: 'Authorization', in: 'header', required: true, type: 'Bearer token', description: 'Bearer token of any authenticated user (tenant-scoped via RLS).' },
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Jobs deleted.',
        example: `{ "success": true, "deleted": 12 }`,
      },
    ],
    sideEffects: ['Deletes job rows and cascades their mail_delivery_events entries.'],
    tables: ['mail_delivery_jobs', 'mail_delivery_events'],
  },
  {
    id: 'mcp-stream',
    tag: 'MCP',
    method: 'POST',
    path: '/mcp',
    summary: 'OAuth-protected Streamable HTTP transport for MCP clients',
    description: 'Accepts OAuth-authenticated MCP JSON-RPC calls for schema and page tools. Tool calls use Streamable HTTP SSE; a tool-level failure may be carried by HTTP 200, while agent_logs records its effective inner status separately from transport_status_code.',
    auth: 'bearer-required',
    mountsAt: '/mcp',
    sourceFile: 'api/routes/mcp.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'Authorization', in: 'header', required: true, type: 'Bearer OAuth 2.1 access token', description: 'Required for POST requests and all schema/page management tools.' },
      { name: 'tools/call.name', in: 'body', required: false, type: 'string', description: 'MCP tool name; captured as operation_name in agent_logs.' },
    ],
    responseExamples: [
      {
        status: 200,
        description: 'Transport-level response; inspect the JSON-RPC tool result and isError for operation success.',
        example: `event: message\ndata: {"jsonrpc":"2.0","id":22,"result":{"isError":true,"structuredContent":{"error":"Schema not found","http_status":404}}}`,
      },
      {
        status: 401,
        description: 'Missing or invalid OAuth bearer session.',
        example: '{ "error": "Authentication required for MCP." }',
      },
    ],
    notes: [
      'Authenticated schema/page tools: specy_pages_schemas_list, specy_pages_schemas_get, specy_pages_schemas_list_pages, specy_pages_schemas_get_page, specy_pages_schemas_create_page, specy_pages_schemas_update_page, specy_pages_schemas_update_definition, specy_pages_schemas_update_system_data, and specy_pages_schemas_replace_frontend_targets. Service products use specy_products_list/create/get/update/publish/archive/delete with explicit tenant IDs.',
      'specy_pages_schemas_create_page/update_page dispatch event-classified schemas through event aggregate RPCs when explicit tenant and schema/page revisions plus event details are supplied. Product schemas use specy_products_* aggregate operations.',
      'specy_pages_schemas_update_system_data accepts api_slug or one unambiguous tenant-local schema slug; it edits non-secret frontend_url/route metadata under caller RLS.',
      'The logging verbosity key POST /mcp controls all MCP JSON-RPC operations; rows are distinguished by operation_name, and actor identity is recorded only after bearer verification.',
      'MCP management POST requires OAuth. GET /mcp discovery is separate and does not invoke management tools.',
      'Authenticated REST POST/PATCH /api/schemas/:slug/pages supports entity-aware page writes; public GET /api/schemas/:slug/pages remains registered-schema, published-only frontend delivery.',
      'Transport semantics are defined by @modelcontextprotocol/sdk and @hono/mcp.',
    ],
  },
  {
    id: 'plugin-routes-dynamic',
    tag: 'Plugins',
    method: 'GET',
    path: 'dynamic via mountPluginRoutes(app)',
    summary: 'Plugin-contributed API routes',
    description: 'Additional endpoints can be mounted at runtime by the generated api/plugin-routes.ts file. Installed plugin routes should be documented individually in this catalog when they are operator-relevant.',
    auth: 'public',
    mountsAt: 'generated',
    sourceFile: 'api/plugin-routes.ts',
    logging: 'agentLogger',
    responseExamples: [
      {
        status: 200,
        description: 'Plugin routes are mounted through generated integration code rather than a single callable endpoint.',
        example: `// Plugin route mounts are generated in api/plugin-routes.ts`,
      },
    ],
    notes: ['This is a generated integration point, not a single callable route.', 'Run plugin installation to regenerate the mount file when plugins provide API handlers.'],
  },
];

function toPluginApiEndpoint(route: ReturnType<typeof getPluginApiRoutes>[number]): ApiEndpointDefinition {
  return {
    id: route.id,
    tag: route.tag,
    method: route.method,
    path: `${route.basePath}${route.path}`,
    summary: route.summary ?? `${route.pluginName} API route`,
    description: route.description ?? `Plugin-provided endpoint from ${route.pluginName}.`,
    auth: route.auth ?? 'public',
    mountsAt: route.basePath,
    sourceFile: `plugins/${route.pluginId}/api/index.ts`,
    logging: route.logging ?? 'agentLogger',
    parameters: route.parameters,
    requestExample: route.requestExample,
    responseExamples: route.responseExamples ?? [{ status: 200, description: 'Route-specific response.' }],
    sideEffects: route.sideEffects,
    tables: route.tables,
    notes: route.notes,
  };
}

export function getApiCatalog(userRoles?: string[]): ApiEndpointDefinition[] {
  return [
    ...CORE_API_CATALOG,
    ...getPluginApiRoutes(userRoles).map(toPluginApiEndpoint),
  ];
}

export function getAgentLoggerEndpoints(userRoles?: string[]): ApiEndpointDefinition[] {
  return getApiCatalog(userRoles).filter(
    (endpoint) => endpoint.logging === 'agentLogger' && endpoint.path.startsWith('/'),
  );
}

export function getApiTags(userRoles?: string[]): string[] {
  return Array.from(new Set(getApiCatalog(userRoles).map((endpoint) => endpoint.tag)));
}