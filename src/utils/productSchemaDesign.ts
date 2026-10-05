export interface ProductSchemaDesignField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enumValues: string[];
  children: ProductSchemaDesignField[];
}

const asRecord = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const propertyEntries = (value: unknown): Array<[string, unknown]> => {
  const record = asRecord(value);
  if (record) return Object.entries(record);
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry, index) => {
    const field = asRecord(entry);
    return field && typeof field.name === 'string'
      ? [[field.name, field] as [string, unknown]]
      : [[`field_${index + 1}`, entry] as [string, unknown]];
  });
};

const parseField = (name: string, value: unknown): ProductSchemaDesignField => {
  const definition = asRecord(value);
  const declaredType = typeof definition?.type === 'string' ? definition.type : 'json';
  const items = asRecord(definition?.items);
  const type = declaredType === 'array' && items?.type
    ? `array of ${String(items.type)}`
    : declaredType;
  const properties = items?.properties ?? definition?.properties;
  const description = typeof definition?.description === 'string' ? definition.description : undefined;
  const enumValues = Array.isArray(definition?.enum)
    ? definition.enum.filter((entry): entry is string => typeof entry === 'string')
    : [];

  return {
    name,
    type,
    required: definition?.required === true,
    ...(description ? { description } : {}),
    enumValues,
    children: propertyEntries(properties).map(([childName, childValue]) => parseField(childName, childValue)),
  };
};

/** Return a readable, non-mutating outline of the fields defined by a schema. */
export function getProductSchemaDesign(schema: Record<string, unknown>): ProductSchemaDesignField[] {
  return Object.entries(schema).map(([name, definition]) => parseField(name, definition));
}
