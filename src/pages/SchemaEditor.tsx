import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Loader2, Eye, Save, ChevronDown, ChevronUp, FileJson, AlertTriangle, CheckCircle2, Info, Upload } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  createSchema,
  createSchemaTemplate,
  getSchemaTemplates,
  updateSchema,
  getSchema,
  startSchemaRegistration,
} from '@/services/pageService';
import type { SchemaFieldDefinition, PageSchema, PageSchemaTemplate, SchemaTemplateDefinition } from '@/types/pagebuilder';
import { useTheme } from '@/contexts/ThemeContext';
import { toast } from 'sonner';
import { SCHEMA_TEMPLATES, type SchemaTemplate } from '@/config/schemaTemplates';

const FIELD_TYPES = ['string', 'number', 'boolean', 'array', 'object', 'ContentBlock[]', 'CodeBlock[]', 'media'] as const;
const VALID_SCHEMA_TYPES = new Set<string>(FIELD_TYPES);

const toStoredTemplateDefinition = (template: PageSchemaTemplate): SchemaTemplateDefinition => ({
  id: template.id,
  slug: template.slug,
  name: template.name,
  nameDe: template.name,
  description: template.description || '',
  descriptionDe: template.description || '',
  icon: template.icon || '🧩',
  schema: template.schema,
  llm_instructions: template.llm_instructions || undefined,
  source: 'stored',
  external_source_url: template.external_source_url,
});

const mergeTemplates = (
  bundled: SchemaTemplateDefinition[],
  stored: SchemaTemplateDefinition[],
): SchemaTemplateDefinition[] => {
  const merged = new Map<string, SchemaTemplateDefinition>();

  for (const template of bundled) {
    merged.set(template.slug, template);
  }

  for (const template of stored) {
    merged.set(template.slug, template);
  }

  return [...merged.values()];
};

interface EditorSchemaFieldDefinition extends Omit<SchemaFieldDefinition, 'properties' | 'items'> {
  editorId: string;
  properties?: EditorSchemaFieldDefinition[];
  items?: EditorSchemaFieldDefinition;
}

