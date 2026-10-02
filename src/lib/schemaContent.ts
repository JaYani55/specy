import type { SchemaFieldDefinition } from '@/types/pagebuilder';

export type SchemaEntityKind = 'page' | 'service-product' | 'event';

/** JSON object guard used at the editor boundary. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Optional field activation is presence-based: false, 0, null and empty values are data. */
export function hasOwnKey(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Keep the stored JSON intact while providing defaults for fields the current
 * schema knows about. Known defaults never overwrite a persisted value.
 */
export function initializeSchemaContent(
  defaults: Record<string, unknown>,
  stored: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return { ...defaults, ...(stored ?? {}) };
}

/** Merge an imported JSON object without dropping unknown developer-owned keys. */
export function mergeSchemaContent(
  current: Record<string, unknown>,
  imported: Record<string, unknown>,
): Record<string, unknown> {
  return { ...current, ...imported };
}

/** Build a save payload while preserving unknown keys and only omitting an optional
 * field after the editor explicitly removes it. */
export function buildSchemaContent(
  initial: Record<string, unknown> | null | undefined,
  current: Record<string, unknown>,
  fields: SchemaFieldDefinition[],
  activeOptional: ReadonlySet<string>,
  removedOptional: ReadonlySet<string>,
): Record<string, unknown> {
  const known = new Set(fields.map((field) => field.name));
  const content: Record<string, unknown> = { ...(initial ?? {}) };

  // Imports and extensions may add arbitrary keys that are not declared in the
  // current schema. They remain part of the content contract.
  for (const [key, value] of Object.entries(current)) {
    if (!known.has(key)) content[key] = value;
  }

  for (const field of fields) {
    if (field.required || activeOptional.has(field.name)) {
      if (hasOwnKey(current, field.name)) content[field.name] = current[field.name];
      else delete content[field.name];
    }
  }

  for (const fieldName of removedOptional) delete content[fieldName];
  return content;
}

/** A non-destructive diagnostic for a value which the visual widget cannot edit. */
export function fieldValueTypeConflict(field: SchemaFieldDefinition, value: unknown): boolean {
  if (value === undefined) return false;
  if (value === null) return field.nullable !== true;
  switch (field.type) {
    case 'string':
      return typeof value !== 'string';
    case 'media':
      // The current media picker edits URL strings. Preserve richer media
      // reference objects behind an explicit conflict diagnostic instead.
      return typeof value !== 'string';
    case 'number':
      return typeof value !== 'number' || !Number.isFinite(value);
    case 'boolean':
      return typeof value !== 'boolean';
    case 'array':
    case 'ContentBlock[]':
    case 'CodeBlock[]':
      return !Array.isArray(value);
    case 'object':
      return !isJsonObject(value);
    default:
      return false;
  }
}
