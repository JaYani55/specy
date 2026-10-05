import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { createSupabaseAdminClient, createSupabaseClient, type Env } from '../lib/supabase';
import { getOptionalAuthSession, parseBearerToken, requireAppRole } from '../lib/auth';
import { isPublicObjectReadable } from '../lib/objectVisibility';

const objects = new Hono<{ Bindings: Env }>();

const OBJECT_API_COLUMNS = 'id, name, slug, description, agent_description, object_type, schema, data, status, requires_auth, api_enabled, share_enabled, share_slug, tenant_id, created_at, updated_at';
const OBJECT_PUBLIC_COLUMNS = 'id, name, slug, description, agent_description, object_type, schema, data, status, requires_auth, api_enabled, share_enabled, share_slug, created_at, updated_at';

interface ObjectRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  agent_description: string | null;
  object_type: 'json' | 'markdown';
  schema: Record<string, unknown>;
  data: Record<string, unknown> | unknown[];
  status: 'published' | 'archived';
  requires_auth: boolean;
  api_enabled: boolean;
  share_enabled: boolean;
  share_slug: string | null;
  tenant_id?: string | null;
  source_product_id?: number | null;
  created_at: string;
  updated_at: string;
}

interface ObjectWithTenantRow extends ObjectRow {
  tenants?: {
    name: string;
    slug?: string;
    organization_slug?: string | null;
  } | null;
}

const normalizeTenantNameSegment = (value: string): string => value
  .toLowerCase()
  .trim()
  .replace(/ä/g, 'ae')
  .replace(/ö/g, 'oe')
  .replace(/ü/g, 'ue')
  .replace(/ß/g, 'ss')
  .replace(/[^a-z0-9\s-]/g, '')
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '');

const serializeObject = (obj: ObjectRow) => ({
  id: obj.id,
  name: obj.name,
  slug: obj.slug,
  description: obj.description,
  agent_description: obj.agent_description,
  object_type: obj.object_type,
  requires_auth: obj.requires_auth,
  api_enabled: obj.api_enabled,
  share_enabled: obj.share_enabled,
  share_slug: obj.share_slug,
  schema: obj.schema,
  data: obj.data,
  updated_at: obj.updated_at,
});

const getObjectByShareSlug = async (
  env: Env,
  tenantNameSegment: string,
  shareSlug: string,
): Promise<ObjectRow | null> => {
  // Use admin client for the lookup to ensure we find objects regardless of user RLS
  // (visibility/auth requirement is checked afterward in the route handler)
  const admin = await createSupabaseAdminClient(env);
  const { data, error } = await admin
    .from('objects')
    .select('*, tenants (name, slug, organization_slug)')
    .eq('share_slug', shareSlug)
    .eq('share_enabled', true)
    .neq('status', 'archived')
    .limit(20);

  if (error) throw error;
  const candidates = (data as ObjectWithTenantRow[] | null) ?? [];
  const requestedTenantSegment = normalizeTenantNameSegment(tenantNameSegment);

  for (const obj of candidates) {
    if (!obj.tenant_id) continue;

    const resolvedTenantName = obj.tenants?.name;
    const resolvedTenantSlug = obj.tenants?.slug;
    const resolvedOrganizationSlug = obj.tenants?.organization_slug;

    const matchesTenant = [resolvedTenantName, resolvedTenantSlug, resolvedOrganizationSlug]
      .filter((v): v is string => Boolean(v))
      .some((v) => normalizeTenantNameSegment(v) === requestedTenantSegment);

    if (matchesTenant) return obj;
  }

  return null;
};

const getObjectConflictMessage = (error: { message?: string; details?: string | null; hint?: string | null }) => {
  const detail = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase();

  if (detail.includes('share_slug')) {
    return 'An object with this share slug already exists in the selected workspace.';
  }

  if (detail.includes('slug')) {
    return 'An object with this slug already exists.';
  }

  return 'A unique value for this object already exists.';
};

