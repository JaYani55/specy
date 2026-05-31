import type { FormAnswerValue, FormFieldDefinition, FormFieldType, FormSchemaDefinition, ParsedFormSchemaResult } from '@/types/forms';

export const RESERVED_FORM_SHARE_SLUGS = new Set([
  'admin',
  'calendar',
  'create-event',
  'events',
  'forms',
  'info',
  'list',
  'login',
  'me',
  'pagebuilder',
  'pages',
  'plugins',
  'profile',
  'settings',
  'test-loader',
]);

const VALID_FORM_FIELD_TYPES = new Set<FormFieldType>([
  'text',
  'textarea',
  'email',
  'number',
  'file-upload',
  'checkbox',
  'single-select',
  'multi-select',
  'select',
  'radio',
  'date',
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const generateFormSlug = (value: string): string => (
  value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
);

export const validateShareSlug = (value: string): string | null => {
  const normalized = generateFormSlug(value);
  if (!normalized) return 'Share slug is required.';
  if (RESERVED_FORM_SHARE_SLUGS.has(normalized)) return 'Share slug conflicts with an existing route.';
  return null;
};

const parseFieldEntry = (
  fieldName: string,
  value: unknown,
  path: string,
): { field: FormFieldDefinition | null; errors: string[]; warnings: string[] } => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!fieldName.trim()) {
    errors.push(`${path} field name must not be empty.`);
    return { field: null, errors, warnings };
  }

  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object.`);
    return { field: null, errors, warnings };
  }

  const rawType = value.type;
  if (typeof rawType !== 'string' || !VALID_FORM_FIELD_TYPES.has(rawType as FormFieldType)) {
    errors.push(`${path}.type must be one of: ${Array.from(VALID_FORM_FIELD_TYPES).join(', ')}.`);
    return { field: null, errors, warnings };
  }

  const label = value.label;
  if (typeof label !== 'string' || !label.trim()) {
    errors.push(`${path}.label is required.`);
    return { field: null, errors, warnings };
  }

  const field: FormFieldDefinition = {
    name: fieldName,
    type: rawType as FormFieldType,
    label,
    description: typeof value.description === 'string' ? value.description : undefined,
    placeholder: typeof value.placeholder === 'string' ? value.placeholder : undefined,
    meta_description: typeof value.meta_description === 'string' ? value.meta_description : undefined,
    required: typeof value.required === 'boolean' ? value.required : false,
    upload_mount: typeof value.upload_mount === 'string' ? value.upload_mount : undefined,
    upload_bucket: typeof value.upload_bucket === 'string' ? value.upload_bucket : undefined,
    upload_folder: typeof value.upload_folder === 'string' ? value.upload_folder : undefined,
  };

  if (value.order !== undefined) {
    if (typeof value.order === 'number' && Number.isFinite(value.order)) {
      field.order = Math.max(0, Math.trunc(value.order));
    } else {
      warnings.push(`${path}.order must be a finite number when provided.`);
    }
  }

  if (value.options !== undefined) {
    if (!Array.isArray(value.options) || value.options.some((entry) => typeof entry !== 'string' || !entry.trim())) {
      errors.push(`${path}.options must be an array of non-empty strings.`);
    } else {
      field.options = value.options;
    }
  }

  if ((field.type === 'select' || field.type === 'radio' || field.type === 'single-select' || field.type === 'multi-select') && (!field.options || field.options.length === 0)) {
    errors.push(`${path}.options is required for ${field.type} fields.`);
  }

  if (field.type === 'file-upload') {
    if (field.options) {
      errors.push(`${path}.options is not supported for file-upload fields.`);
    }
    if (!field.upload_folder) {
      field.upload_folder = 'forms/{form_slug}/{field_name}/{submission_id}';
    }
  }

  return { field, errors, warnings };
};

export const parseFormSchema = (raw: string): ParsedFormSchemaResult => {
  if (!raw.trim()) {
    return {
      valid: false,
      errors: ['Schema JSON is required.'],
      warnings: [],
      fields: [],
      normalizedSchema: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : 'Invalid JSON.'],
      warnings: [],
      fields: [],
      normalizedSchema: null,
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      valid: false,
      errors: ['Schema root must be a JSON object.'],
      warnings: [],
      fields: [],
      normalizedSchema: null,
    };
  }

  const fields: FormFieldDefinition[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const normalizedSchema: FormSchemaDefinition = {};

  for (const [name, value] of Object.entries(parsed)) {
    const result = parseFieldEntry(name, value, name);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    if (result.field) {
      fields.push(result.field);
    }
  }

  const sortedFields = [...fields]
    .map((field, index) => ({ field, index }))
    .sort((left, right) => {
      const leftOrder = left.field.order;
      const rightOrder = right.field.order;
      const leftHasOrder = typeof leftOrder === 'number';
      const rightHasOrder = typeof rightOrder === 'number';

      if (leftHasOrder && rightHasOrder && leftOrder !== rightOrder) {
        return (leftOrder as number) - (rightOrder as number);
      }

      if (leftHasOrder && !rightHasOrder) {
        return -1;
      }

      if (!leftHasOrder && rightHasOrder) {
        return 1;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.field);

  for (const [index, field] of sortedFields.entries()) {
    const normalizedOrder = typeof field.order === 'number' ? Math.max(0, Math.trunc(field.order)) : index;
    const { name: fieldName, ...fieldValue } = {
      ...field,
      order: normalizedOrder,
    };
    normalizedSchema[fieldName] = fieldValue;
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    fields: sortedFields,
    normalizedSchema: errors.length === 0 ? normalizedSchema : null,
  };
};

export const formatFormSchema = (schema: FormSchemaDefinition): string => JSON.stringify(schema, null, 2);

export const formFieldsToSchema = (fields: FormFieldDefinition[]): FormSchemaDefinition => {
  return fields.reduce<FormSchemaDefinition>((accumulator, field, index) => {
    const normalizedName = field.name.trim();
    if (!normalizedName) return accumulator;

    accumulator[normalizedName] = {
      order: index,
      type: field.type,
      label: field.label,
      description: field.description || undefined,
      placeholder: field.placeholder || undefined,
      meta_description: field.meta_description || undefined,
      required: Boolean(field.required),
      options: field.options && field.options.length > 0 ? field.options : undefined,
      upload_mount: field.upload_mount || undefined,
      upload_bucket: field.upload_bucket || undefined,
      upload_folder: field.upload_folder || undefined,
    };

    return accumulator;
  }, {});
};

export const buildInitialAnswers = (fields: FormFieldDefinition[]): Record<string, FormAnswerValue> => {
  return fields.reduce<Record<string, FormAnswerValue>>((accumulator, field) => {
    if (field.type === 'checkbox') {
      accumulator[field.name] = false;
    } else if (field.type === 'multi-select') {
      accumulator[field.name] = [];
    } else if (field.type === 'file-upload') {
      accumulator[field.name] = null;
    } else {
      accumulator[field.name] = '';
    }
    return accumulator;
  }, {});
};