const SLUG_TOKEN = ':slug';

export type SchemaFrontendTargetKind = 'collection-slot' | 'detail-page';
export type SchemaContentScope = 'page-collection' | 'single-page';

export interface SchemaPageTargetInput {
  target_key: string;
  host_path: string;
  page_slug?: string | null;
  is_primary?: boolean;
  enabled?: boolean;
}

export interface FrontendTargetValidationResult {
  ok: boolean;
  normalized?: string;
  error?: string;
}

export interface SchemaIntegrationRequirementsRecord {
  content_scope?: SchemaContentScope | null;
  page_target?: SchemaPageTargetInput | null;
  canonical_frontend_url?: string | null;
  required_slug_structure?: string | null;
  route_base_path?: string | null;
  route_ownership?: 'isolated' | 'shared-layout-only' | 'may-modify-existing' | null;
  allow_temporary_frontend_urls?: boolean | null;
  page_discovery_mode?: 'schema-scoped-api' | 'supabase-by-schema' | 'infer-content-shape' | null;
  schema_identification_hint?: string | null;
  registration_notes?: string | null;
}

export interface NormalizedSchemaIntegrationRequirements {
  content_scope: SchemaContentScope;
  page_target: SchemaPageTargetInput | null;
  canonical_frontend_url: string | null;
  required_slug_structure: string | null;
  route_base_path: string | null;
  route_ownership: 'isolated' | 'shared-layout-only' | 'may-modify-existing';
  allow_temporary_frontend_urls: boolean;
  page_discovery_mode: 'schema-scoped-api' | 'supabase-by-schema' | 'infer-content-shape';
  schema_identification_hint: string | null;
  registration_notes: string | null;
}

export interface SlugStructureValidationResult {
  ok: boolean;
  normalized?: string;
  error?: string;
}

const normalizeNullable = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const ensureLeadingSlash = (value: string): string => (value.startsWith('/') ? value : `/${value}`);

export const normalizeSchemaSlugStructure = (value: string): string => {
  const normalized = ensureLeadingSlash(value.trim()).replace(/\/+/g, '/');
  return normalized.replace(/\/$/, '') || '/';
};

export const normalizeRouteBasePath = (value: string): string => {
  const normalized = normalizeSchemaSlugStructure(value);
  return normalized === '/' ? '/' : normalized.replace(/\/$/, '');
};

export const normalizeSchemaIntegrationRequirements = (
  requirements: SchemaIntegrationRequirementsRecord | null | undefined,
): NormalizedSchemaIntegrationRequirements => ({
  content_scope: requirements?.content_scope === 'single-page' ? 'single-page' : 'page-collection',
  page_target: requirements?.page_target ?? null,
  canonical_frontend_url: normalizeNullable(requirements?.canonical_frontend_url),
  required_slug_structure: normalizeNullable(requirements?.required_slug_structure)
    ? normalizeSchemaSlugStructure(requirements?.required_slug_structure as string)
    : null,
  route_base_path: normalizeNullable(requirements?.route_base_path)
    ? normalizeRouteBasePath(requirements?.route_base_path as string)
    : null,
  route_ownership: requirements?.route_ownership === 'shared-layout-only'
    ? 'shared-layout-only'
    : requirements?.route_ownership === 'may-modify-existing'
      ? 'may-modify-existing'
      : 'isolated',
  allow_temporary_frontend_urls: requirements?.allow_temporary_frontend_urls ?? true,
  page_discovery_mode: requirements?.page_discovery_mode === 'supabase-by-schema'
    ? 'supabase-by-schema'
    : requirements?.page_discovery_mode === 'infer-content-shape'
      ? 'infer-content-shape'
      : 'schema-scoped-api',
  schema_identification_hint: normalizeNullable(requirements?.schema_identification_hint),
  registration_notes: normalizeNullable(requirements?.registration_notes),
});