// GET /api/objects
// List all published, api-enabled objects (public or authenticated depending on requires_auth).
// Authenticated users see the rows allowed by RLS, including their own managed objects.
objects.get('/', async (c) => {
  const auth = await getOptionalAuthSession(c);
  if (auth instanceof Response) return auth;

  if (auth) {
    const hasConsoleAccess = auth.roles.some((r) => r === 'user' || r === 'staff' || r === 'admin' || r === 'super-admin');

    if (hasConsoleAccess) {
      const supabase = await createSupabaseClient(c.env, auth.token);

      let objectQuery = supabase
        .from('objects')
        .select('id, name, slug, description, agent_description, object_type, status, requires_auth, api_enabled, share_enabled, share_slug, tenant_id, created_at, updated_at')
        .neq('status', 'archived')
        .order('updated_at', { ascending: false });

      const requestedTenantId = c.req.query('tenantId');
      if (requestedTenantId) {
        const { data: membership } = await supabase
          .from('tenant_users')
          .select('tenant_id')
          .eq('tenant_id', requestedTenantId)
          .eq('user_id', auth.userId)
          .eq('status', 'active')
          .maybeSingle();
        if (!membership) return c.json({ error: 'You are not a member of this workspace.' }, 403);
        objectQuery = objectQuery.eq('tenant_id', requestedTenantId);
      }

      const { data, error: dbError } = await objectQuery;

      if (dbError) {
        return c.json({ error: 'Failed to load objects.' }, 500);
      }

      const visibleRows = data ?? [];
      const rowIds = visibleRows.map((row) => row.id);
      if (!rowIds.length) return c.json({ objects: [] });
      const admin = await createSupabaseAdminClient(c.env);
      const { data: sourceRows, error: sourceError } = await admin.from('objects')
        .select('id, source_product_id')
        .in('id', rowIds);
      if (sourceError) return c.json({ error: 'Failed to load object sources.' }, 500);
      const managedIds = new Set((sourceRows ?? []).filter((row) => row.source_product_id != null).map((row) => row.id));
      return c.json({ objects: visibleRows.filter((row) => !managedIds.has(row.id)) });
    }
  }

  // Public path: only published, api_enabled, non-auth objects
  const supabase = await createSupabaseClient(c.env);
  const { data, error: dbError } = await supabase
    .from('objects')
    .select('id, name, slug, description, agent_description, object_type, share_enabled, share_slug, created_at, updated_at')
    .eq('status', 'published')
    .eq('api_enabled', true)
    .eq('requires_auth', false)
    .order('updated_at', { ascending: false });

  if (dbError) {
    return c.json({ error: 'Failed to load objects.' }, 500);
  }

  return c.json({ objects: data ?? [] });
});

/**
 * Metadata retrieval for Edge injection (no auth check, public fields only)
 */
export async function objectsWithMeta(env: Env, tenantName: string, shareSlug: string) {
  const admin = await createSupabaseAdminClient(env);
  const obj = await getObjectByShareSlug(env, tenantName, shareSlug);
  if (!obj) return null;

  let image: string | undefined;
  try {
    const data = obj.data;
    if (data && typeof data === 'object') {
      const findImage = (val: unknown): string | null => {
        if (typeof val === 'string' && (val.startsWith('http') || val.startsWith('/')) && (val.match(/\.(jpeg|jpg|gif|png|webp|svg)/i))) return val;
        if (Array.isArray(val)) {
          for (const item of val) {
            const found = findImage(item);
            if (found) return found;
          }
        }
        if (val && typeof val === 'object') {
          const v = val as Record<string, unknown>;
          // Check common image keys
          for (const key of ['image', 'src', 'url', 'thumbnail', 'pic']) {
            const pot = v[key];
            if (typeof pot === 'string' && pot.match(/\.(jpeg|jpg|gif|png|webp|svg)/i)) return pot;
          }
          // Recurse
          for (const k in v) {
            const found = findImage(v[k]);
            if (found) return found;
          }
        }
        return null;
      };
      
      const found = findImage(data);
      if (found) image = found;
    }
  } catch (e) {
    console.warn('Failed to extract image for metadata mapping:', e);
  }

  return {
    name: obj.name,
    description: obj.description,
    image
  };
}

