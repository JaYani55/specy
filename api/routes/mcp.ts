import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPTransport } from '@hono/mcp';
import { z } from 'zod';
import { createSupabaseClient, type Env } from '../lib/supabase';
import { createSupabaseAdminClient } from '../lib/supabase';
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
import {
  getDiscoverableSpecBySlug,
  listDiscoverableSpecs,
  listMcpExposedDiscoverableSpecs,
  type DiscoverableSpecSummary,
} from '../lib/specRegistry';

const mcpRoute = new Hono<{ Bindings: Env }>();

const BUILT_IN_MCP_TOOLS = [
  'list_available_tools',
  'get_spec_definition',
  'list_schemas',
  'get_schema_spec',
  'register_frontend',
  'check_health',
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

async function createMcpServerWithTools(env: Env, baseUrl: string) {
  const server = new McpServer({
    name: 'specy',
    version: '1.0.0',
  });

  const supabase = await createSupabaseClient(env);

  // ── Tool: list_schemas ──────────────────────────────────────────────────
  server.tool(
    'list_available_tools',
    'List all published public specs attached to registered schemas. This is the unified discovery surface for agent-readable tools.',
    {},
    async () => {
      const specs = await listDiscoverableSpecs(env);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            specs: specs.map((spec) => ({
              slug: spec.slug,
              name: spec.name,
              description: spec.description,
              discovery_scope: spec.discovery_scope,
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
    'Get the full JSON definition for a discoverable spec by slug.',
    { slug: z.string().describe('The spec slug to resolve') },
    async ({ slug }) => {
      const spec = await getDiscoverableSpecBySlug(env, slug);

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

  const exposedSpecs = await listMcpExposedDiscoverableSpecs(env);
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

// ─── MCP HTTP Transport ─────────────────────────────────────────────────────

let mcpServer: McpServer | null = null;
let transport: StreamableHTTPTransport | null = null;

mcpRoute.all('/', async (c) => {
  const baseUrl = new URL(c.req.url).origin;

  // Browsers/REST clients hitting GET /mcp without SSE headers
  if (c.req.method === 'GET' && !c.req.header('accept')?.includes('text/event-stream')) {
    const exposedSpecs = await listMcpExposedDiscoverableSpecs(c.env);
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
      description: 'This is the Specy MCP endpoint. Connect using an MCP-compatible client over Streamable HTTP and initialize against this URL.',
      methods: {
        post: 'Send JSON-RPC MCP requests to this endpoint.',
        get: 'Open an optional SSE stream or fetch this discovery payload.',
      },
      tools: toolNames,
    });
  }

  if (!transport) {
    transport = new StreamableHTTPTransport();
  }

  if (!mcpServer || !mcpServer.isConnected()) {
    mcpServer = await createMcpServerWithTools(c.env, baseUrl);
    await mcpServer.connect(transport);
  }

  return transport.handleRequest(c);
});

export default mcpRoute;
