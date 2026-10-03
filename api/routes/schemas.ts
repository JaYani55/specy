import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { createSupabaseAdminClient, createSupabaseClient, hasSupabaseAdminCredential, type Env } from '../lib/supabase';
import { parseBearerToken, requireAppRole, requireAuthSession } from '../lib/auth';
import { validateOutboundHttpUrl } from '../lib/urlSafety';
import {
  buildRevalidationSecretName,
  deleteManagedSecret,
  getManagedSecretValue,
  upsertManagedSecret,
  getRevalidationSecretNamespace,
} from '../lib/managedSecrets';
import {
  normalizeSchemaIntegrationRequirements,
  type SchemaIntegrationRequirementsRecord,
} from '../lib/schemaRouting';
import {
  buildTargetRevalidationPath,
  completeSchemaRegistration,
  getSchemaFrontendTargets,
  validateSchemaFrontendTargetInputs,
  type SchemaRegistrationPayload,
  type SchemaFrontendTargetInput,
} from '../lib/schemaRegistration';
import { getSchemaSpecBundle } from '../lib/specRegistry';
import { getPublicWorkerUrl } from '../lib/systemConfig';
import { buildFrontendIntegrationManifest } from '../lib/frontendManifest';
import { validateSchemaSystemDataPatch } from '../lib/schemaSystemData';
import { parseSchemaDefinitionPatch } from '../lib/schemaDefinition';
import { normalizeSchemaPageSlug } from '../lib/schemaPages';
import { validateSchemaContent } from '../lib/schemaContentValidation';
import { createEventPageAggregate, EventPageAggregateError, parseEventPageCreateInput, updateEventPageAggregate } from '../lib/eventPageAggregates';
import {
  parsePublicEntityIncludes,
  projectPublicEventRelations,
  projectPublicProductRelations,
  type PublicEventProduct,
  type PublicEventReference,
  type PublicPageRecord,
} from '../lib/publicEntityProjection';

const schemas = new Hono<{ Bindings: Env }>();

interface SchemaRow {
  slug: string;
  api_slug: string;
  name: string;
  description: string | null;
  registration_status: string | null;
  is_default: boolean | null;
  frontend_url: string | null;
  slug_structure: string | null;
  integration_requirements: SchemaIntegrationRequirementsRecord | null;
  content_scope?: 'page-collection' | 'single-page' | null;
  page_target?: Record<string, unknown> | null;
  entity_kind?: 'page' | 'service-product' | 'event';
  definition_revision?: number;
  editor_config?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface SchemaSecretStatusRow {
  id: string;
  slug: string;
  frontend_url: string | null;
  revalidation_endpoint: string | null;
  revalidation_secret: string | null;
  revalidation_secret_name: string | null;
  registration_status: string;
  slug_structure?: string | null;
  integration_requirements?: SchemaIntegrationRequirementsRecord | null;
}

interface PublishedSchemaPageRow {
  id: string;
  slug: string;
  name: string;
  status: 'published';
  content: Record<string, unknown>;
  domain_url: string | null;
  updated_at: string;
  published_at: string | null;
}

function buildSpecSections(
  schema: {
    id: string;
    name: string;
    slug: string;
    api_slug: string;
    description: string | null;
    registration_status: string;
    is_default?: boolean | null;
    created_at?: string;
    updated_at?: string;
    schema: Record<string, unknown>;
    llm_instructions: string | null;
    frontend_url: string | null;
    revalidation_endpoint: string | null;
    registration_code: string | null;
    slug_structure: string;
    integration_requirements: SchemaIntegrationRequirementsRecord | null;
    entity_kind?: 'page' | 'service-product' | 'event';
    definition_revision?: number;
    editor_config?: Record<string, unknown>;
  },
  count: number,
  baseUrl: string,
  specBundle?: {
    main_spec: {
      slug: string;
      name: string;
      description: string | null;
      status: string;
      is_public: boolean;
    } | null;
    attached_specs: Array<{
      slug: string;
      name: string;
      description: string | null;
      status: string;
      is_public: boolean;
      is_main: boolean;
    }>;
  },
  targets: Array<{ target_key: string; kind: 'collection-slot' | 'detail-page'; host_path: string; placement_key: string | null }> = [],
): string[] {
  const requirements = normalizeSchemaIntegrationRequirements(schema.integration_requirements);
  const expectedSlugStructure = requirements.required_slug_structure || schema.slug_structure || '/:slug';
  const pagesUrl = `${baseUrl}/api/schemas/${schema.api_slug}/pages`;

  const lines: string[] = [
    '='.repeat(60),
    `SCHEMA SPECIFICATION: ${schema.name}`,
    '='.repeat(60),
    '',
    `Name: ${schema.name}`,
    `Slug: ${schema.slug}`,
    `API slug: ${schema.api_slug}`,
    `Status: ${schema.registration_status}`,
    `Entity kind: ${schema.entity_kind || 'page'}`,
    `Definition revision: ${schema.definition_revision || 1}`,
    `Editor hints: ${JSON.stringify(schema.editor_config || {})}`,
    `Default: ${schema.is_default ? 'Yes' : 'No'}`,
    `Pages using this schema: ${count ?? 0}`,
    schema.created_at ? `Created: ${schema.created_at}` : null,
    schema.updated_at ? `Updated: ${schema.updated_at}` : null,
    '',
  ].filter((line): line is string => line !== null);

  if (schema.description) {
    lines.push('--- DESCRIPTION ---', schema.description, '');
  }

  lines.push(
    '--- REQUIREMENTS ---',
    '',
    targets.length > 0
      ? '- Frontend targets: content may be rendered in collection slots and/or optional detail pages.'
      : `- Legacy public route shape: ${expectedSlugStructure}`,
    `- Route ownership: ${requirements.route_ownership}`,
    `- Canonical frontend URL: ${requirements.canonical_frontend_url || 'Not fixed by schema'}`,
    `- Temporary frontend URLs allowed: ${requirements.allow_temporary_frontend_urls ? 'Yes' : 'No'}`,
    `- Preferred page discovery: ${requirements.page_discovery_mode}`,
    `- Published pages API: ${pagesUrl}`,
    '',
  );

  if (targets.length > 0) {
    lines.push('Target contract:', ...targets.map((target) =>
      target.kind === 'collection-slot'
        ? `- ${target.target_key}: collection-slot at ${target.host_path}, placement key ${target.placement_key || '(missing)'}`
        : `- ${target.target_key}: detail-page at ${target.host_path}`,
    ), '');
  }

  if (requirements.schema_identification_hint) {
    lines.push(`- Schema identification hint: ${requirements.schema_identification_hint}`);
  }

  if (requirements.registration_notes) {
    lines.push(`- Registration notes: ${requirements.registration_notes}`);
  }

  lines.push('');

  lines.push(
    '--- DO NOT CHANGE ---',
    '',
    requirements.route_ownership === 'isolated'
      ? '- Keep the implementation isolated to the configured route space. Do not replace unrelated dynamic routes.'
      : requirements.route_ownership === 'shared-layout-only'
        ? '- Existing routes may only be touched for shared layout or styling concerns.'
        : '- Existing routes may be modified if required, but preserve the final route shape and registration contract.',
    requirements.canonical_frontend_url && !requirements.allow_temporary_frontend_urls
      ? `- Register only against the canonical frontend URL ${requirements.canonical_frontend_url}.`
      : '- Confirm the final production frontend URL before registration whenever possible.',
    '',
  );

  lines.push(
    '--- DATA SOURCE ---',
    '',
    'Use the schema-scoped published pages API instead of inferring schema membership from raw table reads whenever possible.',
    `GET ${pagesUrl}`,
    'Returns only these fields for published pages:',
    '  - id',
    '  - slug',
    '  - name',
    '  - status',
    '  - content',
    '  - domain_url',
    '  - updated_at',
    '',
  );

  lines.push(
    '--- SCHEMA DEFINITION ---',
    '',
    JSON.stringify(schema.schema, null, 2),
    '',
  );

  if (specBundle?.main_spec || (specBundle?.attached_specs.length ?? 0) > 0) {
    const mainSpec = specBundle?.main_spec ?? null;
    const attachedSpecs = specBundle?.attached_specs ?? [];
    lines.push('--- SPEC REGISTRY ---', '');

    if (mainSpec) {
      lines.push(
        `Main spec: ${mainSpec.name} (${mainSpec.slug})`,
        `Main spec status: ${mainSpec.status}`,
        `Main spec visibility: ${mainSpec.is_public ? 'public' : 'private'}`,
      );

      if (mainSpec.description) {
        lines.push(`Main spec description: ${mainSpec.description}`);
      }

      lines.push('');
    }

    const secondarySpecs = attachedSpecs.filter((spec) => !spec.is_main);
    if (secondarySpecs.length > 0) {
      lines.push('Additional attached specs:');
      secondarySpecs.forEach((spec) => {
        lines.push(`- ${spec.name} (${spec.slug}) [${spec.status}${spec.is_public ? ', public' : ', private'}]`);
      });
      lines.push('');
    }
  }

  lines.push(
    '--- CONTENT BLOCK TYPES ---',
    '',
    'ContentBlock is a union type. Each block has { id: string, type: string } plus type-specific fields:',
    '',
    '  text:    { content: string }',
    '  heading: { content: string, level: "heading1" | "heading2" | "heading3" | "heading4" | "heading5" | "heading6" }',
    '  image:   { src: string, alt: string, caption?: string, width?: number, height?: number }',
    '  quote:   { text: string, author?: string, source?: string }',
    '  list:    { style: "ordered" | "unordered", items: string[] }',
    '  video:   { src: string, provider: "youtube" | "vimeo" | "other", caption?: string }',
    '',
    'Block IDs follow the pattern: ${prefix}-${timestamp}-${random}',
    '',
  );

  lines.push(
    '--- REVALIDATION ---',
    '',
    '- The CMS derives collection paths from target host_path and detail paths from the target host_path with :slug replaced.',
    '- A collection-slot revalidates its host path (for example /); URL fragments such as #posts are frontend-only and are never sent.',
    '- Your revalidation endpoint should accept Authorization: Bearer <secret>.',
    '- The CMS sends ?path=<full-route-path> and ?slug=<bare-page-slug>.',
    '- Use the full path as the primary invalidation target.',
    '',
  );

  if (schema.llm_instructions) {
    lines.push('--- LLM INSTRUCTIONS ---', '', schema.llm_instructions, '');
  }

  if (schema.frontend_url) {
    lines.push(
      '--- FRONTEND INFO ---',
      '',
      `Frontend URL: ${schema.frontend_url}`,
      `Slug Structure: ${schema.slug_structure}`,
      `Revalidation Endpoint: ${schema.revalidation_endpoint || 'Not configured'}`,
      '',
    );
  }

  if (schema.registration_status === 'waiting' && schema.registration_code) {
    lines.push(
      '--- REGISTRATION ---',
      '',
      `Registration Code: ${schema.registration_code}`,
      '',
      'Register only after the frontend is reachable and verified.',
      `POST ${baseUrl}/api/schemas/${schema.api_slug}/register`,
      '',
      'Request body (JSON):',
      JSON.stringify({
        code: schema.registration_code,
        frontend_url: requirements.canonical_frontend_url || 'https://your-frontend.com',
        revalidation_endpoint: '/api/revalidate',
        revalidation_secret: 'your-shared-secret',
        ...(targets.length > 0
          ? { targets: targets.map((target) => ({
            target_key: target.target_key,
            kind: target.kind,
            host_path: target.host_path,
            ...(target.kind === 'collection-slot' ? { placement_key: target.placement_key } : {}),
          })) }
          : { slug_structure: expectedSlugStructure }),
      }, null, 2),
      '',
    );
  }

  lines.push('='.repeat(60));
  return lines;
}

type ManagedSecretWarningCode = 'supabase_admin_credential' | 'secrets_encryption_key' | 'both_worker_keys' | 'managed_secret_access';

interface SchemaSecretStatusResult {
  schema: SchemaSecretStatusRow | null;
  managementAvailable: boolean;
  warning: string | null;
  warningCode: ManagedSecretWarningCode | null;
}

interface SchemaTemplateRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  schema: Record<string, unknown>;
  llm_instructions: string | null;
  source_schema_id: string | null;
  external_source_url: string | null;
  created_at: string;
  updated_at: string;
}