objects.get('/share/:tenantName/:shareSlug', async (c) => {
  const token = parseBearerToken(c.req.header('Authorization'));
  const supabase = await createSupabaseClient(c.env, token);

  const obj = await getObjectByShareSlug(c.env, c.req.param('tenantName'), c.req.param('shareSlug'));
  if (!obj || obj.status === 'archived') {
    return c.json({ error: 'Object not found.' }, 404);
  }
  if (!obj.share_enabled) {
    return c.json({ error: 'Share link is disabled for this object.' }, 403);
  }
  if (obj.requires_auth && !token) {
    return c.json({ error: 'Authentication required.' }, 401);
  }

  return c.json(serializeObject(obj));
});

objects.get('/o/:tenantName/:shareSlug', async (c) => {
  const token = parseBearerToken(c.req.header('Authorization'));
  const supabase = await createSupabaseClient(c.env, token);

  const obj = await getObjectByShareSlug(c.env, c.req.param('tenantName'), c.req.param('shareSlug'));
  if (!obj || obj.status === 'archived') {
    return c.json({ error: 'Object not found.' }, 404);
  }
  if (!obj.share_enabled) {
    return c.json({ error: 'Share link is disabled for this object.' }, 403);
  }
  if (obj.requires_auth && !token) {
    return c.json({ error: 'Authentication required.' }, 401);
  }

  return c.json(serializeObject(obj));
});

// Authenticated UI handoff for generated Objects. It returns a safe editor path,
// never the source Product's legacy database key.
objects.get('/:id/source', async (c) => {
  const auth = await getOptionalAuthSession(c);
  if (auth instanceof Response) return auth;
  if (!auth) return c.json({ error: 'Authentication required.' }, 401);
  const id = c.req.param('id');
  const caller = await createSupabaseClient(c.env, auth.token);
  const { data: visible, error: visibleError } = await caller.from('objects').select('id').eq('id', id).maybeSingle();
  if (visibleError) return c.json({ error: 'Could not load the requested Object.' }, 500);
  if (!visible) return c.json({ error: 'Object not found.' }, 404);

  const admin = await createSupabaseAdminClient(c.env);
  const { data: source, error: sourceError } = await admin.from('objects').select('source_product_id').eq('id', id).maybeSingle();
  if (sourceError) return c.json({ error: 'Could not load the Object source.' }, 500);
  if (!source || source.source_product_id == null) return c.json({ managed: false });

  const { data: product, error: productError } = await admin.from('mentorbooking_products')
    .select('tenant_id, product_page_id')
    .eq('id', source.source_product_id)
    .maybeSingle();
  if (productError) return c.json({ error: 'Could not load the Product source.' }, 500);
  if (!product?.tenant_id) return c.json({ error: 'Object source not found.' }, 404);
  if (!auth.roles.some((role) => role === 'admin' || role === 'super-admin')) {
    const { data: membership, error: membershipError } = await caller.from('tenant_users')
      .select('tenant_id')
      .eq('tenant_id', product.tenant_id)
      .eq('user_id', auth.userId)
      .eq('status', 'active')
      .maybeSingle();
    if (membershipError) return c.json({ error: 'Could not verify workspace access.' }, 500);
    if (!membership) return c.json({ error: 'Object not found.' }, 404);
  }

  if (product.product_page_id) {
    const { data: page, error: pageError } = await admin.from('pages')
      .select('id, schema_id, tenant_id')
      .eq('id', product.product_page_id)
      .eq('tenant_id', product.tenant_id)
      .maybeSingle();
    if (pageError) return c.json({ error: 'Could not load the Product page.' }, 500);
    if (page) {
      const { data: schema, error: schemaError } = await admin.from('page_schemas')
        .select('slug, tenant_id, entity_kind')
        .eq('id', page.schema_id)
        .maybeSingle();
      if (schemaError) return c.json({ error: 'Could not load the Product catalogue.' }, 500);
      if (schema && schema.tenant_id === product.tenant_id && schema.entity_kind === 'service-product') {
        const { data: tenant, error: tenantError } = await admin.from('tenants').select('slug').eq('id', product.tenant_id).maybeSingle();
        if (tenantError) return c.json({ error: 'Could not load the Product workspace.' }, 500);
        const editorPath = tenant?.slug
          ? `/pages/schema/${encodeURIComponent(tenant.slug)}/${encodeURIComponent(schema.slug)}/edit/${page.id}`
          : `/pages/schema/${encodeURIComponent(schema.slug)}/edit/${page.id}`;
        return c.json({ managed: true, editor_path: editorPath });
      }
    }
  }
  return c.json({ managed: true, editor_path: '/products/manage/legacy' });
});

