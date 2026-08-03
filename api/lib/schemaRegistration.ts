import { createSupabaseAdminClient, createSupabaseClient, type Env } from './supabase';
import { validateOutboundHttpUrl } from './urlSafety';
import {
  buildRevalidationSecretName,
  upsertManagedSecret,
  getRevalidationSecretNamespace,
} from './managedSecrets';
import {
  isFrontendUrlAllowed,
  normalizeSchemaIntegrationRequirements,
  type SchemaIntegrationRequirementsRecord,
  validateFrontendTarget,
  validateSlugStructure,
  type SchemaContentScope,
  validateCollectionHostPath,
} from './schemaRouting';

export type SchemaFrontendTargetKind = 'collection-slot' | 'detail-page';

export interface SchemaFrontendTargetInput {
  target_key: string;
  kind: SchemaFrontendTargetKind;
  host_path: string;
  placement_key?: string | null;
  supports_preview?: boolean;
  is_primary?: boolean;
  sort_order?: number;
  enabled?: boolean;
}

export interface SchemaPageTargetInput {
  target_key: string;
  host_path: string;
  page_slug?: string | null;
  is_primary?: boolean;
  enabled?: boolean;
}

export interface SchemaContentContractInput {
  content_scope: SchemaContentScope;
  page_target?: SchemaPageTargetInput | null;
}

export interface SchemaRegistrationPayload {
  code: string;
  frontend_url: string;
  revalidation_endpoint?: string;
  revalidation_secret?: string;
  /** Legacy detail-route field. Kept for existing agents and clients. */
  slug_structure?: string;
  targets?: SchemaFrontendTargetInput[];
}

export function validateSchemaContentContract(
  contract: SchemaContentContractInput | null | undefined,
): { ok: true; contract: SchemaContentContractInput } | { ok: false; error: string } {
  if (!contract) {
    return { ok: true, contract: { content_scope: 'page-collection' } };
  }
  if (contract.content_scope === 'page-collection') {
    return { ok: true, contract };
  }
  if (contract.content_scope !== 'single-page') {
    return { ok: false, error: 'content_scope must be page-collection or single-page' };
  }
  const target = contract.page_target;
  if (!target || !target.target_key || !target.host_path) {
    return { ok: false, error: 'single-page schemas require page_target.target_key and page_target.host_path' };
  }
  if (!validateTargetKey(target.target_key)) {
    return { ok: false, error: `Invalid page_target.target_key: ${target.target_key}` };
  }
  const path = validateCollectionHostPath(target.host_path);
  if (!path.ok) return { ok: false, error: path.error || 'Invalid page_target.host_path' };
  return {
    ok: true,
    contract: { ...contract, page_target: { ...target, host_path: path.normalized, is_primary: true, enabled: true } },
  };
}