interface SchemaTemplateInput {
  name: string;
  slug?: string;
  description?: string | null;
  icon?: string | null;
  schema: Record<string, unknown>;
  llm_instructions?: string | null;
  source_schema_id?: string | null;
  external_source_url?: string | null;
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
    .replace(/^-|-$/g, '') || 'template';
}

async function ensureUniqueTemplateSlug(
  client: Awaited<ReturnType<typeof createSupabaseClient>>,
  requestedSlug: string,
): Promise<string> {
  const baseSlug = generateSlug(requestedSlug);
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    const { data, error } = await client
      .from('page_schema_templates')
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTemplateInput(payload: unknown): SchemaTemplateInput {
  const raw = isRecord(payload) && isRecord(payload.template) ? payload.template : payload;

  if (!isRecord(raw)) {
    throw new Error('Template payload must be a JSON object.');
  }

  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    throw new Error('Template name is required.');
  }

  if (!isRecord(raw.schema)) {
    throw new Error('Template schema must be a JSON object.');
  }

  return {
    name: raw.name.trim(),
    slug: typeof raw.slug === 'string' && raw.slug.trim() ? raw.slug.trim() : undefined,
    description: typeof raw.description === 'string' ? raw.description.trim() : null,
    icon: typeof raw.icon === 'string' && raw.icon.trim() ? raw.icon.trim() : null,
    schema: raw.schema,
    llm_instructions: typeof raw.llm_instructions === 'string' ? raw.llm_instructions : null,
    source_schema_id: typeof raw.source_schema_id === 'string' && raw.source_schema_id.trim() ? raw.source_schema_id.trim() : null,
    external_source_url: typeof raw.external_source_url === 'string' && raw.external_source_url.trim() ? raw.external_source_url.trim() : null,
  };
}

async function saveSchemaTemplate(
  client: Awaited<ReturnType<typeof createSupabaseClient>>,
  input: SchemaTemplateInput,
  options?: { preferProvidedSlug?: boolean },
): Promise<SchemaTemplateRow> {
  const slug = options?.preferProvidedSlug && input.slug
    ? generateSlug(input.slug)
    : await ensureUniqueTemplateSlug(client, input.slug || input.name);

  const { data, error } = await client
    .from('page_schema_templates')
    .insert({
      name: input.name,
      slug,
      description: input.description ?? null,
      icon: input.icon ?? '🧩',
      schema: input.schema,
      llm_instructions: input.llm_instructions ?? null,
      source_schema_id: input.source_schema_id ?? null,
      external_source_url: input.external_source_url ?? null,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as SchemaTemplateRow;
}

function isManagedSecretUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('SS_SUPABASE_SECRET_KEY is not bound')
    || message.includes('Secret "SUPABASE_SECRET_KEY" not found')
    || message.includes('SECRETS_ENCRYPTION_KEY is not configured');
}

function getManagedSecretUnavailableCode(env: Env, error?: unknown): ManagedSecretWarningCode {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const adminMissing = !hasSupabaseAdminCredential(env)
    || message.includes('SS_SUPABASE_SECRET_KEY is not bound')
    || message.includes('Secret "SUPABASE_SECRET_KEY" not found');
  const encryptionKeyMissing = !env.SECRETS_ENCRYPTION_KEY
    || message.includes('SECRETS_ENCRYPTION_KEY is not configured');

  if (adminMissing && encryptionKeyMissing) return 'both_worker_keys';
  if (adminMissing) return 'supabase_admin_credential';
  if (encryptionKeyMissing) return 'secrets_encryption_key';
  return 'managed_secret_access';
}

function getManagedSecretUnavailableMessage(env: Env, error?: unknown): string {
  switch (getManagedSecretUnavailableCode(env, error)) {
    case 'supabase_admin_credential': return 'Worker Supabase admin credential is missing or unavailable.';
    case 'secrets_encryption_key': return 'Worker secret SECRETS_ENCRYPTION_KEY is missing.';
    case 'both_worker_keys': return 'Worker Supabase admin credential and SECRETS_ENCRYPTION_KEY are missing.';
    default: return 'Worker managed-secret access failed; check its bindings and secret store.';
  }
}

async function readSchemaSecretStatusWithUserToken(env: Env, slug: string, token: string): Promise<SchemaSecretStatusRow | null> {
  const supabase = await createSupabaseClient(env, token);
  const { data, error } = await supabase
    .from('page_schemas')
    .select('id, slug, frontend_url, revalidation_endpoint, revalidation_secret, revalidation_secret_name, registration_status')
    .eq('api_slug', slug)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(error.message);
  }

  return data as SchemaSecretStatusRow;
}