// GET /api/objects/datastreams — all RLS-visible API Objects, including generated Product mirrors.
objects.get('/datastreams', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;
  const caller = await createSupabaseClient(c.env, auth.token);
  const requestedTenantId = c.req.query('tenantId');
  if (requestedTenantId) {
    const { data: membership, error: membershipError } = await caller.from('tenant_users')
      .select('tenant_id')
      .eq('tenant_id', requestedTenantId)
      .eq('user_id', auth.userId)
      .eq('status', 'active')
      .maybeSingle();
    if (membershipError) return c.json({ error: 'Could not verify workspace access.' }, 500);
    if (!membership) return c.json({ error: 'You are not a member of this workspace.' }, 403);
  }

  let query = caller.from('objects')
    .select('id, name, slug, description, object_type, status, requires_auth, api_enabled, share_enabled, tenant_id, updated_at')
    .order('updated_at', { ascending: false });
  if (requestedTenantId) query = query.eq('tenant_id', requestedTenantId);
  const { data: visibleObjects, error } = await query;
  if (error) return c.json({ error: 'Failed to load Object datastreams.' }, 500);
  const rows = visibleObjects ?? [];
  if (!rows.length) return c.json({ datastreams: [], total: 0 });

  const admin = await createSupabaseAdminClient(c.env);
  const objectIds = rows.map((row) => row.id);
  const { data: sourceRows, error: sourceError } = await admin.from('objects')
    .select('id, source_product_id')
    .in('id', objectIds);
  if (sourceError) return c.json({ error: 'Failed to load Object datastream sources.' }, 500);
  const sourceProductByObjectId = new Map((sourceRows ?? [])
    .filter((row) => row.source_product_id !== null)
    .map((row) => [row.id, row.source_product_id as number]));
  const sourceProductIds = [...new Set(sourceProductByObjectId.values())];
  const { data: products, error: productsError } = sourceProductIds.length
    ? await admin.from('mentorbooking_products')
      .select('id, integration_id, name, tenant_id, product_page_id, retired_at, object_api_enabled, object_requires_auth')
      .in('id', sourceProductIds)
    : { data: [], error: null };
  if (productsError) return c.json({ error: 'Failed to load Product datastream sources.' }, 500);
  const productById = new Map((products ?? []).map((product) => [product.id, product]));
  const productPageIds = [...new Set((products ?? []).map((product) => product.product_page_id).filter((id): id is string => Boolean(id)))];
  const { data: productPages, error: productPagesError } = productPageIds.length
    ? await admin.from('pages').select('id, schema_id, tenant_id, status').in('id', productPageIds)
    : { data: [], error: null };
  if (productPagesError) return c.json({ error: 'Failed to load Product page visibility.' }, 500);
  const productSchemaIds = [...new Set((productPages ?? []).map((page) => page.schema_id).filter((id): id is string => Boolean(id)))];
  const { data: productSchemas, error: productSchemasError } = productSchemaIds.length
    ? await admin.from('page_schemas').select('id, tenant_id, entity_kind, registration_status').in('id', productSchemaIds)
    : { data: [], error: null };
  if (productSchemasError) return c.json({ error: 'Failed to load Product schema visibility.' }, 500);
  const pageById = new Map((productPages ?? []).map((page) => [page.id, page]));
  const schemaById = new Map((productSchemas ?? []).map((schema) => [schema.id, schema]));

  const getProductApiGateReason = (product: NonNullable<typeof products>[number]): string | null => {
    if (product.retired_at) return 'product_retired';
    if (!product.product_page_id) return 'product_page_missing';
    const page = pageById.get(product.product_page_id);
    if (!page || page.tenant_id !== product.tenant_id) return 'product_page_missing';
    if (page.status !== 'published') return 'product_page_unpublished';
    const schema = schemaById.get(page.schema_id);
    if (!schema || schema.tenant_id !== product.tenant_id || schema.entity_kind !== 'service-product') return 'product_schema_not_eligible';
    if (schema.registration_status !== 'registered') return 'product_schema_not_registered';
    return null;
  };

  const datastreams = rows.map((row) => {
    const sourceProductId = sourceProductByObjectId.get(row.id);
    const product = sourceProductId === undefined ? undefined : productById.get(sourceProductId);
    const sameTenantProduct = product && product.tenant_id === row.tenant_id ? product : undefined;
    const apiGateReason = sameTenantProduct ? getProductApiGateReason(sameTenantProduct) : null;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      object_type: row.object_type,
      status: row.status,
      requires_auth: row.requires_auth,
      api_enabled: row.api_enabled,
      requested_api_enabled: sameTenantProduct ? sameTenantProduct.object_api_enabled : row.api_enabled,
      api_gate_open: apiGateReason === null,
      api_gate_reason: apiGateReason,
      publicly_readable: isPublicObjectReadable(row),
      share_enabled: row.share_enabled,
      tenant_id: row.tenant_id,
      updated_at: row.updated_at,
      endpoint_path: `/api/objects/${encodeURIComponent(row.slug)}`,
      source: sameTenantProduct
        ? { kind: 'product' as const, id: sameTenantProduct.integration_id, name: sameTenantProduct.name }
        : { kind: 'object' as const },
    };
  });
  return c.json({ datastreams, total: datastreams.length });
});

