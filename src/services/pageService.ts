import { supabase } from '@/lib/supabase';
import {
  DEFAULT_SCHEMA_INTEGRATION_REQUIREMENTS,
  type PageSchema,
  type PageSchemaTemplate,
  type PageRecord,
  type TLDGroup,
  type SchemaIntegrationRequirements,
  type SchemaEntityKind,
  type SchemaFrontendTarget,
  type SchemaFrontendTargetInput,
} from '@/types/pagebuilder';

import { API_URL } from '@/lib/apiUrl';

export interface RevalidationTargetDiagnostic {
  target_key: string;
  path: string;
  endpoint: string;
  status: number;
  success: boolean;
  message: string;
}

export interface RevalidationDiagnostics {
  httpStatus?: number;
  message?: string;
  error?: string;
  targets?: RevalidationTargetDiagnostic[];
}

export interface RevalidationResult {
  success: boolean;
  message: string;
  diagnostics?: RevalidationDiagnostics;
}

export interface RevalidationSecretStatus {
  configured: boolean;
  secret_name: string | null;
  legacy_plaintext: boolean;
  registration_status: string;
  frontend_url: string | null;
  revalidation_endpoint: string | null;
  management_available?: boolean;
  readonly_fallback?: boolean;
  warning?: string | null;
  warning_code?: 'supabase_admin_credential' | 'secrets_encryption_key' | 'both_worker_keys' | 'managed_secret_access' | null;
}

export interface CreateSchemaTemplateInput {
  name: string;
  slug?: string;
  description?: string;
  icon?: string;
  schema: Record<string, unknown>;
  llm_instructions?: string;
  source_schema_id?: string;
  external_source_url?: string;
}

const normalizeIntegrationRequirements = (
  requirements?: Partial<SchemaIntegrationRequirements> | null,
): SchemaIntegrationRequirements => ({
  ...DEFAULT_SCHEMA_INTEGRATION_REQUIREMENTS,
  ...(requirements ?? {}),
});

async function createAuthenticatedHeaders(extraHeaders?: HeadersInit): Promise<Headers> {
  const headers = new Headers(extraHeaders);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return headers;
}

// --- Slug Utilities ---

const generateSlug = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

const normalizeSlug = (value: string): string => {
  const normalized = generateSlug(value);
  return normalized || 'page';
};

const ensureUniqueSchemaSlug = async (requestedSlug: string, tenantId: string | null, schemaId?: string): Promise<string> => {
  const baseSlug = normalizeSlug(requestedSlug);
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    let query = supabase
      .from('page_schemas')
      .select('id')
      .eq('slug', candidate)
      .limit(1);
    query = tenantId ? query.eq('tenant_id', tenantId) : query.is('tenant_id', null);
    if (schemaId) query = query.neq('id', schemaId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return candidate;

    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
};

export const ensureUniquePageSlug = async (requestedSlug: string, pageId?: string): Promise<string> => {
  const baseSlug = normalizeSlug(requestedSlug);
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    let query = supabase
      .from('pages')
      .select('id')
      .eq('slug', candidate)
      .limit(1);

    if (pageId) {
      query = query.neq('id', pageId);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      return candidate;
    }

    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
};

const generateRegistrationCode = (): string => {
  const segments = [];
  for (let i = 0; i < 4; i++) {
    segments.push(Math.random().toString(36).substring(2, 8));
  }
  return segments.join('-');
};

// --- Schema CRUD ---

export const getSchemas = async (tenantId?: string | null): Promise<PageSchema[]> => {
  let query = supabase
    .from('page_schemas')
    .select('*, tenants:tenant_id(slug), schema_frontend_targets(id, schema_id, tenant_id, target_key, kind, host_path, placement_key, supports_preview, is_primary, sort_order, enabled)')
    .neq('registration_status', 'archived')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });
  if (tenantId) query = query.or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
  const { data, error } = await query;

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const schema = row as PageSchema & {
      tenants?: { slug?: string } | Array<{ slug?: string }> | null;
      schema_frontend_targets?: SchemaFrontendTarget[] | null;
    };
    const tenant = Array.isArray(schema.tenants) ? schema.tenants[0] : schema.tenants;
    return {
      ...schema,
      tenant_slug: tenant?.slug ?? null,
      frontend_targets: schema.schema_frontend_targets ?? [],
    };
  });
};

