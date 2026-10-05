import type { createSupabaseClient } from './supabase';

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
  /** Explicit acknowledgment required to reclassify a schema that already has pages. */
  allow_reclassification?: boolean;
  /** Caller-confirmed page count; must match the schema's actual page count for a reclassification. */
  expected_page_count?: number;
}

export type SchemaDefinitionPatchResult =
  | { ok: true; patch: SchemaDefinitionPatch }
  | { ok: false; error: string };

export interface SchemaDefinitionUpdateResult {
  status: number;
  body: Record<string, unknown>;
}

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
  if (Object.prototype.hasOwnProperty.call(input, 'allow_reclassification')) {
    if (input.allow_reclassification !== true) return { ok: false, error: 'allow_reclassification must be true when provided.' };
    patch.allow_reclassification = true;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'expected_page_count')) {
    const expectedPageCount = input.expected_page_count;
    if (typeof expectedPageCount !== 'number' || !Number.isSafeInteger(expectedPageCount) || expectedPageCount < 0) {
      return { ok: false, error: 'expected_page_count must be a non-negative safe integer.' };
    }
    patch.expected_page_count = expectedPageCount;
  }

  if (Object.keys(patch).length === 1) {
    return { ok: false, error: 'Provide at least one schema definition or metadata field to update.' };
  }
  return { ok: true, patch };
}

/**
 * Reclassification is only safe when every existing page keeps an aggregate that
 * matches the new purpose: event pages need a linked event, product pages need a
 * linked product. Returns an error message when the pages are incompatible.
 */
async function assertPagesCompatibleWithEntityKind(
  client: Awaited<ReturnType<typeof createSupabaseClient>>,
  schemaId: string,
  targetKind: SchemaEntityKind,
): Promise<string | null> {
  if (targetKind === 'page') return null;

  const { data: pages, error: pagesError } = await client
    .from('pages')
    .select('id')
    .eq('schema_id', schemaId);
  if (pagesError) return pagesError.message;
  const pageIds = (pages ?? []).map((page) => page.id as string);
  if (!pageIds.length) return null;

  // Catalogue targets accept every page that keeps a manageable aggregate:
  // an event link or a product link.
  const [{ data: eventLinks, error: eventError }, { data: productLinks, error: productError }] = await Promise.all([
    client.from('mentorbooking_events').select('page_id').in('page_id', pageIds),
    client.from('mentorbooking_products').select('product_page_id').in('product_page_id', pageIds).is('retired_at', null),
  ]);
  if (eventError) return eventError.message;
  if (productError) return productError.message;
  const linkedPageIds = new Set<string>([
    ...(eventLinks ?? []).map((row) => String((row as Record<string, unknown>).page_id)),
    ...(productLinks ?? []).map((row) => String((row as Record<string, unknown>).product_page_id)),
  ]);
  const unlinked = pageIds.filter((id) => !linkedPageIds.has(id));
  if (unlinked.length) {
    return `${unlinked.length} of ${pageIds.length} pages have no linked event or product record. Reclassifying would leave them without a manageable aggregate; convert or delete these pages first.`;
  }
  return null;
}