// HEAD /api/objects/:idOrSlug — lightweight anonymous API availability probe.
objects.on('HEAD', '/:idOrSlug', async (c) => {
  const idOrSlug = c.req.param('idOrSlug');
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const auth = await getOptionalAuthSession(c);
  if (auth instanceof Response) return auth;

  if (auth && auth.roles.some((role) => ['user', 'staff', 'admin', 'super-admin'].includes(role))) {
    const client = await createSupabaseClient(c.env, auth.token);
    const query = client.from('objects').select('id').neq('status', 'archived');
    const { data, error } = await (isUuid ? query.eq('id', idOrSlug) : query.eq('slug', idOrSlug)).limit(1);
    if (error) return c.body(null, 500);
    return c.body(null, data?.length ? 200 : 404);
  }

  const client = await createSupabaseClient(c.env);
  const query = client.from('objects').select('id')
    .eq('status', 'published').eq('api_enabled', true).eq('requires_auth', false);
  const { data, error } = await (isUuid ? query.eq('id', idOrSlug) : query.eq('slug', idOrSlug)).limit(1);
  if (error) return c.body(null, 500);
  return c.body(null, data?.length ? 200 : 404);
});

// PATCH /api/objects/:id/access — update API visibility on manual Objects or the owning Product source.
objects.patch('/:id/access', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Request body must be an object.' }, 400);
  const input = body as Record<string, unknown>;
  if (typeof input.api_enabled !== 'boolean' || typeof input.requires_auth !== 'boolean') {
    return c.json({ error: 'api_enabled and requires_auth must be boolean values.' }, 400);
  }

  const objectId = c.req.param('id');
  const caller = await createSupabaseClient(c.env, auth.token);
  const { data: visibleObject, error: visibleError } = await caller.from('objects')
    .select('id, status, tenant_id')
    .eq('id', objectId)
    .maybeSingle();
  if (visibleError) return c.json({ error: 'Could not load the Object.' }, 500);
  if (!visibleObject) return c.json({ error: 'Object not found.' }, 404);

  const admin = await createSupabaseAdminClient(c.env);
  const { data: source, error: sourceError } = await admin.from('objects')
    .select('source_product_id')
    .eq('id', objectId)
    .maybeSingle();
  if (sourceError) return c.json({ error: 'Could not load the Object source.' }, 500);

  if (source?.source_product_id != null) {
    const { data: product, error: productError } = await admin.from('mentorbooking_products')
      .select('integration_id, tenant_id')
      .eq('id', source.source_product_id)
      .maybeSingle();
    if (productError) return c.json({ error: 'Could not load Product access settings.' }, 500);
    if (!product || product.tenant_id !== visibleObject.tenant_id) return c.json({ error: 'Object source not found.' }, 404);

    const { error } = await caller.rpc('update_product_object_api_access', {
      target_product_id: product.integration_id,
      target_tenant_id: product.tenant_id,
      target_api_enabled: input.api_enabled,
      target_requires_auth: input.requires_auth,
    });
    if (error) {
      const status = error.code === 'P0002' ? 404 : error.code === '42501' ? 403 : error.code === '22023' ? 400 : 500;
      return c.json({ error: error.message || 'Could not update Product Object API access.' }, status as ContentfulStatusCode);
    }
  } else {
    const { error } = await caller.from('objects')
      .update({ api_enabled: input.api_enabled, requires_auth: input.requires_auth })
      .eq('id', objectId);
    if (error) {
      if (error.code === '42501') return c.json({ error: 'You cannot change access settings for this Object.' }, 403);
      return c.json({ error: 'Could not update Object API access.' }, 500);
    }
  }

  const { data: updated, error: updatedError } = await caller.from('objects')
    .select('id, api_enabled, requires_auth, status')
    .eq('id', objectId)
    .maybeSingle();
  if (updatedError) return c.json({ error: 'Access was saved, but the Object status could not be reloaded.' }, 500);
  if (!updated) return c.json({ error: 'Object not found after updating access.' }, 404);
  return c.json({
    object: {
      ...updated,
      requested_api_enabled: input.api_enabled,
    },
  });
});

