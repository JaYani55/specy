import { createSupabaseClient } from './supabase';
import { validateSchemaContent } from './schemaContentValidation';
import { validateCustomFieldValues } from './customFields';
import type { CreateServiceProductInput, UpdateServiceProductInput } from './productAggregates';

type UserClient = Awaited<ReturnType<typeof createSupabaseClient>>;

export class ProductAggregateError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: string;

  constructor(message: string, status: number, code?: string, details?: string) {
    super(message);
    this.name = 'ProductAggregateError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function throwDatabaseError(error: { message: string; code?: string; details?: string }): never {
  const status = error.code === 'P0002' ? 404
    : error.code === '23514' || error.code === '23505' || error.code === '40001' ? 409
      : error.code === '22023' || error.code === '22P02' ? 400
        : error.code === '42501' ? 403 : 500;
  throw new ProductAggregateError(error.message, status, error.code, error.details);
}

export async function listProductAggregates(client: UserClient, tenantId: string) {
  const { data: products, error } = await client
    .from('service_products')
    .select('id, tenant_id, name, page_id, retired_at, team_enabled, version, created_at, updated_at, custom_fields, custom_field_schema')
    .eq('tenant_id', tenantId)
    .is('retired_at', null)
    .order('updated_at', { ascending: false });
  if (error) throwDatabaseError(error);
  const rows = products ?? [];
  const pageIds = rows.map((product) => product.page_id).filter((id): id is string => typeof id === 'string');
  const { data: pages, error: pagesError } = pageIds.length
    ? await client.from('pages').select('id, schema_id, slug, status, content, updated_at').eq('tenant_id', tenantId).in('id', pageIds)
    : { data: [], error: null };
  if (pagesError) throwDatabaseError(pagesError);
  const pageById = new Map((pages ?? []).map((page) => [page.id, page]));
  return rows.map((product) => ({ ...product, page: pageById.get(product.page_id) ?? null }));
}

export async function getProductAggregate(client: UserClient, id: string, tenantId: string) {
  const { data: product, error } = await client
    .from('service_products')
    .select('id, tenant_id, name, page_id, retired_at, team_enabled, version, created_at, updated_at, custom_fields, custom_field_schema')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle();
  if (error) throwDatabaseError(error);
  if (!product) throw new ProductAggregateError('Product not found.', 404, 'P0002');
  const { data: page, error: pageError } = await client
    .from('pages')
    .select('id, schema_id, slug, status, content, updated_at')
    .eq('tenant_id', tenantId)
    .eq('id', product.page_id)
    .maybeSingle();
  if (pageError) throwDatabaseError(pageError);
  if (!page) throw new ProductAggregateError('Product page not found.', 404, 'P0002');
  return { ...product, page };
}

export async function getProductAggregateByPage(client: UserClient, pageId: string, tenantId: string) {
  const { data, error } = await client
    .from('service_products')
    .select('id, tenant_id, name, page_id, retired_at, team_enabled, version, created_at, updated_at, custom_fields, custom_field_schema')
    .eq('tenant_id', tenantId)
    .eq('page_id', pageId)
    .is('retired_at', null)
    .maybeSingle();
  if (error) throwDatabaseError(error);
  if (!data) throw new ProductAggregateError('Product not found.', 404, 'P0002');
  return data;
}

export async function createProductAggregate(client: UserClient, input: CreateServiceProductInput) {
  const { data: schema, error: schemaError } = await client
    .from('page_schemas')
    .select('id, tenant_id, entity_kind, content_scope, definition_revision')
    .eq('id', input.schema_id)
    .maybeSingle();
  if (schemaError) throwDatabaseError(schemaError);
  if (!schema || schema.tenant_id !== input.tenant_id) throw new ProductAggregateError('Schema not found in the requested workspace.', 404, 'P0002');
  if (schema.entity_kind !== 'service-product' || schema.content_scope !== 'page-collection') {
    throw new ProductAggregateError('Schema is not an eligible service-product collection.', 409, '23514');
  }
  if (schema.definition_revision !== input.expected_definition_revision) {
    throw new ProductAggregateError('Schema definition revision conflict.', 409, '40001');
  }
  const { data, error } = await client.rpc('create_service_product_aggregate', {
    target_tenant_id: input.tenant_id,
    target_schema_id: input.schema_id,
    expected_definition_revision: input.expected_definition_revision,
    target_name: input.name,
    target_slug: input.slug,
    target_content: input.content,
    idempotency_key: input.idempotency_key,
  });
  if (error) throwDatabaseError(error);
  if (!data) throw new ProductAggregateError('Product aggregate creation returned no result.', 500);
  return data;
}