async function migrateLegacyRevalidationSecret(env: Env, schema: SchemaSecretStatusRow): Promise<SchemaSecretStatusRow> {
  if (!schema.revalidation_secret || schema.revalidation_secret_name) {
    return schema;
  }

  const secretName = buildRevalidationSecretName(schema.id);
  await upsertManagedSecret(env, {
    name: secretName,
    namespace: getRevalidationSecretNamespace(),
    value: schema.revalidation_secret,
    metadata: {
      schema_id: schema.id,
      schema_slug: schema.slug,
      frontend_url: schema.frontend_url,
    },
  });

  const admin = await createSupabaseAdminClient(env);
  const { error } = await admin
    .from('page_schemas')
    .update({
      revalidation_secret_name: secretName,
      revalidation_secret: null,
    })
    .eq('id', schema.id);

  if (error) {
    throw new Error(error.message);
  }

  return {
    ...schema,
    revalidation_secret: null,
    revalidation_secret_name: secretName,
  };
}

async function getSchemaSecretStatus(
  env: Env,
  slug: string,
  options?: { token?: string; allowReadonlyFallback?: boolean; migrateLegacy?: boolean },
): Promise<SchemaSecretStatusResult> {
  if (!hasSupabaseAdminCredential(env)) {
    if (options?.allowReadonlyFallback && options.token) {
      return {
        schema: await readSchemaSecretStatusWithUserToken(env, slug, options.token),
        managementAvailable: false,
        warning: getManagedSecretUnavailableMessage(env),
        warningCode: getManagedSecretUnavailableCode(env),
      };
    }

    throw new Error('SS_SUPABASE_SECRET_KEY is not bound and SUPABASE_SECRET_KEY fallback is missing.');
  }
  try {
    const admin = await createSupabaseAdminClient(env);
    const { data, error } = await admin
      .from('page_schemas')
      .select('id, slug, frontend_url, revalidation_endpoint, revalidation_secret, revalidation_secret_name, registration_status')
      .eq('api_slug', slug)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return {
          schema: null,
          managementAvailable: true,
          warning: null,
          warningCode: null,
        };
      }
      throw new Error(error.message);
    }

    const row = data as SchemaSecretStatusRow;
    if (options?.migrateLegacy === false || !row.revalidation_secret || row.revalidation_secret_name) {
      return {
        schema: row,
        managementAvailable: true,
        warning: null,
        warningCode: null,
      };
    }

    return {
      schema: await migrateLegacyRevalidationSecret(env, row),
      managementAvailable: true,
      warning: null,
      warningCode: null,
    };
  } catch (error) {
    if (options?.allowReadonlyFallback && options.token && isManagedSecretUnavailableError(error)) {
      return {
        schema: await readSchemaSecretStatusWithUserToken(env, slug, options.token),
        managementAvailable: false,
        warning: getManagedSecretUnavailableMessage(env, error),
        warningCode: getManagedSecretUnavailableCode(env, error),
      };
    }

    throw error;
  }
}

// GET /api/schemas — Discovery endpoint: list all available schemas
schemas.get('/', async (c) => {
  const token = parseBearerToken(c.req.header('Authorization'));
  const supabase = await createSupabaseClient(c.env, token);

  const { data, error } = await supabase
    .from('page_schemas')
    .select('slug, api_slug, name, description, registration_status, is_default, frontend_url, slug_structure, integration_requirements, content_scope, page_target, entity_kind, definition_revision, editor_config, created_at, updated_at')
    .order('is_default', { ascending: false })
    .order('name', { ascending: true });

  if (error) {
    return c.json({ error: 'Failed to fetch schemas' }, 500);
  }

  const baseUrl = await getPublicWorkerUrl(c.env, new URL(c.req.url).origin);

  return c.json({
    service: 'specy-api',
    description: 'Available page schemas. Use the spec_url to fetch the full LLM-readable specification for any schema.',
    mcp_endpoint: `${baseUrl}/mcp`,
    schemas: ((data ?? []) as SchemaRow[]).map((s) => ({
      slug: s.api_slug,
      schema_slug: s.slug,
      api_slug: s.api_slug,
      name: s.name,
      description: s.description,
      status: s.registration_status,
      is_default: s.is_default,
      frontend_url: s.frontend_url,
      slug_structure: s.slug_structure,
      integration_requirements: normalizeSchemaIntegrationRequirements(s.integration_requirements),
      content_scope: s.content_scope || 'page-collection',
      page_target: s.page_target || null,
      entity_kind: s.entity_kind || 'page',
      definition_revision: s.definition_revision || 1,
      editor_config: s.editor_config || {},
      spec_url: `${baseUrl}/api/schemas/${s.api_slug}/spec.txt`,
      spec_json_url: `${baseUrl}/api/schemas/${s.api_slug}/spec`,
      pages_url: `${baseUrl}/api/schemas/${s.api_slug}/pages`,
      register_url: `${baseUrl}/api/schemas/${s.api_slug}/register`,
      created_at: s.created_at,
      updated_at: s.updated_at,
    })),
  });
});

schemas.get('/templates', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  const supabase = await createSupabaseClient(c.env, auth.token);
  const { data, error } = await supabase
    .from('page_schema_templates')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ templates: (data ?? []) as SchemaTemplateRow[] });
});

schemas.get('/templates/:slug', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  const slug = c.req.param('slug');
  const supabase = await createSupabaseClient(c.env, auth.token);
  const { data, error } = await supabase
    .from('page_schema_templates')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error || !data) {
    return c.json({ error: `Template "${slug}" not found` }, 404);
  }

  return c.json({ template: data as SchemaTemplateRow });
});

schemas.post('/templates', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const supabase = await createSupabaseClient(c.env, auth.token);
    const template = await saveSchemaTemplate(supabase, parseTemplateInput(body));
    return c.json({ template }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create template' }, 400);
  }
});

schemas.post('/templates/import', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  let body: { url?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.url) {
    return c.json({ error: 'Missing required field: url' }, 400);
  }

  const validated = validateOutboundHttpUrl(body.url);
  if (!validated.ok) {
    return c.json({ error: validated.error }, 400);
  }

  try {
    const response = await fetch(validated.url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return c.json({ error: `Template download failed with status ${response.status}` }, 502);
    }

    const payload = await response.json();
    const supabase = await createSupabaseClient(c.env, auth.token);
    const template = await saveSchemaTemplate(supabase, {
      ...parseTemplateInput(payload),
      external_source_url: validated.url.toString(),
    });

    return c.json({ template }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to import template' }, 400);
  }
});

