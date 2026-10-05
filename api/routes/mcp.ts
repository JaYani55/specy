import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPTransport } from '@hono/mcp';
import { z } from 'zod';
import { createSupabaseClient, type Env } from '../lib/supabase';
import { createSupabaseAdminClient } from '../lib/supabase';
import { createPendingSchema } from '../lib/schemaCreation';
import {
  buildRevalidationSecretName,
  getRevalidationSecretNamespace,
  upsertManagedSecret,
} from '../lib/managedSecrets';
import { validateOutboundHttpUrl } from '../lib/urlSafety';
import { normalizeSchemaIntegrationRequirements } from '../lib/schemaRouting';
import { getOptionalAuthSession, unauthorizedWithChallenge } from '../lib/auth';
import {
  getDiscoverableSpecBySlug,
  listRegistryMcpSpecs,
  type DiscoverableSpecSummary,
} from '../lib/specRegistry';
import { registerPluginMcpTools } from '../lib/mcpHooks';
import type { VerifiedAuthSession } from '../lib/auth';
import { getPublicUrlConfig } from '../lib/systemConfig';
import { completeSchemaRegistration, type SchemaFrontendTargetInput } from '../lib/schemaRegistration';
import { validateSchemaContentContract, type SchemaContentContractInput } from '../lib/schemaRegistration';
import { getSchemaFrontendTargets } from '../lib/schemaRegistration';
import { serializeMcpError } from '../lib/apiError';
import {
  archiveProductAggregate,
  createProductAggregate,
  deleteProductAggregate,
  getProductAggregate,
  listProductAggregates,
  ProductAggregateError,
  publishProductAggregate,
  updateProductAggregate,
} from '../lib/productAggregateService';
import { parseCreateServiceProductInput, parseUpdateServiceProductInput } from '../lib/productAggregates';
import { createEventPageAggregate, EventPageAggregateError, parseEventPageCreateInput, updateEventPageAggregate } from '../lib/eventPageAggregates';
import { normalizeSchemaPageSlug } from '../lib/schemaPages';
import { validateSchemaSystemDataPatch } from '../lib/schemaSystemData';
import { parseSchemaDefinitionPatch, updateSchemaDefinition } from '../lib/schemaDefinition';
import { isPublicObjectReadable } from '../lib/objectVisibility';

const mcpRoute = new Hono<{ Bindings: Env }>();

const eventPageCreateDetailsSchema = z.object({
  company: z.string().min(1).describe('Legacy operational company label; it is not included in public event delivery.'),
  company_id: z.string().uuid().nullable().optional(),
  product_id: z.string().uuid().optional().describe('Service-product UUID from specy_products_list; must belong to the same workspace.'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  duration_minutes: z.number().int().min(1),
  timezone: z.string().min(1).describe('Confirmed IANA timezone such as Europe/Berlin.'),
  mode: z.enum(['live', 'online', 'hybrid']).optional(),
  required_staff_count: z.number().int().min(1).optional(),
  required_trait_id: z.number().int().positive().nullable().optional(),
  description: z.string().optional().describe('Operational description; it is not included in the public event projection.'),
  custom_fields: z.record(z.string(), z.unknown()).optional().describe('Product-defined event fields, separate from page content.'),
  registration_status: z.enum(['open', 'waitlist', 'full', 'closed', 'cancelled']).nullable().optional().describe('Operational registration state; distinct from page publication and scheduler status.'),
  participant_min: z.number().int().min(1).nullable().optional(),
  participant_max: z.number().int().min(1).nullable().optional(),
}).superRefine((event, context) => {
  if (event.participant_min != null && event.participant_max != null && event.participant_min > event.participant_max) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['participant_min'], message: 'participant_min cannot exceed participant_max.' });
  }
});

const BUILT_IN_MCP_TOOLS = [
  'start_here',
  'create_schema',
  'start_schema_registration',
  'create_page',
  'new_schema',
  'list_available_tools',
  'get_spec_definition',
  'list_schemas',
  'get_schema_spec',
  'register_frontend',
  'check_health',
  'list_objects',
  'get_object',
  'specy_pages_schemas_list',
  'specy_pages_schemas_get',
  'specy_pages_schemas_list_pages',
  'specy_pages_schemas_get_page',
  'specy_pages_schemas_create_page',
  'specy_pages_schemas_update_page',
  'specy_pages_schemas_update_system_data',
  'specy_pages_schemas_update_definition',
  'specy_pages_schemas_replace_frontend_targets',
  'specy_products_list',
  'specy_products_create',
  'specy_products_get',
  'specy_products_update',
  'specy_products_publish',
  'specy_products_archive',
  'specy_products_delete',
] as const;

const AUTHENTICATED_MCP_TOOLS = new Set([
  'create_schema', 'new_schema', 'start_schema_registration', 'create_page', 'register_frontend',
  'specy_pages_schemas_list', 'specy_pages_schemas_get', 'specy_pages_schemas_list_pages',
  'specy_pages_schemas_get_page', 'specy_pages_schemas_create_page', 'specy_pages_schemas_update_page',
  'specy_pages_schemas_update_system_data', 'specy_pages_schemas_update_definition', 'specy_pages_schemas_replace_frontend_targets',
  'specy_products_list', 'specy_products_create', 'specy_products_get', 'specy_products_update', 'specy_products_publish', 'specy_products_archive', 'specy_products_delete',
]);

