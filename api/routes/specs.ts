import { Hono } from 'hono';
import { requireAppRole } from '../lib/auth';
import { createSupabaseClient, type Env } from '../lib/supabase';
import {
  bootstrapSchemaMainSpec,
  getDiscoverableSpecBySlug,
  getSchemaSpecBundle,
  listDiscoverableSpecs,
  type LlmSpecStatus,
} from '../lib/specRegistry';

const specs = new Hono<{ Bindings: Env }>();

function normalizeStatus(value: unknown): LlmSpecStatus {
  return value === 'published' || value === 'archived' ? value : 'draft';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

specs.get('/', async (c) => {
  const baseUrl = new URL(c.req.url).origin;
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    const entries = await listDiscoverableSpecs(c.env);
    return c.json({
      service: 'specy-api',
      description: 'Published public specs attached to registered schemas. Use these entries as the unified discovery surface for agent-readable tools.',
      mcp_endpoint: `${baseUrl}/mcp`,
      specs: entries.map((entry) => ({
        slug: entry.slug,
        name: entry.name,
        description: entry.description,
        discovery_scope: entry.discovery_scope,
        schema: entry.schema,
        is_main: entry.is_main,
        tags: entry.tags,
        detail_url: `${baseUrl}/api/specs/${entry.slug}`,
      })),
    });
  }

  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  const supabase = await createSupabaseClient(c.env, auth.token);
  const { data, error } = await supabase
    .from('llm_specs')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ specs: data ?? [] });
});

specs.get('/schema/:schemaSlug', async (c) => {
  const schemaSlug = c.req.param('schemaSlug');
  const supabase = await createSupabaseClient(c.env);
  const { data: schema, error } = await supabase
    .from('page_schemas')
    .select('id, slug, name, registration_status, frontend_url')
    .eq('slug', schemaSlug)
    .single();

  if (error || !schema) {
    return c.json({ error: `Schema "${schemaSlug}" not found` }, 404);
  }

  const bundle = await getSchemaSpecBundle(c.env, { id: schema.id }, { publicOnly: true });
  return c.json({ schema, ...bundle });
});

specs.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    const spec = await getDiscoverableSpecBySlug(c.env, slug);
    if (!spec) {
      return c.json({ error: `Spec "${slug}" not found` }, 404);
    }

    return c.json({ spec });
  }

  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  const supabase = await createSupabaseClient(c.env, auth.token);
  const { data, error } = await supabase
    .from('llm_specs')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error || !data) {
    return c.json({ error: `Spec "${slug}" not found` }, 404);
  }

  return c.json({ spec: data });
});

specs.post('/', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  let body: {
    slug?: string;
    name?: string;
    description?: string | null;
    definition?: Record<string, unknown>;
    llm_instructions?: string | null;
    status?: LlmSpecStatus;
    is_public?: boolean;
    is_main_template?: boolean;
    tags?: string[];
    metadata?: Record<string, unknown>;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.name || !body.slug || !body.definition) {
    return c.json({ error: 'Missing required fields: name, slug, definition' }, 400);
  }

  const supabase = await createSupabaseClient(c.env, auth.token);
  const { data, error } = await supabase
    .from('llm_specs')
    .insert({
      slug: body.slug,
      name: body.name,
      description: body.description ?? null,
      definition: body.definition,
      llm_instructions: body.llm_instructions ?? null,
      status: normalizeStatus(body.status),
      is_public: Boolean(body.is_public),
      is_main_template: Boolean(body.is_main_template),
      tags: normalizeStringArray(body.tags),
      metadata: body.metadata ?? {},
    })
    .select('*')
    .single();

  if (error || !data) {
    return c.json({ error: error?.message || 'Failed to create spec' }, 400);
  }

  return c.json({ spec: data }, 201);
});