// PATCH /api/schemas/:slug/definition — update the JSON contract with revision checks.
schemas.patch('/:slug/definition', async (c) => {
  const auth = await requireAuthSession(c);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = parseSchemaDefinitionPatch(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const client = await createSupabaseClient(c.env, auth.token);
  const { data: current, error: readError } = await client
    .from('page_schemas')
    .select('id, api_slug, tenant_id, content_scope, entity_kind, definition_revision')
    .eq('api_slug', c.req.param('slug'))
    .maybeSingle();
  if (readError) return c.json({ error: readError.message }, 500);
  if (!current) return c.json({ error: 'Schema not found.' }, 404);

  if (parsed.patch.expected_revision !== current.definition_revision) {
    return c.json({
      error: 'Schema definition changed since it was loaded. Reload it before saving.',
      code: 'definition_revision_conflict',
      expected_revision: parsed.patch.expected_revision,
      current_revision: current.definition_revision,
    }, 409);
  }

  const entityKindChanges = parsed.patch.entity_kind !== undefined
    && parsed.patch.entity_kind !== current.entity_kind;
  const tenantChanges = parsed.patch.tenant_id !== undefined
    && parsed.patch.tenant_id !== current.tenant_id;
  const nextEntityKind = parsed.patch.entity_kind ?? current.entity_kind;
  const nextTenantId = parsed.patch.tenant_id !== undefined ? parsed.patch.tenant_id : current.tenant_id;
  const requestedScope = parsed.patch.integration_requirements?.content_scope;
  if (requestedScope !== undefined && requestedScope !== 'page-collection' && requestedScope !== 'single-page') {
    return c.json({ error: 'integration_requirements.content_scope must be page-collection or single-page.' }, 400);
  }
  const nextContentScope = requestedScope ?? current.content_scope;
  if (nextEntityKind !== 'page' && nextTenantId == null) {
    return c.json({ error: 'Product and event schemas must belong to a workspace.' }, 400);
  }
  if (nextEntityKind !== 'page' && nextContentScope !== 'page-collection') {
    return c.json({ error: 'Product and event schemas must use page-collection content scope.' }, 400);
  }
  if (parsed.patch.slug) {
    let slugQuery = client.from('page_schemas').select('id').eq('slug', parsed.patch.slug).neq('id', current.id).limit(1);
    slugQuery = nextTenantId ? slugQuery.eq('tenant_id', nextTenantId) : slugQuery.is('tenant_id', null);
    const { data: slugMatches, error: slugError } = await slugQuery;
    if (slugError) return c.json({ error: slugError.message }, 500);
    if (slugMatches?.length) return c.json({ error: 'That schema slug is already used in this workspace.', code: 'schema_slug_conflict' }, 409);
  }

  if (tenantChanges && current.entity_kind !== 'page') {
    return c.json({ error: 'Product/event schemas cannot be moved between workspaces until an explicit aggregate migration is available.', code: 'schema_tenant_migration_required' }, 409);
  }
  if (entityKindChanges || tenantChanges) {
    const { count, error: countError } = await client
      .from('pages')
      .select('id', { count: 'exact', head: true })
      .eq('schema_id', current.id);
    if (countError) return c.json({ error: countError.message }, 500);
    if ((count ?? 0) > 0) {
      return c.json({
        error: entityKindChanges
          ? 'Schemas with existing pages cannot be reclassified until an explicit conversion workflow is available.'
          : 'Schemas with existing pages cannot be moved to another workspace until an explicit migration workflow is available.',
        code: entityKindChanges ? 'schema_conversion_required' : 'schema_tenant_migration_required',
        affected_pages: count,
      }, 409);
    }
  }

  const { expected_revision: _expectedRevision, ...update } = parsed.patch;
  const updateData: Record<string, unknown> = { ...update };
  if (requestedScope !== undefined) updateData.content_scope = requestedScope;
  if (parsed.patch.integration_requirements && Object.prototype.hasOwnProperty.call(parsed.patch.integration_requirements, 'page_target')) {
    updateData.page_target = parsed.patch.integration_requirements.page_target ?? null;
  }
  const { data: schema, error: updateError } = await client
    .from('page_schemas')
    .update(updateData)
    .eq('id', current.id)
    .eq('definition_revision', parsed.patch.expected_revision)
    .select('id, slug, api_slug, tenant_id, name, schema, entity_kind, definition_revision, editor_config, content_scope, page_target, updated_at')
    .maybeSingle();
  if (updateError) {
    if (updateError.code === '23505') return c.json({ error: 'That schema slug is already in use.', code: 'schema_slug_conflict' }, 409);
    return c.json({ error: updateError.message }, 500);
  }
  if (!schema) {
    return c.json({ error: 'Schema definition changed during save. Reload it and retry.', code: 'definition_revision_conflict' }, 409);
  }

  return c.json({ success: true, schema, changed_fields: Object.keys(updateData) });
});

// GET /api/schemas/:slug/spec.txt — LLM-ready plaintext schema specification
schemas.get('/:slug/spec.txt', async (c) => {
  const slug = c.req.param('slug');
  const token = parseBearerToken(c.req.header('Authorization'));
  const supabase = await createSupabaseClient(c.env, token);

  const { data: schema, error } = await supabase
    .from('page_schemas')
    .select('*')
    .eq('api_slug', slug)
    .single();

  if (error || !schema) {
    return c.text(`Schema "${slug}" not found.`, 404);
  }

  // Count pages using this schema
  const { count } = await supabase
    .from('pages')
    .select('*', { count: 'exact', head: true })
    .eq('schema_id', schema.id);

  const specBundle = await getSchemaSpecBundle(c.env, { id: schema.id }, token ? { token } : undefined);
  const targets = await getSchemaFrontendTargets(c.env, schema.id, token ?? undefined);
  const baseUrl = await getPublicWorkerUrl(c.env, new URL(c.req.url).origin);
  const lines = buildSpecSections(schema, count ?? 0, baseUrl, specBundle, targets);
  lines.push(
    '--- CODE BLOCK FIELD TYPE ---',
    '',
    'Schemas may also use the custom field type "CodeBlock[]" for structured code examples.',
    'Each item is typically stored as:',
    '  { id: string, language: string, code: string, label?: string, pattern?: string, frameworks?: string[] }',
    '',
    'The optional items.properties definition can be used to configure placeholders, help text, required flags, and enum options for language, pattern, frameworks, or extra metadata fields.',
    'If frameworks.items.enum is provided, the Page Builder renders a multi-select checkbox group for frameworks.',
    '',
    '='.repeat(60),
  );

  return c.text(lines.join('\n'), 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Spec-Format': 'raw-text',
  });
});

schemas.get('/:slug/spec', async (c) => {
  const slug = c.req.param('slug');
  const token = parseBearerToken(c.req.header('Authorization'));
  const supabase = await createSupabaseClient(c.env, token);

  const { data: schema, error } = await supabase
    .from('page_schemas')
    .select('*')
    .eq('api_slug', slug)
    .single();

  if (error || !schema) {
    return c.json({ error: `Schema "${slug}" not found` }, 404);
  }

  const { count } = await supabase
    .from('pages')
    .select('*', { count: 'exact', head: true })
    .eq('schema_id', schema.id);

  const specBundle = await getSchemaSpecBundle(c.env, { id: schema.id }, token ? { token } : undefined);
  const targets = await getSchemaFrontendTargets(c.env, schema.id, token ?? undefined);

  return c.json({
    schema: { ...schema, slug: schema.api_slug, schema_slug: schema.slug },
    page_count: count ?? 0,
    main_spec: specBundle.main_spec,
    attached_specs: specBundle.attached_specs,
    integration_requirements: normalizeSchemaIntegrationRequirements(schema.integration_requirements),
    targets,
    spec_text_url: `${await getPublicWorkerUrl(c.env, new URL(c.req.url).origin)}/api/schemas/${slug}/spec.txt`,
    pages_url: `${await getPublicWorkerUrl(c.env, new URL(c.req.url).origin)}/api/schemas/${slug}/pages`,
  });
});

schemas.get('/:slug/manifest', async (c) => {
  const slug = c.req.param('slug');
  const supabase = await createSupabaseAdminClient(c.env);
  const { data: schema, error } = await supabase
    .from('page_schemas')
    .select('id, slug, api_slug, name, registration_status, content_scope, entity_kind, frontend_url, revalidation_endpoint, slug_structure, integration_requirements')
    .eq('api_slug', slug)
    .single();

  if (error || !schema) {
    return c.json({ error: `Schema "${slug}" not found` }, 404);
  }
  if (schema.registration_status !== 'registered') {
    return c.json({ error: `Schema "${slug}" is not publicly registered` }, 404);
  }

  const baseUrl = await getPublicWorkerUrl(c.env, new URL(c.req.url).origin);
  return c.json(await buildFrontendIntegrationManifest(c.env, schema, baseUrl));
});