function generateRegistrationCode(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

interface SchemaListRow {
  slug: string;
  api_slug: string;
  tenant_id?: string | null;
  tenants?: { slug?: string } | Array<{ slug?: string }> | null;
  name: string;
  description: string | null;
  registration_status: string | null;
  is_default: boolean | null;
  frontend_url: string | null;
  slug_structure?: string | null;
  integration_requirements?: Record<string, unknown> | null;
  content_scope?: 'page-collection' | 'single-page' | null;
  page_target?: Record<string, unknown> | null;
  entity_kind?: 'page' | 'service-product' | 'event' | null;
  definition_revision?: number;
  editor_config?: Record<string, unknown> | null;
}

function mcpToolFailure(message: string, httpStatus: number, extra: Record<string, unknown> = {}) {
  const payload = { error: message, http_status: httpStatus, ...extra };
  return {
    isError: true,
    structuredContent: payload,
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function buildSpecToolDescription(spec: DiscoverableSpecSummary): string {
  const summary = spec.description?.trim() || `Load the ${spec.name} specification.`;
  return `${summary} Returns the full spec definition and LLM instructions for this discoverable spec.`;
}

function buildSpecToolPayload(spec: DiscoverableSpecSummary, baseUrl: string) {
  return {
    spec: {
      slug: spec.slug,
      name: spec.name,
      description: spec.description,
      discovery_scope: spec.discovery_scope,
      schema: spec.schema,
      definition: spec.definition,
      llm_instructions: spec.llm_instructions,
      tags: spec.tags,
      metadata: spec.metadata,
      updated_at: spec.updated_at,
      detail_url: `${baseUrl}/api/specs/${spec.slug}`,
    },
  };
}

// ─── MCP Server Factory ─────────────────────────────────────────────────────
// Creates a fresh McpServer instance with all tools registered.
// We need a factory because each connection needs its own server + transport.

const newSchemaToolSchema = {
  name: z.string().min(1).describe('Display name for the new schema'),
  slug: z.string().optional().describe('Optional custom slug. Will be normalized and uniquified.'),
  description: z.string().optional().describe('Optional schema description'),
  schema: z.record(z.string(), z.unknown()).describe('Schema JSON definition to save in page_schemas.schema'),
  entity_kind: z.enum(['page', 'service-product', 'event']).optional().describe('Integration classification. Product/event schemas must be tenant-owned page collections.'),
  editor_config: z.record(z.string(), z.unknown()).optional().describe('Non-executable editor labels and widget/grouping hints; separate from content JSON.'),
  llm_instructions: z.string().optional().describe('Optional LLM instructions for builders and agents'),
  tenant_id: z.string().uuid().optional().describe('Workspace that owns this schema; defaults to the current workspace.'),
  integration_requirements: z.object({
    content_scope: z.enum(['page-collection', 'single-page']).optional().describe('Whether this schema creates many page records or edits one existing page surface.'),
    page_target: z.object({
      target_key: z.string(),
      host_path: z.string(),
      page_slug: z.string().nullable().optional(),
    }).nullable().optional().describe('Required for single-page schemas; identifies the existing frontend page surface.'),
    canonical_frontend_url: z.string().optional(),
    required_slug_structure: z.string().optional(),
    route_base_path: z.string().optional(),
    route_ownership: z.enum(['isolated', 'shared-layout-only', 'may-modify-existing']).optional(),
    allow_temporary_frontend_urls: z.boolean().optional(),
    page_discovery_mode: z.enum(['schema-scoped-api', 'supabase-by-schema', 'infer-content-shape']).optional(),
    schema_identification_hint: z.string().optional(),
    registration_notes: z.string().optional(),
  }).optional().describe('Optional schema routing and integration requirements. Choose content_scope=single-page for one existing landing page, or page-collection for many page records.'),
};

async function createMcpServerWithTools(
  env: Env,
  baseUrl: string,
  includeClosed: boolean,
  authSession: VerifiedAuthSession | null,
) {
  const server = new McpServer({
    name: 'specy',
    version: '1.0.0',
  });

  const authToken = authSession?.token ?? null;
  const supabaseUrl = (env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  const isAuthenticated = Boolean(authSession?.token);

  const supabase = await createSupabaseClient(env, authToken ?? undefined);
  const callProductOperation = async (operation: () => Promise<unknown>) => {
    try {
      const result = await operation();
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      if (error instanceof ProductAggregateError) {
        return mcpToolFailure(error.message, error.status, {
          ...(error.code ? { code: error.code } : {}),
          ...(error.details ? { details: error.details } : {}),
        });
      }
      return mcpToolFailure(error instanceof Error ? error.message : 'Product operation failed.', 500);
    }
  };

  server.tool(
    'start_here',
    'Explain Specy and outline how to inspect/manage schemas and pages, correct integration metadata, or create/register a frontend.',
    {},
    async () => ({
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          service: 'specy',
          workflow_version: '2026-10-01-schema-page-management-v1',
          purpose: 'Specy is a CMS and MCP server for schema-driven website generation and frontend registration workflows.',
          workflow: [
            '1. Call start_here to understand the system and available workflow tools.',
            '2. For existing content, authenticate and use specy_pages_schemas_list/get, then specy_pages_schemas_list_pages/get_page. Use specy_pages_schemas_update_page to edit ordinary page content or system fields. Use specy_pages_schemas_update_definition with the expected definition revision to change a schema contract. Product/event schema content requires entity-aware aggregate operations; generic page writes are rejected for those classifications.',
            '3. Correct a mistaken frontend URL with specy_pages_schemas_update_system_data after checking the schema and the intended canonical frontend; this does not require a new registration code.',
            '4. BEFORE any schema, page, registration, or closed-content operation, authenticate this MCP connection. If authenticated tools such as specy_pages_schemas_update_page or specy_pages_schemas_update_system_data are absent from tools/list, ask the MCP client to complete OAuth 2.1 in the browser.',
            '5. After OAuth completes, reconnect or refresh the MCP session and call tools/list again. Do not continue until the authenticated tools are visible.',
            '6. Authenticated tools include create_schema, start_schema_registration, register_frontend, ordinary page tools, schema-management tools, and specy_products_* aggregate tools.',
            '7. For a new frontend, call create_schema with the schema definition, then start_schema_registration.',
            '8. Build the frontend from get_schema_spec, then call register_frontend with the generated code and deployed URL.',
            '9. For ordinary schemas, create pages with create_page or specy_pages_schemas_create_page. For event schemas, use the same pages post tool with an explicit tenant_id, expected_definition_revision, and event details; it creates a linked draft event page. Product schemas use specy_products_create/get/update/publish/archive.'
          ],
          how_to_authenticate: {
            mode: 'MCP client-managed OAuth 2.1 Authorization Code + PKCE',
            required_before_private_tools: true,
            note: 'Authentication is mandatory before schema creation, page creation, frontend registration, or closed MCP access. The MCP client should follow the 401 WWW-Authenticate challenge, discover Supabase OAuth metadata, open the browser, handle consent, store the token, refresh it, and reconnect automatically.',
            expected_client_behavior: [
              '1. Connect to /mcp.',
              '2. On 401, discover /.well-known/oauth-protected-resource and the Supabase authorization server.',
              '3. Open the authorization URL in the browser and let the user approve.',
              '4. Capture the callback in the MCP client, exchange the code, store/refresh the token, and reconnect.',
              '5. Re-run tools/list after authentication.',
              '6. Confirm that the required authenticated tools, including specy_pages_schemas_update_definition and specy_products_create, are present before proceeding.'
            ],
            anonymous_tools: ['start_here', 'list_schemas', 'get_schema_spec', 'list_objects', 'get_object', 'check_health', 'list_available_tools', 'get_spec_definition'],
            authenticated_tools: [...AUTHENTICATED_MCP_TOOLS, 'closed MCP registry tools'],
            stop_condition: 'If the authenticated_tools are not returned by tools/list, do not claim that schema creation or registration is unavailable and do not proceed with a local-only implementation. Report that OAuth has not completed for this MCP connection.',
            legacy_tools: 'No manual OAuth tools are exposed on the normal MCP surface. VS Code, Cursor, Claude Desktop, and standards-compliant MCP clients must use the HTTP 401 challenge and manage OAuth themselves.',
          },
          important_notes: [
            'CRITICAL: The normal MCP surface has no manual authorization-code tools. Let the MCP client manage OAuth automatically.',
            'CRITICAL: An anonymous tools/list is not sufficient for schema work. Authenticate first, then call tools/list again and verify the private tools are present.',
            'new_schema intentionally creates schemas in pending state with no registration code.',
            'start_schema_registration can generate a registration code programmatically. A registered frontend URL can be corrected later through specy_pages_schemas_update_system_data; use the unhook workflow to disconnect a frontend.',
            'Published public MCP entries are visible without auth; published closed entries require a valid OAuth 2.1 bearer token.',
            'Password-based login was removed; normal MCP clients use client-managed OAuth through the HTTP challenge.',
          ],
        }, null, 2),
      }],
    }),
  );

  if (isAuthenticated) {
    server.tool(
      'specy_products_list',
      '[specy-products] List active service-product aggregates in one explicitly selected workspace.',
      { tenant_id: z.string().uuid() },
      async ({ tenant_id }) => callProductOperation(async () => ({ products: await listProductAggregates(supabase, tenant_id) })),
    );
    server.tool(
      'specy_products_create',
      '[specy-products] Atomically create a draft product aggregate and its canonical schema page. Use a tenant-owned service-product page-collection schema.',
      {
        tenant_id: z.string().uuid(),
        schema_id: z.string().uuid(),
        expected_definition_revision: z.number().int().min(1),
        name: z.string().min(1),
        slug: z.string().optional(),
        content: z.record(z.string(), z.unknown()).optional(),
        idempotency_key: z.string().uuid().optional(),
      },
      async ({ tenant_id, schema_id, expected_definition_revision, name, slug, content, idempotency_key }) => {
        const parsed = parseCreateServiceProductInput({
          tenant_id, schema_id, expected_definition_revision, name,
          ...(slug ? { slug } : {}), content: content ?? {}, idempotency_key: idempotency_key ?? crypto.randomUUID(),
        });
        if (!parsed.ok) return mcpToolFailure(parsed.error, 400);
        return callProductOperation(async () => {
          const product = await createProductAggregate(supabase, parsed.value) as { page_id?: string };
          const { data: schema } = await supabase.from('page_schemas').select('slug, api_slug, tenant_id').eq('id', schema_id).maybeSingle();
          const { data: tenant } = schema?.tenant_id
            ? await supabase.from('tenants').select('slug').eq('id', schema.tenant_id).maybeSingle()
            : { data: null };
          const editorPath = schema && tenant?.slug
            ? `/pages/schema/${encodeURIComponent(tenant.slug)}/${encodeURIComponent(schema.slug)}/edit/${product.page_id}`
            : `/pages/schema/${encodeURIComponent(schema?.api_slug ?? schema_id)}/edit/${product.page_id}`;
          return { product, editor_url: product.page_id ? `${baseUrl}${editorPath}` : null };
        });
      },
    );
    server.tool(
      'specy_products_get',
      '[specy-products] Read one product aggregate and its schema page from an explicitly selected workspace.',
      { id: z.string().uuid(), tenant_id: z.string().uuid() },
      async ({ id, tenant_id }) => callProductOperation(() => getProductAggregate(supabase, id, tenant_id)),
    );
    server.tool(
      'specy_products_update',
      '[specy-products] Atomically update product name, page slug, and arbitrary page JSON using optimistic version checks.',
      {
        id: z.string().uuid(),
        tenant_id: z.string().uuid(),
        expected_version: z.number().int().min(1),
        expected_definition_revision: z.number().int().min(1),
        name: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        content: z.record(z.string(), z.unknown()).optional(),
        custom_fields: z.record(z.string(), z.unknown()).optional().describe('Workspace-defined product fields, stored separately from schema page content.'),
      },
      async ({ id, tenant_id, expected_version, expected_definition_revision, name, slug, content, custom_fields }) => {
        const parsed = parseUpdateServiceProductInput({
          tenant_id, expected_version, expected_definition_revision,
          ...(name !== undefined ? { name } : {}), ...(slug !== undefined ? { slug } : {}), ...(content !== undefined ? { content } : {}),
          ...(custom_fields !== undefined ? { custom_fields } : {}),
        });
        if (!parsed.ok) return mcpToolFailure(parsed.error, 400);
        return callProductOperation(() => updateProductAggregate(supabase, id, parsed.value));
      },
    );
    server.tool(
      'specy_products_publish',
      '[specy-products] Publish or return a product page to draft status through the aggregate service.',
      { id: z.string().uuid(), tenant_id: z.string().uuid(), expected_version: z.number().int().min(1), expected_definition_revision: z.number().int().min(1), status: z.enum(['draft', 'published']) },
      async ({ id, tenant_id, expected_version, expected_definition_revision, status }) => callProductOperation(
        () => publishProductAggregate(supabase, id, tenant_id, expected_version, expected_definition_revision, status),
      ),
    );
    server.tool(
      'specy_products_archive',
      '[specy-products] Retire a product and archive its canonical page atomically while preserving its history.',
      { id: z.string().uuid(), tenant_id: z.string().uuid(), expected_version: z.number().int().min(1) },
      async ({ id, tenant_id, expected_version }) => callProductOperation(
        () => archiveProductAggregate(supabase, id, tenant_id, expected_version),
      ),
    );
    server.tool(
      'specy_products_delete',
      '[specy-products] Permanently delete a product, its canonical Page, every linked active Event and linked Event Page, plus archived Event history. This is irreversible; require explicit user confirmation and the current expected_version.',
      {
        id: z.string().uuid(),
        tenant_id: z.string().uuid(),
        expected_version: z.number().int().min(1),
        confirm_delete: z.literal(true).describe('Set true only after the user explicitly confirms permanent deletion of the Product, Events, Pages and archived Event history.'),
      },
      async ({ id, tenant_id, expected_version }) => callProductOperation(
        () => deleteProductAggregate(supabase, id, tenant_id, expected_version),
      ),
    );

    const createSchemaHandler = await buildNewSchemaHandler(env, baseUrl, authToken);
    server.tool(
      'create_schema',
      'Create a new page schema for the current authenticated tenant. The schema is immediately ready for frontend registration. Call start_schema_registration next; do not ask the user to click anything in the CMS.',
      newSchemaToolSchema,
      createSchemaHandler,
    );
    server.tool(
      'new_schema',
      'Compatibility alias for create_schema. Creates a new page schema for the current authenticated tenant.',
      newSchemaToolSchema,
      createSchemaHandler,
    );

    server.tool(
      'start_schema_registration',
      'Generate a one-time frontend registration code for a schema. This replaces the manual CMS Start Registration action.',
      {
      slug: z.string().min(1).describe('Schema API slug (api_slug) returned by list_schemas/create_schema'),
      },
      async ({ slug }) => {
      if (!authToken) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Authentication required. Use the MCP client OAuth flow first.' }, null, 2) }] };
      }

      const registrationCode = generateRegistrationCode();
      const { data, error } = await supabase
        .from('page_schemas')
        .update({ registration_code: registrationCode, registration_status: 'waiting' })
        .eq('api_slug', slug)
        .select('id, slug, api_slug, name, registration_status, registration_code, integration_requirements, slug_structure')
        .single();

      if (error || !data) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: error?.message || `Schema "${slug}" not found.` }, null, 2) }] };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            schema: { ...data, slug: data.api_slug, schema_slug: data.slug },
            registration: {
              code: registrationCode,
              endpoint: `${baseUrl}/api/schemas/${data.api_slug}/register`,
              request: {
                slug: data.api_slug,
                code: registrationCode,
                frontend_url: 'https://your-frontend.example',
                revalidation_endpoint: '/api/revalidate',
                revalidation_secret: 'REQUIRED_GENERATE_A_STRONG_RANDOM_SECRET',
                slug_structure: data.slug_structure || '/:slug',
              },
            },
            next_step: 'Build the frontend, then call register_frontend with this code and the deployed frontend URL.',
          }, null, 2),
        }],
      };
      },
    );

    server.tool(
      'create_page',
      'Create a schema page entry with a valid OAuth bearer token. For event schemas, supply tenant_id, expected_definition_revision, and event details; this atomically creates an operational event plus a linked draft page. Service products use specy_products_create.',
      {
      schema_slug: z.string().min(1).describe('Schema API slug (api_slug) returned by list_schemas/create_schema'),
      name: z.string().min(1).describe('Page display name'),
      slug: z.string().optional().describe('Optional URL slug; generated from name when omitted'),
      content: z.record(z.string(), z.unknown()).describe('Page content matching the schema definition'),
      status: z.enum(['draft', 'published']).optional().describe('Page status; defaults to draft. Event pages are always created as drafts.'),
      tenant_id: z.string().uuid().optional().describe('Tenant UUID; required for event schemas.'),
      expected_definition_revision: z.number().int().min(1).optional().describe('Required for event schemas.'),
      event: eventPageCreateDetailsSchema.optional().describe('Required when schema_slug identifies an event schema; operational event facts are stored separately from page content.'),
      },
      async ({ schema_slug, name, slug, content, status, tenant_id, expected_definition_revision, event }) => {
      if (!authToken) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Authentication required. Use the MCP client OAuth flow first.' }, null, 2) }] };
      }

      const { data: schema, error: schemaError } = await supabase
        .from('page_schemas')
        .select('id, slug, api_slug, tenant_id, frontend_url, slug_structure, content_scope, entity_kind, definition_revision')
        .eq('api_slug', schema_slug)
        .single();
      if (schemaError || !schema) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: schemaError?.message || `Schema "${schema_slug}" not found.` }, null, 2) }] };
      }

      if (schema.content_scope === 'single-page') {
        return { content: [{ type: 'text' as const, text: JSON.stringify({
          error: `Schema "${schema_slug}" is a single-page schema. Use the schema's existing page surface instead of create_page.`,
          content_scope: schema.content_scope,
        }, null, 2) }] };
      }
      if (schema.entity_kind === 'event' || schema.entity_kind === 'service-product') {
        if (status === 'published') return mcpToolFailure('Event pages are created as drafts; publish them separately after content review.', 400);
        if (!event || !tenant_id || expected_definition_revision === undefined) {
          return mcpToolFailure('tenant_id, expected_definition_revision, and event details are required for an event schema.', 400);
        }
        const parsed = parseEventPageCreateInput({
          tenant_id, expected_definition_revision, name, slug, content, event,
        });
        if (!parsed.ok) return mcpToolFailure(parsed.error, 400);
        try {
          const aggregate = await createEventPageAggregate(supabase, schema, parsed.value) as { event_id: string; page_id: string; page_slug: string; page_status: string };
          const { data: tenant } = schema.tenant_id
            ? await supabase.from('tenants').select('slug').eq('id', schema.tenant_id).maybeSingle()
            : { data: null };
          const cmsPath = tenant?.slug
            ? `/pages/schema/${encodeURIComponent(tenant.slug)}/${encodeURIComponent(schema.slug)}`
            : `/pages/schema/${encodeURIComponent(schema.api_slug)}`;
          return { content: [{ type: 'text' as const, text: JSON.stringify({
            success: true,
            event: { id: aggregate.event_id, tenant_id: schema.tenant_id, page_id: aggregate.page_id },
            page: { id: aggregate.page_id, slug: aggregate.page_slug, name, status: aggregate.page_status, schema_id: schema.id, tenant_id: schema.tenant_id, content },
            editor_url: `${baseUrl}${cmsPath}/edit/${aggregate.page_id}`,
            next_step: 'Open the event page in PageBuilder, complete schema-required content, then explicitly publish it.',
          }, null, 2) }] };
        } catch (error) {
          if (error instanceof EventPageAggregateError) return mcpToolFailure(error.message, error.status, error.code ? { code: error.code } : {});
          return mcpToolFailure(error instanceof Error ? error.message : 'Event page creation failed.', 500);
        }
      }
      if (schema.entity_kind === 'service-product') {
        return mcpToolFailure('Use specy_products_create for service-product schemas.', 409, { code: 'aggregate_operation_required' });
      }
      if (schema.entity_kind && schema.entity_kind !== 'page') {
        return mcpToolFailure(`Unsupported page entity kind: ${schema.entity_kind}.`, 409, { code: 'aggregate_operation_required' });
      }
      if (tenant_id && tenant_id !== schema.tenant_id) {
        return mcpToolFailure('Page tenant must match the owning schema tenant.', 409);
      }

      const requestedSlug = normalizeSchemaPageSlug(slug || name);

      const { data: existing } = await supabase.from('pages').select('id').eq('slug', requestedSlug).limit(1);
      const uniqueSlug = existing && existing.length > 0 ? `${requestedSlug}-${Date.now().toString(36)}` : requestedSlug;

      const pageInsert: Record<string, unknown> = {
          name,
          slug: uniqueSlug,
          content,
          status: status || 'draft',
          schema_id: schema.id,
        };
      if (schema.tenant_id) pageInsert.tenant_id = schema.tenant_id;

      const { data: page, error: pageError } = await supabase
        .from('pages')
        .insert(pageInsert)
        .select('id, slug, name, status, schema_id, tenant_id, domain_url, updated_at, published_at')
        .single();

      if (pageError || !page) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: pageError?.message || 'Failed to create page.' }, null, 2) }] };
      }

      const { data: tenant } = schema.tenant_id
        ? await supabase.from('tenants').select('slug').eq('id', schema.tenant_id).maybeSingle()
        : { data: null };
      const cmsSchemaPath = tenant?.slug
        ? `/pages/schema/${tenant.slug}/${schema.slug}`
        : `/pages/schema/${schema.api_slug}`;

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            page,
            preview_url: schema.frontend_url ? `${schema.frontend_url}${(schema.slug_structure || '/:slug').replace(':slug', page.slug)}` : null,
            cms_url: `${baseUrl}${cmsSchemaPath}/edit/${page.id}`,
          }, null, 2),
        }],
      };
      },
    );

    // Hierarchical page tools: specy-pages > schemas.
    server.tool(
      'specy_pages_schemas_list',
      '[specy-pages > schemas] List schemas accessible to the authenticated caller, including their API identifiers and frontend system metadata.',
      {},
      async () => {
        const { data, error } = await supabase
          .from('page_schemas')
          .select('slug, api_slug, tenant_id, name, description, registration_status, is_default, frontend_url, revalidation_endpoint, slug_structure, integration_requirements, content_scope, page_target, entity_kind, definition_revision, editor_config, updated_at')
          .neq('registration_status', 'archived')
          .order('name', { ascending: true });
        if (error) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: error.message }, null, 2) }] };

        const schemas = (data ?? []).map((schema) => ({
          slug: schema.api_slug,
          api_slug: schema.api_slug,
          schema_slug: schema.slug,
          tenant_id: schema.tenant_id,
          name: schema.name,
          description: schema.description,
          registration_status: schema.registration_status,
          is_default: schema.is_default,
          frontend_url: schema.frontend_url,
          revalidation_endpoint: schema.revalidation_endpoint,
          slug_structure: schema.slug_structure,
          integration_requirements: normalizeSchemaIntegrationRequirements(schema.integration_requirements),
          content_scope: schema.content_scope || 'page-collection',
          page_target: schema.page_target,
          entity_kind: schema.entity_kind || 'page',
          definition_revision: schema.definition_revision || 1,
          editor_config: schema.editor_config || {},
          spec_url: `${baseUrl}/api/schemas/${schema.api_slug}/spec.txt`,
          pages_url: `${baseUrl}/api/schemas/${schema.api_slug}/pages`,
        }));
        return { content: [{ type: 'text' as const, text: JSON.stringify({ schemas, total: schemas.length }, null, 2) }] };
      },
    );

    server.tool(
      'specy_pages_schemas_get',
      '[specy-pages > schemas] View one full schema definition and its safe system metadata. Secrets and registration codes are never returned.',
      { schema_slug: z.string().min(1).describe('Stable schema API slug (api_slug) from the schema list') },
      async ({ schema_slug }) => {
        const { data: schema, error } = await supabase
          .from('page_schemas')
          .select('id, slug, api_slug, tenant_id, name, description, schema, llm_instructions, registration_status, is_default, frontend_url, revalidation_endpoint, slug_structure, integration_requirements, content_scope, page_target, entity_kind, definition_revision, editor_config, created_at, updated_at')
          .eq('api_slug', schema_slug)
          .single();
        if (error || !schema) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: error?.message || `Schema "${schema_slug}" not found.` }, null, 2) }] };

        const targets = await getSchemaFrontendTargets(env, schema.id, authToken ?? undefined);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              schema: {
                ...schema,
                slug: schema.api_slug,
                schema_slug: schema.slug,
                integration_requirements: normalizeSchemaIntegrationRequirements(schema.integration_requirements),
                entity_kind: schema.entity_kind || 'page',
                definition_revision: schema.definition_revision || 1,
                editor_config: schema.editor_config || {},
              },
              targets,
              system_data_edit_endpoint: `${baseUrl}/api/schemas/${schema.api_slug}/system-data`,
            }, null, 2),
          }],
        };
      },
    );

    server.tool(
      'specy_pages_schemas_list_pages',
      '[specy-pages > schemas > pages] List Page records only: editorial content, publication and Page system fields. Linked operational Product/Event facts are not part of this contract; use the relevant Object for dynamic data. Content is omitted unless requested.',
      {
        schema_slug: z.string().min(1).describe('Stable schema API slug (api_slug) from the schema list'),
        include_content: z.boolean().optional().describe('Include full arbitrary JSON page content; defaults to false.'),
      },
      async ({ schema_slug, include_content }) => {
        const { data: schema, error: schemaError } = await supabase
          .from('page_schemas')
          .select('id, api_slug')
          .eq('api_slug', schema_slug)
          .single();
        if (schemaError || !schema) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Schema "${schema_slug}" not found.` }, null, 2) }] };

        const projection = include_content
          ? 'id, slug, name, status, is_draft, content, schema_id, tenant_id, domain_url, updated_at, published_at'
          : 'id, slug, name, status, is_draft, schema_id, tenant_id, domain_url, updated_at, published_at';
        const { data: pages, error } = await supabase
          .from('pages')
          .select(projection)
          .eq('schema_id', schema.id)
          .order('updated_at', { ascending: false });
        if (error) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: error.message }, null, 2) }] };
        return { content: [{ type: 'text' as const, text: JSON.stringify({ schema_slug, pages: pages ?? [], total: pages?.length ?? 0 }, null, 2) }] };
      },
    );

    server.tool(
      'specy_pages_schemas_get_page',
      '[specy-pages > schemas > pages] Load one Page record only, including its complete stored editorial JSON content and Page system fields. Use the relevant Object for dynamic Product/Event facts.',
      {
        schema_slug: z.string().min(1).describe('Stable schema API slug (api_slug)'),
        page_id: z.string().uuid().describe('Page UUID from specy_pages_schemas_list_pages'),
      },
      async ({ schema_slug, page_id }) => {
        const { data: schema } = await supabase.from('page_schemas').select('id').eq('api_slug', schema_slug).single();
        if (!schema) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Schema "${schema_slug}" not found.` }, null, 2) }] };
        const { data: page, error } = await supabase
          .from('pages')
          .select('id, slug, name, status, is_draft, content, schema_id, tenant_id, domain_url, updated_at, published_at')
          .eq('schema_id', schema.id)
          .eq('id', page_id)
          .single();
        if (error || !page) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: error?.message || 'Page not found in the requested schema.' }, null, 2) }] };
        return { content: [{ type: 'text' as const, text: JSON.stringify({ page }, null, 2) }] };
      },
    );

    server.tool(
      'specy_pages_schemas_create_page',
      '[specy-pages > schemas > pages] Create a schema page entry. For event schemas include tenant_id, expected_definition_revision, and operational event details; this creates an atomic event plus draft event page. Event pages are published separately.',
      {
        schema_slug: z.string().min(1).describe('Stable schema API slug (api_slug)'),
        name: z.string().min(1),
        slug: z.string().optional().describe('Optional URL slug; generated from name when omitted.'),
        content: z.record(z.string(), z.unknown()).describe('Complete page JSON content; keys and casing are preserved.'),
        status: z.enum(['draft', 'published']).optional().describe('Defaults to draft. Event pages are always created as drafts.'),
        domain_url: z.string().max(2048).nullable().optional().describe('Optional ordinary page-owned domain URL system field.'),
        tenant_id: z.string().uuid().optional().describe('Required for event schemas; must match the schema workspace.'),
        expected_definition_revision: z.number().int().min(1).optional().describe('Required for event schemas.'),
        event: eventPageCreateDetailsSchema.optional().describe('Required for event schemas; these operational fields are separate from page content.'),
      },
      async ({ schema_slug, name, slug, content, status, domain_url, tenant_id, expected_definition_revision, event }) => {
        const { data: schema, error: schemaError } = await supabase
          .from('page_schemas')
          .select('id, api_slug, slug, tenant_id, content_scope, entity_kind, definition_revision')
          .eq('api_slug', schema_slug)
          .single();
        if (schemaError || !schema) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Schema "${schema_slug}" not found.` }, null, 2) }] };
        if (schema.content_scope === 'single-page') {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'This is a single-page schema; edit its existing page record instead of adding another page.' }, null, 2) }] };
        }
        if (schema.entity_kind === 'event' || schema.entity_kind === 'service-product') {
          if (status === 'published') return mcpToolFailure('Event pages are created as drafts; publish them separately after content review.', 400);
          if (domain_url !== undefined) return mcpToolFailure('domain_url is not supported for event aggregate creation.', 400);
          if (!event || !tenant_id || expected_definition_revision === undefined) {
            return mcpToolFailure('tenant_id, expected_definition_revision, and event details are required for an event schema.', 400);
          }
          const parsed = parseEventPageCreateInput({ tenant_id, expected_definition_revision, name, slug, content, event });
          if (!parsed.ok) return mcpToolFailure(parsed.error, 400);
          try {
            const aggregate = await createEventPageAggregate(supabase, schema, parsed.value) as { event_id: string; page_id: string; page_slug: string; page_status: string };
            const { data: tenant } = schema.tenant_id
              ? await supabase.from('tenants').select('slug').eq('id', schema.tenant_id).maybeSingle()
              : { data: null };
            const cmsPath = tenant?.slug
              ? `/pages/schema/${encodeURIComponent(tenant.slug)}/${encodeURIComponent(schema.slug)}`
              : `/pages/schema/${encodeURIComponent(schema.api_slug)}`;
            return { content: [{ type: 'text' as const, text: JSON.stringify({
              success: true,
              event: { id: aggregate.event_id, tenant_id: schema.tenant_id, page_id: aggregate.page_id },
              page: { id: aggregate.page_id, slug: aggregate.page_slug, name, status: aggregate.page_status, schema_id: schema.id, tenant_id: schema.tenant_id, content },
              editor_url: `${baseUrl}${cmsPath}/edit/${aggregate.page_id}`,
              next_step: 'Open the event page in PageBuilder, complete schema-required content, then explicitly publish it.',
            }, null, 2) }] };
          } catch (error) {
            if (error instanceof EventPageAggregateError) return mcpToolFailure(error.message, error.status, error.code ? { code: error.code } : {});
            return mcpToolFailure(error instanceof Error ? error.message : 'Event page creation failed.', 500);
          }
        }
        if (schema.entity_kind === 'service-product') {
          return mcpToolFailure('Use specy_products_create for service-product schemas.', 409, { code: 'aggregate_operation_required' });
        }
        if (schema.entity_kind && schema.entity_kind !== 'page') {
          return mcpToolFailure(`Unsupported page entity kind: ${schema.entity_kind}.`, 409, { code: 'aggregate_operation_required' });
        }
        if (tenant_id && tenant_id !== schema.tenant_id) return mcpToolFailure('Page tenant must match the owning schema tenant.', 409);

        const requestedSlug = normalizeSchemaPageSlug(slug || name);
        let uniqueSlug = requestedSlug;
        for (let suffix = 2; suffix <= 100; suffix += 1) {
          const { data: matches, error } = await supabase.from('pages').select('id').eq('slug', uniqueSlug).limit(1);
          if (error) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: error.message }, null, 2) }] };
          if (!matches?.length) break;
          uniqueSlug = `${requestedSlug}-${suffix}`;
        }

        const pageInsert: Record<string, unknown> = {
          name,
          slug: uniqueSlug,
          content,
          status: status ?? 'draft',
          schema_id: schema.id,
          ...(domain_url !== undefined ? { domain_url } : {}),
        };
        if (schema.tenant_id) pageInsert.tenant_id = schema.tenant_id;
        const { data: page, error } = await supabase
          .from('pages')
          .insert(pageInsert)
          .select('id, slug, name, status, is_draft, content, schema_id, tenant_id, domain_url, updated_at, published_at')
          .single();
        if (error || !page) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: error?.message || 'Failed to create page.' }, null, 2) }] };
        return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, page }, null, 2) }] };
      },
    );

    server.tool(
      'specy_pages_schemas_update_page',
      '[specy-pages > schemas > pages] Edit page content or system fields. Event pages use the event aggregate and require explicit tenant/schema/page revisions; schema linkage and tenant ownership cannot be reassigned.',
      {
        schema_slug: z.string().min(1).describe('Stable schema API slug (api_slug)'),
        page_id: z.string().uuid().describe('Page UUID from the schema page list'),
        content: z.record(z.string(), z.unknown()).optional().describe('Full replacement JSON content. Existing keys are not normalized or filtered.'),
        name: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        status: z.enum(['draft', 'published', 'archived']).optional(),
        domain_url: z.string().max(2048).nullable().optional(),
        tenant_id: z.string().uuid().optional().describe('Required for event pages.'),
        expected_definition_revision: z.number().int().min(1).optional().describe('Required for event pages.'),
        expected_page_updated_at: z.string().min(1).optional().describe('Page updated_at from the latest page read; required for event pages.'),
      },
      async ({ schema_slug, page_id, content, name, slug, status, domain_url, tenant_id, expected_definition_revision, expected_page_updated_at }) => {
        const { data: schema } = await supabase.from('page_schemas').select('id, tenant_id, entity_kind, definition_revision').eq('api_slug', schema_slug).single();
        if (!schema) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Schema "${schema_slug}" not found.` }, null, 2) }] };
        if (schema.entity_kind === 'event' || schema.entity_kind === 'service-product') {
          if (!tenant_id || tenant_id !== schema.tenant_id || expected_definition_revision === undefined || !expected_page_updated_at) {
            return mcpToolFailure('Event page updates require matching tenant_id, expected_definition_revision, and expected_page_updated_at.', 400);
          }
          if (domain_url !== undefined) return mcpToolFailure('domain_url is not supported for event pages.', 400);
          try {
            const page = await updateEventPageAggregate(supabase, schema, page_id, {
              tenant_id,
              expected_definition_revision,
              expected_page_updated_at,
              ...(content !== undefined ? { content } : {}),
              ...(name !== undefined ? { name } : {}),
              ...(slug !== undefined ? { slug } : {}),
              ...(status !== undefined ? { status } : {}),
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, page }, null, 2) }] };
          } catch (error) {
            if (error instanceof EventPageAggregateError) return mcpToolFailure(error.message, error.status, error.code ? { code: error.code } : {});
            return mcpToolFailure(error instanceof Error ? error.message : 'Event page update failed.', 500);
          }
        }
        if (schema.entity_kind === 'service-product') {
          return mcpToolFailure('Use specy_products_update/publish for service-product pages.', 409, { code: 'aggregate_operation_required' });
        }
        if (schema.entity_kind && schema.entity_kind !== 'page') {
          return mcpToolFailure(`Unsupported page entity kind: ${schema.entity_kind}.`, 409, { code: 'aggregate_operation_required' });
        }
        const { data: currentPage, error: pageError } = await supabase
          .from('pages')
          .select('id, slug')
          .eq('schema_id', schema.id)
          .eq('id', page_id)
          .single();
        if (pageError || !currentPage) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: pageError?.message || 'Page not found in the requested schema.' }, null, 2) }] };

        const patch: Record<string, unknown> = {};
        if (content !== undefined) patch.content = content;
        if (name !== undefined) patch.name = name;
        if (slug !== undefined) {
          const normalizedSlug = normalizeSchemaPageSlug(slug);
          const { data: duplicate, error } = await supabase.from('pages').select('id').eq('slug', normalizedSlug).neq('id', page_id).limit(1);
          if (error) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: error.message }, null, 2) }] };
          if (duplicate?.length) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Page slug "${normalizedSlug}" is already in use.` }, null, 2) }] };
          patch.slug = normalizedSlug;
        }
        if (status !== undefined) patch.status = status;
        if (domain_url !== undefined) patch.domain_url = domain_url;
        if (Object.keys(patch).length === 0) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Provide at least one page field to update.' }, null, 2) }] };

        const { data: page, error } = await supabase
          .from('pages')
          .update(patch)
          .eq('schema_id', schema.id)
          .eq('id', page_id)
          .select('id, slug, name, status, is_draft, content, schema_id, tenant_id, domain_url, updated_at, published_at')
          .single();
        if (error || !page) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: error?.message || 'Failed to update page.' }, null, 2) }] };
        return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, page }, null, 2) }] };
      },
    );

    server.tool(
      'specy_pages_schemas_update_definition',
      '[specy-pages > schemas] Update the schema definition and non-secret schema metadata using optimistic revision checks. This never rewrites page content.',
      {
        schema_slug: z.string().min(1).describe('Stable schema API identifier (api_slug).'),
        expected_revision: z.number().int().min(1).describe('definition_revision returned by specy_pages_schemas_get.'),
        schema: z.record(z.string(), z.unknown()).optional(),
        editor_config: z.record(z.string(), z.unknown()).optional().describe('Non-executable editor hints.'),
        entity_kind: z.enum(['page', 'service-product', 'event']).optional(),
        allow_reclassification: z.boolean().optional().describe('Must be true to reclassify a schema that already has pages; pages must keep matching aggregates.'),
        expected_page_count: z.number().int().min(0).optional().describe('Caller-confirmed page count; must match the schema for a reclassification.'),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        llm_instructions: z.string().nullable().optional(),
        integration_requirements: z.record(z.string(), z.unknown()).optional(),
        tenant_id: z.string().uuid().nullable().optional(),
        slug: z.string().min(1).optional(),
      },
      async ({ schema_slug, expected_revision, schema, editor_config, entity_kind, allow_reclassification, expected_page_count, name, description, llm_instructions, integration_requirements, tenant_id, slug }) => {
        const patch = {
          expected_revision,
          ...(schema !== undefined ? { schema } : {}),
          ...(editor_config !== undefined ? { editor_config } : {}),
          ...(entity_kind !== undefined ? { entity_kind } : {}),
          ...(allow_reclassification !== undefined ? { allow_reclassification } : {}),
          ...(expected_page_count !== undefined ? { expected_page_count } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(llm_instructions !== undefined ? { llm_instructions } : {}),
          ...(integration_requirements !== undefined ? { integration_requirements } : {}),
          ...(tenant_id !== undefined ? { tenant_id } : {}),
          ...(slug !== undefined ? { slug } : {}),
        };
        const parsed = parseSchemaDefinitionPatch(patch);
        if (!parsed.ok) return mcpToolFailure(parsed.error, 400);
        const result = await updateSchemaDefinition(supabase, schema_slug, parsed.patch);
        if (result.status !== 200) {
          return mcpToolFailure(
            String(result.body.error || `Schema definition update failed (${result.status}).`),
            result.status,
            result.body.code ? { code: result.body.code } : {},
          );
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result.body, null, 2) }] };
      },
    );

    server.tool(
      'specy_pages_schemas_update_system_data',
      '[specy-pages > schemas] Correct non-secret schema integration settings such as frontend_url. This does not change page content or the schema definition.',
      {
        schema_slug: z.string().min(1).describe('Stable api_slug, or a tenant-local schema slug when it resolves to exactly one schema visible to you.'),
        frontend_url: z.string().url().optional().describe('Correct frontend URL origin. Use the explicit unhook workflow to disconnect a frontend.'),
        slug_structure: z.string().optional().describe('Legacy detail route template containing exactly one :slug token.'),
        revalidation_endpoint: z.string().nullable().optional().describe('Strict relative revalidation path, such as /api/revalidate.'),
      },
      async ({ schema_slug, frontend_url, slug_structure, revalidation_endpoint }) => {
        const schemaProjection = 'id, api_slug, slug, tenant_id, integration_requirements';
        const { data: apiMatch, error: apiMatchError } = await supabase
          .from('page_schemas')
          .select(schemaProjection)
          .eq('api_slug', schema_slug)
          .maybeSingle();
        if (apiMatchError) return mcpToolFailure(`Could not resolve schema "${schema_slug}": ${apiMatchError.message}`, 500);

        let resolvedSchema = apiMatch;
        if (!resolvedSchema) {
          const { data: localMatches, error: localMatchError } = await supabase
            .from('page_schemas')
            .select(schemaProjection)
            .eq('slug', schema_slug)
            .limit(2);
          if (localMatchError) return mcpToolFailure(`Could not resolve schema "${schema_slug}": ${localMatchError.message}`, 500);
          if (!localMatches?.length) {
            return mcpToolFailure(
              `Schema "${schema_slug}" was not found. Use the api_slug from specy_pages_schemas_list; a tenant-local slug is accepted only when it is unambiguous.`,
              404,
            );
          }
          if (localMatches.length > 1) {
            const candidates = localMatches.map((candidate) => ({ api_slug: candidate.api_slug, tenant_id: candidate.tenant_id }));
            return mcpToolFailure(
              `Schema slug "${schema_slug}" is ambiguous across visible workspaces. Retry with one of the api_slug values in candidates.`,
              409,
              { candidates },
            );
          }
          resolvedSchema = localMatches[0];
        }

        const patch = {
          ...(frontend_url !== undefined ? { frontend_url } : {}),
          ...(slug_structure !== undefined ? { slug_structure } : {}),
          ...(revalidation_endpoint !== undefined ? { revalidation_endpoint } : {}),
        };
        const validation = validateSchemaSystemDataPatch(patch, resolvedSchema.integration_requirements);
        if (!validation.ok) return mcpToolFailure(validation.error, 400);

        const { data: updatedSchema, error: updateError } = await supabase
          .from('page_schemas')
          .update(validation.patch)
          .eq('id', resolvedSchema.id)
          .select('id, slug, api_slug, registration_status, frontend_url, revalidation_endpoint, slug_structure, integration_requirements, content_scope, page_target, updated_at')
          .single();
        if (updateError || !updatedSchema) {
          const status = updateError?.code === '42501' || updateError?.code === 'PGRST116' ? 403 : 500;
          const message = status === 403
            ? 'Schema system-data update was denied or the schema is no longer accessible. Verify the caller has edit access to this schema.'
            : updateError?.message || 'Schema system-data update failed.';
          return mcpToolFailure(message, status);
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              schema: { ...updatedSchema, slug: updatedSchema.api_slug, schema_slug: updatedSchema.slug },
              updated_fields: Object.keys(validation.patch),
            }, null, 2),
          }],
        };
      },
    );

    server.tool(
      'specy_pages_schemas_replace_frontend_targets',
      '[specy-pages > schemas] Replace a schema frontend target registry after correcting collection or detail route metadata.',
      {
        schema_slug: z.string().min(1).describe('Stable schema API slug (api_slug)'),
        targets: z.array(z.object({
          target_key: z.string(),
          kind: z.enum(['collection-slot', 'detail-page']),
          host_path: z.string(),
          placement_key: z.string().nullable().optional(),
          supports_preview: z.boolean().optional(),
          is_primary: z.boolean().optional(),
          sort_order: z.number().int().optional(),
          enabled: z.boolean().optional(),
        })).describe('Complete replacement target list; use server paths, never browser fragments.'),
      },
      async ({ schema_slug, targets }) => {
        try {
          const response = await fetch(`${baseUrl}/api/schemas/${encodeURIComponent(schema_slug)}/frontend-targets`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ targets }),
          });
          const result = await response.json().catch(() => ({})) as Record<string, unknown>;
          if (!response.ok) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error || `Frontend-target update failed (${response.status}).` }, null, 2) }] };
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: error instanceof Error ? error.message : 'Frontend-target update failed.' }, null, 2) }] };
        }
      },
    );
  }

  // ── Tool: list_schemas ──────────────────────────────────────────────────
  server.tool(
    'list_available_tools',
    'List all published MCP entries visible to the current caller. Public entries are always listed. Closed entries require a valid Supabase JWT.',
    {},
    async () => {
      const specs = await listRegistryMcpSpecs(env, { includeClosed });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            specs: specs.map((spec) => ({
              slug: spec.slug,
              name: spec.name,
              description: spec.description,
              discovery_scope: spec.discovery_scope,
              access_scope: spec.access_scope,
              schema: spec.schema,
              is_main: spec.is_main,
              detail_url: `${baseUrl}/api/specs/${spec.slug}`,
            })),
            total: specs.length,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'get_spec_definition',
    'Get the full JSON definition for a published MCP entry by slug. Closed entries require a valid Supabase JWT.',
    { slug: z.string().describe('The spec slug to resolve') },
    async ({ slug }) => {
      const spec = await getDiscoverableSpecBySlug(env, slug, { includeClosed });

      if (!spec) {
        return { content: [{ type: 'text' as const, text: `Spec "${slug}" not found.` }] };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ spec }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'list_schemas',
    'List all available page schemas. Returns the stable API slug plus the tenant-local schema_slug, status, and integration URLs.',
    {},
    async () => {
      const { data, error } = await supabase
        .from('page_schemas')
        .select('slug, api_slug, tenant_id, tenants:tenant_id(slug), name, description, registration_status, is_default, frontend_url, slug_structure, integration_requirements, content_scope, page_target, entity_kind, definition_revision, editor_config, created_at, updated_at')
        .order('is_default', { ascending: false })
        .order('name', { ascending: true });

      if (error) {
        return { content: [{ type: 'text' as const, text: `Error fetching schemas: ${error.message}` }] };
      }

      const schemas = ((data ?? []) as SchemaListRow[]).map((s) => {
        const tenant = Array.isArray(s.tenants) ? s.tenants[0] : s.tenants;
        return {
          slug: s.api_slug,
          schema_slug: s.slug,
          api_slug: s.api_slug,
          tenant_id: s.tenant_id ?? null,
          tenant_slug: tenant?.slug ?? null,
          name: s.name,
          description: s.description,
          status: s.registration_status,
          is_default: s.is_default,
          frontend_url: s.frontend_url,
          slug_structure: s.slug_structure,
          integration_requirements: normalizeSchemaIntegrationRequirements(s.integration_requirements),
          content_scope: s.content_scope || 'page-collection',
          page_target: s.page_target || null,
          entity_kind: s.entity_kind || 'page',
          definition_revision: s.definition_revision || 1,
          editor_config: s.editor_config || {},
          spec_url: `${baseUrl}/api/schemas/${s.api_slug}/spec.txt`,
          spec_json_url: `${baseUrl}/api/schemas/${s.api_slug}/spec`,
          pages_url: `${baseUrl}/api/schemas/${s.api_slug}/pages`,
          register_url: `${baseUrl}/api/schemas/${s.api_slug}/register`,
        };
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ schemas, total: schemas.length }, null, 2),
        }],
      };
    },
  );

  // ── Tool: get_schema_spec ───────────────────────────────────────────────
  server.tool(
    'get_schema_spec',
    'Get the full LLM-readable specification for a page schema. Includes field definitions, content block types, LLM instructions, and registration info.',
    { slug: z.string().describe('The schema API identifier (api_slug) returned by list_schemas; existing schemas also accept their legacy slug.') },
    async ({ slug }) => {
      const { data: schema, error } = await supabase
        .from('page_schemas')
        .select('*')
        .eq('api_slug', slug)
        .single();

      if (error || !schema) {
        return { content: [{ type: 'text' as const, text: `Schema "${slug}" not found.` }] };
      }

      const { count } = await supabase
        .from('pages')
        .select('*', { count: 'exact', head: true })
        .eq('schema_id', schema.id);

      const targets = await getSchemaFrontendTargets(env, schema.id, authToken ?? undefined);

      const lines: string[] = [
        '='.repeat(60),
        `SCHEMA SPECIFICATION: ${schema.name}`,
        '='.repeat(60),
        '',
        `Name: ${schema.name}`,
        `Slug: ${schema.slug}`,
        `API slug: ${schema.api_slug}`,
        `Status: ${schema.registration_status}`,
        `Entity kind: ${schema.entity_kind || 'page'}`,
        `Definition revision: ${schema.definition_revision || 1}`,
        `Editor hints: ${JSON.stringify(schema.editor_config || {})}`,
        `Default: ${schema.is_default ? 'Yes' : 'No'}`,
        `Pages using this schema: ${count ?? 0}`,
        '',
      ];

      if (schema.description) {
        lines.push('--- DESCRIPTION ---', schema.description, '');
      }

      lines.push(
        '--- FRONTEND TARGETS ---',
        '',
        ...(targets.length > 0
          ? targets.map((target) => target.kind === 'collection-slot'
            ? `- ${target.target_key}: collection-slot at ${target.host_path}, placement key ${target.placement_key || '(missing)'}`
            : `- ${target.target_key}: detail-page at ${target.host_path}`)
          : ['No target registry entries yet; legacy slug_structure applies.']),
        'Collection fragments such as #posts are frontend-local and must not be registered or revalidated.',
        '',
        '--- SCHEMA DEFINITION ---',
        '',
        JSON.stringify(schema.schema, null, 2),
        '',
        '--- CONTENT BLOCK TYPES ---',
        '',
        'ContentBlock is a union type. Each block has { id: string, type: string } plus:',
        '  text:    { content: string }',
        '  heading: { content: string, level: "heading1" | ... | "heading6" }',
        '  image:   { src: string, alt: string, caption?: string, width?: number, height?: number }',
        '  quote:   { text: string, author?: string, source?: string }',
        '  list:    { style: "ordered" | "unordered", items: string[] }',
        '  video:   { src: string, provider: "youtube" | "vimeo" | "other", caption?: string }',
        '',
      );
      lines.push('Legacy schema type "string[]" is supported as an array of strings; prefer type "array" with an items schema for new definitions.', '');
      if (schema.entity_kind === 'event') {
        lines.push(
          '--- EVENT PUBLIC DELIVERY ---',
          '',
          `GET ${baseUrl}/api/schemas/${schema.api_slug}/pages`,
          `GET ${baseUrl}/api/schemas/${schema.api_slug}/pages/:pageSlug`,
          'Published event pages include relations.event by default with date, time, end_time, duration_minutes, mode, and timezone.',
          'Use ?include=entity,event,product when you also need the event identity and an eligible published product reference.',
          'Operational schedule facts come from the event record, not page content. Private company, meeting URL, staff, status, and compensation fields are never returned.',
          '',
        );
      }

      if (schema.llm_instructions) {
        lines.push('--- LLM INSTRUCTIONS ---', '', schema.llm_instructions, '');
      }

      if (schema.frontend_url) {
        lines.push(
          '--- FRONTEND INFO ---',
          `Frontend URL: ${schema.frontend_url}`,
          `Revalidation Endpoint: ${schema.revalidation_endpoint || 'Not configured'}`,
          '',
        );
      }

      if (schema.registration_status === 'waiting' && schema.registration_code) {
        lines.push(
          '--- REGISTRATION ---',
          `Registration Code: ${schema.registration_code}`,
          `Register at: POST ${baseUrl}/api/schemas/${slug}/register`,
          '',
          'Body (JSON):',
          JSON.stringify({
            code: schema.registration_code,
            frontend_url: normalizeSchemaIntegrationRequirements(schema.integration_requirements).canonical_frontend_url || 'https://your-frontend.com',
            revalidation_endpoint: '/api/revalidate',
            revalidation_secret: 'REQUIRED_GENERATE_A_STRONG_RANDOM_SECRET',
            ...(targets.length > 0
              ? { targets: targets.map((target) => ({
                target_key: target.target_key,
                kind: target.kind,
                host_path: target.host_path,
                ...(target.kind === 'collection-slot' ? { placement_key: target.placement_key } : {}),
              })) }
              : { slug_structure: normalizeSchemaIntegrationRequirements(schema.integration_requirements).required_slug_structure || schema.slug_structure || '/:slug' }),
          }, null, 2),
          '',
        );
      }

      lines.push('='.repeat(60));

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );

  // ── Tool: list_objects ─────────────────────────────────────────────────
  server.tool(
    'list_objects',
    'List available Objects. A detail_url is returned only when the Object is anonymously readable; Objects are the dynamic API stream, separate from Pages and their revalidation lifecycle.',
    {},
    async () => {
      let query = supabase
        .from('objects')
        .select('id, name, slug, description, status, requires_auth, api_enabled, updated_at')
        .neq('status', 'archived');

      // Without auth, only show public objects. With auth, rely on RLS for tenant/user scoping.
      if (!authToken) {
        query = query
          .eq('status', 'published')
          .eq('api_enabled', true)
          .eq('requires_auth', false);
      }

      const { data, error } = await query.order('updated_at', { ascending: false });

      if (error) {
        return { content: [{ type: 'text' as const, text: `Error fetching objects: ${error.message}` }] };
      }

      const objectsMap = (data ?? []).map((o) => {
        const publiclyReadable = isPublicObjectReadable(o);
        return {
          id: o.id,
          name: o.name,
          slug: o.slug,
          description: o.description,
          status: o.status,
          requires_auth: o.requires_auth,
          api_enabled: o.api_enabled,
          publicly_readable: publiclyReadable,
          updated_at: o.updated_at,
          ...(publiclyReadable ? { detail_url: `${baseUrl}/api/objects/${encodeURIComponent(o.slug)}` } : {}),
        };
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ objects: objectsMap, total: objectsMap.length }, null, 2),
        }],
      };
    },
  );

  // ── Tool: get_object ───────────────────────────────────────────────────
  server.tool(
    'get_object',
    'Get the current dynamic Object data and schema by slug or UUID. Generated Product Objects include current operational Event facts; Page editorial content is read through Pages tools/API.',
    { idOrSlug: z.string().describe('The object slug or UUID') },
    async ({ idOrSlug }) => {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);

      let query = supabase
        .from('objects')
        .select('id, name, slug, description, schema, data, status, requires_auth, api_enabled, share_enabled, share_slug, updated_at')
        .neq('status', 'archived');

      if (!authToken) {
        query = query
          .eq('status', 'published')
          .eq('api_enabled', true)
          .eq('requires_auth', false);
      }

      query = isUuid ? query.eq('id', idOrSlug) : query.eq('slug', idOrSlug);

      const { data: rows, error } = await query.single();

      if (error || !rows) {
        return { content: [{ type: 'text' as const, text: `Object "${idOrSlug}" not found or error: ${error?.message}` }] };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            id: rows.id,
            name: rows.name,
            slug: rows.slug,
            description: rows.description,
            schema: rows.schema,
            data: rows.data,
            updated_at: rows.updated_at,
          }, null, 2),
        }],
      };
    },
  );

  // ── Tool: register_frontend ─────────────────────────────────────────────
  if (isAuthenticated) server.tool(
    'register_frontend',
    'Register a deployed frontend with a schema. Requires the registration code from the CMS and the frontend domain URL.',
    {
      slug: z.string().describe('The schema API identifier (api_slug) returned by list_schemas/create_schema'),
      code: z.string().describe('The registration code shown in the CMS'),
      frontend_url: z.string().url().describe('The deployed frontend URL (e.g. https://my-site.com)'),
      revalidation_endpoint: z.string().optional().describe('Path for ISR revalidation (e.g. /api/revalidate)'),
      revalidation_secret: z.string().min(1).describe('REQUIRED shared secret for authenticating ISR revalidation requests. Generate a strong random secret and send it with every registration.'),
      slug_structure: z.string().optional().describe('URL pattern for pages (default: /:slug)'),
      targets: z.array(z.object({
        target_key: z.string(),
        kind: z.enum(['collection-slot', 'detail-page']),
        host_path: z.string(),
        placement_key: z.string().nullable().optional(),
        supports_preview: z.boolean().optional(),
        is_primary: z.boolean().optional(),
        sort_order: z.number().int().optional(),
        enabled: z.boolean().optional(),
      })).optional().describe('Frontend collection-slot and optional detail-page targets'),
    },
    async ({ slug, code, frontend_url, revalidation_endpoint, revalidation_secret, slug_structure, targets }) => {
      if (!revalidation_secret?.trim()) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Missing required field: revalidation_secret',
              instruction: 'Generate a strong random secret, include it in register_frontend, and configure the same value in the deployed frontend revalidation endpoint.',
            }, null, 2),
          }],
        };
      }

      const result = await completeSchemaRegistration(env, slug, {
        code,
        frontend_url,
        revalidation_endpoint,
        revalidation_secret,
        slug_structure,
        targets: targets as SchemaFrontendTargetInput[] | undefined,
      }, authToken ?? undefined);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ status: result.status, ...result.body }, null, 2) }],
      };
    },
  );

  // ── Tool: check_health ──────────────────────────────────────────────────
  server.tool(
    'check_health',
    'Check the health/reachability of a registered frontend domain.',
    { url: z.string().url().describe('The frontend URL to health-check') },
    async ({ url }) => {
      const validatedUrl = validateOutboundHttpUrl(url);
      if (!validatedUrl.ok) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: validatedUrl.error }, null, 2) }],
        };
      }

      const start = Date.now();
      try {
        const response = await fetch(validatedUrl.url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000),
        });
        const latency = Date.now() - start;
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: response.ok ? 'online' : 'offline',
              latency_ms: latency,
              http_status: response.status,
              url: validatedUrl.url.toString(),
            }, null, 2),
          }],
        };
      } catch {
        const latency = Date.now() - start;
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: 'offline',
              latency_ms: latency,
              reason: 'Connection failed or timed out',
              url: validatedUrl.url.toString(),
            }, null, 2),
          }],
        };
      }
    },
  );

  const exposedSpecs = await listRegistryMcpSpecs(env, { includeClosed });
  const registeredToolNames = new Set<string>(BUILT_IN_MCP_TOOLS);

  exposedSpecs.forEach((spec) => {
    if (registeredToolNames.has(spec.slug)) {
      return;
    }

    registeredToolNames.add(spec.slug);
    server.tool(
      spec.slug,
      buildSpecToolDescription(spec),
      {},
      async () => ({
        content: [{
          type: 'text' as const,
          text: JSON.stringify(buildSpecToolPayload(spec, baseUrl), null, 2),
        }],
      }),
    );
  });

  await registerPluginMcpTools({
    env,
    server,
    baseUrl,
    auth: authSession,
    includeClosed,
    registeredToolNames,
  });

  return server;
}

async function buildNewSchemaHandler(
  env: Env,
  baseUrl: string,
  authToken: string | null,
) {
  return async ({
    name,
    slug,
    description,
    schema,
    entity_kind,
    editor_config,
    llm_instructions,
    integration_requirements,
    tenant_id,
  }: {
    name: string;
    slug?: string;
    description?: string;
    schema: Record<string, unknown>;
    entity_kind?: 'page' | 'service-product' | 'event';
    editor_config?: Record<string, unknown>;
    llm_instructions?: string;
    integration_requirements?: Record<string, unknown>;
    tenant_id?: string;
  }) => {
    if (!authToken) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            ...JSON.parse(serializeMcpError('AUTHENTICATION_REQUIRED', 'Authentication required. create_schema only works with a valid OAuth 2.1 bearer token.')),
            how_to_authenticate: {
              mode: 'MCP client-managed OAuth 2.1',
              note: 'Do not call authorize or ask the user to copy a code. The MCP client must handle the 401 challenge, open the browser, complete PKCE and consent, store the token, reconnect, and retry create_schema.',
              retry: 'After OAuth completes, reconnect to /mcp or retry this request with Authorization: Bearer <access_token>.',
            },
          }, null, 2),
        }],
      };
    }

    try {
      const contentContract = validateSchemaContentContract({
        content_scope: integration_requirements?.content_scope as SchemaContentContractInput['content_scope'] ?? 'page-collection',
        page_target: integration_requirements?.page_target as SchemaContentContractInput['page_target'] ?? null,
      });
      if (!contentContract.ok) {
        return { content: [{ type: 'text' as const, text: serializeMcpError('SCHEMA_REGISTRATION_STATE_INVALID', contentContract.error) }] };
      }

      const result = await createPendingSchema(env, authToken, {
        name,
        slug,
        description: description ?? null,
        schema,
        llm_instructions: llm_instructions ?? null,
        integration_requirements: (integration_requirements ?? null) as Record<string, unknown> | null,
        content_scope: contentContract.contract.content_scope,
        page_target: contentContract.contract.page_target,
        entity_kind,
        editor_config,
        tenant_id,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            message: 'Pending schema created. Start registration through the authenticated MCP workflow before calling register_frontend.',
            schema: {
              id: result.schema.id,
              slug: result.schema.api_slug,
              schema_slug: result.schema.slug,
              api_slug: result.schema.api_slug,
              tenant_id: result.schema.tenant_id,
              tenant_slug: result.schema.tenant_slug ?? null,
              name: result.schema.name,
              description: result.schema.description,
              registration_status: result.schema.registration_status,
              registration_code: result.schema.registration_code,
              content_scope: contentContract.contract.content_scope,
              page_target: contentContract.contract.page_target,
              entity_kind: result.schema.entity_kind,
              definition_revision: result.schema.definition_revision,
              editor_config: result.schema.editor_config,
              cms_url: result.schema.tenant_slug
                ? `${baseUrl}/pages/schema/${result.schema.tenant_slug}/${result.schema.slug}`
                : `${baseUrl}/pages/schema/${result.schema.api_slug}`,
              spec_text_url: `${baseUrl}/api/schemas/${result.schema.api_slug}/spec.txt`,
              spec_json_url: `${baseUrl}/api/schemas/${result.schema.api_slug}/spec`,
            },
            main_spec: result.mainSpec,
            created_main_spec: result.createdMainSpec,
            next_step: 'Call start_schema_registration to generate a registration code before calling register_frontend.',
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to create schema.' }, null, 2),
        }],
      };
    }
  };
}

mcpRoute.all('/', async (c) => {
  const { publicUrl: baseUrl } = await getPublicUrlConfig(c.env, new URL(c.req.url).origin);
  const authSession = await getOptionalAuthSession(c);
  if (authSession instanceof Response) {
    return authSession;
  }

  // MCP clients must initiate OAuth through the standard protected-resource
  // challenge. Do not create an anonymous POST session: doing so exposes only
  // public tools and leaves clients unable to discover that authentication is
  // required for schema/page mutations. Public REST/discovery endpoints remain
  // available without authentication.
  if (!authSession && c.req.method === 'POST') {
    return unauthorizedWithChallenge(c, 'Authentication required for MCP. Follow the OAuth 2.1 protected-resource challenge.');
  }

  const includeClosed = Boolean(authSession?.token);

  // Browsers/REST clients hitting GET /mcp without SSE headers
  if (c.req.method === 'GET' && !c.req.header('accept')?.includes('text/event-stream')) {
    const exposedSpecs = await listRegistryMcpSpecs(c.env, { includeClosed });
    const publicBuiltInTools = BUILT_IN_MCP_TOOLS.filter((tool) => !AUTHENTICATED_MCP_TOOLS.has(tool));
    const toolNames = Array.from(new Set([
      ...publicBuiltInTools,
      ...(authSession ? AUTHENTICATED_MCP_TOOLS : []),
      ...exposedSpecs.map((spec) => spec.slug),
    ]));

    return c.json({
      service: 'specy-mcp',
      name: 'specy',
      version: '1.0.0',
      protocol: 'MCP (Model Context Protocol)',
      transport: 'Streamable HTTP',
      endpoint: `${baseUrl}/mcp`,
      discovery_url: `${baseUrl}/.well-known/mcp.json`,
      oauth: {
        flow: 'OAuth 2.1 Authorization Code + PKCE',
        resource_metadata_url: `${baseUrl}/.well-known/oauth-protected-resource`,
      },
      status: 'active',
      description: 'This is the Specy MCP endpoint. Published public MCP entries are visible without auth. Closed MCP entries require a valid OAuth 2.1 bearer token in the Authorization header (obtain one via the authorization server advertised in the resource metadata).',
      methods: {
        post: 'Send JSON-RPC MCP requests to this endpoint.',
        get: 'Open an optional SSE stream or fetch this discovery payload.',
      },
      tools: toolNames,
    });
  }

  const transport = new StreamableHTTPTransport();
  const mcpServer = await createMcpServerWithTools(c.env, baseUrl, includeClosed, authSession);
  await mcpServer.connect(transport);

  return transport.handleRequest(c);
});

export default mcpRoute;