function normalizeRevalidationEndpoint(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || /[?#\\]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function validateTargetKey(value: string): boolean {
  return /^[a-z][a-z0-9_.-]{0,99}$/.test(value);
}

export function validateSchemaFrontendTargetInputs(
  targets: SchemaFrontendTargetInput[],
  requirements: SchemaIntegrationRequirementsRecord | null,
): { ok: true; targets: SchemaFrontendTargetInput[] } | { ok: false; error: string } {
  const seenKeys = new Set<string>();
  let primaryCount = 0;
  let detailCount = 0;
  const normalizedTargets: SchemaFrontendTargetInput[] = [];

  for (const target of targets) {
    if (!validateTargetKey(target.target_key) || seenKeys.has(target.target_key)) {
      return { ok: false, error: `Invalid or duplicate target_key: ${target.target_key}` };
    }
    seenKeys.add(target.target_key);

    const validation = validateFrontendTarget(target, requirements);
    if (!validation.ok || !validation.normalized) {
      return { ok: false, error: validation.error || `Invalid target: ${target.target_key}` };
    }
    if (target.kind === 'detail-page' && target.enabled !== false) detailCount += 1;
    if (target.is_primary && target.enabled !== false) primaryCount += 1;

    normalizedTargets.push({
      ...target,
      host_path: validation.normalized,
      placement_key: target.kind === 'collection-slot' ? target.placement_key ?? null : null,
      supports_preview: target.kind === 'detail-page' && target.supports_preview !== false,
      is_primary: target.is_primary ?? false,
      sort_order: target.sort_order ?? normalizedTargets.length,
      enabled: target.enabled !== false,
    });
  }

  if (normalizedTargets.length > 0 && primaryCount !== 1) {
    return { ok: false, error: 'Targets must define exactly one enabled primary target' };
  }
  if (detailCount > 1) {
    return { ok: false, error: 'Registration currently supports at most one enabled detail-page target' };
  }

  return { ok: true, targets: normalizedTargets };
}

function legacyTarget(
  body: SchemaRegistrationPayload,
  requirements: SchemaIntegrationRequirementsRecord | null,
  storedSlugStructure: string | null,
): SchemaFrontendTargetInput {
  const candidate = body.slug_structure?.trim()
    || normalizeSchemaIntegrationRequirements(requirements).required_slug_structure
    || storedSlugStructure
    || '/:slug';

  if (candidate === '/') {
    return {
      target_key: `home.${body.frontend_url.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'content'}`,
      kind: 'collection-slot',
      host_path: '/',
      placement_key: 'home.content',
      supports_preview: false,
      is_primary: true,
      sort_order: 0,
      enabled: true,
    };
  }

  return {
    target_key: 'default',
    kind: 'detail-page',
    host_path: candidate,
    supports_preview: true,
    is_primary: true,
    sort_order: 0,
    enabled: true,
  };
}

export async function completeSchemaRegistration(
  env: Env,
  slug: string,
  body: SchemaRegistrationPayload,
  token?: string,
) {
  if (!body.revalidation_secret?.trim()) {
    return {
      status: 400 as const,
      body: {
        error: 'Missing required field: revalidation_secret',
        instruction: 'Generate a strong random secret and configure the same value in the frontend revalidation endpoint before registering.',
      },
    };
  }

  // MCP registration is authenticated and must retain the caller's RLS
  // context. The public REST callback is code-authenticated, so it uses the
  // service client for lookup when no bearer token is available.
  const supabase = token
    ? await createSupabaseClient(env, token)
    : await createSupabaseAdminClient(env);
  const admin = await createSupabaseAdminClient(env);

  const { data: schema, error } = await supabase
    .from('page_schemas')
    .select('id, slug, registration_code, registration_status, revalidation_secret_name, slug_structure, integration_requirements, tenant_id')
    .eq('slug', slug)
    .single();

  if (error || !schema) {
    return { status: 404 as const, body: { error: `Schema "${slug}" not found` } };
  }
  if (schema.registration_status !== 'waiting') {
    return { status: 400 as const, body: { error: 'Schema is not awaiting registration' } };
  }
  if (schema.registration_code !== body.code) {
    return { status: 403 as const, body: { error: 'Invalid registration code' } };
  }

  const validatedFrontendUrl = validateOutboundHttpUrl(body.frontend_url);
  if (!validatedFrontendUrl.ok) {
    return { status: 400 as const, body: { error: validatedFrontendUrl.error } };
  }
  const frontendPolicy = isFrontendUrlAllowed(validatedFrontendUrl.url.origin, schema.integration_requirements);
  if (!frontendPolicy.ok) {
    return { status: 400 as const, body: { error: frontendPolicy.error } };
  }

  const suppliedTargets = body.targets?.length ? body.targets : [
    legacyTarget(body, schema.integration_requirements, schema.slug_structure),
  ];
  const normalizedRequirements = normalizeSchemaIntegrationRequirements(schema.integration_requirements);
  const targetValidation = validateSchemaFrontendTargetInputs(suppliedTargets, schema.integration_requirements);
  if (!targetValidation.ok) return { status: 400 as const, body: { error: targetValidation.error } };
  const targets = targetValidation.targets;

  const revalidationEndpoint = normalizeRevalidationEndpoint(body.revalidation_endpoint);
  if (body.revalidation_endpoint?.trim() && !revalidationEndpoint) {
    return { status: 400 as const, body: { error: 'revalidation_endpoint must be a strict relative path' } };
  }

  const revalidationSecretName = body.revalidation_secret?.trim()
    ? (schema.revalidation_secret_name || buildRevalidationSecretName(schema.id))
    : schema.revalidation_secret_name;

  if (body.revalidation_secret?.trim() && revalidationSecretName) {
    await upsertManagedSecret(env, {
      name: revalidationSecretName,
      namespace: getRevalidationSecretNamespace(),
      value: body.revalidation_secret.trim(),
      metadata: { schema_id: schema.id, schema_slug: schema.slug, frontend_url: validatedFrontendUrl.url.origin },
    });
  }

  const primaryDetail = targets.find((target) => target.is_primary && target.kind === 'detail-page');
  const schemaUpdate = {
    registration_status: 'registered',
    registration_code: null,
    frontend_url: validatedFrontendUrl.url.origin,
    revalidation_endpoint: revalidationEndpoint,
    revalidation_secret: null,
    revalidation_secret_name: revalidationSecretName ?? null,
    ...(primaryDetail ? { slug_structure: primaryDetail.host_path } : {}),
  };

  const { error: updateError } = await admin.from('page_schemas').update(schemaUpdate).eq('id', schema.id);
  if (updateError) {
    return { status: 500 as const, body: { error: 'Failed to complete registration' } };
  }

  await admin.from('schema_frontend_targets').delete().eq('schema_id', schema.id);
  const { error: targetError } = await admin.from('schema_frontend_targets').insert(
    targets.map((target) => ({ ...target, schema_id: schema.id, tenant_id: schema.tenant_id })),
  );
  if (targetError) {
    return { status: 500 as const, body: { error: `Failed to save frontend targets: ${targetError.message}` } };
  }

  return {
    status: 200 as const,
    body: {
      success: true,
      message: 'Schema registration completed successfully',
      schema: {
        slug,
        frontend_url: validatedFrontendUrl.url.origin,
        slug_structure: primaryDetail?.host_path ?? schema.slug_structure,
        targets,
      },
      requirements: normalizedRequirements,
    },
  };
}

export async function getSchemaFrontendTargets(
  env: Env,
  schemaId: string,
  token?: string,
  options?: { publicRead?: boolean },
) {
  const client = options?.publicRead
    ? await createSupabaseAdminClient(env)
    : await createSupabaseClient(env, token);
  const { data, error } = await client
    .from('schema_frontend_targets')
    .select('id, schema_id, tenant_id, target_key, kind, host_path, placement_key, supports_preview, is_primary, sort_order, enabled, created_at, updated_at')
    .eq('schema_id', schemaId)
    .eq('enabled', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export function buildTargetRevalidationPath(target: {
  kind: SchemaFrontendTargetKind;
  host_path: string;
}, pageSlug: string): string {
  if (target.kind === 'collection-slot') return target.host_path;
  return target.host_path.replace(':slug', pageSlug.trim().replace(/^\/+/, '').replace(/\/+$/, ''));
}