async function loadProductSchema(client: UserClient, tenantId: string, pageSchemaId: string) {
  const { data: schema, error } = await client
    .from('page_schemas')
    .select('schema, entity_kind, tenant_id, definition_revision')
    .eq('id', pageSchemaId)
    .maybeSingle();
  if (error) throwDatabaseError(error);
  if (!schema || schema.tenant_id !== tenantId || schema.entity_kind !== 'service-product') {
    throw new ProductAggregateError('Product schema not found in the requested workspace.', 404, 'P0002');
  }
  return schema;
}

export async function updateProductAggregate(client: UserClient, id: string, input: UpdateServiceProductInput) {
  const { data: product, error: productError } = await client
    .from('service_products')
    .select('name, page_id, version, custom_fields, custom_field_schema')
    .eq('tenant_id', input.tenant_id)
    .eq('id', id)
    .maybeSingle();
  if (productError) throwDatabaseError(productError);
  if (!product) throw new ProductAggregateError('Product not found.', 404, 'P0002');
  const { data: page, error: pageError } = await client
    .from('pages')
    .select('content, slug, schema_id')
    .eq('tenant_id', input.tenant_id)
    .eq('id', product.page_id)
    .maybeSingle();
  if (pageError) throwDatabaseError(pageError);
  if (!page) throw new ProductAggregateError('Product page not found.', 404, 'P0002');
  const schema = await loadProductSchema(client, input.tenant_id, page.schema_id);
  if (schema.definition_revision !== input.expected_definition_revision) {
    throw new ProductAggregateError('Schema definition revision conflict.', 409, '40001');
  }
  const content = input.content ?? page.content;
  const customFields = input.custom_fields ?? product.custom_fields ?? {};
  const customFieldErrors = validateCustomFieldValues(
    (product.custom_field_schema as { product?: unknown } | null)?.product ?? {},
    customFields,
  );
  if (customFieldErrors.length) {
    throw new ProductAggregateError('Product values do not satisfy their field definitions.', 400, '22023', customFieldErrors.join('\\n'));
  }
  if (input.content !== undefined) {
    const validation = validateSchemaContent(schema.schema, content);
    if (!validation.ok) throw new ProductAggregateError('Product content does not satisfy its schema.', 400, '22023', validation.errors.join('\n'));
  }
  const { data, error } = await client.rpc('update_service_product_aggregate_with_custom_fields', {
    target_product_id: id,
    expected_tenant_id: input.tenant_id,
    expected_version: input.expected_version,
    expected_definition_revision: input.expected_definition_revision,
    target_name: input.name ?? product.name,
    target_slug: input.slug ?? page.slug,
    target_page_content: content,
    target_custom_fields: customFields,
  });
  if (error) throwDatabaseError(error);
  return data;
}

export async function publishProductAggregate(
  client: UserClient,
  id: string,
  tenantId: string,
  expectedVersion: number,
  expectedDefinitionRevision: number,
  status: 'draft' | 'published',
) {
  const product = await getProductAggregate(client, id, tenantId);
  const schema = await loadProductSchema(client, tenantId, product.page.schema_id);
  if (schema.definition_revision !== expectedDefinitionRevision) {
    throw new ProductAggregateError('Schema definition revision conflict.', 409, '40001');
  }
  const validation = validateSchemaContent(schema.schema, product.page.content);
  if (!validation.ok) throw new ProductAggregateError('Product cannot be published until content satisfies its schema.', 400, '22023', validation.errors.join('\n'));
  const { data, error } = await client.rpc('publish_service_product_aggregate', {
    target_product_id: id,
    expected_tenant_id: tenantId,
    expected_version: expectedVersion,
    expected_definition_revision: expectedDefinitionRevision,
    target_status: status,
  });
  if (error) throwDatabaseError(error);
  return data;
}

export async function archiveProductAggregate(client: UserClient, id: string, tenantId: string, expectedVersion: number) {
  const { data, error } = await client.rpc('archive_service_product_aggregate', {
    target_product_id: id,
    expected_tenant_id: tenantId,
    expected_version: expectedVersion,
  });
  if (error) throwDatabaseError(error);
  return data;
}
