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
}

interface CreatedSchemaRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  schema: Record<string, unknown>;
  llm_instructions: string | null;
  registration_status: string | null;
  frontend_url: string | null;
  registration_code: string | null;
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
): Promise<string> {
  const baseSlug = generateSlug(requested);
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    const { data, error } = await client
      .from('page_schemas')
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
  const schemaSlug = await ensureUniqueSchemaSlug(client, input.slug || input.name);

  const { data: createdSchema, error: createError } = await client
    .from('page_schemas')
    .insert({
      name: input.name,
      slug: schemaSlug,
      description: input.description ?? null,
      schema: input.schema,
      llm_instructions: input.llm_instructions ?? null,
      integration_requirements: normalizeSchemaIntegrationRequirements(input.integration_requirements),
      registration_status: 'pending',
      registration_code: null,
    })
    .select('id, slug, name, description, schema, llm_instructions, registration_status, frontend_url, registration_code')
    .single();

  if (createError || !createdSchema) {
    throw new Error(createError?.message || 'Failed to create schema.');
  }

  const auth = await verifyAuthSession(env, token);
  if (!auth) {
    throw new Error('Invalid or expired session.');
  }

  const bootstrap = await bootstrapSchemaMainSpec(env, createdSchema as CreatedSchemaRow, {
    token,
    createdBy: auth.userId,
  });

  return {
    schema: createdSchema as CreatedSchemaRow,
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