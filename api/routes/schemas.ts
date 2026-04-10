import { Hono } from 'hono';
import { createSupabaseClient, type Env } from '../lib/supabase';
import { createSupabaseAdminClient } from '../lib/supabase';
import { requireAppRole } from '../lib/auth';
import { validateOutboundHttpUrl } from '../lib/urlSafety';
import {
  buildRevalidationSecretName,
  deleteManagedSecret,
  getManagedSecretValue,
  upsertManagedSecret,
  getRevalidationSecretNamespace,
} from '../lib/managedSecrets';

const schemas = new Hono<{ Bindings: Env }>();

interface SchemaRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  registration_status: string | null;
  is_default: boolean | null;
  frontend_url: string | null;
  created_at: string;
  updated_at: string;
}

interface SchemaRegistrationPayload {
  code: string;
  frontend_url: string;
  revalidation_endpoint?: string;
  revalidation_secret?: string;
  slug_structure?: string;
}

interface SchemaSecretStatusRow {
  id: string;
  slug: string;
  frontend_url: string | null;
  revalidation_endpoint: string | null;
  revalidation_secret: string | null;
  revalidation_secret_name: string | null;
  registration_status: string;
}

interface SchemaSecretStatusResult {
  schema: SchemaSecretStatusRow | null;
  managementAvailable: boolean;
}

interface SchemaTemplateRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  schema: Record<string, unknown>;
  llm_instructions: string | null;
  source_schema_id: string | null;
  external_source_url: string | null;
  created_at: string;
  updated_at: string;
}

interface SchemaTemplateInput {
  name: string;
  slug?: string;
  description?: string | null;
  icon?: string | null;
  schema: Record<string, unknown>;
  llm_instructions?: string | null;
  source_schema_id?: string | null;
  external_source_url?: string | null;
}

function generateSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'template';
}

async function ensureUniqueTemplateSlug(
  admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
  requestedSlug: string,
): Promise<string> {
  const baseSlug = generateSlug(requestedSlug);
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    const { data, error } = await admin
      .from('page_schema_templates')
      .select('id')
      .eq('slug', candidate)
      .limit(1);

    if (error) {
      throw new Error(error.message);
    }

    if (!data || data.length === 0) {
      return candidate;
    }

    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTemplateInput(payload: unknown): SchemaTemplateInput {
  const raw = isRecord(payload) && isRecord(payload.template) ? payload.template : payload;

  if (!isRecord(raw)) {
    throw new Error('Template payload must be a JSON object.');
  }

  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    throw new Error('Template name is required.');
  }

  if (!isRecord(raw.schema)) {
    throw new Error('Template schema must be a JSON object.');
  }

  return {
    name: raw.name.trim(),
    slug: typeof raw.slug === 'string' && raw.slug.trim() ? raw.slug.trim() : undefined,
    description: typeof raw.description === 'string' ? raw.description.trim() : null,
    icon: typeof raw.icon === 'string' && raw.icon.trim() ? raw.icon.trim() : null,
    schema: raw.schema,
    llm_instructions: typeof raw.llm_instructions === 'string' ? raw.llm_instructions : null,
    source_schema_id: typeof raw.source_schema_id === 'string' && raw.source_schema_id.trim() ? raw.source_schema_id.trim() : null,
    external_source_url: typeof raw.external_source_url === 'string' && raw.external_source_url.trim() ? raw.external_source_url.trim() : null,
  };
}

