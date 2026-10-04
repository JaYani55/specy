import { supabase } from '@/lib/supabase';

export type TenantCustomFieldEntity = 'product' | 'event';
export type TenantCustomFieldType = 'string' | 'number' | 'boolean' | 'date' | 'url' | 'email' | 'json';

export interface TenantCustomFieldDefinition {
  label: string;
  type: TenantCustomFieldType;
  description?: string;
  required?: boolean;
  is_public?: boolean;
}

export type TenantCustomFieldDefinitions = Record<string, TenantCustomFieldDefinition>;

const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const FIELD_TYPES = new Set<TenantCustomFieldType>(['string', 'number', 'boolean', 'date', 'url', 'email', 'json']);

export function validateTenantCustomFieldDefinitions(definitions: TenantCustomFieldDefinitions): string | null {
  const labels = new Set<string>();
  for (const [key, definition] of Object.entries(definitions)) {
    if (!FIELD_KEY_PATTERN.test(key)) return `Field key "${key}" must start with a lowercase letter and contain only lowercase letters, numbers, and underscores.`;
    if (!definition.label.trim() || definition.label.length > 120) return `Field "${key}" needs a label of at most 120 characters.`;
    if (!FIELD_TYPES.has(definition.type)) return `Field "${key}" has an unsupported type.`;
    const normalizedLabel = definition.label.trim().toLocaleLowerCase();
    if (labels.has(normalizedLabel)) return `Field label "${definition.label}" is duplicated.`;
    labels.add(normalizedLabel);
  }
  return null;
}

export async function getTenantCustomFieldDefinitions(
  tenantId: string,
  entityType: TenantCustomFieldEntity,
): Promise<TenantCustomFieldDefinitions> {
  if (!tenantId) return {};
  const { data, error } = await supabase
    .from('tenant_custom_field_definitions')
    .select('definitions')
    .eq('tenant_id', tenantId)
    .eq('entity_type', entityType)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.definitions && typeof data.definitions === 'object' && !Array.isArray(data.definitions)
    ? data.definitions as TenantCustomFieldDefinitions
    : {};
}

export async function saveTenantCustomFieldDefinitions(input: {
  tenantId: string;
  entityType: TenantCustomFieldEntity;
  definitions: TenantCustomFieldDefinitions;
}): Promise<void> {
  if (!input.tenantId) throw new Error('Select a workspace before saving custom fields.');
  const validationError = validateTenantCustomFieldDefinitions(input.definitions);
  if (validationError) throw new Error(validationError);
  const { error } = await supabase
    .from('tenant_custom_field_definitions')
    .upsert({
      tenant_id: input.tenantId,
      entity_type: input.entityType,
      definitions: input.definitions,
    }, { onConflict: 'tenant_id,entity_type' });
  if (error) throw new Error(error.message);
}