const createEditorFieldId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `schema-field-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

const emptyField = (): EditorSchemaFieldDefinition => ({
  editorId: createEditorFieldId(),
  name: '',
  type: 'string',
  description: '',
  placeholder: '',
  meta_description: '',
  required: false,
});

const defaultCodeBlockItemsField = (): EditorSchemaFieldDefinition => ({
  editorId: createEditorFieldId(),
  name: 'item',
  type: 'object',
  required: false,
  properties: [
    {
      editorId: createEditorFieldId(),
      name: 'label',
      type: 'string',
      description: 'Optional display label for this code variant.',
      placeholder: 'e.g. React Hook',
      meta_description: 'Short label describing this code variant or implementation style.',
      required: false,
    },
    {
      editorId: createEditorFieldId(),
      name: 'language',
      type: 'string',
      description: 'Programming language used for syntax highlighting.',
      placeholder: 'e.g. typescript',
      meta_description: 'Syntax highlighting token used by the frontend renderer. Prefer canonical identifiers like typescript, javascript, python, or bash.',
      required: true,
    },
    {
      editorId: createEditorFieldId(),
      name: 'pattern',
      type: 'string',
      description: 'Optional implementation pattern or style.',
      placeholder: 'e.g. async server action',
      meta_description: 'Optional label describing the implementation pattern, framework convention, or architectural style used by this code example.',
      required: false,
    },
    {
      editorId: createEditorFieldId(),
      name: 'frameworks',
      type: 'array',
      description: 'Optional framework tags for filtering or variant selection.',
      meta_description: 'Optional list of frameworks or runtimes this snippet applies to. When enum options are provided, the Page Builder renders this as a multi-select control.',
      required: false,
      items: {
        editorId: createEditorFieldId(),
        name: 'item',
        type: 'string',
        description: 'Framework or runtime name.',
        placeholder: 'e.g. nextjs',
        meta_description: 'One framework or runtime tag such as react, nextjs, hono, express, or node.',
        required: false,
      },
    },
    {
      editorId: createEditorFieldId(),
      name: 'code',
      type: 'string',
      description: 'Source code for this variant.',
      placeholder: 'Paste code here...',
      meta_description: 'The full code snippet. Preserve indentation and exact syntax. This field is typically rendered in a monospace code editor or code block preview.',
      required: true,
    },
  ],
});

interface SchemaJsonParseResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  fields: EditorSchemaFieldDefinition[];
  normalizedSchema: Record<string, unknown> | null;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const validateOptionalString = (
  value: unknown,
  path: string,
  label: string,
  errors: string[],
): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    errors.push(`${path}.${label} must be a string.`);
    return undefined;
  }
  return value;
};

const validateOptionalBoolean = (
  value: unknown,
  path: string,
  label: string,
  errors: string[],
): boolean | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    errors.push(`${path}.${label} must be true or false.`);
    return undefined;
  }
  return value;
};

const parseSchemaFieldEntry = (
  fieldName: string,
  value: unknown,
  path: string,
): { field: EditorSchemaFieldDefinition | null; errors: string[]; warnings: string[] } => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!fieldName.trim()) {
    errors.push(`${path} field name must not be empty.`);
    return { field: null, errors, warnings };
  }

  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object with at least a valid type.`);
    return { field: null, errors, warnings };
  }

  const rawType = value.type;
  if (typeof rawType !== 'string' || rawType.trim() === '') {
    errors.push(`${path}.type is required and must be a string.`);
    return { field: null, errors, warnings };
  }

  let normalizedType = rawType;
  if (rawType === 'string[]') {
    normalizedType = 'array';
    warnings.push(`${path}.type "string[]" was normalized to "array" with string items.`);
  }

  if (!VALID_SCHEMA_TYPES.has(normalizedType)) {
    errors.push(
      `${path}.type must be one of: ${Array.from(VALID_SCHEMA_TYPES).join(', ')}. Received: ${rawType}.`
    );
    return { field: null, errors, warnings };
  }

  const field: EditorSchemaFieldDefinition = {
    editorId: createEditorFieldId(),
    name: fieldName,
    type: normalizedType as SchemaFieldDefinition['type'],
    description: validateOptionalString(value.description, path, 'description', errors),
    placeholder: validateOptionalString(value.placeholder, path, 'placeholder', errors),
    meta_description: validateOptionalString(value.meta_description, path, 'meta_description', errors),
    required: validateOptionalBoolean(value.required, path, 'required', errors) ?? false,
  };

  if (value.enum !== undefined) {
    if (!Array.isArray(value.enum) || value.enum.some((entry) => typeof entry !== 'string')) {
      errors.push(`${path}.enum must be an array of strings.`);
    } else if (field.type !== 'string' && field.type !== 'media') {
      errors.push(`${path}.enum is only supported for string or media fields.`);
    } else {
      field.enum = value.enum;
    }
  }

  if (field.type === 'object') {
    if (value.properties === undefined) {
      field.properties = [];
    } else if (!isPlainObject(value.properties)) {
      errors.push(`${path}.properties must be an object whose keys are nested field names.`);
    } else {
      const nestedFields: EditorSchemaFieldDefinition[] = [];
      for (const [nestedName, nestedValue] of Object.entries(value.properties)) {
        const nestedResult = parseSchemaFieldEntry(nestedName, nestedValue, `${path}.properties.${nestedName}`);
        errors.push(...nestedResult.errors);
        warnings.push(...nestedResult.warnings);
        if (nestedResult.field) {
          nestedFields.push(nestedResult.field);
        }
      }
      field.properties = nestedFields;
    }
  } else if (value.properties !== undefined) {
    errors.push(`${path}.properties is only allowed for object fields.`);
  }

  if (field.type === 'array') {
    if (rawType === 'string[]') {
      field.items = {
        name: 'item',
        type: 'string',
        description: '',
        placeholder: '',
        meta_description: '',
        required: false,
      };
    } else if (value.items === undefined) {
      errors.push(`${path}.items is required for array fields.`);
    } else {
      const itemResult = parseSchemaFieldEntry('item', value.items, `${path}.items`);
      errors.push(...itemResult.errors);
      warnings.push(...itemResult.warnings);
      if (itemResult.field) {
        field.items = itemResult.field;
      }
    }
  } else if (field.type === 'CodeBlock[]') {
    if (value.items === undefined) {
      field.items = defaultCodeBlockItemsField();
    } else {
      const itemResult = parseSchemaFieldEntry('item', value.items, `${path}.items`);
      errors.push(...itemResult.errors);
      warnings.push(...itemResult.warnings);
      if (itemResult.field) {
        field.items = itemResult.field;
      }
    }
  } else if (value.items !== undefined) {
    errors.push(`${path}.items is only allowed for array fields.`);
  }

  return { field, errors, warnings };
};

