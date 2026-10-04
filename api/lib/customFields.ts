export interface PublicCustomFieldDefinition {
  type?: string;
  is_public?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSafeRootKey = (key: string) =>
  /^[a-z][a-z0-9_]{0,63}$/.test(key) && !['__proto__', 'prototype', 'constructor'].includes(key);

function isValueCompatible(type: unknown, value: unknown): boolean {
  switch (type) {
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'json':
      try { return JSON.stringify(value) !== undefined; } catch { return false; }
    case 'string':
    case 'date':
    case 'url':
    case 'email': return typeof value === 'string';
    default: return false;
  }
}

export function projectPublicCustomFields(
  definitions: unknown,
  customFields: unknown,
): Record<string, unknown> {
  if (!isRecord(definitions) || !isRecord(customFields)) return {};
  const projected: Array<[string, unknown]> = [];
  for (const [key, rawDefinition] of Object.entries(definitions)) {
    if (!isSafeRootKey(key) || !isRecord(rawDefinition) || rawDefinition.is_public !== true) continue;
    if (!Object.prototype.hasOwnProperty.call(customFields, key)
      || !isValueCompatible(rawDefinition.type, customFields[key])) continue;
    projected.push([key, customFields[key]]);
  }
  return Object.fromEntries(projected);
}