/** Apply a revision-checked schema update without making an HTTP self-request. */
export async function updateSchemaDefinition(
  client: Awaited<ReturnType<typeof createSupabaseClient>>,
  apiSlug: string,
  patch: SchemaDefinitionPatch,
): Promise<SchemaDefinitionUpdateResult> {
  const { data: current, error: readError } = await client
    .from('page_schemas')
    .select('id, api_slug, tenant_id, content_scope, entity_kind, definition_revision')
    .eq('api_slug', apiSlug)
    .maybeSingle();
  if (readError) return { status: 500, body: { error: readError.message } };
  if (!current) return { status: 404, body: { error: 'Schema not found.' } };

  if (patch.expected_revision !== current.definition_revision) {
    return {
      status: 409,
      body: {
        error: 'Schema definition changed since it was loaded. Reload it before saving.',
        code: 'definition_revision_conflict',
        expected_revision: patch.expected_revision,
        current_revision: current.definition_revision,
      },
    };
  }

  const entityKindChanges = patch.entity_kind !== undefined && patch.entity_kind !== current.entity_kind;
  const tenantChanges = patch.tenant_id !== undefined && patch.tenant_id !== current.tenant_id;
  const nextEntityKind = patch.entity_kind ?? current.entity_kind;
  const nextTenantId = patch.tenant_id !== undefined ? patch.tenant_id : current.tenant_id;
  const requestedScope = patch.integration_requirements?.content_scope;
  if (requestedScope !== undefined && requestedScope !== 'page-collection' && requestedScope !== 'single-page') {
    return { status: 400, body: { error: 'integration_requirements.content_scope must be page-collection or single-page.' } };
  }
  const nextContentScope = requestedScope ?? current.content_scope;
  if (nextEntityKind !== 'page' && nextTenantId == null) {
    return { status: 400, body: { error: 'Product and event schemas must belong to a workspace.' } };
  }
  if (nextEntityKind !== 'page' && nextContentScope !== 'page-collection') {
    return { status: 400, body: { error: 'Product and event schemas must use page-collection content scope.' } };
  }

  if (patch.slug) {
    let slugQuery = client.from('page_schemas').select('id').eq('slug', patch.slug).neq('id', current.id).limit(1);
    slugQuery = nextTenantId ? slugQuery.eq('tenant_id', nextTenantId) : slugQuery.is('tenant_id', null);
    const { data: slugMatches, error: slugError } = await slugQuery;
    if (slugError) return { status: 500, body: { error: slugError.message } };
    if (slugMatches?.length) return { status: 409, body: { error: 'That schema slug is already used in this workspace.', code: 'schema_slug_conflict' } };
  }

  if (tenantChanges && current.entity_kind !== 'page') {
    return { status: 409, body: { error: 'Product/event schemas cannot be moved between workspaces until an explicit aggregate migration is available.', code: 'schema_tenant_migration_required' } };
  }
  if (entityKindChanges || tenantChanges) {
    const { count, error: countError } = await client
      .from('pages')
      .select('id', { count: 'exact', head: true })
      .eq('schema_id', current.id);
    if (countError) return { status: 500, body: { error: countError.message } };
    if ((count ?? 0) > 0) {
      if (entityKindChanges) {
        if (patch.allow_reclassification !== true || patch.expected_page_count !== count) {
          return {
            status: 409,
            body: {
              error: 'Reclassifying a schema with existing pages requires the explicit allow_reclassification flag and the matching expected_page_count.',
              code: 'schema_conversion_required',
              affected_pages: count,
            },
          };
        }
        const compatibilityError = await assertPagesCompatibleWithEntityKind(client, current.id, patch.entity_kind as SchemaEntityKind);
        if (compatibilityError) {
          return {
            status: 409,
            body: {
              error: compatibilityError,
              code: 'schema_conversion_required',
              affected_pages: count,
            },
          };
        }
      } else {
        return {
          status: 409,
          body: {
            error: 'Schemas with existing pages cannot be moved to another workspace until an explicit migration workflow is available.',
            code: 'schema_tenant_migration_required',
            affected_pages: count,
          },
        };
      }
    }
  }

  const { expected_revision: _expectedRevision, ...update } = patch;
  const updateData: Record<string, unknown> = { ...update };
  if (requestedScope !== undefined) updateData.content_scope = requestedScope;
  if (patch.integration_requirements && Object.prototype.hasOwnProperty.call(patch.integration_requirements, 'page_target')) {
    updateData.page_target = patch.integration_requirements.page_target ?? null;
  }
  const { data: schema, error: updateError } = await client
    .from('page_schemas')
    .update(updateData)
    .eq('id', current.id)
    .eq('definition_revision', patch.expected_revision)
    .select('id, slug, api_slug, tenant_id, name, schema, entity_kind, definition_revision, editor_config, content_scope, page_target, updated_at')
    .maybeSingle();
  if (updateError) {
    if (updateError.code === '23505') return { status: 409, body: { error: 'That schema slug is already in use.', code: 'schema_slug_conflict' } };
    return { status: 500, body: { error: updateError.message } };
  }
  if (!schema) return { status: 409, body: { error: 'Schema definition changed during save. Reload it and retry.', code: 'definition_revision_conflict' } };

  return { status: 200, body: { success: true, schema, changed_fields: Object.keys(updateData) } };
}
