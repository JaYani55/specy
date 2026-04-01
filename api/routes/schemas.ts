import { Hono } from 'hono';
import { createSupabaseClient, type Env } from '../lib/supabase';

const schemas = new Hono<{ Bindings: Env }>();

interface SchemaRow {
  slug: string;
  name: string;
  description: string | null;
  registration_status: string | null;
  is_default: boolean | null;
  frontend_url: string | null;
  created_at: string;
  updated_at: string;
}

// GET /api/schemas — Discovery endpoint: list all available schemas
schemas.get('/', async (c) => {
  const supabase = await createSupabaseClient(c.env);

  const { data, error } = await supabase
    .from('page_schemas')
    .select('slug, name, description, registration_status, is_default, frontend_url, created_at, updated_at')
    .order('is_default', { ascending: false })
    .order('name', { ascending: true });

  if (error) {
    return c.json({ error: 'Failed to fetch schemas' }, 500);
  }

  const baseUrl = new URL(c.req.url).origin;

  return c.json({
    service: 'service-cms-api',
    description: 'Available page schemas. Use the spec_url to fetch the full LLM-readable specification for any schema.',
    mcp_endpoint: `${baseUrl}/mcp`,
    schemas: ((data ?? []) as SchemaRow[]).map((s) => ({
      slug: s.slug,
      name: s.name,
      description: s.description,
      status: s.registration_status,
      is_default: s.is_default,
      frontend_url: s.frontend_url,
      spec_url: `${baseUrl}/api/schemas/${s.slug}/spec.txt`,
      register_url: `${baseUrl}/api/schemas/${s.slug}/register`,
      created_at: s.created_at,
      updated_at: s.updated_at,
    })),
  });
});

// GET /api/schemas/:slug/spec.txt — LLM-ready plaintext schema specification
schemas.get('/:slug/spec.txt', async (c) => {
  const slug = c.req.param('slug');
  const supabase = await createSupabaseClient(c.env);

  const { data: schema, error } = await supabase
    .from('page_schemas')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error || !schema) {
    return c.text(`Schema "${slug}" not found.`, 404);
  }

  // Count pages using this schema
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
    `Created: ${schema.created_at}`,
    `Updated: ${schema.updated_at}`,
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
  );

  // Content Block reference
  lines.push(
    '--- CONTENT BLOCK TYPES ---',
    '',
    'ContentBlock is a union type. Each block has { id: string, type: string } plus type-specific fields:',
    '',
    '  text:    { content: string }',
    '  heading: { content: string, level: "heading1" | "heading2" | "heading3" | "heading4" | "heading5" | "heading6" }',
    '  image:   { src: string, alt: string, caption?: string, width?: number, height?: number }',
    '  quote:   { text: string, author?: string, source?: string }',
    '  list:    { style: "ordered" | "unordered", items: string[] }',
    '  video:   { src: string, provider: "youtube" | "vimeo" | "other", caption?: string }',
    '',
    'Block IDs follow the pattern: ${prefix}-${timestamp}-${random}',
    '',
  );

  lines.push(
    '--- CODE BLOCK FIELD TYPE ---',
    '',
    'Schemas may also use the custom field type "CodeBlock[]" for structured code examples.',
    'Each item is typically stored as:',
    '  { id: string, language: string, code: string, label?: string, pattern?: string, frameworks?: string[] }',
    '',
    'The optional items.properties definition can be used to configure placeholders, help text, required flags, and enum options for language, pattern, frameworks, or extra metadata fields.',
    'If frameworks.items.enum is provided, the Page Builder renders a multi-select checkbox group for frameworks.',
    '',
  );

  if (schema.llm_instructions) {
    lines.push('--- LLM INSTRUCTIONS ---', '', schema.llm_instructions, '');
  }

  if (schema.frontend_url) {
    lines.push(
      '--- FRONTEND INFO ---',
      '',
      `Frontend URL: ${schema.frontend_url}`,
      `Slug Structure: ${schema.slug_structure}`,
      `Revalidation Endpoint: ${schema.revalidation_endpoint || 'Not configured'}`,
      '',
    );
  }

  if (schema.registration_status === 'waiting' && schema.registration_code) {
    lines.push(
      '--- REGISTRATION ---',
      '',
      `Registration Code: ${schema.registration_code}`,
      '',
      'To complete schema registration, POST to:',
      `POST /api/schemas/${slug}/register`,
      '',
      'Request body (JSON):',
      JSON.stringify({
        code: schema.registration_code,
        frontend_url: 'https://your-frontend.com',
        revalidation_endpoint: '/api/revalidate',
        revalidation_secret: 'your-shared-secret',
        slug_structure: '/:slug',
      }, null, 2),
      '',
    );
  }

  lines.push('='.repeat(60));

  return c.text(lines.join('\n'), 200);
});

