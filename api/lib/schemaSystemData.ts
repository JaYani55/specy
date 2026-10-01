import {
  isFrontendUrlAllowed,
  type SchemaIntegrationRequirementsRecord,
  validateSlugStructure,
} from './schemaRouting.ts';
import { validateOutboundHttpUrl } from './urlSafety.ts';

export interface SchemaSystemDataPatch {
  frontend_url?: string;
  slug_structure?: string;
  revalidation_endpoint?: string | null;
}

export type SchemaSystemDataValidation =
  | { ok: true; patch: SchemaSystemDataPatch }
  | { ok: false; error: string };

const ALLOWED_KEYS = new Set(['frontend_url', 'slug_structure', 'revalidation_endpoint']);

/** Validate the small, non-secret set of schema integration settings agents may repair. */
export function validateSchemaSystemDataPatch(
  input: unknown,
  requirements?: SchemaIntegrationRequirementsRecord | null,
): SchemaSystemDataValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }

  const values = input as Record<string, unknown>;
  const keys = Object.keys(values);
  if (keys.length === 0) return { ok: false, error: 'Provide at least one system-data field to update.' };

  const unknownKey = keys.find((key) => !ALLOWED_KEYS.has(key));
  if (unknownKey) {
    return { ok: false, error: `System-data field is not editable through this endpoint: ${unknownKey}` };
  }

  const patch: SchemaSystemDataPatch = {};

  if (Object.prototype.hasOwnProperty.call(values, 'frontend_url')) {
    const value = values.frontend_url;
    if (typeof value === 'string' && value.trim()) {
      const validated = validateOutboundHttpUrl(value.trim());
      if (!validated.ok) return { ok: false, error: validated.error };
      const origin = validated.url.origin;
      const frontendPolicy = isFrontendUrlAllowed(origin, requirements);
      if (!frontendPolicy.ok) return { ok: false, error: frontendPolicy.error || 'frontend_url is not allowed.' };
      patch.frontend_url = origin;
    } else {
      return { ok: false, error: 'frontend_url must be a valid absolute URL.' };
    }
  }

  if (Object.prototype.hasOwnProperty.call(values, 'slug_structure')) {
    const value = values.slug_structure;
    if (typeof value !== 'string' || !value.trim()) {
      return { ok: false, error: 'slug_structure must be a non-empty route template.' };
    }
    const validation = validateSlugStructure(value, requirements);
    if (!validation.ok || !validation.normalized) {
      return { ok: false, error: validation.error || 'Invalid slug_structure.' };
    }
    patch.slug_structure = validation.normalized;
  }

  if (Object.prototype.hasOwnProperty.call(values, 'revalidation_endpoint')) {
    const value = values.revalidation_endpoint;
    if (value === null) {
      patch.revalidation_endpoint = null;
    } else if (typeof value === 'string' && value.trim()) {
      const endpoint = value.trim();
      if (!endpoint.startsWith('/') || endpoint.startsWith('//') || /[?#\\]/.test(endpoint)) {
        return { ok: false, error: 'revalidation_endpoint must be a strict relative path.' };
      }
      patch.revalidation_endpoint = endpoint;
    } else {
      return { ok: false, error: 'revalidation_endpoint must be a strict relative path or null.' };
    }
  }

  return { ok: true, patch };
}
