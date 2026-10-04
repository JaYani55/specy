export interface SchemaContentValidationResult {
  ok: boolean;
  errors: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const unsafeKey = (key: string) => key === '__proto__' || key === 'prototype' || key === 'constructor';

export function validateSchemaContent(schema: unknown, content: unknown): SchemaContentValidationResult {
  const errors: string[] = [];
  const addError = (message: string) => { if (errors.length < 100) errors.push(message); };
  if (!isRecord(schema)) return { ok: false, errors: ['Schema definition must be a JSON object.'] };
  if (!isRecord(content)) return { ok: false, errors: ['Content must be a JSON object.'] };

  let payload: string;
  try { payload = JSON.stringify(content); } catch { return { ok: false, errors: ['Content is not serializable JSON.'] }; }
  if (new TextEncoder().encode(payload).byteLength > 1048576) return { ok: false, errors: ['Content exceeds the 1 MiB limit.'] };

  const scanJson = (value: unknown, path: string, depth: number): void => {
    if (depth > 32) { addError(`${path} exceeds the maximum content depth.`); return; }
    if (Array.isArray(value)) {
      if (value.length > 1000) addError(`${path} exceeds the 1000 item limit.`);
      value.slice(0, 1000).forEach((item, index) => scanJson(item, `${path}[${index}]`, depth + 1));
    } else if (isRecord(value)) {
      for (const [key, entry] of Object.entries(value)) {
        if (unsafeKey(key)) addError(`${path} contains an unsafe object key.`);
        scanJson(entry, `${path}.${key}`, depth + 1);
      }
    }
  };
  scanJson(content, '$', 0);

  const visit = (definition: unknown, value: unknown, path: string, depth: number): void => {
    if (depth > 32) { addError(`${path} exceeds the maximum content depth.`); return; }
    if (!isRecord(definition)) { addError(`${path} has an invalid field definition.`); return; }
    if (value === null) {
      if (definition.nullable !== true) addError(`${path} does not allow null.`);
      return;
    }

    const type = definition.type;
    switch (type) {
      case 'string':
        if (typeof value !== 'string') { addError(`${path} must be a string.`); return; }
        if (Array.isArray(definition.enum) && !definition.enum.includes(value)) addError(`${path} is not an allowed enum value.`);
        if (typeof definition.minLength === 'number' && value.length < definition.minLength) addError(`${path} is shorter than minLength.`);
        if (typeof definition.maxLength === 'number' && value.length > definition.maxLength) addError(`${path} exceeds maxLength.`);
        return;
      case 'media':
        if (typeof value !== 'string' && !isRecord(value)) addError(`${path} must be a media reference string or object.`);
        return;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) { addError(`${path} must be a finite number.`); return; }
        if (typeof definition.minimum === 'number' && value < definition.minimum) addError(`${path} is below minimum.`);
        if (typeof definition.maximum === 'number' && value > definition.maximum) addError(`${path} exceeds maximum.`);
        return;
      case 'boolean':
        if (typeof value !== 'boolean') addError(`${path} must be a boolean.`);
        return;
      case 'object': {
        if (!isRecord(value)) { addError(`${path} must be an object.`); return; }
        if (Object.keys(value).some(unsafeKey)) addError(`${path} contains an unsafe object key.`);
        const properties = isRecord(definition.properties) ? definition.properties : {};
        for (const [key, property] of Object.entries(properties)) {
          if (unsafeKey(key)) { addError(`${path} schema includes an unsafe key.`); continue; }
          if (!Object.prototype.hasOwnProperty.call(value, key)) {
            if (isRecord(property) && property.required === true) addError(`${path}.${key} is required.`);
            continue;
          }
          visit(property, value[key], `${path}.${key}`, depth + 1);
        }
        return;
      }
      case 'array':
      case 'string[]':
      case 'ContentBlock[]':
      case 'CodeBlock[]': {
        if (!Array.isArray(value)) { addError(`${path} must be an array.`); return; }
        if (value.length > 1000) { addError(`${path} exceeds the 1000 item limit.`); return; }
        if (typeof definition.minItems === 'number' && value.length < definition.minItems) addError(`${path} has fewer items than minItems.`);
        if (typeof definition.maxItems === 'number' && value.length > definition.maxItems) addError(`${path} exceeds maxItems.`);
        if (type === 'ContentBlock[]') {
          value.forEach((block, index) => {
            if (!isRecord(block) || typeof block.type !== 'string' || !block.type) addError(`${path}[${index}] must be an object with a block type.`);
            else if (Object.keys(block).some(unsafeKey)) addError(`${path}[${index}] contains an unsafe object key.`);
          });
        } else if (type === 'string[]') {
          value.forEach((item, index) => {
            if (typeof item !== 'string') addError(`${path}[${index}] must be a string.`);
          });
        } else if (definition.items !== undefined) {
          value.forEach((item, index) => visit(definition.items, item, `${path}[${index}]`, depth + 1));
        }
        return;
      }
      default:
        addError(`${path} uses unsupported schema type "${String(type)}".`);
    }
  };

  if (Object.keys(content).some(unsafeKey)) addError('Content contains an unsafe object key.');
  for (const [key, definition] of Object.entries(schema)) {
    if (unsafeKey(key)) { addError(`Schema includes unsafe field key "${key}".`); continue; }
    if (!Object.prototype.hasOwnProperty.call(content, key)) {
      if (isRecord(definition) && definition.required === true) addError(`${key} is required.`);
      continue;
    }
    visit(definition, content[key], key, 0);
  }
  return { ok: errors.length === 0, errors };
}