async function saveSchemaTemplate(
  admin: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
  input: SchemaTemplateInput,
  options?: { preferProvidedSlug?: boolean },
): Promise<SchemaTemplateRow> {
  const slug = options?.preferProvidedSlug && input.slug
    ? generateSlug(input.slug)
    : await ensureUniqueTemplateSlug(admin, input.slug || input.name);

  const { data, error } = await admin
    .from('page_schema_templates')
    .insert({
      name: input.name,
      slug,
      description: input.description ?? null,
      icon: input.icon ?? '🧩',
      schema: input.schema,
      llm_instructions: input.llm_instructions ?? null,
      source_schema_id: input.source_schema_id ?? null,
      external_source_url: input.external_source_url ?? null,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as SchemaTemplateRow;
}

function isManagedSecretUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('SS_SUPABASE_SECRET_KEY is not bound')
    || message.includes('Secret "SUPABASE_SECRET_KEY" not found')
    || message.includes('SECRETS_ENCRYPTION_KEY is not configured');
}

function getManagedSecretUnavailableMessage(): string {
  return 'Revalidation secret management is unavailable in this environment because the Supabase admin secret or managed-secret encryption key is not available.';
}

async function readSchemaSecretStatusWithUserToken(env: Env, slug: string, token: string): Promise<SchemaSecretStatusRow | null> {
  const supabase = await createSupabaseClient(env, token);
  const { data, error } = await supabase
    .from('page_schemas')
    .select('id, slug, frontend_url, revalidation_endpoint, revalidation_secret, revalidation_secret_name, registration_status')
    .eq('slug', slug)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(error.message);
  }

  return data as SchemaSecretStatusRow;
}

async function migrateLegacyRevalidationSecret(env: Env, schema: SchemaSecretStatusRow): Promise<SchemaSecretStatusRow> {
  if (!schema.revalidation_secret || schema.revalidation_secret_name) {
    return schema;
  }

  const secretName = buildRevalidationSecretName(schema.id);
  await upsertManagedSecret(env, {
    name: secretName,
    namespace: getRevalidationSecretNamespace(),
    value: schema.revalidation_secret,
    metadata: {
      schema_id: schema.id,
      schema_slug: schema.slug,
      frontend_url: schema.frontend_url,
    },
  });

  const admin = await createSupabaseAdminClient(env);
  const { error } = await admin
    .from('page_schemas')
    .update({
      revalidation_secret_name: secretName,
      revalidation_secret: null,
    })
    .eq('id', schema.id);

  if (error) {
    throw new Error(error.message);
  }

  return {
    ...schema,
    revalidation_secret: null,
    revalidation_secret_name: secretName,
  };
}

async function completeSchemaRegistration(env: Env, slug: string, body: SchemaRegistrationPayload) {
  const supabase = await createSupabaseClient(env);
  const admin = await createSupabaseAdminClient(env);

  const { data: schema, error } = await supabase
    .from('page_schemas')
    .select('id, slug, registration_code, registration_status, revalidation_secret_name')
    .eq('slug', slug)
    .single();

  if (error || !schema) {
    return { status: 404 as const, body: { error: `Schema "${slug}" not found` } };
  }

  if (schema.registration_status !== 'waiting') {
    return { status: 400 as const, body: { error: 'Schema is not awaiting registration' } };
  }

  if (schema.registration_code !== body.code) {
    return { status: 403 as const, body: { error: 'Invalid registration code' } };
  }

  const revalidationSecretName = body.revalidation_secret?.trim()
    ? (schema.revalidation_secret_name || buildRevalidationSecretName(schema.id))
    : schema.revalidation_secret_name;

  if (body.revalidation_secret?.trim() && revalidationSecretName) {
    await upsertManagedSecret(env, {
      name: revalidationSecretName,
      namespace: getRevalidationSecretNamespace(),
      value: body.revalidation_secret.trim(),
      metadata: {
        schema_id: schema.id,
        schema_slug: schema.slug,
        frontend_url: body.frontend_url,
      },
    });
  }

  const { error: updateError } = await admin
    .from('page_schemas')
    .update({
      registration_status: 'registered',
      registration_code: null,
      frontend_url: body.frontend_url,
      revalidation_endpoint: body.revalidation_endpoint || null,
      revalidation_secret: null,
      revalidation_secret_name: revalidationSecretName ?? null,
      slug_structure: body.slug_structure || '/:slug',
    })
    .eq('id', schema.id);

  if (updateError) {
    return { status: 500 as const, body: { error: 'Failed to complete registration' } };
  }

  return {
    status: 200 as const,
    body: {
      success: true,
      message: 'Schema registration completed successfully',
      schema: {
        slug,
        frontend_url: body.frontend_url,
        slug_structure: body.slug_structure || '/:slug',
      },
    },
  };
}