schemas.post('/:slug/pages', async (c) => {
  const auth = await requireAuthSession(c);
  if (auth instanceof Response) return auth;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Request body must be an object.' }, 400);
  const input = body as Record<string, unknown>;
  const client = await createSupabaseClient(c.env, auth.token);
  const { data: schema, error: schemaError } = await client.from('page_schemas')
    .select('id, api_slug, slug, tenant_id, name, entity_kind, content_scope, definition_revision, schema, frontend_url, slug_structure')
    .eq('api_slug', c.req.param('slug'))
    .maybeSingle();
  if (schemaError) return c.json({ error: schemaError.message }, 500);
  if (!schema) return c.json({ error: 'Schema not found.' }, 404);
  if (schema.content_scope === 'single-page') return c.json({ error: 'This is a single-page schema; it cannot receive additional entries.' }, 409);

  if (schema.entity_kind === 'event') {
    if (input.domain_url !== undefined) return c.json({ error: 'domain_url is not supported for event aggregate creation.' }, 400);
    if (input.status !== undefined && input.status !== 'draft') {
      return c.json({ error: 'Event pages are created as drafts and published separately.' }, 400);
    }
    const parsed = parseEventPageCreateInput(input);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      const aggregate = await createEventPageAggregate(client, schema, parsed.value) as {
        event_id: string; page_id: string; page_slug: string; page_status: 'draft'; page_updated_at: string;
      };
      const { data: tenant } = schema.tenant_id
        ? await client.from('tenants').select('slug').eq('id', schema.tenant_id).maybeSingle()
        : { data: null };
      const editorPath = tenant?.slug
        ? `/pages/schema/${encodeURIComponent(tenant.slug)}/${encodeURIComponent(schema.slug)}/edit/${aggregate.page_id}`
        : `/pages/schema/${encodeURIComponent(schema.api_slug)}/edit/${aggregate.page_id}`;
      return c.json({
        success: true,
        event: { id: aggregate.event_id, tenant_id: schema.tenant_id, page_id: aggregate.page_id },
        page: {
          id: aggregate.page_id, schema_id: schema.id, tenant_id: schema.tenant_id,
          name: parsed.value.name, slug: aggregate.page_slug, status: 'draft',
          content: parsed.value.content, updated_at: aggregate.page_updated_at,
        },
        editor_url: `${await getPublicWorkerUrl(c.env, new URL(c.req.url).origin)}${editorPath}`,
      }, 201);
    } catch (error) {
      if (error instanceof EventPageAggregateError) {
        return c.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status as ContentfulStatusCode);
      }
      return c.json({ error: error instanceof Error ? error.message : 'Event page creation failed.' }, 500);
    }
  }

  if (schema.entity_kind === 'service-product') {
    return c.json({ error: 'Use POST /api/products for service-product schemas.', code: 'aggregate_operation_required' }, 409);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'event')) {
    return c.json({ error: 'event details are accepted only by event-classified schemas.' }, 400);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'tenant_id') && input.tenant_id !== schema.tenant_id) {
    return c.json({ error: 'Page tenant must match the owning schema workspace.' }, 409);
  }
  if (typeof input.name !== 'string' || !input.name.trim() || !input.content || typeof input.content !== 'object' || Array.isArray(input.content)) {
    return c.json({ error: 'name and object content are required.' }, 400);
  }
  if (input.status !== undefined && !['draft', 'published'].includes(String(input.status))) {
    return c.json({ error: 'status must be draft or published.' }, 400);
  }
  const pageContent = input.content as Record<string, unknown>;
  if (input.status === 'published') {
    const validation = validateSchemaContent(schema.schema, pageContent);
    if (!validation.ok) return c.json({ error: 'Page content does not satisfy its schema.', details: validation.errors }, 400);
  }
  const requestedSlug = normalizeSchemaPageSlug(typeof input.slug === 'string' && input.slug.trim() ? input.slug : input.name);
  let uniqueSlug = requestedSlug;
  for (let suffix = 2; suffix <= 100; suffix += 1) {
    const { data: matches, error } = await client.from('pages').select('id').eq('slug', uniqueSlug).limit(1);
    if (error) return c.json({ error: error.message }, 500);
    if (!matches?.length) break;
    uniqueSlug = `${requestedSlug}-${suffix}`;
  }
  const pageInsert: Record<string, unknown> = {
    name: input.name.trim(), slug: uniqueSlug, content: pageContent,
    status: input.status ?? 'draft', schema_id: schema.id, owner_user_id: auth.userId,
    ...(input.domain_url !== undefined ? { domain_url: input.domain_url } : {}),
  };
  if (schema.tenant_id) pageInsert.tenant_id = schema.tenant_id;
  const { data: page, error: pageError } = await client.from('pages').insert(pageInsert)
    .select('id, slug, name, status, content, schema_id, tenant_id, domain_url, updated_at, published_at')
    .single();
  if (pageError || !page) return c.json({ error: pageError?.message || 'Failed to create page.' }, pageError?.code === '23505' ? 409 : 500);
  return c.json({ success: true, page }, 201);
});

schemas.get('/:slug/pages', async (c) => {
  const slug = c.req.param('slug');
  // Public delivery must work for tenant-owned schemas without requiring the
  // frontend to have a CMS user JWT. Use the server client for this read path;
  // the query still restricts returned pages to published content below.
  const supabase = await createSupabaseAdminClient(c.env);

  const { data: schema, error: schemaError } = await supabase
    .from('page_schemas')
    .select('id, slug, api_slug, tenant_id, name, registration_status, entity_kind, slug_structure, integration_requirements')
    .eq('api_slug', slug)
    .single();

  if (schemaError || !schema) {
    return c.json({ error: `Schema "${slug}" not found` }, 404);
  }

  if ((schema as { registration_status?: string }).registration_status !== 'registered') {
    return c.json({ error: `Schema "${slug}" is not publicly registered` }, 404);
  }
  const entityKind = (schema.entity_kind || 'page') as 'page' | 'service-product' | 'event';
  const includeResult = parsePublicEntityIncludes(c.req.query('include'), entityKind);
  if (!includeResult.ok) return c.json({ error: includeResult.error }, 400);

  let pageQuery = supabase
    .from('pages')
    .select('id, slug, name, status, content, domain_url, updated_at, published_at')
    .eq('schema_id', schema.id)
    .eq('status', 'published')
    .order('updated_at', { ascending: false });
  if (schema.tenant_id) pageQuery = pageQuery.eq('tenant_id', schema.tenant_id);
  const { data, error } = await pageQuery;

  if (error) return c.json({ error: error.message }, 500);

  let publicPages = (data ?? []) as PublicPageRecord[];
  if (entityKind === 'service-product') {
    const { data: productsData, error: productsError } = await supabase
      .from('service_products')
      .select('id, page_id')
      .eq('tenant_id', schema.tenant_id)
      .is('retired_at', null);
    if (productsError) return c.json({ error: productsError.message }, 500);
    const productRefs = (productsData ?? []).filter((product): product is { id: string; page_id: string } => Boolean(product.page_id));
    const activePageIds = new Set(productRefs.map((product) => product.page_id));
    publicPages = publicPages.filter((page) => activePageIds.has(page.id));
    if (includeResult.includes.includeEntity) publicPages = projectPublicProductRelations(publicPages, productRefs);
  } else if (entityKind === 'event') {
    if (!schema.tenant_id) return c.json({ error: 'Event schema is not assigned to a workspace.' }, 404);
    const pageIds = publicPages.map((page) => page.id);
    const { data: eventRows, error: eventError } = pageIds.length
      ? await supabase.from('mentorbooking_events')
        .select('id, page_id, date, time, end_time, duration_minutes, mode, timezone, product_id')
        .eq('tenant_id', schema.tenant_id)
        .in('page_id', pageIds)
      : { data: [], error: null };
    if (eventError) return c.json({ error: eventError.message }, 500);
    const eventRefs = (eventRows ?? []) as PublicEventReference[];
    let eventProducts: PublicEventProduct[] = [];
    if (includeResult.includes.includeProduct) {
      const productIds = [...new Set(eventRefs.map((event) => event.product_id).filter((id): id is number => typeof id === 'number'))];
      if (productIds.length) {
        const { data: productRows, error: productError } = await supabase.from('mentorbooking_products')
          .select('id, integration_id, name, product_page_id')
          .eq('tenant_id', schema.tenant_id)
          .is('retired_at', null)
          .in('id', productIds);
        if (productError) return c.json({ error: productError.message }, 500);
        const productPages = (productRows ?? []).filter((product) => typeof product.product_page_id === 'string');
        const productPageIds = productPages.map((product) => product.product_page_id as string);
        const { data: visibleProductPages, error: productPageError } = productPageIds.length
          ? await supabase.from('pages').select('id, slug, schema_id').eq('tenant_id', schema.tenant_id).eq('status', 'published').in('id', productPageIds)
          : { data: [], error: null };
        if (productPageError) return c.json({ error: productPageError.message }, 500);
        const productSchemaIds = [...new Set((visibleProductPages ?? []).map((productPage) => productPage.schema_id).filter((id): id is string => typeof id === 'string'))];
        const { data: visibleProductSchemas, error: productSchemaError } = productSchemaIds.length
          ? await supabase.from('page_schemas').select('id, api_slug').eq('tenant_id', schema.tenant_id).eq('entity_kind', 'service-product').eq('registration_status', 'registered').in('id', productSchemaIds)
          : { data: [], error: null };
        if (productSchemaError) return c.json({ error: productSchemaError.message }, 500);
        const publicProductSchemaById = new Map((visibleProductSchemas ?? []).map((productSchema) => [productSchema.id, productSchema.api_slug]));
        const visiblePageById = new Map((visibleProductPages ?? []).flatMap((productPage) => {
          const schemaApiSlug = publicProductSchemaById.get(productPage.schema_id);
          return schemaApiSlug ? [[productPage.id, { slug: productPage.slug, schemaApiSlug }] as const] : [];
        }));
        eventProducts = productPages.flatMap((product) => {
          const publicPage = product.product_page_id ? visiblePageById.get(product.product_page_id) : undefined;
          return publicPage
            ? [{ legacy_id: product.id, id: product.integration_id, name: product.name, page_slug: publicPage.slug, schema_api_slug: publicPage.schemaApiSlug }]
            : [];
        });
      }
    }
    publicPages = projectPublicEventRelations(publicPages, eventRefs, eventProducts, includeResult.includes);
  }

  const targets = await getSchemaFrontendTargets(c.env, schema.id, undefined, { publicRead: true });

  return c.json({
    schema: {
      slug: schema.api_slug,
      schema_slug: schema.slug,
      api_slug: schema.api_slug,
      name: schema.name,
      entity_kind: entityKind,
      supported_includes: entityKind === 'service-product' ? ['entity'] : entityKind === 'event' ? ['entity', 'event', 'product'] : [],
      slug_structure: schema.slug_structure,
      integration_requirements: normalizeSchemaIntegrationRequirements(schema.integration_requirements),
      targets,
    },
    pages: publicPages,
  });
});

