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
import { getOptionalAuthSession, getRolesFromToken } from '../lib/auth';
import {
  getDiscoverableSpecBySlug,
  listRegistryMcpSpecs,
  type DiscoverableSpecSummary,
} from '../lib/specRegistry';

const mcpRoute = new Hono<{ Bindings: Env }>();

const BUILT_IN_MCP_TOOLS = [
  'start_here',
  'login',
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

interface SchemaListRow {
  slug: string;
  name: string;
  description: string | null;
  registration_status: string | null;
  is_default: boolean | null;
  frontend_url: string | null;
  slug_structure?: string | null;
  integration_requirements?: Record<string, unknown> | null;
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
    canonical_frontend_url: z.string().optional(),
    required_slug_structure: z.string().optional(),
    route_base_path: z.string().optional(),
    route_ownership: z.enum(['isolated', 'shared-layout-only', 'may-modify-existing']).optional(),
    allow_temporary_frontend_urls: z.boolean().optional(),
    page_discovery_mode: z.enum(['schema-scoped-api', 'supabase-by-schema', 'infer-content-shape']).optional(),
    schema_identification_hint: z.string().optional(),
    registration_notes: z.string().optional(),
  }).optional().describe('Optional schema routing and integration requirements'),
};

async function createMcpServerWithTools(env: Env, baseUrl: string, includeClosed: boolean, authToken: string | null) {
  const server = new McpServer({
    name: 'specy',
    version: '1.0.0',
  });

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
          purpose: 'Specy is a CMS and MCP server for schema-driven website generation and frontend registration workflows.',
          workflow: [
            '1. Call start_here to understand the system and available workflow tools.',
            '2. Call list_schemas or get_schema_spec to inspect existing schema patterns and requirements.',
            '3. If you need a private MCP entry or creation tools, call login with dedicated agent credentials to obtain a Supabase JWT.',
            '4. Design a compliant page schema from the user request and create it with new_schema. This creates an unassigned pending schema without a registration code.',
            '5. Ask the user to review the schema in the CMS and click Register to start the registration process and generate a registration code.',
            '6. Call get_schema_spec for the created schema, build the frontend, then call register_frontend with the generated registration code and ISR settings.',
            '7. Optionally call check_health to confirm the registered frontend is reachable.',
          ],
          auth_model: {
            public_tools: ['start_here', 'list_schemas', 'get_schema_spec', 'register_frontend', 'check_health', 'login'],
            authenticated_tools: ['new_schema', 'closed MCP entries'],
            closed_tool_access: 'Use Authorization: Bearer <supabase-jwt> on subsequent MCP requests after login.',
          },
          important_notes: [
            'new_schema intentionally creates schemas in pending state with no registration code.',
            'The user must explicitly start registration in the frontend to generate a registration code.',
            'Published public MCP entries are visible without auth; published closed entries require a valid Supabase JWT.',
          ],
        }, null, 2),
      }],
    }),
  );

  server.tool(
    'login',
    'Sign in with Specy user credentials and return a Supabase JWT that can be used on subsequent MCP requests for authenticated tools.',
    {
      email: z.string().email().describe('Account email address'),
      password: z.string().min(1).describe('Account password'),
    },
    async ({ email, password }) => {
      const authClient = await createSupabaseClient(env);
      const { data, error } = await authClient.auth.signInWithPassword({ email, password });

      if (error || !data.session || !data.user) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: error?.message || 'Login failed.' }, null, 2) }],
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            message: 'Login successful. Use the returned access_token as Authorization: Bearer <token> on future MCP requests.',
            session: {
              access_token: data.session.access_token,
              refresh_token: data.session.refresh_token,
              token_type: data.session.token_type,
              expires_at: data.session.expires_at,
              expires_in: data.session.expires_in,
            },
            user: {
              id: data.user.id,
              email: data.user.email,
              roles: getRolesFromToken(data.session.access_token),
            },
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'new_schema',
    'Create a new unassigned pending schema from an agent-produced schema definition. Requires a valid Supabase JWT on the MCP request.',
    newSchemaToolSchema,
    await buildNewSchemaHandler(env, baseUrl, authToken),
  );

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
        .select('slug, name, description, registration_status, is_default, frontend_url, slug_structure, integration_requirements, created_at, updated_at')
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
            revalidation_secret: 'your-shared-secret',
            slug_structure: normalizeSchemaIntegrationRequirements(schema.integration_requirements).required_slug_structure || schema.slug_structure || '/:slug',
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
  server.tool(
    'register_frontend',
    'Register a deployed frontend with a schema. Requires the registration code from the CMS and the frontend domain URL.',
    {
      slug: z.string().describe('The schema slug to register against'),
      code: z.string().describe('The registration code shown in the CMS'),
      frontend_url: z.string().url().describe('The deployed frontend URL (e.g. https://my-site.com)'),
      revalidation_endpoint: z.string().optional().describe('Path for ISR revalidation (e.g. /api/revalidate)'),
      revalidation_secret: z.string().optional().describe('Shared secret for revalidation requests'),
      slug_structure: z.string().optional().describe('URL pattern for pages (default: /:slug)'),
    },
    async ({ slug, code, frontend_url, revalidation_endpoint, revalidation_secret, slug_structure }) => {
      const { data: schema, error } = await supabase
        .from('page_schemas')
        .select('id, slug, registration_code, registration_status, revalidation_secret_name, slug_structure, integration_requirements')
        .eq('slug', slug)
        .single();

      if (error || !schema) {
        return { content: [{ type: 'text' as const, text: `Schema "${slug}" not found.` }] };
      }

      if (schema.registration_status !== 'waiting') {
        return { content: [{ type: 'text' as const, text: 'Schema is not awaiting registration.' }] };
      }

      if (schema.registration_code !== code) {
        return { content: [{ type: 'text' as const, text: 'Invalid registration code.' }] };
      }

      const validatedFrontendUrl = validateOutboundHttpUrl(frontend_url);
      if (!validatedFrontendUrl.ok) {
        return { content: [{ type: 'text' as const, text: validatedFrontendUrl.error }] };
      }

      const frontendPolicy = isFrontendUrlAllowed(validatedFrontendUrl.url.origin, schema.integration_requirements);
      if (!frontendPolicy.ok) {
        return { content: [{ type: 'text' as const, text: frontendPolicy.error || 'frontend_url rejected by schema policy.' }] };
      }

      const slugStructureValidation = validateSlugStructure(
        slug_structure || normalizeSchemaIntegrationRequirements(schema.integration_requirements).required_slug_structure || schema.slug_structure || '/:slug',
        schema.integration_requirements,
      );
      if (!slugStructureValidation.ok) {
        return { content: [{ type: 'text' as const, text: slugStructureValidation.error || 'Invalid slug_structure.' }] };
      }

      const secretName = revalidation_secret?.trim()
        ? (schema.revalidation_secret_name || buildRevalidationSecretName(schema.id))
        : schema.revalidation_secret_name;

      if (revalidation_secret?.trim() && secretName) {
        await upsertManagedSecret(env, {
          name: secretName,
          namespace: getRevalidationSecretNamespace(),
          value: revalidation_secret.trim(),
          metadata: {
            schema_id: schema.id,
            schema_slug: schema.slug,
            frontend_url: validatedFrontendUrl.url.origin,
          },
        });
      }

      const admin = await createSupabaseAdminClient(env);
      const { error: updateError } = await admin
        .from('page_schemas')
        .update({
          registration_status: 'registered',
          registration_code: null,
          frontend_url: validatedFrontendUrl.url.origin,
          revalidation_endpoint: revalidation_endpoint?.trim() ? (revalidation_endpoint.startsWith('/') ? revalidation_endpoint : `/${revalidation_endpoint}`) : null,
          revalidation_secret: null,
          revalidation_secret_name: secretName ?? null,
          slug_structure: slugStructureValidation.normalized,
        })
        .eq('id', schema.id);

      if (updateError) {
        return { content: [{ type: 'text' as const, text: `Registration failed: ${updateError.message}` }] };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            message: 'Frontend registered successfully',
            schema: { slug, frontend_url: validatedFrontendUrl.url.origin, slug_structure: slugStructureValidation.normalized },
          }, null, 2),
        }],
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
            error: 'Authentication required. Call login first and resend the MCP request with Authorization: Bearer <access_token>.',
          }, null, 2),
        }],
      };
    }

    try {
      const result = await createPendingSchema(env, authToken, {
        name,
        slug,
        description: description ?? null,
        schema,
        llm_instructions: llm_instructions ?? null,
        integration_requirements: (integration_requirements ?? null) as Record<string, unknown> | null,
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
  const baseUrl = new URL(c.req.url).origin;
  const authSession = await getOptionalAuthSession(c);
  if (authSession instanceof Response) {
    return authSession;
  }

  const includeClosed = Boolean(authSession?.token);

  // Browsers/REST clients hitting GET /mcp without SSE headers
  if (c.req.method === 'GET' && !c.req.header('accept')?.includes('text/event-stream')) {
    const exposedSpecs = await listRegistryMcpSpecs(c.env, { includeClosed });
    const toolNames = Array.from(new Set([
      ...BUILT_IN_MCP_TOOLS,
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
      status: 'active',
      description: 'This is the Specy MCP endpoint. Published public MCP entries are visible without auth. Closed MCP entries require a valid Supabase JWT in the Authorization header.',
      methods: {
        post: 'Send JSON-RPC MCP requests to this endpoint.',
        get: 'Open an optional SSE stream or fetch this discovery payload.',
      },
      tools: toolNames,
    });
  }

  const transport = new StreamableHTTPTransport();
  const mcpServer = await createMcpServerWithTools(c.env, baseUrl, includeClosed, authSession?.token ?? null);
  await mcpServer.connect(transport);

  return transport.handleRequest(c);
});

export default mcpRoute;
