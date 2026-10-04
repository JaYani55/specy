import { supabase } from '@/lib/supabase';
import {
  validateTenantCustomFieldDefinitions,
  type TenantCustomFieldDefinitions,
} from '@/services/tenantCustomFieldsService';

export interface ProductCustomFieldSchema {
  product: TenantCustomFieldDefinitions;
  event: TenantCustomFieldDefinitions;
}

export interface ProductCustomFieldSchemaResult {
  schema: ProductCustomFieldSchema;
  version: number;
}

export const emptyProductCustomFieldSchema = (): ProductCustomFieldSchema => ({ product: {}, event: {} });

export function normalizeProductCustomFieldSchema(value: unknown): ProductCustomFieldSchema {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyProductCustomFieldSchema();
  const record = value as Record<string, unknown>;
  const namespace = (input: unknown): TenantCustomFieldDefinitions =>
    input && typeof input === 'object' && !Array.isArray(input)
      ? input as TenantCustomFieldDefinitions
      : {};
  return { product: namespace(record.product), event: namespace(record.event) };
}

export function validateProductCustomFieldSchema(schema: ProductCustomFieldSchema): string | null {
  return validateTenantCustomFieldDefinitions(schema.product) ?? validateTenantCustomFieldDefinitions(schema.event);
}

export async function getProductCustomFieldSchema(
  productId: string,
  tenantId: string,
): Promise<ProductCustomFieldSchemaResult> {
  if (!productId || !tenantId) throw new Error('Produkt und Workspace müssen ausgewählt sein.');
  const { data, error } = await supabase
    .from('mentorbooking_products')
    .select('custom_field_schema, version')
    .eq('integration_id', productId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Produkt wurde in diesem Workspace nicht gefunden.');
  return {
    schema: normalizeProductCustomFieldSchema(data.custom_field_schema),
    version: data.version,
  };
}

export async function saveProductCustomFieldSchema(input: {
  productId: string;
  tenantId: string;
  expectedVersion: number;
  schema: ProductCustomFieldSchema;
}): Promise<ProductCustomFieldSchemaResult> {
  if (!input.productId || !input.tenantId) throw new Error('Produkt und Workspace müssen ausgewählt sein.');
  const validationError = validateProductCustomFieldSchema(input.schema);
  if (validationError) throw new Error(validationError);

  const { data, error } = await supabase
    .from('mentorbooking_products')
    .update({ custom_field_schema: input.schema })
    .eq('integration_id', input.productId)
    .eq('tenant_id', input.tenantId)
    .eq('version', input.expectedVersion)
    .select('custom_field_schema, version')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Das Produkt wurde inzwischen geändert. Lade es neu und versuche es erneut.');
  return { schema: normalizeProductCustomFieldSchema(data.custom_field_schema), version: data.version };
}