const parseSchemaJsonDefinition = (raw: string): SchemaJsonParseResult => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      valid: false,
      errors: [],
      warnings: [],
      fields: [],
      normalizedSchema: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
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
      errors: ['The schema definition must be a JSON object at the root.'],
      warnings: [],
      fields: [],
      normalizedSchema: null,
    };
  }

  const fields: EditorSchemaFieldDefinition[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const [fieldName, fieldValue] of Object.entries(parsed)) {
    const result = parseSchemaFieldEntry(fieldName, fieldValue, fieldName);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    if (result.field) {
      fields.push(result.field);
    }
  }

  const normalizedSchema = errors.length === 0 ? fieldsToJsonSchema(fields) : null;

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    fields,
    normalizedSchema,
  };
};

const fieldsToJsonSchema = (fields: EditorSchemaFieldDefinition[]): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (!field.name.trim()) continue;

    const entry: Record<string, unknown> = {
      type: field.type,
      description: field.description || undefined,
      placeholder: field.placeholder || undefined,
      meta_description: field.meta_description || undefined,
      required: field.required || undefined,
    };

    if (field.enum && field.enum.length > 0) {
      entry.enum = field.enum;
    }

    if (field.type === 'object' && field.properties && field.properties.length > 0) {
      entry.properties = fieldsToJsonSchema(field.properties);
    }

    if ((field.type === 'array' || field.type === 'CodeBlock[]') && field.items) {
      entry.items = {
        type: field.items.type,
        description: field.items.description || undefined,
        placeholder: field.items.placeholder || undefined,
        meta_description: field.items.meta_description || undefined,
        required: field.items.required || undefined,
        ...(field.items.enum && field.items.enum.length > 0
          ? { enum: field.items.enum }
          : {}),
        ...(field.items.type === 'object' && field.items.properties
          ? { properties: fieldsToJsonSchema(field.items.properties) }
          : {}),
      };
    }

    result[field.name] = entry;
  }
  return result;
};

const jsonSchemaToFields = (schema: Record<string, unknown>): EditorSchemaFieldDefinition[] => {
  const fields: EditorSchemaFieldDefinition[] = [];
  for (const [name, value] of Object.entries(schema)) {
    const entry = value as Record<string, unknown>;
    const field: EditorSchemaFieldDefinition = {
      editorId: createEditorFieldId(),
      name,
      type: (entry.type as SchemaFieldDefinition['type']) || 'string',
      description: (entry.description as string) || '',
      placeholder: (entry.placeholder as string) || '',
      meta_description: (entry.meta_description as string) || '',
      required: (entry.required as boolean) || false,
    };

    if (entry.enum) {
      field.enum = entry.enum as string[];
    }

    if (entry.properties && typeof entry.properties === 'object') {
      field.properties = jsonSchemaToFields(entry.properties as Record<string, unknown>);
    }

    if (entry.items && typeof entry.items === 'object') {
      const items = entry.items as Record<string, unknown>;
      field.items = {
        editorId: createEditorFieldId(),
        name: 'item',
        type: (items.type as SchemaFieldDefinition['type']) || 'string',
        description: (items.description as string) || '',
        placeholder: (items.placeholder as string) || '',
        meta_description: (items.meta_description as string) || '',
        required: (items.required as boolean) || false,
        ...(items.enum ? { enum: items.enum as string[] } : {}),
        ...(items.properties
          ? { properties: jsonSchemaToFields(items.properties as Record<string, unknown>) }
          : {}),
      };
    }

    fields.push(field);
  }
  return fields;
};

