import { Hono } from 'hono';
import { createSupabaseAdminClient, createSupabaseClient, type Env } from '../lib/supabase';
import { getOptionalAuthSession, parseBearerToken, requireAppRole } from '../lib/auth';

const objects = new Hono<{ Bindings: Env }>();

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
  created_at: string;
  updated_at: string;
}

interface ObjectWithTenantRow extends ObjectRow {
  tenants?: {
    name: string;
    slug?: string;
  } | null;
}

const normalizeTenantNameSegment = (value: string): string => value
  .toLowerCase()
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
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  tenantNameSegment: string,
  shareSlug: string,
): Promise<ObjectRow | null> => {
  const { data, error } = await supabase
    .from('objects')
    .select('*, tenants:tenant_id (name, slug)')
    .eq('share_slug', shareSlug)
    .eq('share_enabled', true)
    .neq('status', 'archived')
    .limit(20);

  if (error) {
    throw error;
  }

  const candidates = (data as ObjectWithTenantRow[] | null) ?? [];
  const requestedTenantSegment = normalizeTenantNameSegment(tenantNameSegment);

  for (const obj of candidates) {
    if (!obj.tenant_id) {
      continue;
    }

    let resolvedTenantName: string | null = obj.tenants?.name ?? null;
    let resolvedTenantSlug: string | null = obj.tenants?.slug ?? null;

    if ((!resolvedTenantName || !resolvedTenantSlug) && obj.tenant_id) {
      const admin = await createSupabaseAdminClient(env);
      const { data: tenantData, error: tenantError } = await admin
        .from('tenants')
        .select('name, slug')
        .eq('id', obj.tenant_id)
        .maybeSingle();

      if (tenantError) {
        throw tenantError;
      }

      resolvedTenantName = typeof tenantData?.name === 'string' ? tenantData.name : resolvedTenantName;
      resolvedTenantSlug = typeof tenantData?.slug === 'string' ? tenantData.slug : resolvedTenantSlug;
    }

    const matchesTenant = [resolvedTenantName, resolvedTenantSlug]
      .filter((value): value is string => Boolean(value))
      .some((value) => normalizeTenantNameSegment(value) === requestedTenantSegment);

    if (matchesTenant) {
      return obj;
    }
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

      const { data, error: dbError } = await supabase
        .from('objects')
        .select('id, name, slug, description, agent_description, object_type, status, requires_auth, api_enabled, share_enabled, share_slug, created_at, updated_at')
        .neq('status', 'archived')
        .order('updated_at', { ascending: false });

      if (dbError) {
        return c.json({ error: 'Failed to load objects.' }, 500);
      }

      return c.json({ objects: data ?? [] });
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

objects.get('/share/:tenantName/:shareSlug', async (c) => {
  const token = parseBearerToken(c.req.header('Authorization'));
  const supabase = await createSupabaseClient(c.env, token);

  const obj = await getObjectByShareSlug(c.env, supabase, c.req.param('tenantName'), c.req.param('shareSlug'));
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
      .select('*');

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
    .select('*')
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
    .select()
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
  const { data: updated, error } = await supabase
    .from('objects')
    .update(patch)
    .eq('id', id)
    .select()
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

  const { error } = await supabase
    .from('objects')
    .update({ status: 'archived' })
    .eq('id', id);

  if (error) {
    return c.json({ error: 'Failed to archive object.' }, 500);
  }

  return c.json({ success: true });
});

export default objects;
