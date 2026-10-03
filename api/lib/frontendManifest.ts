import { getSchemaFrontendTargets } from './schemaRegistration';
import { normalizeSchemaIntegrationRequirements } from './schemaRouting';

interface ManifestSchema {
  id: string;
  slug: string;
  api_slug: string;
  name: string;
  registration_status: string;
  content_scope?: 'page-collection' | 'single-page' | null;
  entity_kind?: 'page' | 'service-product' | 'event' | null;
  frontend_url: string | null;
  revalidation_endpoint: string | null;
  slug_structure: string | null;
  integration_requirements: Record<string, unknown> | null;
}

export async function buildFrontendIntegrationManifest(
  env: Parameters<typeof getSchemaFrontendTargets>[0],
  schema: ManifestSchema,
  baseUrl: string,
) {
  const targets = await getSchemaFrontendTargets(env, schema.id, undefined, { publicRead: true });
  const requirements = normalizeSchemaIntegrationRequirements(schema.integration_requirements);
  const detailTarget = targets.find((target) => target.kind === 'detail-page');
  const publicDeliveryAvailable = !schema.entity_kind || schema.entity_kind === 'page' || schema.entity_kind === 'service-product' || schema.entity_kind === 'event';

  return {
    manifest_version: '1',
    schema: {
      id: schema.id,
      slug: schema.api_slug,
      schema_slug: schema.slug,
      api_slug: schema.api_slug,
      name: schema.name,
      content_scope: schema.content_scope || requirements.content_scope,
      entity_kind: schema.entity_kind || 'page',
    },
    frontend: {
      url: schema.frontend_url,
      registration_status: schema.registration_status,
    },
    data: {
      available: publicDeliveryAvailable,
      collection_url: publicDeliveryAvailable ? `${baseUrl}/api/schemas/${schema.api_slug}/pages` : null,
      detail_url_template: publicDeliveryAvailable ? `${baseUrl}/api/schemas/${schema.api_slug}/pages/:slug` : null,
      authentication: 'public-registered-schema',
      published_only: true,
      supported_includes: schema.entity_kind === 'service-product' ? ['entity'] : schema.entity_kind === 'event' ? ['entity', 'event', 'product'] : [],
      page_fields: ['id', 'slug', 'name', 'status', 'content', 'domain_url', 'updated_at', 'published_at'],
    },
    targets,
    revalidation: {
      enabled: Boolean(schema.frontend_url && schema.revalidation_endpoint),
      endpoint: schema.revalidation_endpoint,
      authorization: 'bearer',
      requests_per_target: true,
      // Registration health cannot prove that a static frontend can generate
      // routes. Until a frontend declares and verifies that capability, do not
      // promise support for newly created detail routes.
      supports_new_routes: null,
    },
    legacy: {
      slug_structure: schema.slug_structure,
      detail_target: detailTarget?.host_path || null,
    },
  };
}
