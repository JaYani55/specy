import { bootstrapSchemaMainSpec } from './specRegistry';
import { verifyAuthSession } from './auth';
import { createSupabaseClient, type Env } from './supabase';
import {
  normalizeSchemaIntegrationRequirements,
  type SchemaIntegrationRequirementsRecord,
} from './schemaRouting';

export interface CreatePendingSchemaInput {
  name: string;
  slug?: string;
  description?: string | null;
  schema: Record<string, unknown>;
  llm_instructions?: string | null;
  integration_requirements?: SchemaIntegrationRequirementsRecord | null;
  content_scope?: 'page-collection' | 'single-page';
  page_target?: { target_key: string; host_path: string; page_slug?: string | null } | null;
  entity_kind?: 'page' | 'service-product' | 'event';
  editor_config?: Record<string, unknown>;
  tenant_id?: string | null;
}

interface CreatedSchemaRow {
  id: string;
  slug: string;
  api_slug: string;
  tenant_id: string | null;
  tenant_slug?: string | null;
  name: string;
  description: string | null;
  schema: Record<string, unknown>;
  llm_instructions: string | null;
  registration_status: string | null;
  frontend_url: string | null;
  registration_code: string | null;
  entity_kind: 'page' | 'service-product' | 'event';
  definition_revision: number;
  editor_config: Record<string, unknown>;
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
    .replace(/^-|-$/g, '') || 'schema';
}

async function ensureUniqueSchemaSlug(
  client: Awaited<ReturnType<typeof createSupabaseClient>>,
  requested: string,
  tenantId: string | null,
): Promise<string> {
  const baseSlug = generateSlug(requested);
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    let query = client
      .from('page_schemas')
      .select('id')
      .eq('slug', candidate)
      .limit(1);
    query = tenantId ? query.eq('tenant_id', tenantId) : query.is('tenant_id', null);
    const { data, error } = await query;

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return candidate;

    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

export async function createPendingSchema(
  env: Env,
  token: string,
  input: CreatePendingSchemaInput,
): Promise<{
  schema: CreatedSchemaRow;
  mainSpec: { id: string; slug: string; name: string; status: string } | null;
  createdMainSpec: boolean;
}> {
  const client = await createSupabaseClient(env, token);
  const auth = await verifyAuthSession(env, token);
  if (!auth) throw new Error('Invalid or expired session.');

  let tenantId = input.tenant_id ?? null;
  if (!tenantId) {
    const { data: currentTenantId, error: tenantError } = await client.rpc('current_tenant_id');
    if (tenantError) throw new Error(tenantError.message);
    tenantId = typeof currentTenantId === 'string' ? currentTenantId : null;
  }
  const schemaSlug = await ensureUniqueSchemaSlug(client, input.slug || input.name, tenantId);
  // Catalogue unification: 'service-product' is a legacy alias for the
  // unified catalogue kind 'event' — normalize on creation so new schemas
  // satisfy the catalogue aggregate RPC guards from the start.
  const entityKind = (input.entity_kind ?? 'page') === 'service-product' ? 'event' : (input.entity_kind ?? 'page');
  const contentScope = input.content_scope ?? 'page-collection';
  const integrationRequirements = normalizeSchemaIntegrationRequirements(input.integration_requirements);
  if (entityKind !== 'page' && !tenantId) {
    throw new Error('Service-product and event schemas require an explicit tenant/workspace.');
  }
  if (entityKind !== 'page' && contentScope !== 'page-collection') {
    throw new Error('Service-product and event schemas must use page-collection content scope.');
  }

  const { data: createdSchema, error: createError } = await client
    .from('page_schemas')
    .insert({
      name: input.name,
      slug: schemaSlug,
      description: input.description ?? null,
      schema: input.schema,
      llm_instructions: input.llm_instructions ?? null,
      integration_requirements: integrationRequirements,
      slug_structure: integrationRequirements.required_slug_structure ?? '/:slug',
      tenant_id: tenantId,
      content_scope: contentScope,
      page_target: input.page_target ?? null,
      entity_kind: entityKind,
      editor_config: input.editor_config ?? {},
      registration_status: 'pending',
      registration_code: null,
    })
    .select('id, slug, api_slug, tenant_id, name, description, schema, llm_instructions, registration_status, frontend_url, registration_code, entity_kind, definition_revision, editor_config')
    .single();

  if (createError || !createdSchema) {
    throw new Error(createError?.message || 'Failed to create schema.');
  }

  const { data: tenant } = tenantId
    ? await client.from('tenants').select('slug').eq('id', tenantId).maybeSingle()
    : { data: null };
  const schemaWithTenant = { ...createdSchema, tenant_slug: tenant?.slug ?? null } as CreatedSchemaRow;
  const bootstrap = await bootstrapSchemaMainSpec(env, schemaWithTenant, {
    token,
    createdBy: auth.userId,
  });

  return {
    schema: schemaWithTenant,
    mainSpec: bootstrap.spec
      ? {
          id: bootstrap.spec.id,
          slug: bootstrap.spec.slug,
          name: bootstrap.spec.name,
          status: bootstrap.spec.status,
        }
      : null,
    createdMainSpec: bootstrap.created,
  };
}