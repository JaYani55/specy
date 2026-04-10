import { supabase } from '@/lib/supabase';
import type { PageSchema, PageSchemaTemplate, PageRecord, PageBuilderData, TLDGroup } from '@/types/pagebuilder';

import { API_URL } from '@/lib/apiUrl';

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

const ensureUniquePageSlug = async (requestedSlug: string, pageId?: string): Promise<string> => {
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

export const getSchemas = async (): Promise<PageSchema[]> => {
  const { data, error } = await supabase
    .from('page_schemas')
    .select('*')
    .neq('registration_status', 'archived')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return data as PageSchema[];
};

export const getSchemaTemplates = async (): Promise<PageSchemaTemplate[]> => {
  if (!API_URL) {
    return [];
  }

  const response = await fetch(`${API_URL}/api/schemas/templates`, {
    headers: { Accept: 'application/json' },
  });

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

export const getSchema = async (slugOrId: string): Promise<PageSchema & { page_count: number }> => {
  // Try by slug first, then by id
  const query = supabase
    .from('page_schemas')
    .select('*')
    .eq('slug', slugOrId)
    .single();

  let { data, error } = await query;

  if (error || !data) {
    // Try by id
    const result = await supabase
      .from('page_schemas')
      .select('*')
      .eq('id', slugOrId)
      .single();
    data = result.data;
    error = result.error;
  }

  if (error || !data) throw new Error(error?.message || 'Schema not found');

  // Get page count
  const { count } = await supabase
    .from('pages')
    .select('*', { count: 'exact', head: true })
    .eq('schema_id', data.id);

  return { ...(data as PageSchema), page_count: count ?? 0 };
};

export const createSchema = async (input: {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
  llm_instructions?: string;
}): Promise<PageSchema> => {
  const slug = generateSlug(input.name);
  const registrationCode = generateRegistrationCode();

  const { data, error } = await supabase
    .from('page_schemas')
    .insert({
      name: input.name,
      slug,
      description: input.description || null,
      schema: input.schema,
      llm_instructions: input.llm_instructions || null,
      registration_code: registrationCode,
      registration_status: 'waiting',
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as PageSchema;
};

export const updateSchema = async (
  id: string,
  input: Partial<{
    name: string;
    description: string;
    schema: Record<string, unknown>;
    llm_instructions: string;
  }>
): Promise<PageSchema> => {
  const updateData: Record<string, unknown> = { ...input };
  if (input.name) {
    updateData.slug = generateSlug(input.name);
  }

  const { data, error } = await supabase
    .from('page_schemas')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as PageSchema;
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

export const getPagesBySchema = async (schemaId: string): Promise<PageRecord[]> => {
  const { data, error } = await supabase
    .from('pages')
    .select('id, slug, name, status, is_draft, schema_id, domain_url, updated_at, published_at')
    .eq('schema_id', schemaId)
    .order('updated_at', { ascending: false });

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
): Promise<{ id: string; slug: string }> => {
  const slug = await ensureUniquePageSlug(requestedSlug || pageName, pageId);

  if (pageId) {
    // Update existing page
    const { data, error } = await supabase
      .from('pages')
      .update({ content, slug, name: pageName })
      .eq('id', pageId)
      .select('id, slug')
      .single();

    if (error) throw new Error(error.message);
    return data as { id: string; slug: string };
  } else {
    // Create new page
    const { data, error } = await supabase
      .from('pages')
      .insert({
        name: pageName,
        slug,
        content,
        status: 'draft',
        schema_id: schemaId,
      })
      .select('id, slug')
      .single();

    if (error) throw new Error(error.message);
    return data as { id: string; slug: string };
  }
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
  const updateData: Record<string, unknown> = { status };
  if (status === 'published') {
    updateData.published_at = new Date().toISOString();
  }

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

// --- Legacy Compatibility ---

/**
 * @deprecated Use getPage() directly. This wrapper exists for backward compat
 * with the old PageBuilder that accessed pages via mentorbooking_products.
 */
export const getProductPageData = async (mentorProductId: string) => {
  const { data: mentorProduct, error: mentorProductError } = await supabase
    .from('mentorbooking_products')
    .select('product_page_id, name')
    .eq('id', mentorProductId)
    .single();

  if (mentorProductError) throw new Error(mentorProductError.message);
  if (!mentorProduct) throw new Error('Mentor product not found.');

  if (!mentorProduct.product_page_id) {
    return { product: null, name: mentorProduct.name };
  }

  const { data: productPage, error: productPageError } = await supabase
    .from('pages')
    .select('content')
    .eq('id', mentorProduct.product_page_id)
    .single();

  if (productPageError) throw new Error(productPageError.message);

  return { product: productPage.content as PageBuilderData, name: mentorProduct.name };
};

/**
 * @deprecated Use savePage() directly. Legacy wrapper for old PageBuilder flow.
 */
export const saveProductPage = async (
  mentorProductId: string,
  content: PageBuilderData,
  productName: string
): Promise<{ slug: string }> => {
  const { data: existingMentorProduct, error: existingMentorProductError } = await supabase
    .from('mentorbooking_products')
    .select('product_page_id')
    .eq('id', mentorProductId)
    .single();

  if (existingMentorProductError) throw new Error(existingMentorProductError.message);

  const slug = await ensureUniquePageSlug(productName, existingMentorProduct?.product_page_id ?? undefined);

  if (existingMentorProduct?.product_page_id) {
    const { error } = await supabase
      .from('pages')
      .update({ content, slug, name: productName })
      .eq('id', existingMentorProduct.product_page_id);

    if (error) throw error;
  } else {
    // Get the service-product schema id for legacy pages
    const { data: schemaData } = await supabase
      .from('page_schemas')
      .select('id')
      .eq('slug', 'service-product')
      .single();

    const { data: newPage, error: newPageError } = await supabase
      .from('pages')
      .insert({
        name: productName,
        slug,
        content,
        status: 'draft',
        schema_id: schemaData?.id || null,
      })
      .select('id')
      .single();

    if (newPageError) throw newPageError;

    const { error: updateError } = await supabase
      .from('mentorbooking_products')
      .update({ product_page_id: newPage.id })
      .eq('id', mentorProductId);

    if (updateError) throw updateError;
  }

  return { slug };
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

export const triggerRevalidation = async (schemaSlug: string, pageSlug: string): Promise<{
  success: boolean;
  message: string;
}> => {
  if (!API_URL) {
    return { success: false, message: 'API URL not configured' };
  }

  try {
    const response = await fetch(`${API_URL}/api/schemas/${schemaSlug}/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_slug: pageSlug }),
    });
    return await response.json();
  } catch {
    return { success: false, message: 'Failed to reach API' };
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
