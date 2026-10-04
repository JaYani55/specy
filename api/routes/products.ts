import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from '../lib/supabase';
import { createSupabaseAdminClient, createSupabaseClient } from '../lib/supabase';
import { projectPublicCustomFields } from '../lib/customFields';
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

type PublicProductRow = {
  id: number;
  integration_id: string;
  name: string;
  description_de: string;
  description_effort: string;
  icon_name: string | null;
  custom_fields: Record<string, unknown>;
  product_page_id: string;
};

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
    .select('id, slug')
    .eq('slug', c.req.param('workspaceSlug'))
    .maybeSingle();
  if (workspaceError) return c.json({ error: 'Could not load the requested workspace.' }, 500);
  if (!workspace) return c.json({ error: 'Published product not found.' }, 404);

  const requestedProductSlug = c.req.param('productSlug');
  const { data: productPage, error: pageError } = await admin.from('pages')
    .select('id, slug, name, content, schema_id')
    .eq('tenant_id', workspace.id)
    .eq('slug', requestedProductSlug)
    .eq('status', 'published')
    .maybeSingle();
  if (pageError) return c.json({ error: 'Could not load the requested product page.' }, 500);

  if (!productPage) return c.json({ error: 'Published product not found.' }, 404);

  const { data: productSchema, error: productSchemaError } = await admin.from('page_schemas')
    .select('id')
    .eq('id', productPage.schema_id)
    .eq('tenant_id', workspace.id)
    .eq('entity_kind', 'service-product')
    .eq('registration_status', 'registered')
    .maybeSingle();
  if (productSchemaError) return c.json({ error: 'Could not load the product schema.' }, 500);
  if (!productSchema) return c.json({ error: 'Published product not found.' }, 404);

  const { data: productData, error: productError } = await admin.from('mentorbooking_products')
    .select('id, integration_id, name, description_de, description_effort, icon_name, custom_fields, product_page_id')
    .eq('tenant_id', workspace.id)
    .eq('product_page_id', productPage.id)
    .is('retired_at', null)
    .maybeSingle();
  if (productError) return c.json({ error: 'Could not load the product record.' }, 500);
  if (!productData) return c.json({ error: 'Published product not found.' }, 404);
  const product = productData as PublicProductRow;

  const { data: productFieldDefinition, error: productFieldError } = await admin.from('tenant_custom_field_definitions')
    .select('definitions')
    .eq('tenant_id', workspace.id)
    .eq('entity_type', 'product')
    .maybeSingle();
  if (productFieldError) return c.json({ error: 'Could not load product field definitions.' }, 500);

  const { data: eventRows, error: eventsError } = await admin.from('mentorbooking_events')
    .select('id, page_id, date, time, end_time, duration_minutes, timezone, mode, custom_fields')
    .eq('tenant_id', workspace.id)
    .eq('product_id', product.id)
    .not('page_id', 'is', null)
    .order('date', { ascending: true })
    .order('time', { ascending: true });
  if (eventsError) return c.json({ error: 'Could not load events for this product.' }, 500);

  const events = eventRows ?? [];
  const eventPageIds = events.map((event) => event.page_id).filter((pageId): pageId is string => typeof pageId === 'string');
  const { data: eventPages, error: eventPagesError } = eventPageIds.length
    ? await admin.from('pages').select('id, slug, name, content, schema_id')
      .eq('tenant_id', workspace.id).eq('status', 'published').in('id', eventPageIds)
    : { data: [], error: null };
  if (eventPagesError) return c.json({ error: 'Could not load public event pages.' }, 500);

  const eventSchemasIds = [...new Set((eventPages ?? []).map((page) => page.schema_id).filter((schemaId): schemaId is string => typeof schemaId === 'string'))];
  const { data: eventSchemas, error: eventSchemasError } = eventSchemasIds.length
    ? await admin.from('page_schemas').select('id')
      .eq('tenant_id', workspace.id).eq('entity_kind', 'event').eq('registration_status', 'registered').in('id', eventSchemasIds)
    : { data: [], error: null };
  if (eventSchemasError) return c.json({ error: 'Could not load event schema registration.' }, 500);

  const { data: eventFieldDefinition, error: eventFieldError } = await admin.from('tenant_custom_field_definitions')
    .select('definitions')
    .eq('tenant_id', workspace.id)
    .eq('entity_type', 'event')
    .maybeSingle();
  if (eventFieldError) return c.json({ error: 'Could not load event field definitions.' }, 500);

  const publicSchemaIds = new Set((eventSchemas ?? []).map((schema) => schema.id));
  const eventPageById = new Map((eventPages ?? [])
    .filter((page) => publicSchemaIds.has(page.schema_id))
    .map((page) => [page.id, page]));
  const publicEvents = events.flatMap((event) => {
    const page = event.page_id ? eventPageById.get(event.page_id) : undefined;
    if (!page || typeof event.timezone !== 'string' || !isValidPublicTimezone(event.timezone)) return [];
    return [{
      id: event.id,
      name: page.name,
      slug: page.slug,
      content: page.content,
      date: event.date,
      time: event.time,
      end_time: event.end_time,
      duration_minutes: event.duration_minutes,
      timezone: event.timezone,
      mode: event.mode,
      custom_fields: projectPublicCustomFields(eventFieldDefinition?.definitions, event.custom_fields),
    }];
  });

  return c.json({
    product: {
      id: product.integration_id,
      name: product.name,
      slug: productPage.slug,
      content: productPage.content,
      description_de: product.description_de,
      description_effort: product.description_effort,
      icon_name: product.icon_name,
      custom_fields: projectPublicCustomFields(productFieldDefinition?.definitions, product.custom_fields),
      events: publicEvents,
    },
  });
});

function isValidPublicTimezone(value: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0); return true; }
  catch { return false; }
}

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