specs.put('/schema/:schemaId/attachments', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  let body: { main_spec_id?: string | null; additional_spec_ids?: string[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const schemaId = c.req.param('schemaId');
  const additionalSpecIds = normalizeStringArray(body.additional_spec_ids)
    .filter((specId) => specId !== body.main_spec_id);
  const allTargetSpecIds = Array.from(new Set([
    ...(body.main_spec_id ? [body.main_spec_id] : []),
    ...additionalSpecIds,
  ]));

  const supabase = await createSupabaseClient(c.env, auth.token);
  const { data: schema, error: schemaError } = await supabase
    .from('page_schemas')
    .select('id')
    .eq('id', schemaId)
    .single();

  if (schemaError || !schema) {
    return c.json({ error: `Schema "${schemaId}" not found` }, 404);
  }

  const { data: currentAttachments, error: currentError } = await supabase
    .from('page_schema_specs')
    .select('id, schema_id, spec_id, enabled, is_main, sort_order, created_at, updated_at')
    .eq('schema_id', schemaId);

  if (currentError) {
    return c.json({ error: currentError.message }, 400);
  }

  if (allTargetSpecIds.length > 0) {
    const { data: specsData, error: specsError } = await supabase
      .from('llm_specs')
      .select('id')
      .in('id', allTargetSpecIds);

    if (specsError) {
      return c.json({ error: specsError.message }, 400);
    }

    const foundIds = new Set((specsData ?? []).map((entry) => String(entry.id)));
    const missing = allTargetSpecIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return c.json({ error: `Unknown spec ids: ${missing.join(', ')}` }, 400);
    }
  }

  const upserts: Array<Record<string, unknown>> = [];
  if (body.main_spec_id) {
    upserts.push({
      schema_id: schemaId,
      spec_id: body.main_spec_id,
      enabled: true,
      is_main: true,
      sort_order: 0,
    });
  }

  additionalSpecIds.forEach((specId, index) => {
    upserts.push({
      schema_id: schemaId,
      spec_id: specId,
      enabled: true,
      is_main: specId === body.main_spec_id,
      sort_order: index + 1,
    });
  });

  for (const attachment of currentAttachments ?? []) {
    const specId = String(attachment.spec_id);
    if (body.main_spec_id && specId === body.main_spec_id) {
      continue;
    }

    if (additionalSpecIds.includes(specId)) {
      continue;
    }

    const { error: disableError } = await supabase
      .from('page_schema_specs')
      .update({ enabled: false, is_main: false })
      .eq('id', attachment.id as string);

    if (disableError) {
      return c.json({ error: disableError.message }, 400);
    }
  }

  if (body.main_spec_id) {
    const { error: clearMainError } = await supabase
      .from('page_schema_specs')
      .update({ is_main: false })
      .eq('schema_id', schemaId)
      .neq('spec_id', body.main_spec_id);

    if (clearMainError) {
      return c.json({ error: clearMainError.message }, 400);
    }
  }

  if (upserts.length > 0) {
    const { error: upsertError } = await supabase
      .from('page_schema_specs')
      .upsert(upserts, { onConflict: 'schema_id,spec_id' });

    if (upsertError) {
      return c.json({ error: upsertError.message }, 400);
    }
  }

  const bundle = await getSchemaSpecBundle(c.env, { id: schemaId }, { token: auth.token });
  return c.json(bundle);
});

specs.put('/:id', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  let body: {
    slug?: string;
    name?: string;
    description?: string | null;
    definition?: Record<string, unknown>;
    llm_instructions?: string | null;
    status?: LlmSpecStatus;
    is_public?: boolean;
    is_main_template?: boolean;
    tags?: string[];
    metadata?: Record<string, unknown>;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const updateData: Record<string, unknown> = {};
  if (body.slug !== undefined) updateData.slug = body.slug;
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.definition !== undefined) updateData.definition = body.definition;
  if (body.llm_instructions !== undefined) updateData.llm_instructions = body.llm_instructions;
  if (body.status !== undefined) updateData.status = normalizeStatus(body.status);
  if (body.is_public !== undefined) updateData.is_public = body.is_public;
  if (body.is_main_template !== undefined) updateData.is_main_template = body.is_main_template;
  if (body.tags !== undefined) updateData.tags = normalizeStringArray(body.tags);
  if (body.metadata !== undefined) updateData.metadata = body.metadata;

  const supabase = await createSupabaseClient(c.env, auth.token);
  const { data, error } = await supabase
    .from('llm_specs')
    .update(updateData)
    .eq('id', c.req.param('id'))
    .select('*')
    .single();

  if (error || !data) {
    return c.json({ error: error?.message || 'Failed to update spec' }, 400);
  }

  return c.json({ spec: data });
});

specs.delete('/:id', async (c) => {
  const auth = await requireAppRole(c, 'admin');
  if (auth instanceof Response) return auth;

  const supabase = await createSupabaseClient(c.env, auth.token);
  const { error } = await supabase
    .from('llm_specs')
    .delete()
    .eq('id', c.req.param('id'));

  if (error) {
    return c.json({ error: error.message }, 400);
  }

  return c.json({ success: true });
});

specs.post('/bootstrap/schema/:schemaId', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  const schemaId = c.req.param('schemaId');
  const supabase = await createSupabaseClient(c.env, auth.token);
  const { data: schema, error } = await supabase
    .from('page_schemas')
    .select('id, slug, name, description, schema, llm_instructions, registration_status, frontend_url')
    .eq('id', schemaId)
    .single();

  if (error || !schema) {
    return c.json({ error: `Schema "${schemaId}" not found` }, 404);
  }

  const { data: userData } = await supabase.auth.getUser(auth.token);
  const result = await bootstrapSchemaMainSpec(c.env, schema, {
    token: auth.token,
    createdBy: userData.user?.id ?? null,
  });

  return c.json(result, result.created ? 201 : 200);
});

export default specs;