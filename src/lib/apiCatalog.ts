export type ApiParameterLocation = 'path' | 'query' | 'header' | 'body';

export type ApiEndpointMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

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

export const API_CATALOG: ApiEndpointDefinition[] = [
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
    description: 'Primary discovery endpoint for external frontends and agents. Returns schema metadata plus spec and register URLs.',
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
      { name: 'slug', in: 'path', required: true, type: 'string', description: 'Schema slug from page_schemas.slug.' },
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
    description: 'Completes the schema registration handshake by validating the one-time registration code and storing frontend and revalidation metadata.',
    auth: 'public',
    mountsAt: '/api/schemas',
    sourceFile: 'api/routes/schemas.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'slug', in: 'path', required: true, type: 'string', description: 'Schema slug awaiting registration.' },
      { name: 'code', in: 'body', required: true, type: 'string', description: 'Registration code issued by the CMS.' },
      { name: 'frontend_url', in: 'body', required: true, type: 'string', description: 'Base URL of the consuming frontend.' },
      { name: 'revalidation_endpoint', in: 'body', required: false, type: 'string', description: 'Relative revalidation endpoint path.' },
      { name: 'revalidation_secret', in: 'body', required: false, type: 'string', description: 'Shared secret for outbound ISR calls.' },
      { name: 'slug_structure', in: 'body', required: false, type: 'string', description: 'Frontend URL pattern, defaults to /:slug.' },
    ],
    requestExample: `{
  "code": "3f6f7a31-...",
  "frontend_url": "https://frontend.example.com",
  "revalidation_endpoint": "/api/revalidate",
  "revalidation_secret": "shared-secret",
  "slug_structure": "/:slug"
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
    sideEffects: ['Updates page_schemas.registration_status and clears registration_code.'],
    tables: ['page_schemas'],
  },
  {
    id: 'schema-revalidate',
    tag: 'Schemas',
    method: 'POST',
    path: '/api/schemas/:slug/revalidate',
    summary: 'Trigger frontend revalidation for one page slug',
    description: 'Builds the target revalidation URL from stored schema frontend settings and forwards a POST request to the registered frontend.',
    auth: 'public',
    mountsAt: '/api/schemas',
    sourceFile: 'api/routes/schemas.ts',
    logging: 'agentLogger',
    parameters: [
      { name: 'slug', in: 'path', required: true, type: 'string', description: 'Registered schema slug.' },
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
  "status": 200,
  "message": "Revalidation triggered successfully"
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
      { name: 'slug', in: 'path', required: true, type: 'string', description: 'Schema slug.' },
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
  "error": "Schema \"missing\" not found"
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
    description: 'Returns paginated entries from agent_logs with optional filtering by schema slug, method, status band, and date range.',
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
  "logs": [{ "id": "...", "method": "GET", "status_code": 200 }],
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
    description: 'Builds dashboard-oriented counters for total traffic, last 24h traffic, error volume, and unique IP count.',
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
    id: 'forms-share-get',
    tag: 'Forms',
    method: 'GET',
    path: '/api/forms/share/:shareSlug',
    summary: 'Resolve a public or auth-gated share form definition',
    description: 'Returns one form definition by share slug, provided share links are enabled and auth requirements are satisfied.',
    auth: 'bearer-optional',
    mountsAt: '/api/forms',
    sourceFile: 'api/routes/forms.ts',
    logging: 'agentLogger',
    parameters: [
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
    path: '/api/forms/share/:shareSlug/answers',
    summary: 'Submit answers through a share link',
    description: 'Validates incoming answers against the stored JSONB schema and writes one row to forms_answers with submission metadata.',
    auth: 'bearer-optional',
    mountsAt: '/api/forms',
    sourceFile: 'api/routes/forms.ts',
    logging: 'agentLogger',
    parameters: [
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
    sideEffects: ['Inserts one row into forms_answers.', 'Stores ip_address, user_agent, and source_slug when available.'],
    tables: ['forms', 'forms_answers'],
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
    description: 'Machine-facing submission endpoint. Uses the same schema validator as the share flow and stores source_slug plus transport metadata.',
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
    sideEffects: ['Inserts one row into forms_answers with submitted_via=api.'],
    tables: ['forms', 'forms_answers'],
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
    logging: 'agentLogger',
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
    description: 'Returns boolean presence for known worker env vars and Secrets Store bindings. Used for setup and observability.',
    auth: 'bearer-required',
    mountsAt: '/api/secrets',
    sourceFile: 'api/routes/secrets.ts',
    logging: 'agentLogger',
    responseExamples: [
      {
        status: 200,
        description: 'Presence-only status map.',
        example: `{
  "status": [
    { "name": "SUPABASE_URL", "hasValue": true, "source": "secrets-store" }
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
    logging: 'agentLogger',
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
    logging: 'agentLogger',
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
    logging: 'agentLogger',
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
  "error": "Secret \"SUPABASE_URL\" not found in store"
}` },
    ],
    sideEffects: ['Deletes secret material from Cloudflare Secrets Store.'],
  },
  {
    id: 'mcp-stream',
    tag: 'MCP',
    method: 'POST',
    path: '/mcp',
    summary: 'Streamable HTTP transport for MCP clients',
    description: 'Accepts MCP transport traffic for tool invocation against the ServiceCMS server. The route is mounted with agent logging middleware.',
    auth: 'public',
    mountsAt: '/mcp',
    sourceFile: 'api/routes/mcp.ts',
    logging: 'agentLogger',
    responseExamples: [
      {
        status: 200,
        description: 'Transport-level MCP response stream.',
        example: `MCP transport response body depends on protocol framing.`,
      },
    ],
    notes: ['Exposes tools like list_schemas, get_schema_spec, register_frontend, and check_health.', 'Transport semantics are defined by @modelcontextprotocol/sdk and @hono/mcp.'],
  },
  {
    id: 'plugin-routes-dynamic',
    tag: 'Plugins',
    method: 'GET',
    path: 'dynamic via mountPluginRoutes(app)',
    summary: 'Plugin-contributed API routes',
    description: 'Additional endpoints can be mounted at runtime by the generated api/plugin-routes.ts file. This workspace currently reports no installed plugin API routes.',
    auth: 'public',
    mountsAt: 'generated',
    sourceFile: 'api/plugin-routes.ts',
    logging: 'agentLogger',
    responseExamples: [
      {
        status: 200,
        description: 'No plugin API routes are mounted in the current workspace state.',
        example: `// (no plugins with API routes installed)`,
      },
    ],
    notes: ['This is a generated integration point, not a single callable route.', 'Run plugin installation to regenerate the mount file when plugins provide API handlers.'],
  },
];

export const API_TAGS = Array.from(new Set(API_CATALOG.map((endpoint) => endpoint.tag)));