interface FieldEditorProps {
  field: EditorSchemaFieldDefinition;
  onChange: (field: EditorSchemaFieldDefinition) => void;
  onRemove: () => void;
  depth?: number;
}

const FieldEditor: React.FC<FieldEditorProps> = ({ field, onChange, onRemove, depth = 0 }) => {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = field.type === 'object' || field.type === 'array' || field.type === 'CodeBlock[]';

  return (
    <div className={`border rounded-lg p-3 space-y-3 ${depth > 0 ? 'ml-6 border-dashed' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                value={field.name}
                onChange={(e) => onChange({ ...field, name: e.target.value })}
                placeholder="field_name"
                className="h-8 text-sm font-mono"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select
                value={field.type}
                onValueChange={(value) => onChange({
                  ...field,
                  type: value as SchemaFieldDefinition['type'],
                  properties: value === 'object' ? field.properties || [] : undefined,
                  items:
                    value === 'array'
                      ? field.items || emptyField()
                      : value === 'CodeBlock[]'
                        ? field.items || defaultCodeBlockItemsField()
                        : undefined,
                })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Help Text (PageBuilder)</Label>
              <Input
                value={field.description || ''}
                onChange={(e) => onChange({ ...field, description: e.target.value })}
                placeholder="Displayed below the field"
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Placeholder (PageBuilder)</Label>
            <Input
              value={field.placeholder || ''}
              onChange={(e) => onChange({ ...field, placeholder: e.target.value })}
              placeholder="e.g. Enter title..."
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <span>Meta Description</span>
              <span className="font-normal">(Fetched via API)</span>
            </Label>
            <Textarea
              value={field.meta_description || ''}
              onChange={(e) => onChange({ ...field, meta_description: e.target.value })}
              placeholder="Purpose, design intent, and notes for developers or AI agents..."
              className="text-sm min-h-[56px] resize-y"
              rows={2}
            />
          </div>
        </div>
        <div className="flex items-center gap-1 pt-5">
          <div className="flex items-center gap-1">
            <Checkbox
              id={`req-${field.editorId}`}
              checked={field.required || false}
              onCheckedChange={(checked) => onChange({ ...field, required: checked as boolean })}
            />
            <Label htmlFor={`req-${field.editorId}`} className="text-xs cursor-pointer">Req</Label>
          </div>
          {hasChildren && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={onRemove}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Nested properties for object type */}
      {hasChildren && expanded && field.type === 'object' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">Properties</Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => onChange({
                ...field,
                properties: [...(field.properties || []), emptyField()],
              })}
            >
              <Plus className="h-3 w-3 mr-1" /> Field
            </Button>
          </div>
          {(field.properties || []).map((prop) => (
            <FieldEditor
              key={prop.editorId}
              field={prop}
              depth={depth + 1}
              onChange={(updated) => {
                const newProps = (field.properties || []).map((existingProp) => (
                  existingProp.editorId === prop.editorId ? updated : existingProp
                ));
                onChange({ ...field, properties: newProps });
              }}
              onRemove={() => {
                const newProps = (field.properties || []).filter((existingProp) => existingProp.editorId !== prop.editorId);
                onChange({ ...field, properties: newProps });
              }}
            />
          ))}
        </div>
      )}

      {/* Item definition for array type */}
      {hasChildren && expanded && (field.type === 'array' || field.type === 'CodeBlock[]') && field.items && (
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">
            {field.type === 'CodeBlock[]' ? 'Code Block Item Definition' : 'Array Item Type'}
          </Label>
          <FieldEditor
            key={field.items.editorId}
            field={field.items}
            depth={depth + 1}
            onChange={(updated) => onChange({ ...field, items: updated })}
            onRemove={() => onChange({
              ...field,
              items: field.type === 'CodeBlock[]' ? defaultCodeBlockItemsField() : emptyField(),
            })}
          />
        </div>
      )}
    </div>
  );
};

const SchemaEditor: React.FC = () => {
  const { schemaSlug } = useParams<{ schemaSlug: string }>();
  const navigate = useNavigate();
  const { language } = useTheme();
  const isEditing = !!schemaSlug && schemaSlug !== 'new';

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [llmInstructions, setLlmInstructions] = useState('');
  const [fields, setFields] = useState<EditorSchemaFieldDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [existingSchema, setExistingSchema] = useState<PageSchema | null>(null);
  const [schemaJsonInput, setSchemaJsonInput] = useState('');
  const [schemaJsonResult, setSchemaJsonResult] = useState<SchemaJsonParseResult | null>(null);
  const [availableTemplates, setAvailableTemplates] = useState<SchemaTemplateDefinition[]>(SCHEMA_TEMPLATES);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  useEffect(() => {
    if (isEditing && schemaSlug) {
      setIsLoading(true);
      getSchema(schemaSlug)
        .then((data) => {
          setExistingSchema(data);
          setName(data.name);
          setDescription(data.description || '');
          setLlmInstructions(data.llm_instructions || '');
          setFields(jsonSchemaToFields(data.schema as Record<string, unknown>));
        })
        .catch((err) => {
          toast.error(err.message);
          navigate('/pages');
        })
        .finally(() => setIsLoading(false));
    }
  }, [isEditing, schemaSlug, navigate]);

  useEffect(() => {
    getSchemaTemplates()
      .then((templates) => setAvailableTemplates(mergeTemplates(SCHEMA_TEMPLATES, templates.map(toStoredTemplateDefinition))))
      .catch(() => setAvailableTemplates(SCHEMA_TEMPLATES));
  }, []);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(language === 'en' ? 'Name is required' : 'Name ist erforderlich');
      return;
    }

    if (fields.length === 0) {
      toast.error(language === 'en' ? 'At least one field is required' : 'Mindestens ein Feld ist erforderlich');
      return;
    }

    setIsSaving(true);
    try {
      const schemaJson = fieldsToJsonSchema(fields);

      if (isEditing && existingSchema) {
        await updateSchema(existingSchema.id, {
          name,
          description,
          schema: schemaJson,
          llm_instructions: llmInstructions,
        });
        toast.success(language === 'en' ? 'Schema updated' : 'Schema aktualisiert');
        navigate(`/pages/schema/${existingSchema.slug}`);
      } else {
        const newSchema = await createSchema({
          name,
          description,
          schema: schemaJson,
          llm_instructions: llmInstructions,
        });
        toast.success(language === 'en' ? 'Schema created' : 'Schema erstellt');
        navigate(`/pages/schema/${newSchema.slug}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save schema');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartRegistration = async () => {
    if (!existingSchema) return;
    try {
      await startSchemaRegistration(existingSchema.id);
      toast.success(language === 'en' ? 'Registration started' : 'Registrierung gestartet');
      navigate(`/pages/schema/${existingSchema.slug}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start registration');
    }
  };

  const handleCreateTemplate = async () => {
    if (!name.trim()) {
      toast.error(language === 'en' ? 'Name is required before creating a template' : 'Name ist erforderlich, bevor eine Vorlage erstellt werden kann');
      return;
    }

    if (fields.length === 0) {
      toast.error(language === 'en' ? 'Add at least one field before creating a template' : 'Füge mindestens ein Feld hinzu, bevor du eine Vorlage erstellst');
      return;
    }

    setIsSavingTemplate(true);
    try {
      const createdTemplate = await createSchemaTemplate({
        name,
        description,
        schema: generatedSchema,
        llm_instructions: llmInstructions,
        source_schema_id: existingSchema?.id,
      });

      const templateDefinition = toStoredTemplateDefinition(createdTemplate);
      setAvailableTemplates((current) => mergeTemplates(current, [templateDefinition]));
      toast.success(language === 'en'
        ? `Template "${createdTemplate.name}" created`
        : `Vorlage "${createdTemplate.name}" erstellt`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create template');
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const applyTemplate = (template: SchemaTemplateDefinition) => {
    setName(language === 'en' ? template.name : template.nameDe);
    setDescription(language === 'en' ? template.description : template.descriptionDe);
    setFields(jsonSchemaToFields(template.schema));
    toast.info(language === 'en'
      ? `Template "${template.name}" applied`
      : `Vorlage "${template.nameDe}" angewendet`);
  };

  const handleSchemaJsonChange = (value: string) => {
    setSchemaJsonInput(value);
    if (!value.trim()) {
      setSchemaJsonResult(null);
      return;
    }
    setSchemaJsonResult(parseSchemaJsonDefinition(value));
  };

  const loadCurrentSchemaIntoParser = () => {
    const current = JSON.stringify(generatedSchema, null, 2);
    setSchemaJsonInput(current);
    setSchemaJsonResult(parseSchemaJsonDefinition(current));
  };

  const applyParsedSchemaToEditor = () => {
    if (!schemaJsonResult?.valid) {
      return;
    }
    setFields(schemaJsonResult.fields);
    toast.success(language === 'en' ? 'JSON schema loaded into the editor' : 'JSON-Schema in den Editor geladen');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const generatedSchema = fieldsToJsonSchema(fields);

  return (
    <div className="container mx-auto py-8 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/pages')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-3xl font-bold">
          {isEditing
            ? (language === 'en' ? 'Edit Schema' : 'Schema bearbeiten')
            : (language === 'en' ? 'New Schema' : 'Neues Schema')}
        </h1>
      </div>

      {/* Templates Selection (only when creating new) */}
      {!isEditing && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {availableTemplates.map((template) => (
            <Card
              key={template.id}
              className="hover:border-primary cursor-pointer transition-colors border-2 border-transparent"
              onClick={() => applyTemplate(template)}
            >
              <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{template.icon}</span>
                  <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
                    {template.source === 'stored'
                      ? (language === 'en' ? 'Saved Template' : 'Gespeicherte Vorlage')
                      : (language === 'en' ? 'Template' : 'Vorlage')}
                  </Badge>
                </div>
                <CardTitle className="text-base mt-2">
                  {language === 'en' ? template.name : template.nameDe}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {language === 'en' ? template.description : template.descriptionDe}
                </p>
                {template.external_source_url && (
                  <p className="text-[11px] text-muted-foreground mt-2 line-clamp-1">
                    {template.external_source_url}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>📋</span>
            <span>{language === 'en' ? 'Schema Information' : 'Schema-Informationen'}</span>
          </CardTitle>
          <CardDescription>
            {language === 'en'
              ? 'Basic details about this page schema'
              : 'Grundlegende Details zu diesem Seitenschema'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-2">
              <Label htmlFor="schema-name" className="text-base font-semibold">Name</Label>
              <Input
                id="schema-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={language === 'en' ? 'e.g., Landing Page' : 'z.B. Landing Page'}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schema-desc" className="text-base font-semibold">
                {language === 'en' ? 'Description' : 'Beschreibung'}
              </Label>
              <Textarea
                id="schema-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={language === 'en' ? 'What is this schema for?' : 'Wofür ist dieses Schema gedacht?'}
                rows={3}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Schema Fields */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>🏗️</span>
            <span>{language === 'en' ? 'Schema Structure' : 'Schema-Struktur'}</span>
          </CardTitle>
          <CardDescription>
            {language === 'en'
              ? 'Define the JSON fields that make up this page schema'
              : 'Definiere die JSON-Felder, die dieses Seitenschema ausmachen'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {fields.map((field) => (
            <FieldEditor
              key={field.editorId}
              field={field}
              onChange={(updated) => {
                const newFields = fields.map((existingField) => (
                  existingField.editorId === field.editorId ? updated : existingField
                ));
                setFields(newFields);
              }}
              onRemove={() => setFields(fields.filter((existingField) => existingField.editorId !== field.editorId))}
            />
          ))}

          <Button
            variant="outline"
            className="w-full border-dashed"
            onClick={() => setFields([...fields, emptyField()])}
          >
            <Plus className="h-4 w-4 mr-2" />
            {language === 'en' ? 'Add Field' : 'Feld hinzufügen'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5" />
            <span>{language === 'en' ? 'Schema JSON Parser' : 'Schema-JSON-Parser'}</span>
          </CardTitle>
          <CardDescription>
            {language === 'en'
              ? 'Paste a schema JSON object to define fields in bulk. The parser validates types, nested structures, and legacy aliases before loading the result into the editor.'
              : 'Füge ein Schema-JSON-Objekt ein, um Felder gesammelt zu definieren. Der Parser validiert Typen, verschachtelte Strukturen und Legacy-Aliase, bevor das Ergebnis in den Editor geladen wird.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={loadCurrentSchemaIntoParser}>
              <Eye className="h-4 w-4 mr-2" />
              {language === 'en' ? 'Load Current Schema JSON' : 'Aktuelles Schema-JSON laden'}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={applyParsedSchemaToEditor}
              disabled={!schemaJsonResult?.valid}
            >
              <Upload className="h-4 w-4 mr-2" />
              {language === 'en' ? 'Load into Field Editor' : 'In Feld-Editor laden'}
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="schema-json-input" className="text-base font-semibold">
              {language === 'en' ? 'Schema Definition JSON' : 'Schema-Definitions-JSON'}
            </Label>
            <Textarea
              id="schema-json-input"
              value={schemaJsonInput}
              onChange={(e) => handleSchemaJsonChange(e.target.value)}
              rows={14}
              spellCheck={false}
              className={`font-mono text-sm ${
                !schemaJsonInput.trim()
                  ? ''
                  : schemaJsonResult?.valid
                    ? 'border-green-500'
                    : 'border-destructive'
              }`}
              placeholder={`{
  "title": {
    "type": "string",
    "description": "Main page heading",
    "required": true
  },
  "gallery": {
    "type": "array",
    "items": {
      "type": "media"
    }
  }
}`}
            />
            <div className="flex items-center gap-2 min-h-[1.5rem]">
              {!schemaJsonInput.trim() && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  {language === 'en'
                    ? 'Paste a JSON object with field definitions to validate it live.'
                    : 'Füge ein JSON-Objekt mit Felddefinitionen ein, um es live zu validieren.'}
                </span>
              )}
              {schemaJsonInput.trim() && schemaJsonResult?.valid && (
                <Badge variant="outline" className="text-green-700 border-green-400 dark:text-green-400 gap-1 text-xs">
                  <CheckCircle2 className="h-3 w-3" />
                  {language === 'en' ? 'Valid schema JSON' : 'Gültiges Schema-JSON'}
                </Badge>
              )}
              {schemaJsonInput.trim() && schemaJsonResult && !schemaJsonResult.valid && (
                <Badge variant="destructive" className="gap-1 text-xs">
                  <AlertTriangle className="h-3 w-3" />
                  {schemaJsonResult.errors.length === 1
                    ? (language === 'en' ? '1 error' : '1 Fehler')
                    : language === 'en'
                      ? `${schemaJsonResult.errors.length} errors`
                      : `${schemaJsonResult.errors.length} Fehler`}
                </Badge>
              )}
            </div>
          </div>

          {schemaJsonResult && (schemaJsonResult.errors.length > 0 || schemaJsonResult.warnings.length > 0) && (
            <Alert variant={schemaJsonResult.errors.length > 0 ? 'destructive' : 'default'}>
              {schemaJsonResult.errors.length > 0 ? (
                <AlertTriangle className="h-4 w-4" />
              ) : (
                <Info className="h-4 w-4" />
              )}
              <AlertTitle>
                {schemaJsonResult.errors.length > 0
                  ? (language === 'en' ? 'Parser feedback' : 'Parser-Feedback')
                  : (language === 'en' ? 'Warnings' : 'Warnungen')}
              </AlertTitle>
              <AlertDescription>
                <div className="space-y-2">
                  {schemaJsonResult.errors.map((error, index) => (
                    <p key={`schema-json-error-${index}`} className="text-sm">{error}</p>
                  ))}
                  {schemaJsonResult.warnings.map((warning, index) => (
                    <p key={`schema-json-warning-${index}`} className="text-sm text-amber-700 dark:text-amber-400">
                      {warning}
                    </p>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {schemaJsonResult?.normalizedSchema && (
            <div className="space-y-2">
              <Label className="text-base font-semibold">
                {language === 'en' ? 'Normalized Parsed Schema' : 'Normalisiertes geparstes Schema'}
              </Label>
              <pre className="bg-muted p-4 rounded-lg text-sm overflow-auto max-h-80 font-mono">
                {JSON.stringify(schemaJsonResult.normalizedSchema, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* LLM Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>🤖</span>
            <span>{language === 'en' ? 'LLM Instructions' : 'LLM-Anweisungen'}</span>
          </CardTitle>
          <CardDescription>
            {language === 'en'
              ? 'Custom instructions for the AI agent that builds the frontend template'
              : 'Individuelle Anweisungen für den KI-Agenten, der das Frontend-Template erstellt'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={llmInstructions}
            onChange={(e) => setLlmInstructions(e.target.value)}
            placeholder={language === 'en'
              ? 'Describe how the frontend should render this page structure...'
              : 'Beschreibe, wie das Frontend diese Seitenstruktur rendern soll...'}
            rows={8}
            className="font-mono text-sm"
          />
        </CardContent>
      </Card>

      {/* Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>👁️</span>
              <span>{language === 'en' ? 'Schema Preview' : 'Schema-Vorschau'}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowPreview(!showPreview)}>
              <Eye className="h-4 w-4 mr-2" />
              {showPreview
                ? (language === 'en' ? 'Hide' : 'Ausblenden')
                : (language === 'en' ? 'Show' : 'Anzeigen')}
            </Button>
          </CardTitle>
        </CardHeader>
        {showPreview && (
          <CardContent>
            <pre className="bg-muted p-4 rounded-lg text-sm overflow-auto max-h-96 font-mono">
              {JSON.stringify(generatedSchema, null, 2)}
            </pre>
          </CardContent>
        )}
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div>
          {isEditing && existingSchema && existingSchema.registration_status === 'pending' && (
            <Button variant="outline" onClick={handleStartRegistration}>
              {language === 'en' ? 'Start Registration' : 'Registrierung starten'}
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleCreateTemplate} disabled={isSavingTemplate}>
            {isSavingTemplate ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {language === 'en' ? 'Creating Template...' : 'Vorlage wird erstellt...'}
              </>
            ) : (
              <>
                <FileJson className="h-4 w-4 mr-2" />
                {language === 'en' ? 'Save as Template' : 'Als Vorlage speichern'}
              </>
            )}
          </Button>
          <Button variant="outline" onClick={() => navigate('/pages')}>
            {language === 'en' ? 'Cancel' : 'Abbrechen'}
          </Button>
          <Button onClick={handleSave} disabled={isSaving} className="min-w-[150px]">
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {language === 'en' ? 'Saving...' : 'Speichern...'}
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                {language === 'en' ? 'Save Schema' : 'Schema speichern'}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SchemaEditor;
