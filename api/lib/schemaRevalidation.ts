import { createSupabaseAdminClient, type Env } from './supabase.ts';
import { getManagedSecretValue } from './managedSecrets.ts';
import { buildTargetRevalidationPath } from './schemaRegistration.ts';
import { sanitizeRevalidationDiagnostic } from './revalidationDiagnostics.ts';

/**
 * Shared backend page revalidation push (ISR-style, "Variante A").
 *
 * Fired after page create/update/publication changes — including draft pages —
 * by the REST page routes and the MCP page tools. The dashboard additionally
 * triggers revalidation client-side for immediate user feedback; revalidation
 * POSTs are idempotent for the frontend, so a duplicate push is harmless.
 *
 * Also provides the secret check used by the stateless draft delivery
 * ("Variante B"): a registered frontend can fetch draft content by presenting
 * the schema's revalidation secret as a Bearer token.
 */

export interface SchemaRevalidationConfig {
  id: string;
  api_slug: string;
  frontend_url: string | null;
  revalidation_endpoint: string | null;
  revalidation_secret: string | null;
  revalidation_secret_name: string | null;
  registration_status: string | null;
  slug_structure: string | null;
}

export type PageRevalidationEventName = 'created' | 'updated' | 'published' | 'unpublished' | 'archived';

export interface PageRevalidationTriggerInput {
  page_id: string;
  page_slug: string;
  status: 'draft' | 'published' | 'archived';
  event: PageRevalidationEventName;
  content?: Record<string, unknown> | null;
}

export interface RouteRevalidationResult {
  target_key: string;
  kind: string;
  path: string;
  status: number;
  success: boolean;
  message: string;
}

export interface PageRevalidationOutcome {
  attempted: boolean;
  skipped_reason?: 'not_registered' | 'frontend_not_configured' | 'secret_missing';
  success: boolean;
  results: RouteRevalidationResult[];
}

export interface RevalidationSecretStatus {
  revalidation_secret: string | null;
  revalidation_secret_name: string | null;
}

export async function resolveRevalidationSecret(env: Env, schema: RevalidationSecretStatus): Promise<string | null> {
  if (schema.revalidation_secret_name) {
    return await getManagedSecretValue(env, schema.revalidation_secret_name);
  }
  // Legacy compatibility for schemas that still store a plaintext secret.
  return schema.revalidation_secret ?? null;
}

/**
 * Stateless draft delivery check ("Variante B"): the registered frontend
 * presents the schema's revalidation secret as a Bearer token to read drafts.
 */
export async function isRevalidationSecretValid(
  env: Env,
  schema: RevalidationSecretStatus,
  token: string | null,
): Promise<boolean> {
  if (!token) return false;
  let secretValue: string | null = null;
  try {
    secretValue = await resolveRevalidationSecret(env, schema);
  } catch {
    return false;
  }
  return Boolean(secretValue) && secretValue === token;
}

/**
 * Push a page change to the registered frontend revalidation endpoint. Sends
 * one POST per enabled frontend target (including preview targets, so the
 * frontend can (re)build the draft preview route) with the secret as Bearer
 * token, the legacy `path`/`slug` query parameters, and a JSON body payload
 * (`schema_slug`, `page_id`, `slug`, `status`, `event`, `preview_path`,
 * `content`). Never throws — failures are reported per route so the calling
 * write operation is not blocked by a frontend being unreachable.
 */