schemas.patch('/:slug/pages/:pageId', async (c) => {
  const auth = await requireAuthSession(c);
  if (auth instanceof Response) return auth;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Request body must be an object.' }, 400);
  const input = body as Record<string, unknown>;
  const client = await createSupabaseClient(c.env, auth.token);
  const { data: schema, error: schemaError } = await client.from('page_schemas')
    .select('id, api_slug, tenant_id, entity_kind, definition_revision, schema')
    .eq('api_slug', c.req.param('slug'))
    .maybeSingle();
  if (schemaError) return c.json({ error: schemaError.message }, 500);
  if (!schema) return c.json({ error: 'Schema not found.' }, 404);

  if (schema.entity_kind === 'event') {
    if (input.event !== undefined) return c.json({ error: 'Operational event schedule changes are managed through the event editor; Pages PATCH updates page content and publication only.' }, 400);
    if (typeof input.tenant_id !== 'string' || input.tenant_id !== schema.tenant_id
      || !Number.isSafeInteger(input.expected_definition_revision) || Number(input.expected_definition_revision) < 1
      || typeof input.expected_page_updated_at !== 'string' || !Number.isFinite(Date.parse(input.expected_page_updated_at))
      || (input.status !== undefined && !['draft', 'published', 'archived'].includes(String(input.status)))
      || (input.domain_url !== undefined)) {
      return c.json({ error: 'Event page updates require the matching tenant_id, expected_definition_revision and expected_page_updated_at; domain_url is not supported.' }, 400);
    }
    if (input.content === undefined && input.name === undefined && input.slug === undefined && input.status === undefined) {
      return c.json({ error: 'Provide content, name, slug, or status to update.' }, 400);
    }
    if (input.content !== undefined && (typeof input.content !== 'object' || input.content === null || Array.isArray(input.content))) {
      return c.json({ error: 'content must be a JSON object.' }, 400);
    }
    if (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim())) return c.json({ error: 'name must be a non-empty string.' }, 400);
    if (input.slug !== undefined && (typeof input.slug !== 'string' || !input.slug.trim())) return c.json({ error: 'slug must be a non-empty string.' }, 400);
    try {
      const page = await updateEventPageAggregate(client, schema, c.req.param('pageId'), {
        tenant_id: input.tenant_id,
        expected_definition_revision: Number(input.expected_definition_revision),
        expected_page_updated_at: input.expected_page_updated_at,
        ...(input.content !== undefined ? { content: input.content as Record<string, unknown> } : {}),
        ...(typeof input.name === 'string' ? { name: input.name } : {}),
        ...(typeof input.slug === 'string' ? { slug: input.slug } : {}),
        ...(typeof input.status === 'string' ? { status: input.status as 'draft' | 'published' | 'archived' } : {}),
      });
      return c.json({ success: true, page });
    } catch (error) {
      if (error instanceof EventPageAggregateError) {
        return c.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status as ContentfulStatusCode);
      }
      return c.json({ error: error instanceof Error ? error.message : 'Event page update failed.' }, 500);
    }
  }
  if (schema.entity_kind === 'service-product') {
    return c.json({ error: 'Use the product aggregate API to update product pages.', code: 'aggregate_operation_required' }, 409);
  }
  const pageId = c.req.param('pageId');
  const { data: currentPage, error: pageError } = await client.from('pages')
    .select('id, slug, name, content, status, tenant_id, schema_id')
    .eq('id', pageId).eq('schema_id', schema.id).maybeSingle();
  if (pageError) return c.json({ error: pageError.message }, 500);
  if (!currentPage) return c.json({ error: 'Page not found in the requested schema.' }, 404);
  if (Object.prototype.hasOwnProperty.call(input, 'tenant_id') && input.tenant_id !== currentPage.tenant_id) {
    return c.json({ error: 'Page tenant cannot be reassigned.' }, 409);
  }
  const patch: Record<string, unknown> = {};
  if (input.content !== undefined) {
    if (typeof input.content !== 'object' || input.content === null || Array.isArray(input.content)) return c.json({ error: 'content must be a JSON object.' }, 400);
    patch.content = input.content;
  }
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) return c.json({ error: 'name must be a non-empty string.' }, 400);
    patch.name = input.name.trim();
  }
  if (input.slug !== undefined) {
    if (typeof input.slug !== 'string' || !input.slug.trim()) return c.json({ error: 'slug must be a non-empty string.' }, 400);
    const normalizedSlug = normalizeSchemaPageSlug(input.slug);
    const { data: duplicate, error } = await client.from('pages').select('id').eq('slug', normalizedSlug).neq('id', pageId).limit(1);
    if (error) return c.json({ error: error.message }, 500);
    if (duplicate?.length) return c.json({ error: `Page slug "${normalizedSlug}" is already in use.` }, 409);
    patch.slug = normalizedSlug;
  }
  if (input.status !== undefined) {
    if (!['draft', 'published', 'archived'].includes(String(input.status))) return c.json({ error: 'Unsupported page status.' }, 400);
    patch.status = input.status;
  }
  if (input.domain_url !== undefined) patch.domain_url = input.domain_url;
  if (!Object.keys(patch).length) return c.json({ error: 'Provide at least one page field to update.' }, 400);
  if (patch.status === 'published' || currentPage.status === 'published') {
    const content = (patch.content ?? currentPage.content) as Record<string, unknown>;
    const validation = validateSchemaContent(schema.schema, content);
    if (!validation.ok) return c.json({ error: 'Page content does not satisfy its schema.', details: validation.errors }, 400);
  }
  const { data: page, error } = await client.from('pages').update(patch)
    .eq('id', pageId).eq('schema_id', schema.id).eq('tenant_id', currentPage.tenant_id)
    .select('id, slug, name, status, content, schema_id, tenant_id, domain_url, updated_at, published_at').single();
  if (error || !page) return c.json({ error: error?.message || 'Page update failed.' }, 500);
  return c.json({ success: true, page });
});