async function getSchemaSecretStatus(
  env: Env,
  slug: string,
  options?: { token?: string; allowReadonlyFallback?: boolean; migrateLegacy?: boolean },
): Promise<SchemaSecretStatusResult> {
  if (!env.SS_SUPABASE_SECRET_KEY) {
    if (options?.allowReadonlyFallback && options.token) {
      return {
        schema: await readSchemaSecretStatusWithUserToken(env, slug, options.token),
        managementAvailable: false,
      };
    }

    throw new Error('SS_SUPABASE_SECRET_KEY is not bound. Add SUPABASE_SECRET_KEY to your Secrets Store and bind it in wrangler.jsonc.');
  }
  try {
    const admin = await createSupabaseAdminClient(env);
    const { data, error } = await admin
      .from('page_schemas')
      .select('id, slug, frontend_url, revalidation_endpoint, revalidation_secret, revalidation_secret_name, registration_status')
      .eq('slug', slug)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return {
          schema: null,
          managementAvailable: true,
        };
      }
      throw new Error(error.message);
    }

    const row = data as SchemaSecretStatusRow;
    if (options?.migrateLegacy === false || !row.revalidation_secret || row.revalidation_secret_name) {
      return {
        schema: row,
        managementAvailable: true,
      };
    }

    return {
      schema: await migrateLegacyRevalidationSecret(env, row),
      managementAvailable: true,
    };
  } catch (error) {
    if (options?.allowReadonlyFallback && options.token && isManagedSecretUnavailableError(error)) {
      return {
        schema: await readSchemaSecretStatusWithUserToken(env, slug, options.token),
        managementAvailable: false,
      };
    }

    throw error;
  }
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
    service: 'specy-api',
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

schemas.get('/templates', async (c) => {
  const admin = await createSupabaseAdminClient(c.env);
  const { data, error } = await admin
    .from('page_schema_templates')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ templates: (data ?? []) as SchemaTemplateRow[] });
});

schemas.get('/templates/:slug', async (c) => {
  const slug = c.req.param('slug');
  const admin = await createSupabaseAdminClient(c.env);
  const { data, error } = await admin
    .from('page_schema_templates')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error || !data) {
    return c.json({ error: `Template "${slug}" not found` }, 404);
  }

  return c.json({ template: data as SchemaTemplateRow });
});

schemas.post('/templates', async (c) => {
  const auth = await requireAppRole(c, 'admin');
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const admin = await createSupabaseAdminClient(c.env);
    const template = await saveSchemaTemplate(admin, parseTemplateInput(body));
    return c.json({ template }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create template' }, 400);
  }
});

schemas.post('/templates/import', async (c) => {
  const auth = await requireAppRole(c, 'admin');
  if (auth instanceof Response) return auth;

  let body: { url?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.url) {
    return c.json({ error: 'Missing required field: url' }, 400);
  }

  const validated = validateOutboundHttpUrl(body.url);
  if (!validated.ok) {
    return c.json({ error: validated.error }, 400);
  }

  try {
    const response = await fetch(validated.url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return c.json({ error: `Template download failed with status ${response.status}` }, 502);
    }

    const payload = await response.json();
    const admin = await createSupabaseAdminClient(c.env);
    const template = await saveSchemaTemplate(admin, {
      ...parseTemplateInput(payload),
      external_source_url: validated.url.toString(),
    });

    return c.json({ template }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to import template' }, 400);
  }
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

  let body: SchemaRegistrationPayload;

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.code || !body.frontend_url) {
    return c.json({ error: 'Missing required fields: code, frontend_url' }, 400);
  }

  const result = await completeSchemaRegistration(c.env, slug, body);
  return c.json(result.body, result.status);
});

