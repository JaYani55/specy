import { createSupabaseAdminClient, createSupabaseClient, type Env } from './supabase';

export type LlmSpecStatus = 'draft' | 'published' | 'archived';

export interface LlmSpecRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  definition: Record<string, unknown>;
  llm_instructions: string | null;
  status: LlmSpecStatus;
  is_public: boolean;
  is_main_template: boolean;
  tags: string[] | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PageSchemaSpecAttachmentRow {
  id: string;
  schema_id: string;
  spec_id: string;
  enabled: boolean;
  is_main: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface SchemaSpecSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: LlmSpecStatus;
  is_public: boolean;
  llm_instructions: string | null;
  definition: Record<string, unknown>;
  tags: string[];
  metadata: Record<string, unknown> | null;
  updated_at: string;
  enabled: boolean;
  is_main: boolean;
  sort_order: number;
}

export interface DiscoverableSpecSummary extends SchemaSpecSummary {
  schema: {
    id: string;
    slug: string;
    name: string;
    registration_status: string | null;
    frontend_url: string | null;
  } | null;
  discovery_scope: 'schema' | 'global';
}

export interface SchemaSpecBundle {
  main_spec: SchemaSpecSummary | null;
  attached_specs: SchemaSpecSummary[];
}

interface SchemaRowForSpec {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  schema: Record<string, unknown>;
  llm_instructions: string | null;
  registration_status: string | null;
  frontend_url?: string | null;
}

