export type SchemaEntityKind = 'page' | 'service-product' | 'event';

export interface SchemaDefinitionPatch {
  expected_revision: number;
  schema?: Record<string, unknown>;
  editor_config?: Record<string, unknown>;
  entity_kind?: SchemaEntityKind;
  name?: string;
  description?: string | null;
  llm_instructions?: string | null;
  integration_requirements?: Record<string, unknown>;
  tenant_id?: string | null;
  slug?: string;
}

export type SchemaDefinitionPatchResult =
  | { ok: true; patch: SchemaDefinitionPatch }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate the versioned, metadata-only schema definition patch contract. */
export function parseSchemaDefinitionPatch(input: unknown): SchemaDefinitionPatchResult {
  if (!isRecord(input)) return { ok: false, error: 'Request body must be a JSON object.' };
  if (!Number.isSafeInteger(input.expected_revision) || Number(input.expected_revision) < 1) {
    return { ok: false, error: 'expected_revision must be a positive safe integer.' };
  }

  const patch: SchemaDefinitionPatch = { expected_revision: Number(input.expected_revision) };
  if (Object.prototype.hasOwnProperty.call(input, 'schema')) {
    if (!isRecord(input.schema)) return { ok: false, error: 'schema must be a JSON object.' };
    patch.schema = input.schema;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'editor_config')) {
    if (!isRecord(input.editor_config)) return { ok: false, error: 'editor_config must be a JSON object.' };
    patch.editor_config = input.editor_config;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'entity_kind')) {
    if (!['page', 'service-product', 'event'].includes(String(input.entity_kind))) {
      return { ok: false, error: 'entity_kind must be page, service-product, or event.' };
    }
    patch.entity_kind = input.entity_kind as SchemaEntityKind;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'name')) {
    if (typeof input.name !== 'string' || !input.name.trim()) return { ok: false, error: 'name must be a non-empty string.' };
    patch.name = input.name.trim();
  }
  if (Object.prototype.hasOwnProperty.call(input, 'description')) {
    if (input.description !== null && typeof input.description !== 'string') return { ok: false, error: 'description must be a string or null.' };
    patch.description = input.description as string | null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'llm_instructions')) {
    if (input.llm_instructions !== null && typeof input.llm_instructions !== 'string') return { ok: false, error: 'llm_instructions must be a string or null.' };
    patch.llm_instructions = input.llm_instructions as string | null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'integration_requirements')) {
    if (!isRecord(input.integration_requirements)) return { ok: false, error: 'integration_requirements must be a JSON object.' };
    patch.integration_requirements = input.integration_requirements;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'tenant_id')) {
    if (input.tenant_id !== null && (typeof input.tenant_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.tenant_id))) {
      return { ok: false, error: 'tenant_id must be a UUID or null.' };
    }
    patch.tenant_id = input.tenant_id as string | null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'slug')) {
    if (typeof input.slug !== 'string' || !input.slug.trim()) return { ok: false, error: 'slug must be a non-empty string.' };
    patch.slug = input.slug.trim();
  }

  if (Object.keys(patch).length === 1) {
    return { ok: false, error: 'Provide at least one schema definition or metadata field to update.' };
  }
  return { ok: true, patch };
}