export const validateSlugStructure = (
  value: string,
  requirements?: SchemaIntegrationRequirementsRecord | null,
): SlugStructureValidationResult => {
  const normalized = normalizeSchemaSlugStructure(value);

  if (!normalized.startsWith('/')) {
    return { ok: false, error: 'slug_structure must start with /' };
  }

  if (!normalized.includes(SLUG_TOKEN)) {
    return { ok: false, error: 'slug_structure must include the :slug token' };
  }

  if ((normalized.match(/:slug/g) || []).length !== 1) {
    return { ok: false, error: 'slug_structure must include :slug exactly once' };
  }

  if (/\s/.test(normalized)) {
    return { ok: false, error: 'slug_structure must not contain whitespace' };
  }

  const normalizedRequirements = normalizeSchemaIntegrationRequirements(requirements);
  if (normalizedRequirements.required_slug_structure && normalized !== normalizedRequirements.required_slug_structure) {
    return {
      ok: false,
      error: `slug_structure must match the schema requirement ${normalizedRequirements.required_slug_structure}`,
    };
  }

  if (normalizedRequirements.route_base_path) {
    const requiredPrefix = normalizedRequirements.route_base_path === '/'
      ? '/'
      : `${normalizedRequirements.route_base_path}/`;
    if (normalizedRequirements.route_base_path !== '/' && !normalized.startsWith(requiredPrefix)) {
      return {
        ok: false,
        error: `slug_structure must stay under the configured base path ${normalizedRequirements.route_base_path}`,
      };
    }
  }

  return { ok: true, normalized };
};

export const buildSchemaPagePath = (slugStructure: string, pageSlug: string): string => {
  const normalizedSlug = pageSlug.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  return normalizeSchemaSlugStructure(slugStructure).replace(SLUG_TOKEN, normalizedSlug);
};

export const isFrontendUrlAllowed = (
  frontendUrl: string,
  requirements?: SchemaIntegrationRequirementsRecord | null,
): SlugStructureValidationResult => {
  const normalizedRequirements = normalizeSchemaIntegrationRequirements(requirements);
  if (!normalizedRequirements.canonical_frontend_url || normalizedRequirements.allow_temporary_frontend_urls) {
    return { ok: true, normalized: frontendUrl };
  }

  try {
    const actual = new URL(frontendUrl).origin;
    const expected = new URL(normalizedRequirements.canonical_frontend_url).origin;
    if (actual !== expected) {
      return {
        ok: false,
        error: `frontend_url must match the canonical frontend origin ${expected}`,
      };
    }
  } catch {
    return { ok: false, error: 'frontend_url must be a valid absolute URL' };
  }

  return { ok: true, normalized: frontendUrl };
};

const PLACEMENT_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,99}$/;

/** Validate a server path used by a collection target, never a URL fragment. */
export const validateCollectionHostPath = (value: string): FrontendTargetValidationResult => {
  const normalized = normalizeSchemaSlugStructure(value);

  if (normalized !== '/' && normalized.endsWith('/')) {
    return { ok: false, error: 'collection host_path must not have a trailing slash' };
  }
  if (normalized.includes(SLUG_TOKEN)) {
    return { ok: false, error: 'collection host_path must not include the :slug token' };
  }
  if (/\s|[?#\\]|\.\./.test(normalized) || normalized.startsWith('//')) {
    return { ok: false, error: 'collection host_path must be a normalized server path without fragments or traversal' };
  }

  return { ok: true, normalized };
};

export const validateFrontendTarget = (
  target: {
    kind: SchemaFrontendTargetKind;
    host_path: string;
    placement_key?: string | null;
  },
  requirements?: SchemaIntegrationRequirementsRecord | null,
): FrontendTargetValidationResult => {
  if (target.kind === 'detail-page') {
    return validateSlugStructure(target.host_path, requirements);
  }

  const pathResult = validateCollectionHostPath(target.host_path);
  if (!pathResult.ok) return pathResult;

  if (!target.placement_key || !PLACEMENT_KEY_PATTERN.test(target.placement_key)) {
    return {
      ok: false,
      error: 'collection-slot placement_key must be a semantic identifier such as home.posts',
    };
  }

  return pathResult;
};