export const getSchemaTemplates = async (): Promise<PageSchemaTemplate[]> => {
  if (!API_URL) {
    return [];
  }

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session?.access_token) {
    // SchemaEditor can mount during auth hydration. Do not issue an
    // unauthenticated request to the protected template endpoint.
    return [];
  }

  const response = await fetch(`${API_URL}/api/schemas/templates`, {
    headers: { Accept: 'application/json' },
  });

  if (response.status === 401 || response.status === 403) {
    return [];
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to load schema templates' })) as { error?: string };
    throw new Error(body.error ?? 'Failed to load schema templates');
  }

  const body = await response.json() as { templates?: PageSchemaTemplate[] };
  return body.templates ?? [];
};

export const createSchemaTemplate = async (input: CreateSchemaTemplateInput): Promise<PageSchemaTemplate> => {
  if (!API_URL) {
    throw new Error('API URL not configured');
  }

  const response = await fetch(`${API_URL}/api/schemas/templates`, {
    method: 'POST',
    headers: await createAuthenticatedHeaders({
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to create schema template' })) as { error?: string };
    throw new Error(body.error ?? 'Failed to create schema template');
  }

  const body = await response.json() as { template: PageSchemaTemplate };
  return body.template;
};

export const importSchemaTemplate = async (url: string): Promise<PageSchemaTemplate> => {
  if (!API_URL) {
    throw new Error('API URL not configured');
  }

  const response = await fetch(`${API_URL}/api/schemas/templates/import`, {
    method: 'POST',
    headers: await createAuthenticatedHeaders({
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }),
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to import schema template' })) as { error?: string };
    throw new Error(body.error ?? 'Failed to import schema template');
  }

  const body = await response.json() as { template: PageSchemaTemplate };
  return body.template;
};

export const getSchema = async (slugOrId: string, tenantSlug?: string): Promise<PageSchema & { page_count: number }> => {
  let data: Record<string, unknown> | null = null;
  let error: { message: string } | null = null;

  if (tenantSlug) {
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('id')
      .eq('slug', tenantSlug)
      .single();
    if (tenantError || !tenant) throw new Error(tenantError?.message || 'Workspace not found');

    const result = await supabase
      .from('page_schemas')
      .select('*, tenants:tenant_id(slug)')
      .eq('tenant_id', tenant.id)
      .eq('slug', slugOrId)
      .single();
    data = result.data as Record<string, unknown> | null;
    error = result.error;
  } else {
    // The one-segment route is the compatibility path. api_slug preserves the
    // original globally unique slug for every schema that predates this change.
    const result = await supabase
      .from('page_schemas')
      .select('*, tenants:tenant_id(slug)')
      .eq('api_slug', slugOrId)
      .single();
    data = result.data as Record<string, unknown> | null;
    error = result.error;
  }

  if (error || !data) {
    const result = await supabase
      .from('page_schemas')
      .select('*, tenants:tenant_id(slug)')
      .eq('id', slugOrId)
      .single();
    data = result.data as Record<string, unknown> | null;
    error = result.error;
  }

  if (error || !data) throw new Error(error?.message || 'Schema not found');
  const tenantRelation = data.tenants as { slug?: string } | Array<{ slug?: string }> | null | undefined;
  const tenant = Array.isArray(tenantRelation) ? tenantRelation[0] : tenantRelation;
  data.tenant_slug = tenant?.slug ?? null;

  // Get page count
  const { count } = await supabase
    .from('pages')
    .select('*', { count: 'exact', head: true })
    .eq('schema_id', data.id);

  let frontendTargets: SchemaFrontendTarget[] = [];
  if (API_URL) {
    try {
      const response = await fetch(`${API_URL}/api/schemas/${data.api_slug}/spec`, {
        headers: await createAuthenticatedHeaders({ Accept: 'application/json' }),
      });
      if (response.ok) {
        const contract = await response.json() as { targets?: SchemaFrontendTarget[] };
        frontendTargets = contract.targets ?? [];
      }
    } catch {
      // Target metadata is additive; legacy schema loading remains functional.
    }
  }

  return { ...(data as unknown as PageSchema), frontend_targets: frontendTargets, page_count: count ?? 0 };
};

export const saveSchemaFrontendTargets = async (
  schemaId: string,
  targets: SchemaFrontendTargetInput[],
): Promise<SchemaFrontendTarget[]> => {
  if (!API_URL) throw new Error('API URL not configured');

  const response = await fetch(`${API_URL}/api/schemas/${schemaId}/frontend-targets`, {
    method: 'PUT',
    headers: await createAuthenticatedHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: JSON.stringify({ targets }),
  });

  const body = await response.json().catch(() => ({})) as { error?: string; targets?: SchemaFrontendTarget[] };
  if (!response.ok) throw new Error(body.error ?? 'Failed to save frontend targets');
  return body.targets ?? [];
};

export const createSchema = async (input: {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
  llm_instructions?: string;
  integration_requirements?: Partial<SchemaIntegrationRequirements> | null;
  tenant_id?: string | null;
  entity_kind?: SchemaEntityKind;
  editor_config?: Record<string, unknown>;
}): Promise<PageSchema> => {
  const slug = await ensureUniqueSchemaSlug(input.name, input.tenant_id ?? null);
  const registrationCode = generateRegistrationCode();
  const integrationRequirements = normalizeIntegrationRequirements(input.integration_requirements);

  const { data, error } = await supabase
    .from('page_schemas')
    .insert({
      name: input.name,
      slug,
      description: input.description || null,
      schema: input.schema,
      llm_instructions: input.llm_instructions || null,
      integration_requirements: integrationRequirements,
      slug_structure: integrationRequirements.required_slug_structure ?? '/:slug',
      content_scope: input.integration_requirements?.content_scope ?? 'page-collection',
      page_target: input.integration_requirements?.page_target ?? null,
      tenant_id: input.tenant_id || null,
      entity_kind: input.entity_kind ?? 'page',
      editor_config: input.editor_config ?? {},
      registration_code: registrationCode,
      registration_status: 'waiting',
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  if (API_URL) {
    try {
      const bootstrapResponse = await fetch(`${API_URL}/api/specs/bootstrap/schema/${data.id}`, {
        method: 'POST',
        headers: await createAuthenticatedHeaders({
          'Accept': 'application/json',
        }),
      });

      if (!bootstrapResponse.ok) {
        const body = await bootstrapResponse.json().catch(() => ({ error: 'Failed to bootstrap main spec' })) as { error?: string };
        console.warn('[pageService] Schema created without bootstrapped main spec:', body.error ?? 'Failed to bootstrap main spec');
      }
    } catch (bootstrapError) {
      console.warn('[pageService] Schema created but spec bootstrap request failed:', bootstrapError);
    }
  }

  return data as PageSchema;
};

export const updateSchema = async (
  id: string,
  input: Partial<{
    name: string;
    description: string | null;
    schema: Record<string, unknown>;
    llm_instructions: string | null;
    integration_requirements: Partial<SchemaIntegrationRequirements> | null;
    tenant_id: string | null;
    entity_kind: SchemaEntityKind;
    editor_config: Record<string, unknown>;
    /** Explicit acknowledgment required to reclassify a schema that already has pages. */
    allow_reclassification?: boolean;
    /** Caller-confirmed page count; must match the schema's actual page count for a reclassification. */
    expected_page_count?: number;
  }>,
  expectedRevision?: number,
): Promise<PageSchema> => {
  if (!API_URL) throw new Error('API URL not configured');
  const { data: current, error: currentError } = await supabase
    .from('page_schemas')
    .select('api_slug, definition_revision')
    .eq('id', id)
    .single();
  if (currentError || !current) throw new Error(currentError?.message || 'Schema not found');

  const revision = expectedRevision ?? Number(current.definition_revision ?? 1);
  const patch: Record<string, unknown> = { ...input, expected_revision: revision };
  if (Object.prototype.hasOwnProperty.call(input, 'name') && input.name) {
    const { data: schemaData, error: schemaError } = await supabase
      .from('page_schemas')
      .select('tenant_id')
      .eq('id', id)
      .single();
    if (schemaError || !schemaData) throw new Error(schemaError?.message || 'Schema not found');
    const tenantId = Object.prototype.hasOwnProperty.call(input, 'tenant_id') ? input.tenant_id ?? null : schemaData.tenant_id;
    patch.slug = await ensureUniqueSchemaSlug(input.name, tenantId, id);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'integration_requirements')) {
    patch.integration_requirements = normalizeIntegrationRequirements(input.integration_requirements);
  }

  const response = await fetch(`${API_URL}/api/schemas/${encodeURIComponent(current.api_slug)}/definition`, {
    method: 'PATCH',
    headers: await createAuthenticatedHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: JSON.stringify(patch),
  });
  const body = await response.json().catch(() => ({})) as { error?: string; schema?: PageSchema };
  if (!response.ok || !body.schema) throw new Error(body.error ?? 'Failed to update schema definition');
  return body.schema;
};

export const deleteSchema = async (id: string): Promise<void> => {
  const { error } = await supabase
    .from('page_schemas')
    .update({ registration_status: 'archived' })
    .eq('id', id);

  if (error) throw new Error(error.message);
};

export const unhookSchema = async (schemaSlug: string): Promise<void> => {
  if (!API_URL) {
    throw new Error('API URL not configured');
  }

  const response = await fetch(`${API_URL}/api/schemas/${schemaSlug}/unhook`, {
    method: 'POST',
    headers: await createAuthenticatedHeaders({
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to unhook schema' })) as { error?: string };
    throw new Error(body.error ?? 'Failed to unhook schema');
  }
};

export const startSchemaRegistration = async (id: string): Promise<PageSchema> => {
  const registrationCode = generateRegistrationCode();

  const { data, error } = await supabase
    .from('page_schemas')
    .update({
      registration_code: registrationCode,
      registration_status: 'waiting',
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as PageSchema;
};

export const cancelSchemaRegistration = async (id: string): Promise<PageSchema> => {
  const { data, error } = await supabase
    .from('page_schemas')
    .update({
      registration_code: null,
      registration_status: 'pending',
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as PageSchema;
};

export const getSchemaRegistrationStatus = async (id: string): Promise<{
  registration_status: string;
  frontend_url: string | null;
}> => {
  const { data, error } = await supabase
    .from('page_schemas')
    .select('registration_status, frontend_url')
    .eq('id', id)
    .single();

  if (error) throw new Error(error.message);
  return data;
};

// --- Pages CRUD ---

export const getPagesBySchema = async (schemaId: string, tenantId?: string | null): Promise<PageRecord[]> => {
  let query = supabase
    .from('pages')
    .select('id, slug, name, status, is_draft, schema_id, domain_url, updated_at, published_at')
    .eq('schema_id', schemaId)
    .order('updated_at', { ascending: false });
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;

  if (error) throw new Error(error.message);
  return (data ?? []) as PageRecord[];
};

export const getPage = async (pageId: string): Promise<PageRecord> => {
  const { data, error } = await supabase
    .from('pages')
    .select('*')
    .eq('id', pageId)
    .single();

  if (error) throw new Error(error.message);
  return data as PageRecord;
};

export const savePage = async (
  pageId: string | undefined,
  content: Record<string, unknown>,
  pageName: string,
  schemaId: string,
  requestedSlug?: string,
  tenantId?: string | null,
): Promise<{ id: string; slug: string }> => {
  const { data: schema, error: schemaError } = await supabase
    .from('page_schemas')
    .select('tenant_id, entity_kind')
    .eq('id', schemaId)
    .single();
  if (schemaError || !schema) throw new Error(schemaError?.message || 'Schema not found.');
  if (schema.entity_kind && schema.entity_kind !== 'page') {
    throw new Error(`This ${schema.entity_kind} schema requires an entity-aware save operation.`);
  }
  if (tenantId !== undefined && (tenantId || null) !== (schema.tenant_id || null)) {
    throw new Error('Page tenant must match the owning schema workspace.');
  }

  const slug = await ensureUniquePageSlug(requestedSlug || pageName, pageId);
  const normalizedTenantId = schema.tenant_id || null;

  if (pageId) {
    const { data: current, error: currentError } = await supabase
      .from('pages')
      .select('id, schema_id, tenant_id')
      .eq('id', pageId)
      .single();
    if (currentError || !current) throw new Error(currentError?.message || 'Page not found.');
    if (current.schema_id !== schemaId || (current.tenant_id || null) !== normalizedTenantId) {
      throw new Error('The page does not belong to the selected schema and workspace.');
    }

    let updateQuery = supabase
      .from('pages')
      .update({ content, slug, name: pageName })
      .eq('id', pageId)
      .eq('schema_id', schemaId);
    updateQuery = normalizedTenantId
      ? updateQuery.eq('tenant_id', normalizedTenantId)
      : updateQuery.is('tenant_id', null);
    const { data, error } = await updateQuery.select('id, slug').single();

    if (error) throw new Error(error.message);
    return data as { id: string; slug: string };
  }

  const { data, error } = await supabase
    .from('pages')
    .insert({
      name: pageName,
      slug,
      content,
      status: 'draft',
      schema_id: schemaId,
      tenant_id: normalizedTenantId,
    })
    .select('id, slug')
    .single();

  if (error) throw new Error(error.message);
  return data as { id: string; slug: string };
};

export const deletePage = async (pageId: string): Promise<void> => {
  const { error } = await supabase
    .from('pages')
    .delete()
    .eq('id', pageId);

  if (error) throw new Error(error.message);
};

export const updatePageStatus = async (
  pageId: string,
  status: 'draft' | 'published' | 'archived'
): Promise<void> => {
  // The database publication trigger owns published_at semantics so MCP,
  // dashboard, and other API writers cannot diverge.
  const updateData: Record<string, unknown> = { status };

  const { error } = await supabase
    .from('pages')
    .update(updateData)
    .eq('id', pageId);

  if (error) throw new Error(error.message);
};

// --- TLD Grouping ---

/**
 * Groups schemas by their frontend_url (TLD).
 * Schemas without a frontend_url go into a group with domain = null.
 */
export const groupSchemasByTLD = (schemas: PageSchema[]): TLDGroup[] => {
  const map = new Map<string, PageSchema[]>();

  for (const schema of schemas) {
    const key = schema.frontend_url || '__unassigned__';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(schema);
  }

  const groups: TLDGroup[] = [];

  // Assigned domains first, sorted alphabetically
  const assignedKeys = [...map.keys()]
    .filter(k => k !== '__unassigned__')
    .sort();

  for (const key of assignedKeys) {
    groups.push({
      domain: key,
      health: 'unknown',
      schemas: map.get(key)!,
    });
  }

  // Unassigned schemas last
  if (map.has('__unassigned__')) {
    groups.push({
      domain: null,
      health: 'unknown',
      schemas: map.get('__unassigned__')!,
    });
  }

  return groups;
};

/**
 * Direct health check for a domain URL via the Hono Worker.
 * Does not require a schema slug — pings any URL.
 */
export const checkDomainHealthDirect = async (url: string): Promise<{
  status: 'online' | 'offline';
  latency_ms: number;
}> => {
  if (!API_URL) {
    return { status: 'offline', latency_ms: 0 };
  }

  try {
    const response = await fetch(`${API_URL}/api/schemas/health/domain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) throw new Error('Health check failed');
    return await response.json();
  } catch {
    return { status: 'offline', latency_ms: 0 };
  }
};

// --- API Communication (Hono Worker) ---

export const checkDomainHealth = async (schemaSlug: string): Promise<{
  status: 'online' | 'offline';
  latency_ms: number;
}> => {
  if (!API_URL) {
    return { status: 'offline', latency_ms: 0 };
  }

  try {
    const response = await fetch(`${API_URL}/api/schemas/${schemaSlug}/health`);
    if (!response.ok) throw new Error('Health check failed');
    return await response.json();
  } catch {
    return { status: 'offline', latency_ms: 0 };
  }
};

export const triggerRevalidation = async (schemaSlug: string, pageSlug: string): Promise<RevalidationResult> => {
  if (!API_URL) {
    return {
      success: false,
      message: 'Could not reach the revalidation service.',
      diagnostics: { error: 'API URL is not configured.' },
    };
  }

  try {
    const headers = await createAuthenticatedHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
    const response = await fetch(`${API_URL}/api/schemas/${encodeURIComponent(schemaSlug)}/revalidate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ page_slug: pageSlug }),
    });
    const responseBody = (await response.text().catch(() => '')).slice(0, 4096);
    let payload: {
      success?: boolean;
      message?: string;
      error?: string;
      results?: unknown[];
    } | null = null;
    if (responseBody) {
      try {
        payload = JSON.parse(responseBody) as typeof payload;
      } catch {
        payload = { message: responseBody };
      }
    }
    const targets = (payload?.results ?? []).flatMap((value): RevalidationTargetDiagnostic[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const row = value as Record<string, unknown>;
      if (typeof row.target_key !== 'string' || typeof row.path !== 'string'
        || typeof row.endpoint !== 'string' || typeof row.status !== 'number'
        || typeof row.success !== 'boolean' || typeof row.message !== 'string') return [];
      return [{
        target_key: row.target_key,
        path: row.path,
        endpoint: row.endpoint,
        status: row.status,
        success: row.success,
        message: row.message,
      }];
    });
    const success = response.ok && payload?.success === true;
    return {
      success,
      message: success ? 'Frontend revalidation completed.' : 'Frontend revalidation failed.',
      diagnostics: {
        httpStatus: response.status,
        ...(payload?.message ? { message: payload.message } : {}),
        ...(payload?.error ? { error: payload.error } : {}),
        ...(targets.length ? { targets } : {}),
      },
    };
  } catch (error) {
    return {
      success: false,
      message: 'Could not reach the revalidation service.',
      diagnostics: { error: error instanceof Error ? error.message : 'Unknown network error.' },
    };
  }
};

export const getRevalidationSecretStatus = async (schemaSlug: string): Promise<RevalidationSecretStatus> => {
  if (!API_URL) {
    throw new Error('API URL not configured');
  }

  const response = await fetch(`${API_URL}/api/schemas/${schemaSlug}/revalidation-secret/status`, {
    headers: await createAuthenticatedHeaders({ Accept: 'application/json' }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to load revalidation secret status' })) as { error?: string };
    throw new Error(body.error ?? 'Failed to load revalidation secret status');
  }

  return response.json() as Promise<RevalidationSecretStatus>;
};

export const setRevalidationSecret = async (schemaSlug: string, secret: string): Promise<void> => {
  if (!API_URL) {
    throw new Error('API URL not configured');
  }

  const response = await fetch(`${API_URL}/api/schemas/${schemaSlug}/revalidation-secret`, {
    method: 'PUT',
    headers: await createAuthenticatedHeaders({
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }),
    body: JSON.stringify({ secret }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to save revalidation secret' })) as { error?: string };
    throw new Error(body.error ?? 'Failed to save revalidation secret');
  }
};

export const deleteRevalidationSecret = async (schemaSlug: string): Promise<void> => {
  if (!API_URL) {
    throw new Error('API URL not configured');
  }

  const response = await fetch(`${API_URL}/api/schemas/${schemaSlug}/revalidation-secret`, {
    method: 'DELETE',
    headers: await createAuthenticatedHeaders({ Accept: 'application/json' }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Failed to delete revalidation secret' })) as { error?: string };
    throw new Error(body.error ?? 'Failed to delete revalidation secret');
  }
};