export async function triggerPageRevalidation(
  env: Env,
  schema: SchemaRevalidationConfig,
  input: PageRevalidationTriggerInput,
): Promise<PageRevalidationOutcome> {
  if (schema.registration_status !== 'registered') {
    return { attempted: false, skipped_reason: 'not_registered', success: false, results: [] };
  }
  if (!schema.frontend_url || !schema.revalidation_endpoint) {
    return { attempted: false, skipped_reason: 'frontend_not_configured', success: false, results: [] };
  }

  const admin = await createSupabaseAdminClient(env);
  const { data: targetRows, error } = await admin
    .from('schema_frontend_targets')
    .select('target_key, kind, host_path, supports_preview')
    .eq('schema_id', schema.id)
    .eq('enabled', true)
    .order('sort_order', { ascending: true });
  if (error) {
    return {
      attempted: false,
      skipped_reason: 'frontend_not_configured',
      success: false,
      results: [],
    };
  }

  const pageSlug = input.page_slug.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  const targets = (targetRows ?? []).length > 0
    ? (targetRows ?? [])
    : [{ target_key: 'default', kind: 'detail-page' as const, host_path: schema.slug_structure || '/:slug', supports_preview: false }];

  const routePaths = targets.map((target) => ({
    target_key: target.target_key,
    kind: target.kind,
    path: buildTargetRevalidationPath(target, pageSlug),
  }));
  const previewRoute = targets.find((target) => target.kind === 'detail-page' && target.supports_preview);
  const previewPath = previewRoute ? buildTargetRevalidationPath(previewRoute, pageSlug) : null;

  let secretValue: string | null = null;
  try {
    secretValue = await resolveRevalidationSecret(env, schema);
  } catch (error) {
    return {
      attempted: false,
      skipped_reason: 'secret_missing',
      success: false,
      results: routePaths.map((route) => ({
        target_key: route.target_key,
        kind: route.kind,
        path: route.path,
        status: 0,
        success: false,
        message: sanitizeRevalidationDiagnostic(
          error instanceof Error ? error.message : 'Unknown secret-store error',
          null,
        ),
      })),
    };
  }
  if (!secretValue) {
    return { attempted: false, skipped_reason: 'secret_missing', success: false, results: [] };
  }

  const payload: Record<string, unknown> = {
    schema_slug: schema.api_slug,
    page_id: input.page_id,
    slug: pageSlug,
    status: input.status,
    event: input.event,
    ...(previewPath ? { preview_path: previewPath } : {}),
    ...(input.content ? { content: input.content } : {}),
  };

  const results = await Promise.all(routePaths.map(async (route) => {
    const revalidateUrl = new URL(schema.revalidation_endpoint as string, schema.frontend_url as string);
    revalidateUrl.searchParams.set('path', route.path);
    revalidateUrl.searchParams.set('slug', pageSlug);
    const endpoint = `${revalidateUrl.origin}${revalidateUrl.pathname}`;
    const request = async (url: URL): Promise<Response> => fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secretValue}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    try {
      let response = await request(revalidateUrl);
      if (!response.ok && response.status === 401 && !revalidateUrl.searchParams.has('secret')) {
        // Legacy frontends expect the secret as a query parameter.
        const legacyUrl = new URL(revalidateUrl.toString());
        legacyUrl.searchParams.set('secret', secretValue as string);
        response = await request(legacyUrl);
      }
      const upstreamText = (await response.text().catch(() => '')).slice(0, 512);
      let upstreamMessage = '';
      try {
        const parsed = JSON.parse(upstreamText) as { error?: string; message?: string };
        upstreamMessage = parsed.error || parsed.message || '';
      } catch {
        upstreamMessage = upstreamText;
      }
      return {
        target_key: route.target_key,
        kind: route.kind,
        path: route.path,
        status: response.status,
        success: response.ok,
        message: response.ok ? 'Revalidation triggered successfully' : sanitizeRevalidationDiagnostic(
          upstreamMessage || `Frontend returned HTTP ${response.status}`,
          secretValue,
        ),
      };
    } catch (error) {
      return {
        target_key: route.target_key,
        kind: route.kind,
        path: route.path,
        status: 0,
        success: false,
        message: sanitizeRevalidationDiagnostic(
          error instanceof Error ? error.message : 'Unknown network error',
          secretValue,
        ),
      };
    }
  }));

  return {
    attempted: true,
    success: results.every((result) => result.success),
    results,
  };
}

/** Maps a status transition to the revalidation event name. */
export function pageRevalidationEventName(
  previousStatus: string | null | undefined,
  nextStatus: string,
): PageRevalidationEventName {
  if (nextStatus === 'published' && previousStatus !== 'published') return 'published';
  if (previousStatus === 'published' && nextStatus !== 'published') return 'unpublished';
  if (nextStatus === 'archived') return 'archived';
  return 'updated';
}