// GET /api/objects/:idOrSlug
// Retrieve a single object by ID or slug. Enforces requires_auth if set.
// Returns the schema definition and full data payload.
objects.get('/:idOrSlug', async (c) => {
  const idOrSlug = c.req.param('idOrSlug');
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const auth = await getOptionalAuthSession(c);
  if (auth instanceof Response) return auth;

  if (auth && auth.roles.some((role) => role === 'user' || role === 'staff' || role === 'admin' || role === 'super-admin')) {
    const supabase = await createSupabaseClient(c.env, auth.token);

    const query = supabase
      .from('objects')
      .select(OBJECT_API_COLUMNS);

    const { data: rows, error: dbError } = isUuid
      ? await query.eq('id', idOrSlug).limit(1)
      : await query.eq('slug', idOrSlug).limit(1);

    if (dbError) {
      return c.json({ error: 'Failed to load object.' }, 500);
    }

    const obj = rows?.[0] as ObjectRow | undefined;
    if (!obj || obj.status === 'archived') {
      return c.json({ error: 'Object not found.' }, 404);
    }

    return c.json(serializeObject(obj));
  }

  const supabase = await createSupabaseClient(c.env);
  const query = supabase
    .from('objects')
    .select(OBJECT_PUBLIC_COLUMNS)
    .eq('status', 'published')
    .eq('api_enabled', true)
    .eq('requires_auth', false);

  const { data: rows, error: dbError } = isUuid
    ? await query.eq('id', idOrSlug).limit(1)
    : await query.eq('slug', idOrSlug).limit(1);

  if (dbError) {
    return c.json({ error: 'Failed to load object.' }, 500);
  }

  const obj = rows?.[0] as ObjectRow | undefined;

  if (!obj) {
    return c.json({ error: 'Object not found.' }, 404);
  }

  return c.json(serializeObject(obj));
});

