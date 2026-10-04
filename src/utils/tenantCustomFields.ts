import type { TenantCustomFieldDefinition, TenantCustomFieldDefinitions } from '@/services/tenantCustomFieldsService';

export function validateTenantCustomFieldValues(
  definitions: TenantCustomFieldDefinitions,
  values: Record<string, unknown>,
): string | null {
  for (const [key, definition] of Object.entries(definitions)) {
    const value = values[key];
    if (definition.required && (value === undefined || value === null || (typeof value === 'string' && !value.trim()))) {
      return `${definition.label} is required.`;
    }
    if (value === undefined || value === null || value === '') continue;
    if (!isCustomFieldValueValid(definition, value)) return `${definition.label} has an invalid value.`;
  }
  return null;
}

export function isCustomFieldValueValid(definition: TenantCustomFieldDefinition, value: unknown): boolean {
  switch (definition.type) {
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'json':
      try { JSON.stringify(value); return true; } catch { return false; }
    case 'price':
      return isPublicMoneyValue(value);
    case 'string':
    case 'date':
    case 'url':
    case 'email':
      return typeof value === 'string';
    default: return false;
  }
}

export function isPublicMoneyValue(value: unknown): value is { amount: string; currency: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const money = value as Record<string, unknown>;
  return typeof money.amount === 'string'
    && /^(0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(money.amount)
    && typeof money.currency === 'string'
    && /^[A-Z]{3}$/.test(money.currency);
}

export function publicTenantCustomFields(
  definitions: TenantCustomFieldDefinitions,
  values: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!values) return {};
  return Object.fromEntries(Object.entries(definitions)
    .filter(([key, definition]) => definition.is_public === true
      && key !== '__proto__' && key !== 'prototype' && key !== 'constructor'
      && Object.prototype.hasOwnProperty.call(values, key)
      && isCustomFieldValueValid(definition, values[key]))
    .map(([key]) => [key, values[key]]));
}