schemas.get('/:slug/pages/:pageSlug', async (c) => {
  const slug = c.req.param('slug');
  const pageSlug = c.req.param('pageSlug');
  // As with the collection endpoint, public detail delivery must not depend
  // on the visitor having an authenticated CMS session.
  const supabase = await createSupabaseAdminClient(c.env);

  const { data: schema, error: schemaError } = await supabase
    .from('page_schemas')
    .select('id, slug, api_slug, tenant_id, name, registration_status, entity_kind')
    .eq('api_slug', slug)
    .single();

  if (schemaError || !schema || schema.registration_status !== 'registered') {
    return c.json({ error: `Schema "${slug}" not found` }, 404);
  }
  const entityKind = (schema.entity_kind || 'page') as 'page' | 'service-product' | 'event';
  const includeResult = parsePublicEntityIncludes(c.req.query('include'), entityKind);
  if (!includeResult.ok) return c.json({ error: includeResult.error }, 400);

  let pageQuery = supabase
    .from('pages')
    .select('id, slug, name, status, content, domain_url, updated_at, published_at')
    .eq('schema_id', schema.id)
    .eq('slug', pageSlug)
    .eq('status', 'published');
  if (schema.tenant_id) pageQuery = pageQuery.eq('tenant_id', schema.tenant_id);
  const { data: page, error } = await pageQuery.maybeSingle();

  if (error) return c.json({ error: error.message }, 500);
  if (!page) return c.json({ error: 'Published page not found' }, 404);

  let deliveredPage: Record<string, unknown> = page as Record<string, unknown>;
  if (entityKind === 'service-product') {
    const { data: product, error: productError } = await supabase
      .from('service_products')
      .select('id, page_id')
      .eq('tenant_id', schema.tenant_id)
      .eq('page_id', page.id)
      .is('retired_at', null)
      .maybeSingle();
    if (productError) return c.json({ error: productError.message }, 500);
    if (!product) return c.json({ error: 'Published product not found' }, 404);
    if (includeResult.includes.includeEntity) {
      deliveredPage = { ...page, relations: { entity: { kind: 'service-product', id: product.id } } };
    }
  } else if (entityKind === 'event') {
    if (!schema.tenant_id) return c.json({ error: 'Event schema is not assigned to a workspace.' }, 404);
    const { data: event, error: eventError } = await supabase.from('mentorbooking_events')
      .select('id, page_id, date, time, end_time, duration_minutes, mode, timezone, product_id')
      .eq('tenant_id', schema.tenant_id)
      .eq('page_id', page.id)
      .maybeSingle();
    if (eventError) return c.json({ error: eventError.message }, 500);
    if (!event || !event.timezone) return c.json({ error: 'Published event not found' }, 404);
    const [projected] = projectPublicEventRelations([page as PublicPageRecord], [event as PublicEventReference], [], includeResult.includes);
    if (!projected) return c.json({ error: 'Published event not found' }, 404);
    deliveredPage = projected as unknown as Record<string, unknown>;
    if (includeResult.includes.includeProduct && event.product_id !== null) {
      const { data: product, error: productError } = await supabase.from('mentorbooking_products')
        .select('id, integration_id, name, product_page_id')
        .eq('id', event.product_id)
        .eq('tenant_id', schema.tenant_id)
        .is('retired_at', null)
        .maybeSingle();
      if (productError) return c.json({ error: productError.message }, 500);
      if (product?.product_page_id) {
        const { data: productPage, error: productPageError } = await supabase.from('pages').select('slug, schema_id')
          .eq('id', product.product_page_id).eq('tenant_id', schema.tenant_id).eq('status', 'published').maybeSingle();
        if (productPageError) return c.json({ error: productPageError.message }, 500);
        const { data: productSchema, error: productSchemaError } = productPage
          ? await supabase.from('page_schemas').select('id, api_slug').eq('id', productPage.schema_id).eq('tenant_id', schema.tenant_id).eq('entity_kind', 'service-product').eq('registration_status', 'registered').maybeSingle()
          : { data: null, error: null };
        if (productSchemaError) return c.json({ error: productSchemaError.message }, 500);
        if (productPage && productSchema) {
          const relations = deliveredPage.relations && typeof deliveredPage.relations === 'object'
            ? deliveredPage.relations as Record<string, unknown>
            : {};
          deliveredPage = {
            ...deliveredPage,
            relations: {
              ...relations,
              product: { id: product.integration_id, name: product.name, slug: productPage.slug, schema_api_slug: productSchema.api_slug },
            },
          };
        }
      }
    }
  }

  return c.json({ schema: { slug: schema.api_slug, schema_slug: schema.slug, api_slug: schema.api_slug, name: schema.name, entity_kind: entityKind, supported_includes: entityKind === 'event' ? ['entity', 'event', 'product'] : entityKind === 'service-product' ? ['entity'] : [] }, page: deliveredPage });
});

// POST /api/schemas/:slug/register — Frontend registration callback
schemas.post('/:slug/register', async (c) => {
  const slug = c.req.param('slug');

  let body: SchemaRegistrationPayload;

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.code || !body.frontend_url) {
    return c.json({ error: 'Missing required fields: code, frontend_url' }, 400);
  }

  const result = await completeSchemaRegistration(c.env, slug, body);
  return c.json(result.body, result.status);
});

// PUT /api/schemas/:slug/frontend-targets — replace target metadata atomically
schemas.put('/:slug/frontend-targets', async (c) => {
  // MCP OAuth agent accounts are not in the human AppRole ladder; row-level
  // security on page_schemas still determines which schemas they can mutate.
  const auth = await requireAuthSession(c);
  if (auth instanceof Response) return auth;

  const slug = c.req.param('slug');
  let body: { targets?: SchemaFrontendTargetInput[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!Array.isArray(body.targets)) {
    return c.json({ error: 'targets must be an array' }, 400);
  }

  const client = await createSupabaseClient(c.env, auth.token);
  const { data: schema, error: schemaError } = await client
    .from('page_schemas')
    .select('id, slug, api_slug, tenant_id, integration_requirements')
    .eq('api_slug', slug)
    .single();

  if (schemaError || !schema) return c.json({ error: `Schema "${slug}" not found` }, 404);

  const validation = validateSchemaFrontendTargetInputs(body.targets, schema.integration_requirements);
  if (!validation.ok) return c.json({ error: validation.error }, 400);

  const admin = await createSupabaseAdminClient(c.env);
  const { error: rpcError } = await admin.rpc('replace_schema_frontend_targets', {
    target_schema_id: schema.id,
    target_targets: validation.targets,
  });

  if (rpcError) return c.json({ error: rpcError.message }, 500);

  const targets = await getSchemaFrontendTargets(c.env, schema.id, auth.token);
  return c.json({ success: true, schema: { slug: schema.api_slug, schema_slug: schema.slug, api_slug: schema.api_slug }, targets });
});

// PATCH /api/schemas/:slug/system-data — repair non-secret schema integration metadata.
schemas.patch('/:slug/system-data', async (c) => {
  // Allow user and OAuth agent sessions; RLS remains the authoritative scope.
  const auth = await requireAuthSession(c);
  if (auth instanceof Response) return auth;

  const slug = c.req.param('slug');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const client = await createSupabaseClient(c.env, auth.token);
  const { data: schema, error: schemaError } = await client
    .from('page_schemas')
    .select('id, slug, api_slug, integration_requirements')
    .eq('api_slug', slug)
    .single();

  if (schemaError || !schema) return c.json({ error: `Schema "${slug}" not found` }, 404);

  const validation = validateSchemaSystemDataPatch(body, schema.integration_requirements);
  if (!validation.ok) return c.json({ error: validation.error }, 400);

  const { data, error } = await client
    .from('page_schemas')
    .update(validation.patch)
    .eq('id', schema.id)
    .select('id, slug, api_slug, registration_status, frontend_url, revalidation_endpoint, slug_structure, integration_requirements, content_scope, page_target, updated_at')
    .single();

  if (error || !data) return c.json({ error: error?.message || 'Failed to update schema system data.' }, 500);

  return c.json({
    success: true,
    schema: { ...data, slug: data.api_slug, schema_slug: data.slug },
  });
});

schemas.get('/:slug/revalidation-secret/status', async (c) => {
  const auth = await requireAppRole(c, 'admin');
  if (auth instanceof Response) return auth;

  const slug = c.req.param('slug');
  const { schema, managementAvailable, warning, warningCode } = await getSchemaSecretStatus(c.env, slug, {
    token: auth.token,
    allowReadonlyFallback: true,
  });

  if (!schema) {
    return c.json({ error: `Schema "${slug}" not found` }, 404);
  }

  return c.json({
    configured: Boolean(schema.revalidation_secret_name || schema.revalidation_secret),
    secret_name: schema.revalidation_secret_name,
    legacy_plaintext: Boolean(schema.revalidation_secret && !schema.revalidation_secret_name),
    registration_status: schema.registration_status,
    frontend_url: schema.frontend_url,
    revalidation_endpoint: schema.revalidation_endpoint,
    management_available: managementAvailable,
    readonly_fallback: !managementAvailable,
    warning: managementAvailable ? null : warning,
    warning_code: managementAvailable ? null : warningCode,
  });
});

schemas.put('/:slug/revalidation-secret', async (c) => {
  const auth = await requireAppRole(c, 'admin');
  if (auth instanceof Response) return auth;

  const slug = c.req.param('slug');
  let schema: SchemaSecretStatusRow | null;
  try {
    ({ schema } = await getSchemaSecretStatus(c.env, slug, { migrateLegacy: false }));
  } catch (error) {
    if (isManagedSecretUnavailableError(error)) {
      return c.json({ error: getManagedSecretUnavailableMessage(c.env, error) }, 503);
    }
    throw error;
  }

  if (!schema) {
    return c.json({ error: `Schema "${slug}" not found` }, 404);
  }

  let body: { secret: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const secret = body.secret?.trim();
  if (!secret) {
    return c.json({ error: 'Missing required field: secret' }, 400);
  }

  const secretName = schema.revalidation_secret_name || buildRevalidationSecretName(schema.id);
  await upsertManagedSecret(c.env, {
    name: secretName,
    namespace: getRevalidationSecretNamespace(),
    value: secret,
    metadata: {
      schema_id: schema.id,
      schema_slug: schema.slug,
      frontend_url: schema.frontend_url,
    },
  });

  const admin = await createSupabaseAdminClient(c.env);
  const { error } = await admin
    .from('page_schemas')
    .update({
      revalidation_secret_name: secretName,
      revalidation_secret: null,
    })
    .eq('id', schema.id);

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ success: true, secret_name: secretName });
});

