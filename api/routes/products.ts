import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../lib/supabase';
import { createSupabaseAdminClient, createSupabaseClient } from '../lib/supabase';
import { requireAuthSession } from '../lib/auth';
import { getPublicWorkerUrl } from '../lib/systemConfig';
import { parseCreateServiceProductInput, parseUpdateServiceProductInput } from '../lib/productAggregates';
import {
  archiveProductAggregate,
  createProductAggregate,
  getProductAggregate,
  getProductAggregateByPage,
  listProductAggregates,
  ProductAggregateError,
  publishProductAggregate,
  updateProductAggregate,
} from '../lib/productAggregateService';

const products = new Hono<{ Bindings: Env }>();

function errorResponse(c: Context<{ Bindings: Env }>, error: unknown) {
  if (error instanceof ProductAggregateError) {
    return c.json({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.details ? { details: error.details } : {}),
    }, error.status as ContentfulStatusCode);
  }
  return c.json({ error: error instanceof Error ? error.message : 'Product operation failed.' }, 500);
}

async function readJson(c: Context<{ Bindings: Env }>): Promise<unknown | Response> {
  try { return await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body.' }, 400); }
}

products.get('/', async (c) => {
  const auth = await requireAuthSession(c);
  if (auth instanceof Response) return auth;
  const tenantId = c.req.query('tenant_id');
  if (!tenantId) return c.json({ error: 'tenant_id is required.' }, 400);
  const client = await createSupabaseClient(c.env, auth.token);
  try {
    const rows = await listProductAggregates(client, tenantId);
    return c.json({ products: rows, total: rows.length });
  } catch (error) { return errorResponse(c, error); }
});

products.get('/by-page/:pageId', async (c) => {
  const auth = await requireAuthSession(c);
  if (auth instanceof Response) return auth;
  const tenantId = c.req.query('tenant_id');
  if (!tenantId) return c.json({ error: 'tenant_id is required.' }, 400);
  const client = await createSupabaseClient(c.env, auth.token);
  try {
    const product = await getProductAggregateByPage(client, c.req.param('pageId'), tenantId);
    return c.json({ product });
  } catch (error) { return errorResponse(c, error); }
});

products.get('/:workspaceSlug/:productSlug', async (c) => {
  const admin = await createSupabaseAdminClient(c.env);
  const { data: workspace, error: workspaceError } = await admin.from('tenants')
    .select('id')
    .eq('slug', c.req.param('workspaceSlug'))
    .maybeSingle();
  if (workspaceError) return c.json({ error: 'Could not load the requested workspace.' }, 500);
  if (!workspace) return c.json({ error: 'Published product not found.' }, 404);

  const { data: page, error: pageError } = await admin.from('pages')
    .select('id')
    .eq('tenant_id', workspace.id)
    .eq('slug', c.req.param('productSlug'))
    .eq('status', 'published')
    .maybeSingle();
  if (pageError) return c.json({ error: 'Could not load the requested product page.' }, 500);
  if (!page) return c.json({ error: 'Published product not found.' }, 404);

  const { data: product, error: productError } = await admin.from('mentorbooking_products')
    .select('id')
    .eq('tenant_id', workspace.id)
    .eq('product_page_id', page.id)
    .is('retired_at', null)
    .maybeSingle();
  if (productError) return c.json({ error: 'Could not load the product record.' }, 500);
  if (!product) return c.json({ error: 'Published product not found.' }, 404);

  const { data: mirror, error: mirrorError } = await admin.from('objects')
    .select('id, name, slug, description, agent_description, object_type, requires_auth, api_enabled, share_enabled, share_slug, schema, data, updated_at')
    .eq('source_product_id', product.id)
    .eq('tenant_id', workspace.id)
    .eq('status', 'published')
    .eq('api_enabled', true)
    .eq('requires_auth', false)
    .maybeSingle();
  if (mirrorError) return c.json({ error: 'Could not load the published product data.' }, 500);
  if (!mirror) return c.json({ error: 'Published product not found.' }, 404);

  // Friendly page-oriented URL; the payload is exactly the canonical Object DTO.
  return c.json(mirror);
});

products.get('/:id', async (c) => {
  const auth = await requireAuthSession(c);
  if (auth instanceof Response) return auth;
  const tenantId = c.req.query('tenant_id');
  if (!tenantId) return c.json({ error: 'tenant_id is required.' }, 400);
  const client = await createSupabaseClient(c.env, auth.token);
  try {
    const product = await getProductAggregate(client, c.req.param('id'), tenantId);
    return c.json({ product });
  } catch (error) { return errorResponse(c, error); }
});

products.post('/', async (c) => {
  const auth = await requireAuthSession(c);
  if (auth instanceof Response) return auth;
  const body = await readJson(c);
  if (body instanceof Response) return body;
  const parsed = parseCreateServiceProductInput(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const client = await createSupabaseClient(c.env, auth.token);
  try {
    const product = await createProductAggregate(client, parsed.value) as { page_id?: string };
    const { data: schema } = await client
      .from('page_schemas')
      .select('slug, api_slug, tenant_id')
      .eq('id', parsed.value.schema_id)
      .maybeSingle();
    const { data: tenant } = schema?.tenant_id
      ? await client.from('tenants').select('slug').eq('id', schema.tenant_id).maybeSingle()
      : { data: null };
    const editorPath = schema && tenant?.slug
      ? `/pages/schema/${encodeURIComponent(tenant.slug)}/${encodeURIComponent(schema.slug)}/edit/${product.page_id}`
      : `/pages/schema/${encodeURIComponent(schema?.api_slug ?? parsed.value.schema_id)}/edit/${product.page_id}`;
    const baseUrl = await getPublicWorkerUrl(c.env, new URL(c.req.url).origin);
    return c.json({ product, editor_url: product.page_id ? `${baseUrl}${editorPath}` : null }, 201);
  } catch (error) { return errorResponse(c, error); }
});

products.patch('/:id', async (c) => {
  const auth = await requireAuthSession(c);
  if (auth instanceof Response) return auth;
  const body = await readJson(c);
  if (body instanceof Response) return body;
  const parsed = parseUpdateServiceProductInput(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const client = await createSupabaseClient(c.env, auth.token);
  try {
    const product = await updateProductAggregate(client, c.req.param('id'), parsed.value);
    return c.json({ product });
  } catch (error) { return errorResponse(c, error); }
});

products.post('/:id/publish', async (c) => {
  const auth = await requireAuthSession(c);
  if (auth instanceof Response) return auth;
  const body = await readJson(c);
  if (body instanceof Response) return body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Request body must be an object.' }, 400);
  const input = body as Record<string, unknown>;
  if (typeof input.tenant_id !== 'string' || !Number.isSafeInteger(input.expected_version)
    || !Number.isSafeInteger(input.expected_definition_revision)
    || !['draft', 'published'].includes(String(input.status))) {
    return c.json({ error: 'tenant_id, expected_version, expected_definition_revision and draft/published status are required.' }, 400);
  }
  const client = await createSupabaseClient(c.env, auth.token);
  try {
    const product = await publishProductAggregate(
      client,
      c.req.param('id'),
      input.tenant_id,
      Number(input.expected_version),
      Number(input.expected_definition_revision),
      input.status as 'draft' | 'published',
    );
    return c.json({ product });
  } catch (error) { return errorResponse(c, error); }
});

products.post('/:id/archive', async (c) => {
  const auth = await requireAuthSession(c);
  if (auth instanceof Response) return auth;
  const body = await readJson(c);
  if (body instanceof Response) return body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Request body must be an object.' }, 400);
  const input = body as Record<string, unknown>;
  if (typeof input.tenant_id !== 'string' || !Number.isSafeInteger(input.expected_version)) {
    return c.json({ error: 'tenant_id and expected_version are required.' }, 400);
  }
  const client = await createSupabaseClient(c.env, auth.token);
  try {
    const product = await archiveProductAggregate(client, c.req.param('id'), input.tenant_id, Number(input.expected_version));
    return c.json({ product });
  } catch (error) { return errorResponse(c, error); }
});

export default products;