// POST /api/objects — create (user content, enforced by RLS)
objects.post('/', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body.' }, 400);
  }

  const { name, slug, description, agent_description, object_type, schema, data, status, requires_auth, api_enabled, share_enabled, share_slug, tenant_id } = body;

  if (typeof name !== 'string' || !name.trim()) {
    return c.json({ error: 'name is required.' }, 400);
  }
  if (typeof slug !== 'string' || !slug.trim()) {
    return c.json({ error: 'slug is required.' }, 400);
  }

  const supabase = await createSupabaseClient(c.env, auth.token);
  const { data: created, error } = await supabase
    .from('objects')
    .insert({
      name: name.trim(),
      slug: slug.trim(),
      description: typeof description === 'string' ? description : null,
      agent_description: typeof agent_description === 'string' ? agent_description : null,
      object_type: object_type === 'markdown' ? 'markdown' : 'json',
      schema: typeof schema === 'object' && schema !== null ? schema : {},
      data: typeof data === 'object' && data !== null ? data : {},
      status: status === 'archived' ? 'archived' : 'published',
      requires_auth: Boolean(requires_auth),
      api_enabled: api_enabled !== false,
      share_enabled: Boolean(share_enabled),
      share_slug: share_enabled ? (typeof share_slug === 'string' && share_slug.trim() ? share_slug.trim() : slug.trim()) : null,
      tenant_id: typeof tenant_id === 'string' && tenant_id.trim() ? tenant_id.trim() : null,
    })
    .select(OBJECT_API_COLUMNS)
    .single();

  if (error) {
    if (error.code === '23505') {
      return c.json({ error: getObjectConflictMessage(error) }, 409);
    }
    return c.json({ error: 'Failed to create object.' }, 500);
  }

  return c.json(created, 201);
});

// PUT /api/objects/:id — update (user content, enforced by RLS)
objects.put('/:id', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  const id = c.req.param('id');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body.' }, 400);
  }

  const { name, slug, description, agent_description, object_type, schema, data, status, requires_auth, api_enabled, share_enabled, share_slug, tenant_id } = body;

  const patch: Record<string, unknown> = {};
  if (typeof name === 'string' && name.trim()) patch.name = name.trim();
  if (typeof slug === 'string' && slug.trim()) patch.slug = slug.trim();
  if (description !== undefined) patch.description = typeof description === 'string' ? description : null;
  if (agent_description !== undefined) patch.agent_description = typeof agent_description === 'string' ? agent_description : null;
  if (object_type === 'json' || object_type === 'markdown') patch.object_type = object_type;
  if (typeof schema === 'object' && schema !== null) patch.schema = schema;
  if (typeof data === 'object' && data !== null) patch.data = data;
  if (status === 'published' || status === 'archived') patch.status = status;
  if (typeof requires_auth === 'boolean') patch.requires_auth = requires_auth;
  if (typeof api_enabled === 'boolean') patch.api_enabled = api_enabled;
  if (typeof share_enabled === 'boolean') patch.share_enabled = share_enabled;
  if (share_slug === null || share_slug === '') patch.share_slug = null;
  else if (typeof share_slug === 'string' && share_slug.trim()) patch.share_slug = share_slug.trim();
  if (tenant_id === null || tenant_id === '') patch.tenant_id = null;
  else if (typeof tenant_id === 'string' && tenant_id.trim()) patch.tenant_id = tenant_id.trim();

  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'No valid fields to update.' }, 400);
  }

  const supabase = await createSupabaseClient(c.env, auth.token);
  const { data: current, error: currentError } = await supabase
    .from('objects')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (currentError) return c.json({ error: 'Failed to load object.' }, 500);
  if (!current) return c.json({ error: 'Object not found.' }, 404);
  const admin = await createSupabaseAdminClient(c.env);
  const { data: source, error: sourceError } = await admin.from('objects').select('source_product_id').eq('id', id).maybeSingle();
  if (sourceError) return c.json({ error: 'Failed to load object source.' }, 500);
  if (source?.source_product_id != null) return c.json({ error: 'This object is managed by its product and cannot be edited here.' }, 409);

  const { data: updated, error } = await supabase
    .from('objects')
    .update(patch)
    .eq('id', id)
    .select(OBJECT_API_COLUMNS)
    .single();

  if (error) {
    if (error.code === '23505') {
      return c.json({ error: getObjectConflictMessage(error) }, 409);
    }
    return c.json({ error: 'Failed to update object.' }, 500);
  }

  if (!updated) {
    return c.json({ error: 'Object not found.' }, 404);
  }

  return c.json(updated);
});

