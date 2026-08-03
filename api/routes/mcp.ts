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
import {
  isFrontendUrlAllowed,
  normalizeSchemaIntegrationRequirements,
  validateSlugStructure,
} from '../lib/schemaRouting';
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

const mcpRoute = new Hono<{ Bindings: Env }>();

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
] as const;

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
  name: string;
  description: string | null;
  registration_status: string | null;
  is_default: boolean | null;
  frontend_url: string | null;
  slug_structure?: string | null;
  integration_requirements?: Record<string, unknown> | null;
  content_scope?: 'page-collection' | 'single-page' | null;
  page_target?: Record<string, unknown> | null;
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
  llm_instructions: z.string().optional().describe('Optional LLM instructions for builders and agents'),
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

  server.tool(
    'start_here',
    'Explain what Specy is and outline the ideal agent workflow for creating a schema, building a site, and registering a frontend.',
    {},
    async () => ({
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          service: 'specy',
          workflow_version: '2026-08-01-autonomous-schema-pages-v1',
          purpose: 'Specy is a CMS and MCP server for schema-driven website generation and frontend registration workflows.',
          workflow: [
            '1. Call start_here to understand the system and available workflow tools.',
            '2. Call list_schemas or get_schema_spec to inspect existing schema patterns and requirements.',
            '3. BEFORE attempting any schema, page, registration, or closed-content operation, authenticate this MCP connection. If create_schema, new_schema, start_schema_registration, create_page, or register_frontend are absent from tools/list, the connection is anonymous and you must stop the workflow and ask the MCP client to complete OAuth 2.1 in the browser.',
            '4. After OAuth completes, reconnect or refresh the MCP session and call tools/list again. Do not continue until the authenticated tools are visible.',
            '5. Authenticated tools include create_schema, start_schema_registration, register_frontend, and create_page. Use them to complete the requested workflow.',
            '6. Call create_schema with the blog schema definition. This creates the schema for the authenticated tenant.',
            '7. Call start_schema_registration to generate a registration code without asking the user to use the CMS.',
            '8. Build the frontend from get_schema_spec, then call register_frontend with the generated code and deployed URL.',
            '9. Call create_page to create blog content, then optionally call check_health.',
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
              '6. Confirm that create_schema, start_schema_registration, register_frontend, and create_page are now present before proceeding.',
            ],
            anonymous_tools: ['start_here', 'list_schemas', 'get_schema_spec', 'list_objects', 'get_object', 'check_health', 'list_available_tools', 'get_spec_definition'],
            authenticated_tools: ['create_schema', 'new_schema', 'start_schema_registration', 'register_frontend', 'create_page', 'closed MCP registry tools'],
            stop_condition: 'If the authenticated_tools are not returned by tools/list, do not claim that schema creation or registration is unavailable and do not proceed with a local-only implementation. Report that OAuth has not completed for this MCP connection.',
            legacy_tools: 'No manual OAuth tools are exposed on the normal MCP surface. VS Code, Cursor, Claude Desktop, and standards-compliant MCP clients must use the HTTP 401 challenge and manage OAuth themselves.',
          },
          important_notes: [
            'CRITICAL: The normal MCP surface has no manual authorization-code tools. Let the MCP client manage OAuth automatically.',
            'CRITICAL: An anonymous tools/list is not sufficient for schema work. Authenticate first, then call tools/list again and verify the private tools are present.',
            'new_schema intentionally creates schemas in pending state with no registration code.',
            'The user must explicitly start registration in the frontend to generate a registration code.',
            'Published public MCP entries are visible without auth; published closed entries require a valid OAuth 2.1 bearer token.',
            'Password-based login was removed; normal MCP clients use client-managed OAuth through the HTTP challenge.',
          ],
        }, null, 2),
      }],
    }),
  );

  if (isAuthenticated) {
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
      slug: z.string().min(1).describe('Schema slug'),
      },
      async ({ slug }) => {
      if (!authToken) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Authentication required. Use the MCP client OAuth flow first.' }, null, 2) }] };
      }

      const registrationCode = generateRegistrationCode();
      const { data, error } = await supabase
        .from('page_schemas')
        .update({ registration_code: registrationCode, registration_status: 'waiting' })
        .eq('slug', slug)
        .select('id, slug, name, registration_status, registration_code, integration_requirements, slug_structure')
        .single();

      if (error || !data) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: error?.message || `Schema "${slug}" not found.` }, null, 2) }] };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            schema: data,
            registration: {
              code: registrationCode,
              endpoint: `${baseUrl}/api/schemas/${data.slug}/register`,
              request: {
                slug: data.slug,
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
      'Create a draft page validated against a registered or unregistered page schema. Requires a valid OAuth bearer token.',
      {
      schema_slug: z.string().min(1).describe('Schema slug'),
      name: z.string().min(1).describe('Page display name'),
      slug: z.string().optional().describe('Optional URL slug; generated from name when omitted'),
      content: z.record(z.string(), z.unknown()).describe('Page content matching the schema definition'),
      status: z.enum(['draft', 'published']).optional().describe('Page status; defaults to draft'),
      tenant_id: z.string().uuid().optional().describe('Optional tenant override for a tenant the caller belongs to'),
      },
      async ({ schema_slug, name, slug, content, status, tenant_id }) => {
      if (!authToken) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Authentication required. Use the MCP client OAuth flow first.' }, null, 2) }] };
      }

      const { data: schema, error: schemaError } = await supabase
        .from('page_schemas')
        .select('id, slug, frontend_url, slug_structure, content_scope')
        .eq('slug', schema_slug)
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

      const requestedSlug = (slug || name)
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'page';

      const { data: existing } = await supabase.from('pages').select('id').eq('slug', requestedSlug).limit(1);
      const uniqueSlug = existing && existing.length > 0 ? `${requestedSlug}-${Date.now().toString(36)}` : requestedSlug;

      const pageInsert: Record<string, unknown> = {
          name,
          slug: uniqueSlug,
          content,
          status: status || 'draft',
          schema_id: schema.id,
        };
      if (tenant_id) {
        pageInsert.tenant_id = tenant_id;
      }

      const { data: page, error: pageError } = await supabase
        .from('pages')
        .insert(pageInsert)
        .select('id, slug, name, status, schema_id, tenant_id, domain_url, updated_at, published_at')
        .single();

      if (pageError || !page) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: pageError?.message || 'Failed to create page.' }, null, 2) }] };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            page,
            preview_url: schema.frontend_url ? `${schema.frontend_url}${(schema.slug_structure || '/:slug').replace(':slug', page.slug)}` : null,
            cms_url: `${baseUrl}/pages/schema/${schema.slug}/edit/${page.id}`,
          }, null, 2),
        }],
      };
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
    'List all available page schemas in the CMS. Returns slug, name, description, status, and URLs for each schema.',
    {},
    async () => {
      const { data, error } = await supabase
        .from('page_schemas')
        .select('slug, name, description, registration_status, is_default, frontend_url, slug_structure, integration_requirements, content_scope, page_target, created_at, updated_at')
        .order('is_default', { ascending: false })
        .order('name', { ascending: true });

      if (error) {
        return { content: [{ type: 'text' as const, text: `Error fetching schemas: ${error.message}` }] };
      }

      const schemas = ((data ?? []) as SchemaListRow[]).map((s) => ({
        slug: s.slug,
        name: s.name,
        description: s.description,
        status: s.registration_status,
        is_default: s.is_default,
        frontend_url: s.frontend_url,
        slug_structure: s.slug_structure,
        integration_requirements: normalizeSchemaIntegrationRequirements(s.integration_requirements),
        content_scope: s.content_scope || 'page-collection',
        page_target: s.page_target || null,
        spec_url: `${baseUrl}/api/schemas/${s.slug}/spec.txt`,
        spec_json_url: `${baseUrl}/api/schemas/${s.slug}/spec`,
        pages_url: `${baseUrl}/api/schemas/${s.slug}/pages`,
        register_url: `${baseUrl}/api/schemas/${s.slug}/register`,
      }));

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
    { slug: z.string().describe('The schema slug (e.g. "blog", "service-product")') },
    async ({ slug }) => {
      const { data: schema, error } = await supabase
        .from('page_schemas')
        .select('*')
        .eq('slug', slug)
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
        `Status: ${schema.registration_status}`,
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
    'List all available data objects. Objects are arbitrarily definable JSONB data structures (e.g. price lists, configurations).',
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

      const objectsMap = (data ?? []).map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        description: o.description,
        requires_auth: o.requires_auth,
        updated_at: o.updated_at,
        detail_url: `${baseUrl}/api/objects/${o.slug}`,
      }));

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
    'Get the full data and schema for a specific object by its slug or ID.',
    { idOrSlug: z.string().describe('The object slug or UUID') },
    async ({ idOrSlug }) => {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);

      let query = supabase
        .from('objects')
        .select('*')
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
      slug: z.string().describe('The schema slug to register against'),
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
    llm_instructions,
    integration_requirements,
  }: {
    name: string;
    slug?: string;
    description?: string;
    schema: Record<string, unknown>;
    llm_instructions?: string;
    integration_requirements?: Record<string, unknown>;
  }) => {
    if (!authToken) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: 'Authentication required. create_schema only works with a valid OAuth 2.1 bearer token.',
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
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: contentContract.error }, null, 2) }] };
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
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            message: 'Pending schema created. The user must now review it in the CMS and click Register to generate a registration code.',
            schema: {
              id: result.schema.id,
              slug: result.schema.slug,
              name: result.schema.name,
              description: result.schema.description,
              registration_status: result.schema.registration_status,
              registration_code: result.schema.registration_code,
              content_scope: contentContract.contract.content_scope,
              page_target: contentContract.contract.page_target,
              cms_url: `${baseUrl}/pages/schema/${result.schema.slug}`,
              spec_text_url: `${baseUrl}/api/schemas/${result.schema.slug}/spec.txt`,
              spec_json_url: `${baseUrl}/api/schemas/${result.schema.slug}/spec`,
            },
            main_spec: result.mainSpec,
            created_main_spec: result.createdMainSpec,
            next_step: 'Have the user start registration in the frontend to generate a registration code before calling register_frontend.',
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
    const publicBuiltInTools = BUILT_IN_MCP_TOOLS.filter((tool) => ![
      'create_schema', 'new_schema', 'start_schema_registration', 'create_page', 'register_frontend',
    ].includes(tool));
    const toolNames = Array.from(new Set([
      ...publicBuiltInTools,
      ...(authSession ? ['create_schema', 'start_schema_registration', 'create_page', 'register_frontend'] : []),
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