schemas.post('/revalidation-secrets/backfill', async (c) => {
  const auth = await requireAppRole(c, 'super-admin');
  if (auth instanceof Response) return auth;

  const admin = await createSupabaseAdminClient(c.env);
  const { data, error } = await admin
    .from('page_schemas')
    .select('id, slug, frontend_url, revalidation_endpoint, revalidation_secret, revalidation_secret_name, registration_status')
    .not('revalidation_secret', 'is', null);

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  const rows = (data ?? []) as SchemaSecretStatusRow[];
  let migrated = 0;

  for (const row of rows) {
    const before = row.revalidation_secret_name;
    const result = await migrateLegacyRevalidationSecret(c.env, row);
    if (!before && result.revalidation_secret_name) {
      migrated += 1;
    }
  }

  return c.json({ success: true, migrated, total: rows.length });
});

schemas.delete('/:slug/revalidation-secret', async (c) => {
  const auth = await requireAppRole(c, 'admin');
  if (auth instanceof Response) return auth;

  const slug = c.req.param('slug');
  let schema: SchemaSecretStatusRow | null;
  try {
    ({ schema } = await getSchemaSecretStatus(c.env, slug, { migrateLegacy: false }));
  } catch (error) {
    if (isManagedSecretUnavailableError(error)) {
      return c.json({ error: getManagedSecretUnavailableMessage(c.env, error) }, 503);
    }
    throw error;
  }

  if (!schema) {
    return c.json({ error: `Schema "${slug}" not found` }, 404);
  }

  if (schema.revalidation_secret_name) {
    await deleteManagedSecret(c.env, schema.revalidation_secret_name);
  }

  const admin = await createSupabaseAdminClient(c.env);
  const { error } = await admin
    .from('page_schemas')
    .update({
      revalidation_secret_name: null,
      revalidation_secret: null,
    })
    .eq('id', schema.id);

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ success: true });
});

schemas.post('/:slug/unhook', async (c) => {
  const auth = await requireAppRole(c, 'admin');
  if (auth instanceof Response) return auth;

  const slug = c.req.param('slug');
  let schema: SchemaSecretStatusRow | null;
  try {
    ({ schema } = await getSchemaSecretStatus(c.env, slug, { migrateLegacy: false }));
  } catch (error) {
    if (isManagedSecretUnavailableError(error)) {
      return c.json({ error: getManagedSecretUnavailableMessage(c.env, error) }, 503);
    }
    throw error;
  }

  if (!schema) {
    return c.json({ error: `Schema "${slug}" not found` }, 404);
  }

  if (schema.revalidation_secret_name) {
    await deleteManagedSecret(c.env, schema.revalidation_secret_name);
  }

  const admin = await createSupabaseAdminClient(c.env);
  const { error } = await admin
    .from('page_schemas')
    .update({
      registration_status: 'pending',
      frontend_url: null,
      revalidation_endpoint: null,
      revalidation_secret: null,
      revalidation_secret_name: null,
    })
    .eq('id', schema.id);

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ success: true });
});

// POST /api/schemas/:slug/revalidate — Trigger ISR on the registered frontend
schemas.post('/:slug/revalidate', async (c) => {
  const slug = c.req.param('slug');
  const token = parseBearerToken(c.req.header('Authorization'));
  const supabase = await createSupabaseClient(c.env, token);

  let body: { page_slug: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.page_slug) {
    return c.json({ error: 'Missing required field: page_slug' }, 400);
  }

  const { data: schema, error } = await supabase
    .from('page_schemas')
    .select('id, slug, api_slug, frontend_url, revalidation_endpoint, revalidation_secret, revalidation_secret_name, registration_status, slug_structure, integration_requirements')
    .eq('api_slug', slug)
    .single();

  if (error || !schema) {
    return c.json({ error: `Schema "${slug}" not found` }, 404);
  }

  let resolvedSchema = {
    id: schema.id,
    slug,
    frontend_url: schema.frontend_url,
    revalidation_endpoint: schema.revalidation_endpoint,
    revalidation_secret: schema.revalidation_secret,
    revalidation_secret_name: schema.revalidation_secret_name,
    registration_status: schema.registration_status,
    slug_structure: schema.slug_structure,
    integration_requirements: schema.integration_requirements,
  } as SchemaSecretStatusRow;

  try {
    resolvedSchema = await migrateLegacyRevalidationSecret(c.env, resolvedSchema);
  } catch (error) {
    if (!isManagedSecretUnavailableError(error)) {
      throw error;
    }
  }

  if (resolvedSchema.registration_status !== 'registered') {
    return c.json({ error: 'Schema does not have a registered frontend' }, 400);
  }

  if (!resolvedSchema.frontend_url || !resolvedSchema.revalidation_endpoint) {
    return c.json({ error: 'Frontend revalidation not configured' }, 400);
  }

  const targetRows = await getSchemaFrontendTargets(c.env, schema.id);
  const targets = targetRows.length > 0
    ? targetRows
    : [{ target_key: 'default', kind: 'detail-page' as const, host_path: resolvedSchema.slug_structure || '/:slug' }];
  const routePaths = targets.map((target) => ({
    target_key: target.target_key,
    kind: target.kind,
    path: buildTargetRevalidationPath(target, body.page_slug),
  }));

  let secretValue: string | null = null;
  if (resolvedSchema.revalidation_secret_name) {
    secretValue = await getManagedSecretValue(c.env, resolvedSchema.revalidation_secret_name);
  } else if (resolvedSchema.revalidation_secret) {
    // Legacy compatibility for schemas that still store a plaintext secret.
    secretValue = resolvedSchema.revalidation_secret;
  }

  if (!secretValue) {
    return c.json({
      success: false,
      status: 400,
      message: 'Revalidation secret is not configured for this schema',
      schema: slug,
    }, 400);
  }

  const buildHeaders = (secret: string | null): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) {
      headers.Authorization = `Bearer ${secret}`;
    }
    return headers;
  };

  const parseUpstreamBody = async (response: Response): Promise<string | null> => {
    const bodyText = await response.text().catch(() => '');
    if (!bodyText) return null;

    try {
      const parsed = JSON.parse(bodyText) as { error?: string; message?: string };
      return parsed.error || parsed.message || bodyText;
    } catch {
      return bodyText;
    }
  };

  try {
    const results = await Promise.all(routePaths.map(async (route) => {
      const revalidateUrl = new URL(resolvedSchema.revalidation_endpoint as string, resolvedSchema.frontend_url as string);
      revalidateUrl.searchParams.set('path', route.path);
      revalidateUrl.searchParams.set('slug', body.page_slug);

      const request = async (url: URL) => fetch(url.toString(), {
        method: 'POST',
        headers: buildHeaders(secretValue),
        signal: AbortSignal.timeout(10000),
      });

      let response = await request(revalidateUrl);
      let upstreamMessage = await parseUpstreamBody(response);

      if (!response.ok && response.status === 401 && !revalidateUrl.searchParams.has('secret')) {
        const legacyUrl = new URL(revalidateUrl.toString());
        legacyUrl.searchParams.set('secret', secretValue as string);
        response = await request(legacyUrl);
        upstreamMessage = await parseUpstreamBody(response);
      }

      return {
        target_key: route.target_key,
        path: route.path,
        status: response.status,
        success: response.ok,
        endpoint: `${revalidateUrl.origin}${revalidateUrl.pathname}`,
        message: response.ok
          ? 'Revalidation triggered successfully'
          : `Revalidation request failed${upstreamMessage ? `: ${upstreamMessage}` : ''}`,
      };
    }));

    const success = results.every((result) => result.success);
    return c.json({
      success,
      slug: body.page_slug,
      targets: routePaths,
      results,
      message: success ? 'Revalidation triggered successfully' : 'One or more target revalidation requests failed',
    });
  } catch (err) {
    return c.json({
      success: false,
      message: 'Failed to reach frontend revalidation endpoint',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default schemas;