// DELETE /api/objects/:id — archive (user content, enforced by RLS)
objects.delete('/:id', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  const id = c.req.param('id');
  const supabase = await createSupabaseClient(c.env, auth.token);

  const { data: current, error: currentError } = await supabase
    .from('objects')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (currentError) return c.json({ error: 'Failed to load object.' }, 500);
  if (!current) return c.json({ error: 'Object not found.' }, 404);
  const admin = await createSupabaseAdminClient(c.env);
  const { data: source, error: sourceError } = await admin.from('objects').select('source_product_id').eq('id', id).maybeSingle();
  if (sourceError) return c.json({ error: 'Failed to load object source.' }, 500);
  if (source?.source_product_id != null) return c.json({ error: 'This object is managed by its product and cannot be archived here.' }, 409);

  const { error } = await supabase
    .from('objects')
    .update({ status: 'archived' })
    .eq('id', id);

  if (error) {
    return c.json({ error: 'Failed to archive object.' }, 500);
  }

  return c.json({ success: true });
});

/**
 * Programmatic object creation for use by plugins, queue consumers, and hooks.
 * Uses the admin client (bypasses RLS) — callers are responsible for authorization.
 */
export interface CreateObjectInternalInput {
  name: string;
  slug: string;
  description?: string | null;
  agent_description?: string | null;
  object_type?: 'json' | 'markdown';
  schema?: Record<string, unknown>;
  data?: Record<string, unknown> | unknown[];
  status?: 'published' | 'archived';
  requires_auth?: boolean;
  api_enabled?: boolean;
  share_enabled?: boolean;
  share_slug?: string | null;
  tenant_id?: string | null;
}

export async function createObjectInternal(
  env: Env,
  input: CreateObjectInternalInput,
): Promise<ObjectRow> {
  const admin = await createSupabaseAdminClient(env);
  const { data, error } = await admin
    .from('objects')
    .insert({
      name: input.name.trim(),
      slug: input.slug.trim(),
      description: input.description ?? null,
      agent_description: input.agent_description ?? null,
      object_type: input.object_type === 'markdown' ? 'markdown' : 'json',
      schema: input.schema ?? {},
      data: input.data ?? {},
      status: input.status === 'archived' ? 'archived' : 'published',
      requires_auth: input.requires_auth ?? false,
      api_enabled: input.api_enabled ?? false,
      share_enabled: input.share_enabled ?? false,
      share_slug: input.share_enabled ? (input.share_slug?.trim() || input.slug.trim()) : null,
      tenant_id: input.tenant_id?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create object: ${error.message}`);
  }

  return data as ObjectRow;
}

/**
 * Programmatic hard-delete of an object by share_slug.
 * Uses the admin client (bypasses RLS) — callers are responsible for authorization.
 * Returns true if an object was deleted, false if no matching object was found.
 */
export async function deleteObjectInternal(
  env: Env,
  shareSlug: string,
): Promise<boolean> {
  const admin = await createSupabaseAdminClient(env);
  const { error, count } = await admin
    .from('objects')
    .delete()
    .eq('share_slug', shareSlug);

  if (error) {
    throw new Error(`Failed to delete object: ${error.message}`);
  }

  return (count ?? 0) > 0;
}

export default objects;