schemas.get('/:slug/revalidation-secret/status', async (c) => {
  const auth = await requireAppRole(c, 'admin');
  if (auth instanceof Response) return auth;

  const slug = c.req.param('slug');
  const { schema, managementAvailable } = await getSchemaSecretStatus(c.env, slug, {
    token: auth.token,
    allowReadonlyFallback: true,
  });

  if (!schema) {
    return c.json({ error: `Schema "${slug}" not found` }, 404);
  }

  return c.json({
    configured: Boolean(schema.revalidation_secret_name || schema.revalidation_secret),
    secret_name: schema.revalidation_secret_name,
    legacy_plaintext: Boolean(schema.revalidation_secret && !schema.revalidation_secret_name),
    registration_status: schema.registration_status,
    frontend_url: schema.frontend_url,
    revalidation_endpoint: schema.revalidation_endpoint,
    management_available: managementAvailable,
    readonly_fallback: !managementAvailable,
    warning: managementAvailable
      ? null
      : getManagedSecretUnavailableMessage(),
  });
});

schemas.put('/:slug/revalidation-secret', async (c) => {
  const auth = await requireAppRole(c, 'admin');
  if (auth instanceof Response) return auth;

  const slug = c.req.param('slug');
  let schema: SchemaSecretStatusRow | null;
  try {
    ({ schema } = await getSchemaSecretStatus(c.env, slug, { migrateLegacy: false }));
  } catch (error) {
    if (isManagedSecretUnavailableError(error)) {
      return c.json({ error: getManagedSecretUnavailableMessage() }, 503);
    }
    throw error;
  }

  if (!schema) {
    return c.json({ error: `Schema "${slug}" not found` }, 404);
  }

  let body: { secret: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const secret = body.secret?.trim();
  if (!secret) {
    return c.json({ error: 'Missing required field: secret' }, 400);
  }

  const secretName = schema.revalidation_secret_name || buildRevalidationSecretName(schema.id);
  await upsertManagedSecret(c.env, {
    name: secretName,
    namespace: getRevalidationSecretNamespace(),
    value: secret,
    metadata: {
      schema_id: schema.id,
      schema_slug: schema.slug,
      frontend_url: schema.frontend_url,
    },
  });

  const admin = await createSupabaseAdminClient(c.env);
  const { error } = await admin
    .from('page_schemas')
    .update({
      revalidation_secret_name: secretName,
      revalidation_secret: null,
    })
    .eq('id', schema.id);

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ success: true, secret_name: secretName });
});

schemas.post('/revalidation-secrets/backfill', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  const admin = await createSupabaseAdminClient(c.env);
  const { data, error } = await admin
    .from('page_schemas')
    .select('id, slug, frontend_url, revalidation_endpoint, revalidation_secret, revalidation_secret_name, registration_status')
    .not('revalidation_secret', 'is', null);

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  const rows = (data ?? []) as SchemaSecretStatusRow[];
  let migrated = 0;

  for (const row of rows) {
    const before = row.revalidation_secret_name;
    const result = await migrateLegacyRevalidationSecret(c.env, row);
    if (!before && result.revalidation_secret_name) {
      migrated += 1;
    }
  }

  return c.json({ success: true, migrated, total: rows.length });
});

schemas.delete('/:slug/revalidation-secret', async (c) => {
  const auth = await requireAppRole(c, 'admin');
  if (auth instanceof Response) return auth;

  const slug = c.req.param('slug');
  let schema: SchemaSecretStatusRow | null;
  try {
    ({ schema } = await getSchemaSecretStatus(c.env, slug, { migrateLegacy: false }));
  } catch (error) {
    if (isManagedSecretUnavailableError(error)) {
      return c.json({ error: getManagedSecretUnavailableMessage() }, 503);
    }
    throw error;
  }

  if (!schema) {
    return c.json({ error: `Schema "${slug}" not found` }, 404);
  }

  if (schema.revalidation_secret_name) {
    await deleteManagedSecret(c.env, schema.revalidation_secret_name);
  }

  const admin = await createSupabaseAdminClient(c.env);
  const { error } = await admin
    .from('page_schemas')
    .update({
      revalidation_secret_name: null,
      revalidation_secret: null,
    })
    .eq('id', schema.id);

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ success: true });
});

