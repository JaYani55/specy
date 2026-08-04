import { getSchemaFrontendTargets } from './schemaRegistration';
import { normalizeSchemaIntegrationRequirements } from './schemaRouting';

interface ManifestSchema {
  id: string;
  slug: string;
  name: string;
  registration_status: string;
  content_scope?: 'page-collection' | 'single-page' | null;
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

  return {
    manifest_version: '1',
    schema: {
      id: schema.id,
      slug: schema.slug,
      name: schema.name,
      content_scope: schema.content_scope || requirements.content_scope,
    },
    frontend: {
      url: schema.frontend_url,
      registration_status: schema.registration_status,
    },
    data: {
      collection_url: `${baseUrl}/api/schemas/${schema.slug}/pages`,
      detail_url_template: `${baseUrl}/api/schemas/${schema.slug}/pages/:slug`,
      authentication: 'public-registered-schema',
      published_only: true,
      page_fields: ['id', 'slug', 'name', 'status', 'content', 'domain_url', 'updated_at', 'published_at'],
    },
    targets,
    revalidation: {
      enabled: Boolean(schema.frontend_url && schema.revalidation_endpoint),
      endpoint: schema.revalidation_endpoint,
      authorization: 'bearer',
      requests_per_target: true,
      supports_new_routes: true,
    },
    legacy: {
      slug_structure: schema.slug_structure,
      detail_target: detailTarget?.host_path || null,
    },
  };
}