// POST /api/schemas/:slug/register — Frontend registration callback
schemas.post('/:slug/register', async (c) => {
  const slug = c.req.param('slug');
  const supabase = await createSupabaseClient(c.env);

  let body: {
    code: string;
    frontend_url: string;
    revalidation_endpoint?: string;
    revalidation_secret?: string;
    slug_structure?: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.code || !body.frontend_url) {
    return c.json({ error: 'Missing required fields: code, frontend_url' }, 400);
  }

  // Look up the schema and validate code
  const { data: schema, error } = await supabase
    .from('page_schemas')
    .select('id, registration_code, registration_status')
    .eq('slug', slug)
    .single();

  if (error || !schema) {
    return c.json({ error: `Schema "${slug}" not found` }, 404);
  }

  if (schema.registration_status !== 'waiting') {
    return c.json({ error: 'Schema is not awaiting registration' }, 400);
  }

  if (schema.registration_code !== body.code) {
    return c.json({ error: 'Invalid registration code' }, 403);
  }

  // Update schema with frontend information
  const { error: updateError } = await supabase
    .from('page_schemas')
    .update({
      registration_status: 'registered',
      registration_code: null,
      frontend_url: body.frontend_url,
      revalidation_endpoint: body.revalidation_endpoint || null,
      revalidation_secret: body.revalidation_secret || null,
      slug_structure: body.slug_structure || '/:slug',
    })
    .eq('id', schema.id);

  if (updateError) {
    return c.json({ error: 'Failed to complete registration' }, 500);
  }

  return c.json({
    success: true,
    message: 'Schema registration completed successfully',
    schema: {
      slug,
      frontend_url: body.frontend_url,
      slug_structure: body.slug_structure || '/:slug',
    },
  });
});

// POST /api/schemas/:slug/revalidate — Trigger ISR on the registered frontend
schemas.post('/:slug/revalidate', async (c) => {
  const slug = c.req.param('slug');
  const supabase = await createSupabaseClient(c.env);

  let body: { page_slug: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.page_slug) {
    return c.json({ error: 'Missing required field: page_slug' }, 400);
  }

  const { data: schema, error } = await supabase
    .from('page_schemas')
    .select('frontend_url, revalidation_endpoint, revalidation_secret, registration_status')
    .eq('slug', slug)
    .single();

  if (error || !schema) {
    return c.json({ error: `Schema "${slug}" not found` }, 404);
  }

  if (schema.registration_status !== 'registered') {
    return c.json({ error: 'Schema does not have a registered frontend' }, 400);
  }

  if (!schema.frontend_url || !schema.revalidation_endpoint) {
    return c.json({ error: 'Frontend revalidation not configured' }, 400);
  }

  // Build revalidation URL
  const revalidateUrl = new URL(schema.revalidation_endpoint, schema.frontend_url);
  if (schema.revalidation_secret) {
    revalidateUrl.searchParams.set('secret', schema.revalidation_secret);
  }
  revalidateUrl.searchParams.set('path', body.page_slug);

  try {
    const response = await fetch(revalidateUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    return c.json({
      success: response.ok,
      status: response.status,
      message: response.ok ? 'Revalidation triggered successfully' : 'Revalidation request failed',
    });
  } catch (err) {
    return c.json({
      success: false,
      message: 'Failed to reach frontend revalidation endpoint',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default schemas;