schemas.post('/:slug/unhook', async (c) => {
  const auth = await requireAppRole(c, 'admin');
  if (auth instanceof Response) return auth;

  const slug = c.req.param('slug');
  let schema: SchemaSecretStatusRow | null;
  try {
    ({ schema } = await getSchemaSecretStatus(c.env, slug, { migrateLegacy: false }));
  } catch (error) {
    if (isManagedSecretUnavailableError(error)) {
      return c.json({ error: getManagedSecretUnavailableMessage() }, 503);
    }
    throw error;
  }

  if (!schema) {
    return c.json({ error: `Schema "${slug}" not found` }, 404);
  }

  if (schema.revalidation_secret_name) {
    await deleteManagedSecret(c.env, schema.revalidation_secret_name);
  }

  const admin = await createSupabaseAdminClient(c.env);
  const { error } = await admin
    .from('page_schemas')
    .update({
      registration_status: 'pending',
      frontend_url: null,
      revalidation_endpoint: null,
      revalidation_secret: null,
      revalidation_secret_name: null,
    })
    .eq('id', schema.id);

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ success: true });
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
    .select('id, frontend_url, revalidation_endpoint, revalidation_secret, revalidation_secret_name, registration_status')
    .eq('slug', slug)
    .single();

  if (error || !schema) {
    return c.json({ error: `Schema "${slug}" not found` }, 404);
  }

  let resolvedSchema = {
    id: schema.id,
    slug,
    frontend_url: schema.frontend_url,
    revalidation_endpoint: schema.revalidation_endpoint,
    revalidation_secret: schema.revalidation_secret,
    revalidation_secret_name: schema.revalidation_secret_name,
    registration_status: schema.registration_status,
  } as SchemaSecretStatusRow;

  try {
    resolvedSchema = await migrateLegacyRevalidationSecret(c.env, resolvedSchema);
  } catch (error) {
    if (!isManagedSecretUnavailableError(error)) {
      throw error;
    }
  }

  if (resolvedSchema.registration_status !== 'registered') {
    return c.json({ error: 'Schema does not have a registered frontend' }, 400);
  }

  if (!resolvedSchema.frontend_url || !resolvedSchema.revalidation_endpoint) {
    return c.json({ error: 'Frontend revalidation not configured' }, 400);
  }

  // Build revalidation URL
  const revalidateUrl = new URL(resolvedSchema.revalidation_endpoint, resolvedSchema.frontend_url);
  revalidateUrl.searchParams.set('path', body.page_slug);

  let secretValue: string | null = null;
  if (resolvedSchema.revalidation_secret_name) {
    secretValue = await getManagedSecretValue(c.env, resolvedSchema.revalidation_secret_name);
  } else if (resolvedSchema.revalidation_secret) {
    // Legacy compatibility for schemas that still store a plaintext secret.
    secretValue = resolvedSchema.revalidation_secret;
    revalidateUrl.searchParams.set('secret', resolvedSchema.revalidation_secret);
  }

  const buildHeaders = (secret: string | null): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) {
      headers.Authorization = `Bearer ${secret}`;
    }
    return headers;
  };

  const parseUpstreamBody = async (response: Response): Promise<string | null> => {
    const bodyText = await response.text().catch(() => '');
    if (!bodyText) return null;

    try {
      const parsed = JSON.parse(bodyText) as { error?: string; message?: string };
      return parsed.error || parsed.message || bodyText;
    } catch {
      return bodyText;
    }
  };

  try {
    let response = await fetch(revalidateUrl.toString(), {
      method: 'POST',
      headers: buildHeaders(secretValue),
      signal: AbortSignal.timeout(10000),
    });

    let upstreamMessage = await parseUpstreamBody(response);

    if (!response.ok && response.status === 401 && secretValue && !revalidateUrl.searchParams.has('secret')) {
      const legacyUrl = new URL(revalidateUrl.toString());
      legacyUrl.searchParams.set('secret', secretValue);

      response = await fetch(legacyUrl.toString(), {
        method: 'POST',
        headers: buildHeaders(secretValue),
        signal: AbortSignal.timeout(10000),
      });

      upstreamMessage = await parseUpstreamBody(response);
    }

    return c.json({
      success: response.ok,
      status: response.status,
      message: response.ok
        ? 'Revalidation triggered successfully'
        : `Revalidation request failed${upstreamMessage ? `: ${upstreamMessage}` : ''}`,
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