type Client = Awaited<ReturnType<typeof createSupabaseClient>>;

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
    .replace(/^-|-$/g, '');
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function mapSpecRow(row: Record<string, unknown>): LlmSpecRow {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: typeof row.description === 'string' ? row.description : null,
    definition: (row.definition as Record<string, unknown>) ?? {},
    llm_instructions: typeof row.llm_instructions === 'string' ? row.llm_instructions : null,
    status: (row.status as LlmSpecStatus) ?? 'draft',
    is_public: Boolean(row.is_public),
    is_main_template: Boolean(row.is_main_template),
    tags: normalizeTags(row.tags),
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    created_by: typeof row.created_by === 'string' ? row.created_by : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function isGlobalDiscoverableSpec(spec: LlmSpecRow): boolean {
  return spec.status === 'published'
    && spec.is_public
    && Boolean(spec.metadata && spec.metadata.global_discovery === true);
}

async function ensureUniqueSpecSlug(client: Client, requested: string): Promise<string> {
  const baseSlug = generateSlug(requested) || 'spec';
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    const { data, error } = await client
      .from('llm_specs')
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

function buildGeneratedMainSpecDefinition(schema: SchemaRowForSpec): Record<string, unknown> {
  return {
    kind: 'schema-main-spec',
    version: '1.0.0',
    schema: {
      id: schema.id,
      slug: schema.slug,
      name: schema.name,
      description: schema.description,
      registration_status: schema.registration_status,
    },
    tool: {
      name: `${schema.slug}_content_contract`,
      description: `Primary content contract for the ${schema.name} schema.`,
      usage: 'Use this specification as the main agent-readable contract when generating, validating, or transforming content for this schema.',
    },
    input_schema: schema.schema,
    llm_instructions: schema.llm_instructions,
    output_expectations: {
      content_shape: 'Page content must match the schema definition exactly.',
      route_registration: 'Frontend registration remains schema-centric and must use the schema registration endpoint.',
      page_delivery: 'Published page data is served from the schema-scoped pages endpoint.',
    },
  };
}

function buildGeneratedMainSpecDescription(schema: SchemaRowForSpec): string {
  return `Generated main spec for the ${schema.name} schema. This is the default agent-readable contract attached to the schema registration workflow.`;
}

async function getReadClient(env: Env, options?: { publicOnly?: boolean; token?: string }) {
  if (options?.publicOnly) {
    return createSupabaseClient(env, options.token);
  }

  try {
    return await createSupabaseAdminClient(env);
  } catch {
    return createSupabaseClient(env, options?.token);
  }
}

export async function bootstrapSchemaMainSpec(
  env: Env,
  schema: SchemaRowForSpec,
  options?: { token?: string; createdBy?: string | null },
): Promise<{ spec: LlmSpecRow; attachment: PageSchemaSpecAttachmentRow; created: boolean }> {
  const client = await createSupabaseClient(env, options?.token);

  const { data: existingAttachment, error: attachmentError } = await client
    .from('page_schema_specs')
    .select('id, schema_id, spec_id, enabled, is_main, sort_order, created_at, updated_at')
    .eq('schema_id', schema.id)
    .eq('is_main', true)
    .limit(1)
    .maybeSingle();

  if (attachmentError) {
    throw new Error(attachmentError.message);
  }

  if (existingAttachment) {
    const { data: existingSpec, error: specError } = await client
      .from('llm_specs')
      .select('*')
      .eq('id', existingAttachment.spec_id)
      .single();

    if (specError || !existingSpec) {
      throw new Error(specError?.message || 'Main spec attachment exists but spec could not be loaded.');
    }

    return {
      spec: mapSpecRow(existingSpec as Record<string, unknown>),
      attachment: existingAttachment as PageSchemaSpecAttachmentRow,
      created: false,
    };
  }

  const slug = await ensureUniqueSpecSlug(client, `${schema.slug}-main`);
  const { data: spec, error: specInsertError } = await client
    .from('llm_specs')
    .insert({
      slug,
      name: `${schema.name} Main Spec`,
      description: buildGeneratedMainSpecDescription(schema),
      definition: buildGeneratedMainSpecDefinition(schema),
      llm_instructions: schema.llm_instructions,
      status: 'draft',
      is_public: false,
      is_main_template: false,
      tags: ['schema', 'generated', schema.slug],
      metadata: {
        generated_from_schema_id: schema.id,
        generated_from_schema_slug: schema.slug,
      },
      created_by: options?.createdBy ?? null,
    })
    .select('*')
    .single();

  if (specInsertError || !spec) {
    throw new Error(specInsertError?.message || 'Failed to create main spec.');
  }

  const { data: attachment, error: insertAttachmentError } = await client
    .from('page_schema_specs')
    .insert({
      schema_id: schema.id,
      spec_id: spec.id,
      enabled: true,
      is_main: true,
      sort_order: 0,
    })
    .select('id, schema_id, spec_id, enabled, is_main, sort_order, created_at, updated_at')
    .single();

  if (insertAttachmentError || !attachment) {
    throw new Error(insertAttachmentError?.message || 'Failed to attach main spec to schema.');
  }

  return {
    spec: mapSpecRow(spec as Record<string, unknown>),
    attachment: attachment as PageSchemaSpecAttachmentRow,
    created: true,
  };
}

export async function getSchemaSpecBundle(
  env: Env,
  schema: { id: string },
  options?: { publicOnly?: boolean; token?: string },
): Promise<SchemaSpecBundle> {
  const client = await getReadClient(env, options);
  const { data: attachments, error: attachmentError } = await client
    .from('page_schema_specs')
    .select('id, schema_id, spec_id, enabled, is_main, sort_order, created_at, updated_at')
    .eq('schema_id', schema.id)
    .eq('enabled', true)
    .order('is_main', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (attachmentError) {
    throw new Error(attachmentError.message);
  }

  const attachmentRows = (attachments ?? []) as PageSchemaSpecAttachmentRow[];
  if (attachmentRows.length === 0) {
    return { main_spec: null, attached_specs: [] };
  }

  const specIds = attachmentRows.map((attachment) => attachment.spec_id);
  const { data: specs, error: specsError } = await client
    .from('llm_specs')
    .select('*')
    .in('id', specIds);

  if (specsError) {
    throw new Error(specsError.message);
  }

  const specMap = new Map(
    ((specs ?? []) as Record<string, unknown>[]).map((row) => {
      const spec = mapSpecRow(row);
      return [spec.id, spec] as const;
    }),
  );

  const summaries = attachmentRows
    .map((attachment) => {
      const spec = specMap.get(attachment.spec_id);
      if (!spec) {
        return null;
      }

      return {
        id: spec.id,
        slug: spec.slug,
        name: spec.name,
        description: spec.description,
        status: spec.status,
        is_public: spec.is_public,
        llm_instructions: spec.llm_instructions,
        definition: spec.definition,
        tags: spec.tags ?? [],
        metadata: spec.metadata,
        updated_at: spec.updated_at,
        enabled: attachment.enabled,
        is_main: attachment.is_main,
        sort_order: attachment.sort_order,
      } as SchemaSpecSummary;
    })
    .filter((spec): spec is SchemaSpecSummary => spec !== null);

  return {
    main_spec: summaries.find((spec) => spec.is_main) ?? null,
    attached_specs: summaries,
  };
}

export async function listDiscoverableSpecs(env: Env): Promise<DiscoverableSpecSummary[]> {
  const client = await createSupabaseClient(env);
  const { data: attachments, error: attachmentError } = await client
    .from('page_schema_specs')
    .select('id, schema_id, spec_id, enabled, is_main, sort_order, created_at, updated_at')
    .eq('enabled', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (attachmentError) {
    throw new Error(attachmentError.message);
  }

  const attachmentRows = (attachments ?? []) as PageSchemaSpecAttachmentRow[];
  if (attachmentRows.length === 0) {
    return [];
  }

  const specIds = Array.from(new Set(attachmentRows.map((attachment) => attachment.spec_id)));
  const schemaIds = Array.from(new Set(attachmentRows.map((attachment) => attachment.schema_id)));

  const [{ data: specs, error: specsError }, { data: schemas, error: schemasError }, { data: globalSpecs, error: globalSpecsError }] = await Promise.all([
    client
      .from('llm_specs')
      .select('*')
      .in('id', specIds),
    client
      .from('page_schemas')
      .select('id, slug, name, registration_status, frontend_url')
      .in('id', schemaIds),
    client
      .from('llm_specs')
      .select('*')
      .eq('status', 'published')
      .eq('is_public', true),
  ]);

  if (specsError) {
    throw new Error(specsError.message);
  }

  if (schemasError) {
    throw new Error(schemasError.message);
  }

  if (globalSpecsError) {
    throw new Error(globalSpecsError.message);
  }

  const specMap = new Map(
    ((specs ?? []) as Record<string, unknown>[]).map((row) => {
      const spec = mapSpecRow(row);
      return [spec.id, spec] as const;
    }),
  );

  const schemaMap = new Map(
    ((schemas ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), {
      id: String(row.id),
      slug: String(row.slug),
      name: String(row.name),
      registration_status: typeof row.registration_status === 'string' ? row.registration_status : null,
      frontend_url: typeof row.frontend_url === 'string' ? row.frontend_url : null,
    }] as const),
  );

  const attachedDiscoverableSpecs = attachmentRows
    .map((attachment) => {
      const spec = specMap.get(attachment.spec_id);
      const schema = schemaMap.get(attachment.schema_id);
      if (!spec || !schema || schema.registration_status !== 'registered') {
        return null;
      }

      return {
        id: spec.id,
        slug: spec.slug,
        name: spec.name,
        description: spec.description,
        status: spec.status,
        is_public: spec.is_public,
        llm_instructions: spec.llm_instructions,
        definition: spec.definition,
        tags: spec.tags ?? [],
        metadata: spec.metadata,
        updated_at: spec.updated_at,
        enabled: attachment.enabled,
        is_main: attachment.is_main,
        sort_order: attachment.sort_order,
        discovery_scope: 'schema',
        schema,
      } as DiscoverableSpecSummary;
    })
    .filter((entry): entry is DiscoverableSpecSummary => entry !== null);

  const globallyDiscoverableSpecs = ((globalSpecs ?? []) as Record<string, unknown>[])
    .map((row) => mapSpecRow(row))
    .filter(isGlobalDiscoverableSpec)
    .map((spec) => ({
      id: spec.id,
      slug: spec.slug,
      name: spec.name,
      description: spec.description,
      status: spec.status,
      is_public: spec.is_public,
      llm_instructions: spec.llm_instructions,
      definition: spec.definition,
      tags: spec.tags ?? [],
      metadata: spec.metadata,
      updated_at: spec.updated_at,
      enabled: true,
      is_main: false,
      sort_order: -1,
      discovery_scope: 'global',
      schema: null,
    }) satisfies DiscoverableSpecSummary);

  const deduped = new Map<string, DiscoverableSpecSummary>();
  [...attachedDiscoverableSpecs, ...globallyDiscoverableSpecs].forEach((spec) => {
    if (!deduped.has(spec.id)) {
      deduped.set(spec.id, spec);
    }
  });

  return [...deduped.values()]
    .sort((left, right) => {
      if (left.discovery_scope !== right.discovery_scope) {
        return left.discovery_scope === 'global' ? -1 : 1;
      }

      if (!left.schema || !right.schema) {
        return left.name.localeCompare(right.name);
      }

      if (left.schema.slug === right.schema.slug) {
        if (left.is_main !== right.is_main) {
          return left.is_main ? -1 : 1;
        }
        return left.sort_order - right.sort_order;
      }
      return left.schema.slug.localeCompare(right.schema.slug);
    });
}

export function isMcpExposedDiscoverableSpec(spec: DiscoverableSpecSummary): boolean {
  return Boolean(spec.metadata && spec.metadata.mcp_exposed === true);
}

export async function listMcpExposedDiscoverableSpecs(env: Env): Promise<DiscoverableSpecSummary[]> {
  const specs = await listDiscoverableSpecs(env);
  return specs.filter(isMcpExposedDiscoverableSpec);
}

export async function getDiscoverableSpecBySlug(env: Env, slug: string): Promise<DiscoverableSpecSummary | null> {
  const specs = await listDiscoverableSpecs(env);
  return specs.find((spec) => spec.slug === slug) ?? null;
}