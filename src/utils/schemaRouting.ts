import {
  DEFAULT_SCHEMA_INTEGRATION_REQUIREMENTS,
  type PageSchema,
  type SchemaIntegrationRequirements,
  type SchemaFrontendTarget,
} from '@/types/pagebuilder';

const SLUG_TOKEN = ':slug';

const normalizeSlashes = (value: string): string => value.replace(/\/+/g, '/');

const ensureLeadingSlash = (value: string): string => (value.startsWith('/') ? value : `/${value}`);

export const normalizeSchemaIntegrationRequirements = (
  requirements: SchemaIntegrationRequirements | null | undefined,
): SchemaIntegrationRequirements => {
  const merged: SchemaIntegrationRequirements = {
    ...DEFAULT_SCHEMA_INTEGRATION_REQUIREMENTS,
    ...(requirements ?? {}),
  };

  const normalizeNullable = (value: string | null | undefined): string | null => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  };

  const normalizedBasePath = normalizeNullable(merged.route_base_path);
  const normalizedRequiredStructure = normalizeNullable(merged.required_slug_structure);

  return {
    ...merged,
    canonical_frontend_url: normalizeNullable(merged.canonical_frontend_url),
    required_slug_structure: normalizedRequiredStructure
      ? normalizeSchemaSlugStructure(normalizedRequiredStructure)
      : null,
    route_base_path: normalizedBasePath
      ? normalizeRouteBasePath(normalizedBasePath)
      : null,
    schema_identification_hint: normalizeNullable(merged.schema_identification_hint),
    registration_notes: normalizeNullable(merged.registration_notes),
  };
};

export const normalizeRouteBasePath = (value: string): string => {
  const normalized = normalizeSlashes(ensureLeadingSlash(value.trim()));
  if (normalized === '/') {
    return '/';
  }

  return normalized.replace(/\/$/, '');
};

export const normalizeSchemaSlugStructure = (value: string): string => {
  const normalized = normalizeSlashes(ensureLeadingSlash(value.trim()));
  return normalized.replace(/\/$/, '') || '/';
};

export const buildRouteBasePathFromSlugStructure = (slugStructure: string): string => {
  const normalized = normalizeSchemaSlugStructure(slugStructure);
  const withoutToken = normalized.replace(SLUG_TOKEN, '');
  const collapsed = withoutToken.replace(/\/+/g, '/').replace(/\/$/, '');
  return collapsed || '/';
};

export const getExpectedSlugStructure = (schema: Pick<PageSchema, 'slug_structure' | 'integration_requirements'>): string => {
  const requirements = normalizeSchemaIntegrationRequirements(schema.integration_requirements);
  if (requirements.required_slug_structure) {
    return requirements.required_slug_structure;
  }

  return normalizeSchemaSlugStructure(schema.slug_structure || '/:slug');
};

export const buildSchemaPagePath = (slugStructure: string, pageSlug: string): string => {
  const normalizedSlug = pageSlug.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  return normalizeSchemaSlugStructure(slugStructure).replace(SLUG_TOKEN, normalizedSlug);
};

export const buildSchemaPageUrl = (
  frontendUrl: string,
  slugStructure: string,
  pageSlug: string,
): string => `${frontendUrl.replace(/\/$/, '')}${buildSchemaPagePath(slugStructure, pageSlug)}`;

export const getDetailPageTarget = (
  schema: Pick<PageSchema, 'slug_structure' | 'integration_requirements' | 'frontend_targets'>,
): SchemaFrontendTarget | null => {
  const target = schema.frontend_targets?.find((candidate) =>
    candidate.enabled && candidate.kind === 'detail-page',
  );
  return target ?? null;
};

export const getCollectionSlotTargets = (
  schema: Pick<PageSchema, 'frontend_targets'>,
): SchemaFrontendTarget[] => (schema.frontend_targets ?? []).filter((target) =>
  target.enabled && target.kind === 'collection-slot',
);