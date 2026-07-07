import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileJson,
  Info,
  Loader2,
  Lock,
  Plus,
  Save,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AdminCard, AdminPageLayout } from '@/components/admin/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ObjectContentBlocksEditor } from '@/components/objects/ObjectContentBlocksEditor';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import EntityActionsRow from '@/components/entity-actions/EntityActionsRow';
import { createObject, generateObjectSlug, getObject, updateObject } from '@/services/objectService';
import { getTenantOptions, pickInitialTenantId, type TenantOption } from '@/services/tenantService';
import type { ContentBlock } from '@/types/pagebuilder';
import type { MarkdownObjectData, ObjectFieldDefinition, ObjectFieldType, ObjectRecord, ObjectType } from '@/types/objects';
import { toast } from 'sonner';

// ----- Currency options for price fields -----
const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: '€',
  USD: '$',
  GBP: '£',
  CHF: 'Fr.',
  JPY: '¥',
  CAD: 'CA$',
  AUD: 'A$',
  DKK: 'kr',
  SEK: 'kr',
  NOK: 'kr',
};
const CURRENCIES = Object.keys(CURRENCY_SYMBOLS);

// ----- Field types available for Objects (different from PageBuilder) -----
const OBJECT_FIELD_TYPES: ObjectFieldType[] = [
  'string',
  'number',
  'boolean',
  'array',
  'object',
  'url',
  'email',
  'date',
  'price',
];

// ----- Editor-internal field type (with stable editorId) -----
interface EditorField extends Omit<ObjectFieldDefinition, 'properties' | 'items'> {
  editorId: string;
  properties?: EditorField[];
  items?: EditorField;
}

const createEditorId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `obj-field-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

const emptyField = (): EditorField => ({
  editorId: createEditorId(),
  name: '',
  type: 'string',
  description: '',
  placeholder: '',
  meta_description: '',
  required: false,
});

// ----- Conversion helpers -----
const fieldsToSchema = (fields: EditorField[]): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (!field.name.trim()) continue;
    const entry: Record<string, unknown> = {
      type: field.type,
      description: field.description || undefined,
      placeholder: field.placeholder || undefined,
      meta_description: field.meta_description || undefined,
      required: field.required || undefined,
      currency: field.type === 'price' && field.currency ? field.currency : undefined,
      multiple: field.type === 'object' && field.multiple ? true : undefined,
    };
    if (field.enum && field.enum.length > 0) entry.enum = field.enum;
    if (field.type === 'object' && field.properties && field.properties.length > 0) {
      entry.properties = fieldsToSchema(field.properties);
    }
    if (field.type === 'array' && field.items) {
      entry.items = {
        type: field.items.type,
        description: field.items.description || undefined,
        placeholder: field.items.placeholder || undefined,
        meta_description: field.items.meta_description || undefined,
        required: field.items.required || undefined,
        ...(field.items.enum && field.items.enum.length > 0 ? { enum: field.items.enum } : {}),
        ...(field.items.type === 'object' && field.items.properties
          ? { properties: fieldsToSchema(field.items.properties) }
          : {}),
      };
    }
    result[field.name] = entry;
  }
  return result;
};

const schemaToFields = (schema: Record<string, unknown>): EditorField[] => {
  const fields: EditorField[] = [];
  for (const [name, value] of Object.entries(schema)) {
    const entry = value as Record<string, unknown>;
    const field: EditorField = {
      editorId: createEditorId(),
      name,
      type: (entry.type as ObjectFieldType) || 'string',
      description: (entry.description as string) || '',
      placeholder: (entry.placeholder as string) || '',
      meta_description: (entry.meta_description as string) || '',
      required: (entry.required as boolean) || false,
      currency: (entry.currency as string) || undefined,
      multiple: (entry.multiple as boolean) || undefined,
    };
    if (entry.enum) field.enum = entry.enum as string[];
    if (entry.properties && typeof entry.properties === 'object') {
      field.properties = schemaToFields(entry.properties as Record<string, unknown>);
    }
    if (entry.items && typeof entry.items === 'object') {
      const items = entry.items as Record<string, unknown>;
      field.items = {
        editorId: createEditorId(),
        name: 'item',
        type: (items.type as ObjectFieldType) || 'string',
        description: (items.description as string) || '',
        placeholder: (items.placeholder as string) || '',
        meta_description: (items.meta_description as string) || '',
        required: (items.required as boolean) || false,
        ...(items.enum ? { enum: items.enum as string[] } : {}),
        ...(items.properties ? { properties: schemaToFields(items.properties as Record<string, unknown>) } : {}),
      };
    }
    fields.push(field);
  }
  return fields;
};

// ----- JSON import validation -----
interface SchemaParseResult {
  valid: boolean;
  errors: string[];
  fields: EditorField[];
  normalizedSchema: Record<string, unknown> | null;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isMarkdownObjectData = (value: unknown): value is MarkdownObjectData => (
  isPlainObject(value)
  && isPlainObject(value.metadata)
  && Array.isArray(value.content)
);

const parseSchemaJson = (raw: string): SchemaParseResult => {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: false, errors: [], fields: [], normalizedSchema: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return {
      valid: false,
      errors: [e instanceof Error ? e.message : 'Invalid JSON.'],
      fields: [],
      normalizedSchema: null,
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      valid: false,
      errors: ['Schema must be a JSON object at the root level.'],
      fields: [],
      normalizedSchema: null,
    };
  }

  const errors: string[] = [];
  const validTypes = new Set<string>(OBJECT_FIELD_TYPES);

  for (const [fieldName, fieldValue] of Object.entries(parsed)) {
    if (!isPlainObject(fieldValue)) {
      errors.push(`Field "${fieldName}" must be an object with a "type" key.`);
      continue;
    }
    const t = fieldValue.type;
    if (typeof t !== 'string' || !validTypes.has(t)) {
      errors.push(
        `Field "${fieldName}" has invalid type "${String(t)}". Valid types: ${OBJECT_FIELD_TYPES.join(', ')}.`,
      );
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, fields: [], normalizedSchema: null };
  }

  const fields = schemaToFields(parsed);
  return { valid: true, errors: [], fields, normalizedSchema: fieldsToSchema(fields) };
};

// ----- FieldEditor component -----
interface FieldEditorProps {
  field: EditorField;
  onChange: (field: EditorField) => void;
  onRemove: () => void;
  depth?: number;
}

const FieldEditor: React.FC<FieldEditorProps> = ({ field, onChange, onRemove, depth = 0 }) => {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = field.type === 'object' || field.type === 'array';

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
                onValueChange={(value) =>
                  onChange({
                    ...field,
                    type: value as ObjectFieldType,
                    properties: value === 'object' ? field.properties ?? [] : undefined,
                    items: value === 'array' ? field.items ?? emptyField() : undefined,
                  })
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OBJECT_FIELD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Help Text</Label>
              <Input
                value={field.description || ''}
                onChange={(e) => onChange({ ...field, description: e.target.value })}
                placeholder="Shown below the field"
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div className={field.type === 'price' ? 'grid grid-cols-2 gap-2' : ''}>
            <div>
              <Label className="text-xs text-muted-foreground">Placeholder</Label>
              <Input
                value={field.placeholder || ''}
                onChange={(e) => onChange({ ...field, placeholder: e.target.value })}
                placeholder="e.g. Enter value..."
                className="h-8 text-sm"
              />
            </div>
            {field.type === 'price' && (
              <div>
                <Label className="text-xs text-muted-foreground">Currency</Label>
                <Select
                  value={field.currency ?? 'EUR'}
                  onValueChange={(v) => onChange({ ...field, currency: v })}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c} {CURRENCY_SYMBOLS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              Meta Description <span className="font-normal">(API only)</span>
            </Label>
            <Textarea
              value={field.meta_description || ''}
              onChange={(e) => onChange({ ...field, meta_description: e.target.value })}
              placeholder="Purpose, constraints, notes for developers or AI agents..."
              className="text-sm min-h-[48px] resize-y"
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
            <Label htmlFor={`req-${field.editorId}`} className="text-xs cursor-pointer">
              Req
            </Label>
          </div>
          {field.type === 'object' && (
            <div className="flex items-center gap-1">
              <Checkbox
                id={`multi-${field.editorId}`}
                checked={field.multiple || false}
                onCheckedChange={(checked) => onChange({ ...field, multiple: checked as boolean })}
              />
              <Label htmlFor={`multi-${field.editorId}`} className="text-xs cursor-pointer">
                Multi
              </Label>
            </div>
          )}
          {hasChildren && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive"
            onClick={onRemove}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {hasChildren && expanded && field.type === 'object' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">Properties</Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() =>
                onChange({
                  ...field,
                  properties: [...(field.properties ?? []), emptyField()],
                })
              }
            >
              <Plus className="h-3 w-3 mr-1" /> Field
            </Button>
          </div>
          {(field.properties ?? []).map((prop) => (
            <FieldEditor
              key={prop.editorId}
              field={prop}
              depth={depth + 1}
              onChange={(updated) =>
                onChange({
                  ...field,
                  properties: (field.properties ?? []).map((p) =>
                    p.editorId === prop.editorId ? updated : p,
                  ),
                })
              }
              onRemove={() =>
                onChange({
                  ...field,
                  properties: (field.properties ?? []).filter((p) => p.editorId !== prop.editorId),
                })
              }
            />
          ))}
        </div>
      )}

      {hasChildren && expanded && field.type === 'array' && field.items && (
        <div className="space-y-3">
          {/* Enum (allowed values) — only for non-object item types */}
          {field.items.type !== 'object' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-muted-foreground">
                  Allowed values <span className="font-normal">(optional — leave empty for free text)</span>
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => onChange({ ...field, enum: [...(field.enum ?? []), ''] })}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add
                </Button>
              </div>
              {(field.enum ?? []).length > 0 ? (
                <div className="space-y-1.5">
                  {(field.enum ?? []).map((val, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <Input
                        value={val}
                        onChange={(e) => {
                          const next = [...(field.enum ?? [])];
                          next[idx] = e.target.value;
                          onChange({ ...field, enum: next });
                        }}
                        placeholder={`Option ${idx + 1}`}
                        className="h-7 text-xs flex-1"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive flex-shrink-0"
                        onClick={() =>
                          onChange({ ...field, enum: (field.enum ?? []).filter((_, i) => i !== idx) })
                        }
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No allowed values defined — array items will be free text.
                </p>
              )}
            </div>
          )}
          {/* Item type editor — hide when enum is fully defined */}
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Array Item Type</Label>
            <div className="mt-1.5">
              <FieldEditor
                key={field.items.editorId}
                field={field.items}
                depth={depth + 1}
                onChange={(updated) => onChange({ ...field, items: updated })}
                onRemove={() => onChange({ ...field, items: emptyField() })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ----- Multi-entry object editor -----

interface MultipleObjectEditorProps {
  field: EditorField;
  value: unknown;
  onChange: (v: unknown) => void;
  language: string;
}

const MultipleObjectEditor: React.FC<MultipleObjectEditorProps> = ({
  field,
  value,
  onChange,
  language,
}) => {
  const arr = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const props = field.properties?.filter((p) => p.name.trim()) ?? [];

  const makeEmpty = (): Record<string, unknown> =>
    Object.fromEntries(props.map((p) => [p.name, getDefaultFieldValue(p.type)]));

  const addEntry = () => onChange([...arr, makeEmpty()]);
  const removeEntry = (idx: number) => onChange(arr.filter((_, i) => i !== idx));
  const updateEntry = (idx: number, updated: Record<string, unknown>) =>
    onChange(arr.map((item, i) => (i === idx ? updated : item)));

  return (
    <div className="space-y-3">
      {arr.map((entry, idx) => (
        <div key={idx} className="rounded-lg border bg-muted/20 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">
              #{idx + 1}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-destructive"
              onClick={() => removeEntry(idx)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          {props.map((prop) => (
            <div key={prop.editorId} className="space-y-1">
              <Label className="text-xs font-medium">
                {prop.name}
                {prop.required && <span className="text-destructive ml-1">*</span>}
              </Label>
              {prop.description && (
                <p className="text-xs text-muted-foreground">{prop.description}</p>
              )}
              <FieldInput
                field={prop}
                value={entry[prop.name]}
                onChange={(v) => updateEntry(idx, { ...entry, [prop.name]: v })}
                language={language}
              />
            </div>
          ))}
          {props.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {language === 'en'
                ? 'No properties defined.'
                : 'Keine Eigenschaften definiert.'}
            </p>
          )}
        </div>
      ))}
      {arr.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-3">
          {language === 'en' ? 'No entries yet.' : 'Noch keine Einträge.'}
        </p>
      )}
      <Button variant="outline" size="sm" onClick={addEntry}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        {language === 'en'
          ? `Add ${field.name || 'item'}`
          : `${field.name || 'Eintrag'} hinzufügen`}
      </Button>
    </div>
  );
};

// ----- Nested data editors -----

interface NestedObjectEditorProps {
  field: EditorField;
  value: unknown;
  onChange: (v: unknown) => void;
  language: string;
}

const NestedObjectEditor: React.FC<NestedObjectEditorProps> = ({ field, value, onChange, language }) => {
  const props = field.properties?.filter((p) => p.name.trim()) ?? [];
  const obj =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3 bg-muted/20">
      {props.map((prop) => (
        <div key={prop.editorId} className="space-y-1">
          <Label className="text-xs font-medium">
            {prop.name}
            {prop.required && <span className="text-destructive ml-1">*</span>}
          </Label>
          {prop.description && (
            <p className="text-xs text-muted-foreground">{prop.description}</p>
          )}
          <FieldInput
            field={prop}
            value={obj[prop.name]}
            onChange={(v) => onChange({ ...obj, [prop.name]: v })}
            language={language}
          />
        </div>
      ))}
      {props.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {language === 'en'
            ? 'No properties defined for this object field.'
            : 'Keine Eigenschaften für dieses Objekt-Feld definiert.'}
        </p>
      )}
    </div>
  );
};

interface NestedArrayEditorProps {
  field: EditorField;
  value: unknown;
  onChange: (v: unknown) => void;
  language: string;
}

const NestedArrayEditor: React.FC<NestedArrayEditorProps> = ({ field, value, onChange, language }) => {
  const arr = Array.isArray(value) ? value : [];
  const items = field.items;

  const addItem = () => {
    if (!items) {
      onChange([...arr, '']);
      return;
    }
    if (items.type === 'object') {
      const props = items.properties?.filter((p) => p.name.trim()) ?? [];
      const newRow = Object.fromEntries(props.map((p) => [p.name, getDefaultFieldValue(p.type)]));
      onChange([...arr, newRow]);
    } else {
      onChange([...arr, getDefaultFieldValue(items.type)]);
    }
  };

  const removeItem = (idx: number) => onChange(arr.filter((_, i) => i !== idx));
  const updateItem = (idx: number, v: unknown) =>
    onChange(arr.map((item, i) => (i === idx ? v : item)));

  if (items && items.type === 'object') {
    const itemProps = items.properties?.filter((p) => p.name.trim()) ?? [];
    if (itemProps.length > 0) {
      return (
        <div className="space-y-2">
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-1.5 px-2 text-muted-foreground font-medium w-6">#</th>
                  {itemProps.map((p) => (
                    <th
                      key={p.name}
                      className="text-left py-1.5 px-2 text-muted-foreground font-medium whitespace-nowrap"
                    >
                      {p.name}
                      {p.type === 'price' && ` (${CURRENCY_SYMBOLS[p.currency ?? 'EUR'] ?? p.currency ?? '€'})`}
                      {p.required && <span className="text-destructive ml-0.5">*</span>}
                    </th>
                  ))}
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {arr.map((row, rowIdx) => {
                  const rowObj =
                    typeof row === 'object' && row !== null && !Array.isArray(row)
                      ? (row as Record<string, unknown>)
                      : {};
                  return (
                    <tr key={rowIdx} className="border-b last:border-0 group hover:bg-muted/30">
                      <td className="px-2 py-1 text-muted-foreground">{rowIdx + 1}</td>
                      {itemProps.map((p) => (
                        <td key={p.name} className="px-2 py-1">
                          <FieldInput
                            field={p}
                            value={rowObj[p.name]}
                            onChange={(v) => updateItem(rowIdx, { ...rowObj, [p.name]: v })}
                            compact
                            language={language}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 opacity-0 group-hover:opacity-100 text-destructive"
                          onClick={() => removeItem(rowIdx)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {arr.length === 0 && (
                  <tr>
                    <td
                      colSpan={itemProps.length + 2}
                      className="text-center py-4 text-muted-foreground"
                    >
                      {language === 'en' ? 'No rows yet.' : 'Noch keine Zeilen.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Button variant="outline" size="sm" onClick={addItem}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {language === 'en' ? 'Add row' : 'Zeile hinzufügen'}
          </Button>
        </div>
      );
    }
  }

  // Primitive items: list with add / remove
  return (
    <div className="space-y-2">
      {arr.map((item, idx) => (
        <div key={idx} className="flex gap-2 items-center">
          <div className="flex-1">
            <FieldInput
              field={items ?? { editorId: '', name: 'item', type: 'string' }}
              value={item}
              onChange={(v) => updateItem(idx, v)}
              language={language}
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0 text-destructive"
            onClick={() => removeItem(idx)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addItem}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        {language === 'en' ? 'Add item' : 'Eintrag hinzufügen'}
      </Button>
    </div>
  );
};

// ----- Data field helpers -----

const getDefaultFieldValue = (type: ObjectFieldType): unknown => {
  switch (type) {
    case 'boolean': return false;
    case 'number': case 'price': return '';
    case 'array': return [];
    case 'object': return {};
    default: return '';
  }
};

// ----- FieldInput: renders an appropriate input control for a given field type -----

interface FieldInputProps {
  field: EditorField;
  value: unknown;
  onChange: (value: unknown) => void;
  compact?: boolean;
  language?: string;
}

const FieldInput: React.FC<FieldInputProps> = ({ field, value, onChange, compact = false, language = 'de' }) => {
  const cls = compact ? 'h-7 text-xs' : 'h-9 text-sm';

  if (field.type === 'boolean') {
    return (
      <Switch
        checked={typeof value === 'boolean' ? value : false}
        onCheckedChange={(v) => onChange(v)}
      />
    );
  }

  if (field.type === 'number') {
    return (
      <Input
        type="number"
        value={value === undefined || value === null || value === '' ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        placeholder={field.placeholder || '0'}
        className={`${cls}${compact ? ' w-24' : ''}`}
      />
    );
  }

  if (field.type === 'price') {
    const sym = CURRENCY_SYMBOLS[field.currency ?? 'EUR'] ?? field.currency ?? '€';
    const symWidth = sym.length > 1 ? 'pl-10' : 'pl-6';
    return (
      <div className={`relative${compact ? ' w-28' : ''}`}>
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
          {sym}
        </span>
        <Input
          type="number"
          step="0.01"
          value={value === undefined || value === null || value === '' ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          placeholder={field.placeholder || '0.00'}
          className={`${cls} ${symWidth}`}
        />
      </div>
    );
  }

  if (field.type === 'date') {
    return (
      <Input
        type="date"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        className={cls}
      />
    );
  }

  if (field.type === 'email') {
    return (
      <Input
        type="email"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder || 'email@example.com'}
        className={cls}
      />
    );
  }

  if (field.type === 'url') {
    return (
      <Input
        type="url"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder || 'https://...'}
        className={cls}
      />
    );
  }

  if (field.type === 'array') {
    const enumOptions = (field.enum ?? []).filter(Boolean);
    const selected = Array.isArray(value) ? (value as string[]) : [];

    // Enum-backed: clickable badge chips
    if (enumOptions.length > 0) {
      if (!compact) {
        return (
          <div className="flex flex-wrap gap-1.5">
            {enumOptions.map((opt) => {
              const isSelected = selected.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() =>
                    onChange(
                      isSelected
                        ? selected.filter((s) => s !== opt)
                        : [...selected, opt],
                    )
                  }
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    isSelected
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-foreground border-border hover:bg-muted'
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        );
      }
      // Compact: show selected as comma-joined text in a small badge
      return (
        <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground max-w-[140px] truncate">
          {selected.length > 0 ? selected.join(', ') : '—'}
        </span>
      );
    }

    if (!compact) {
      return (
        <NestedArrayEditor field={field} value={value} onChange={onChange} language={language} />
      );
    }
    // Compact (table cell): show item count badge for complex items, comma-list for primitives
    if (field.items?.type === 'object') {
      const count = Array.isArray(value) ? value.length : 0;
      return (
        <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
          [{count}]
        </span>
      );
    }
    return (
      <Input
        type="text"
        value={Array.isArray(value) ? (value as string[]).join(', ') : ''}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
        placeholder={field.placeholder || 'item1, item2, ...'}
        className={`${cls} font-mono`}
      />
    );
  }

  if (field.type === 'object') {
    if (!compact && field.multiple) {
      return (
        <MultipleObjectEditor field={field} value={value} onChange={onChange} language={language} />
      );
    }
    const hasProps = (field.properties?.filter((p) => p.name.trim()) ?? []).length > 0;
    if (!compact && hasProps) {
      return (
        <NestedObjectEditor field={field} value={value} onChange={onChange} language={language} />
      );
    }
    // Compact or no properties: JSON text
    return (
      <Input
        type="text"
        value={
          typeof value === 'object' && value !== null && !Array.isArray(value)
            ? JSON.stringify(value)
            : ''
        }
        onChange={(e) => {
          try {
            onChange(JSON.parse(e.target.value) as unknown);
          } catch {
            onChange(e.target.value);
          }
        }}
        placeholder={field.placeholder || '{"key": "value"}'}
        className={`${cls} font-mono`}
      />
    );
  }

  return (
    <Input
      type="text"
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder || ''}
      className={cls}
    />
  );
};

// ----- DataFormEditor: form-based data entry driven by schema fields -----

interface DataFormEditorProps {
  fields: EditorField[];
  rows: Record<string, unknown>[];
  isListMode: boolean;
  onRowsChange: (rows: Record<string, unknown>[]) => void;
  language: string;
}

const DataFormEditor: React.FC<DataFormEditorProps> = ({
  fields,
  rows,
  isListMode,
  onRowsChange,
  language,
}) => {
  const visibleFields = fields.filter((f) => f.name.trim());

  if (visibleFields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        {language === 'en'
          ? 'Define schema fields above to use the form editor.'
          : 'Definiere Schema-Felder oben, um den Formular-Editor zu nutzen.'}
      </p>
    );
  }

  const updateCell = (rowIdx: number, fieldName: string, value: unknown) => {
    onRowsChange(rows.map((row, i) => (i === rowIdx ? { ...row, [fieldName]: value } : row)));
  };

  const addRow = () => {
    const newRow: Record<string, unknown> = {};
    visibleFields.forEach((f) => {
      newRow[f.name] = getDefaultFieldValue(f.type);
    });
    onRowsChange([...rows, newRow]);
  };

  const removeRow = (idx: number) => {
    const newRows = rows.filter((_, i) => i !== idx);
    onRowsChange(newRows.length > 0 ? newRows : [{}]);
  };

  if (isListMode) {
    return (
      <div className="space-y-3">
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left text-xs text-muted-foreground py-2 px-3 font-medium w-8">
                  #
                </th>
                {visibleFields.map((f) => (
                  <th
                    key={f.name}
                    className="text-left text-xs text-muted-foreground py-2 px-2 font-medium whitespace-nowrap"
                  >
                    {f.name}
                    {f.type === 'price' && ' (€)'}
                    {f.required && <span className="text-destructive ml-0.5">*</span>}
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={rowIdx} className="border-b last:border-0 group hover:bg-muted/30">
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">{rowIdx + 1}</td>
                  {visibleFields.map((f) => (
                    <td key={f.name} className="px-2 py-1.5">
                      <FieldInput
                        field={f}
                        value={row[f.name]}
                        onChange={(val) => updateCell(rowIdx, f.name, val)}
                        compact
                        language={language}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive"
                      onClick={() => removeRow(rowIdx)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={visibleFields.length + 2}
                    className="text-center text-xs text-muted-foreground py-6"
                  >
                    {language === 'en'
                      ? 'No rows yet. Add one below.'
                      : 'Noch keine Einträge. Füge einen hinzu.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Button variant="outline" size="sm" onClick={addRow}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {language === 'en' ? 'Add row' : 'Zeile hinzufügen'}
        </Button>
      </div>
    );
  }

  // Single record mode
  return (
    <div className="space-y-4">
      {visibleFields.map((f) => (
        <div key={f.name} className="space-y-1.5">
          <Label className="text-sm">
            {f.name}
            {f.required && <span className="text-destructive ml-1">*</span>}
          </Label>
          {f.description && <p className="text-xs text-muted-foreground">{f.description}</p>}
          <FieldInput
            field={f}
            value={(rows[0] ?? {})[f.name]}
            onChange={(val) => updateCell(0, f.name, val)}
            language={language}
          />
        </div>
      ))}
    </div>
  );
};

// ----- Main ObjectEditor -----
const ObjectEditor: React.FC = () => {
  const { objectId } = useParams<{ objectId: string }>();
  const navigate = useNavigate();
  const { language } = useTheme();
  const { user } = useAuth();
  const isEditing = !!objectId && objectId !== 'new';

  const [isLoading, setIsLoading] = useState(isEditing);
  const [isSaving, setIsSaving] = useState(false);
  const [existingObject, setExistingObject] = useState<ObjectRecord | null>(null);

  // Metadata
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [agentDescription, setAgentDescription] = useState('');
  const [objectType, setObjectType] = useState<ObjectType>('json');
  const [status, setStatus] = useState<ObjectRecord['status']>('published');
  const [requiresAuth, setRequiresAuth] = useState(false);
  const [apiEnabled, setApiEnabled] = useState(true);
  const [shareEnabled, setShareEnabled] = useState(false);
  const [shareSlug, setShareSlug] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [tenantOptionsLoading, setTenantOptionsLoading] = useState(false);

  // Schema editor
  const [fields, setFields] = useState<EditorField[]>([]);
  const [schemaJsonInput, setSchemaJsonInput] = useState('');
  const [schemaParseResult, setSchemaParseResult] = useState<SchemaParseResult | null>(null);
  const [showSchemaJson, setShowSchemaJson] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Data editor (raw JSON)
  const [dataJson, setDataJson] = useState('{}');
  const [dataJsonError, setDataJsonError] = useState<string | null>(null);
  const [dataMode, setDataMode] = useState<'form' | 'json'>('form');
  const [dataIsListMode, setDataIsListMode] = useState(false);
  const [dataRows, setDataRows] = useState<Record<string, unknown>[]>([{}]);
  const [markdownBlocks, setMarkdownBlocks] = useState<ContentBlock[]>([]);

  const slugManualRef = useRef(false);
  const shareSlugManualRef = useRef(false);

  useEffect(() => {
    const loadTenantOptions = async () => {
      try {
        setTenantOptionsLoading(true);
        const options = await getTenantOptions();
        setTenantOptions(options);
        setTenantId((current) => pickInitialTenantId(options, current));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to load workspaces.');
      } finally {
        setTenantOptionsLoading(false);
      }
    };

    void loadTenantOptions();
  }, []);

  // Load existing object when editing
  useEffect(() => {
    if (!isEditing || !objectId) return;

    const load = async () => {
      try {
        const obj = await getObject(objectId);
        setExistingObject(obj);
        setName(obj.name);
        setSlug(obj.slug);
        setDescription(obj.description ?? '');
        setAgentDescription(obj.agent_description ?? '');
        setObjectType(obj.object_type ?? 'json');
        setStatus(obj.status);
        setRequiresAuth(obj.requires_auth);
        setApiEnabled(obj.api_enabled);
        setShareEnabled(Boolean(obj.share_enabled));
        setShareSlug(obj.share_slug ?? '');
        setTenantId(obj.tenant_id ?? '');
        setFields(schemaToFields(obj.schema as Record<string, unknown>));
        const loadedData = obj.data as Record<string, unknown> | unknown[] | MarkdownObjectData;
        if ((obj.object_type ?? 'json') === 'markdown' && isMarkdownObjectData(loadedData)) {
          setDataIsListMode(false);
          setDataRows([loadedData.metadata]);
          setDataJson(JSON.stringify(loadedData.metadata, null, 2));
          setMarkdownBlocks(loadedData.content);
        } else if (Array.isArray(loadedData)) {
          setDataIsListMode(true);
          setDataRows(loadedData as Record<string, unknown>[]);
          setDataJson(JSON.stringify(loadedData, null, 2));
          setMarkdownBlocks([]);
        } else {
          setDataIsListMode(false);
          setDataRows([loadedData as Record<string, unknown>]);
          setDataJson(JSON.stringify(loadedData, null, 2));
          setMarkdownBlocks([]);
        }
        slugManualRef.current = true;
        shareSlugManualRef.current = true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to load object.');
        navigate('/objects');
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [isEditing, objectId, navigate]);

  // Auto-generate slug from name
  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugManualRef.current) {
      setSlug(generateObjectSlug(value));
    }
    if (!shareSlugManualRef.current) {
      setShareSlug(generateObjectSlug(value));
    }
  };

  const handleSlugChange = (value: string) => {
    setSlug(value);
    slugManualRef.current = true;
  };

  const handleShareSlugChange = (value: string) => {
    setShareSlug(value);
    shareSlugManualRef.current = true;
  };

  useEffect(() => {
    if (objectType !== 'markdown' || !dataIsListMode) {
      return;
    }

    const single = dataRows[0] ?? {};
    setDataIsListMode(false);
    setDataRows([single]);
    setDataJson(JSON.stringify(single, null, 2));
  }, [objectType, dataIsListMode, dataRows]);

  // Schema JSON import
  const handleSchemaJsonImport = () => {
    const result = parseSchemaJson(schemaJsonInput);
    setSchemaParseResult(result);
    if (result.valid && result.fields.length > 0) {
      setFields(result.fields);
      toast.success(
        language === 'en'
          ? `Imported ${result.fields.length} field(s).`
          : `${result.fields.length} Feld(er) importiert.`,
      );
    }
  };

  // Data JSON validation
  const handleDataJsonChange = (value: string) => {
    setDataJson(value);
    try {
      JSON.parse(value);
      setDataJsonError(null);
    } catch (e) {
      setDataJsonError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  const handleDataRowsChange = (rows: Record<string, unknown>[]) => {
    setDataRows(rows);
    const data = dataIsListMode ? rows : (rows[0] ?? {});
    setDataJson(JSON.stringify(data, null, 2));
    setDataJsonError(null);
  };

  const handleSwitchToForm = () => {
    try {
      const parsed = JSON.parse(dataJson) as unknown;
      if (typeof parsed !== 'object' || parsed === null) {
        toast.error(language === 'en' ? 'Fix JSON errors first.' : 'Zuerst JSON-Fehler beheben.');
        return;
      }
      if (objectType === 'markdown' && Array.isArray(parsed)) {
        toast.error(
          language === 'en'
            ? 'Markdown object metadata must be a JSON object.'
            : 'Markdown-Objekt-Metadaten müssen ein JSON-Objekt sein.',
        );
        return;
      }
      if (Array.isArray(parsed)) {
        setDataIsListMode(true);
        setDataRows(parsed as Record<string, unknown>[]);
      } else {
        setDataIsListMode(false);
        setDataRows([parsed as Record<string, unknown>]);
      }
      setDataMode('form');
      setDataJsonError(null);
    } catch {
      toast.error(
        language === 'en'
          ? 'Fix JSON errors before switching to form mode.'
          : 'Zuerst JSON-Fehler beheben, bevor du zum Formular wechselst.',
      );
    }
  };

  const handleDataShapeChange = (newListMode: boolean) => {
    if (objectType === 'markdown' && newListMode) {
      return;
    }

    setDataIsListMode(newListMode);
    if (newListMode) {
      setDataJson(JSON.stringify(dataRows.length > 0 ? dataRows : [{}], null, 2));
    } else {
      const single = dataRows[0] ?? {};
      setDataRows([single]);
      setDataJson(JSON.stringify(single, null, 2));
    }
    setDataJsonError(null);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(language === 'en' ? 'Name is required.' : 'Name ist erforderlich.');
      return;
    }
    if (!slug.trim()) {
      toast.error(language === 'en' ? 'Slug is required.' : 'Slug ist erforderlich.');
      return;
    }
    if (tenantOptions.length > 0 && !tenantId) {
      toast.error(language === 'en' ? 'Select a workspace first.' : 'Bitte zuerst einen Workspace auswählen.');
      return;
    }

    let parsedData: Record<string, unknown> | unknown[];
    try {
      const raw = JSON.parse(dataJson) as unknown;
      if (typeof raw !== 'object' || raw === null) {
        throw new Error(
          language === 'en'
            ? 'Data must be a JSON object or array.'
            : 'Daten müssen ein JSON-Objekt oder Array sein.',
        );
      }
      if (objectType === 'markdown' && Array.isArray(raw)) {
        throw new Error(
          language === 'en'
            ? 'Markdown object metadata must be a JSON object.'
            : 'Markdown-Objekt-Metadaten müssen ein JSON-Objekt sein.',
        );
      }
      parsedData = raw as Record<string, unknown> | unknown[];
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invalid data JSON.');
      return;
    }

    const schema = fieldsToSchema(fields);

    const payload = {
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim() || undefined,
      agent_description: agentDescription.trim() || undefined,
      object_type: objectType,
      schema,
      data: objectType === 'markdown'
        ? { metadata: parsedData as Record<string, unknown>, content: markdownBlocks }
        : parsedData,
      status,
      requires_auth: requiresAuth,
      api_enabled: apiEnabled,
      share_enabled: objectType === 'markdown' ? shareEnabled : false,
      share_slug: objectType === 'markdown' && shareEnabled ? (shareSlug.trim() || slug.trim()) : null,
      tenant_id: tenantId || null,
    };

    try {
      setIsSaving(true);
      if (isEditing && existingObject) {
        await updateObject(existingObject.id, payload);
        toast.success(language === 'en' ? 'Object saved.' : 'Objekt gespeichert.');
      } else {
        const created = await createObject(payload);

        // Trigger afterCreate hook for KB auto sync
        if (created?.id) {
          try {
            const { getPluginHooks } = await import('@/plugins/loader');
            const hooks = getPluginHooks('knowledgeBase.entity.afterCreate', user?.roles || []);
            const context = {
              entityType: 'object',
              entityId: created.id,
              tenantId: tenantId || null,
            };
            for (const hook of hooks) {
              try {
                await hook.handler(context);
              } catch (hErr) {
                console.error('Error running afterCreate hook:', hErr);
              }
            }
          } catch (hookErr) {
            console.error('Failed to run afterCreate hooks:', hookErr);
          }
        }

        toast.success(language === 'en' ? 'Object created.' : 'Objekt erstellt.');
        navigate(`/objects/${created.id}`, { replace: true });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save object.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <AdminPageLayout
        title={language === 'en' ? 'Loading…' : 'Lade…'}
        icon={Box}
      >
        <AdminCard className="flex min-h-[280px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </AdminCard>
      </AdminPageLayout>
    );
  }

  const previewSchema = fieldsToSchema(fields);

  return (
    <AdminPageLayout
      title={isEditing ? name || (language === 'en' ? 'Edit Object' : 'Objekt bearbeiten') : (language === 'en' ? 'New Object' : 'Neues Objekt')}
      description={
        language === 'en'
          ? 'Define the schema and fill in the data for this object.'
          : 'Definiere das Schema und befülle die Daten für dieses Objekt.'
      }
      icon={Box}
      actions={(
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/objects')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {language === 'en' ? 'Back' : 'Zurück'}
          </Button>
          <Button onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {language === 'en' ? 'Save' : 'Speichern'}
          </Button>
        </div>
      )}
    >
      <div className="space-y-6">
        {/* ── Metadata ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {language === 'en' ? 'Object Details' : 'Objektdetails'}
            </CardTitle>
            <CardDescription>
              {language === 'en'
                ? 'Name, type, slug, and description of this object.'
                : 'Name, Typ, Slug und Beschreibung dieses Objekts.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="obj-name">
                  {language === 'en' ? 'Name' : 'Name'} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="obj-name"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder={language === 'en' ? 'e.g. Service Prices' : 'z.B. Dienstleistungspreise'}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{language === 'en' ? 'Object Type' : 'Objekttyp'}</Label>
                <Select value={objectType} onValueChange={(value) => setObjectType(value as ObjectType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="json">JSON Object</SelectItem>
                    <SelectItem value="markdown">Markdown Object</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="obj-slug">
                  Slug <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="obj-slug"
                  value={slug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  placeholder="service-prices"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="obj-agent-description">
                  {language === 'en' ? 'Agent Description' : 'Agenten-Beschreibung'}
                </Label>
                <Textarea
                  id="obj-agent-description"
                  value={agentDescription}
                  onChange={(e) => setAgentDescription(e.target.value)}
                  rows={2}
                  placeholder={
                    language === 'en'
                      ? 'Context for agents and API consumers...'
                      : 'Kontext für Agenten und API-Konsumenten...'
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="obj-description">
                {language === 'en' ? 'Description' : 'Beschreibung'}
              </Label>
              <Textarea
                id="obj-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder={
                  language === 'en'
                    ? 'What is this object used for?'
                    : 'Wofür wird dieses Objekt verwendet?'
                }
              />
              {isEditing && existingObject && (
                <EntityActionsRow
                  entityType="object"
                  entityId={existingObject.id}
                  tenantId={tenantId}
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label>{language === 'en' ? 'Workspace' : 'Workspace'}</Label>
              <Select value={tenantId} onValueChange={setTenantId} disabled={tenantOptionsLoading || tenantOptions.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder={language === 'en' ? 'Select workspace...' : 'Workspace auswählen...'} />
                </SelectTrigger>
                <SelectContent>
                  {tenantOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}{option.is_default ? (language === 'en' ? ' (default)' : ' (Standard)') : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {language === 'en'
                  ? 'Objects stay readable and editable for members of the assigned tenant via RLS and MCP.'
                  : 'Objekte bleiben fuer Mitglieder des zugewiesenen Tenants ueber RLS und MCP lesbar und bearbeitbar.'}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ── Access Settings ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {language === 'en' ? 'Access & Status' : 'Zugriff & Status'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>{language === 'en' ? 'Status' : 'Status'}</Label>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as ObjectRecord['status'])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="published">
                      {language === 'en' ? 'Published' : 'Veröffentlicht'}
                    </SelectItem>
                    <SelectItem value="archived">
                      {language === 'en' ? 'Archived' : 'Archiviert'}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Switch
                  id="api-enabled"
                  checked={apiEnabled}
                  onCheckedChange={setApiEnabled}
                />
                <Label htmlFor="api-enabled" className="flex items-center gap-1.5 cursor-pointer">
                  {language === 'en' ? 'API enabled' : 'API aktiviert'}
                </Label>
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Switch
                  id="requires-auth"
                  checked={requiresAuth}
                  onCheckedChange={setRequiresAuth}
                />
                <Label htmlFor="requires-auth" className="flex items-center gap-1.5 cursor-pointer">
                  {requiresAuth ? (
                    <Lock className="h-3.5 w-3.5" />
                  ) : (
                    <Unlock className="h-3.5 w-3.5" />
                  )}
                  {language === 'en' ? 'Require Auth JWT' : 'Auth JWT erforderlich'}
                </Label>
              </div>
            </div>
            {objectType === 'markdown' && (
              <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-center">
                <div className="flex items-center gap-3 pt-1">
                  <Switch
                    id="share-enabled"
                    checked={shareEnabled}
                    onCheckedChange={setShareEnabled}
                  />
                  <Label htmlFor="share-enabled" className="cursor-pointer">
                    {language === 'en' ? 'Enable share page' : 'Share-Seite aktivieren'}
                  </Label>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="share-slug">Share Slug</Label>
                  <Input
                    id="share-slug"
                    value={shareSlug}
                    onChange={(e) => handleShareSlugChange(e.target.value)}
                    disabled={!shareEnabled}
                    placeholder="team-handbook"
                    className="font-mono text-sm"
                  />
                </div>
              </div>
            )}
            {apiEnabled && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle className="text-sm">
                  {language === 'en' ? 'API endpoint' : 'API-Endpunkt'}
                </AlertTitle>
                <AlertDescription className="font-mono text-xs">
                  GET /api/objects/{slug || '<slug>'}
                </AlertDescription>
              </Alert>
            )}
            {objectType === 'markdown' && shareEnabled && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle className="text-sm">
                  {language === 'en' ? 'Share page' : 'Share-Seite'}
                </AlertTitle>
                <AlertDescription className="font-mono text-xs">
                  /objects/share/&lt;tenant&gt;/{shareSlug || slug || '<share-slug>'}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* ── Schema Editor ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  {language === 'en' ? '📐 Schema Definition' : '📐 Schema-Definition'}
                </CardTitle>
                <CardDescription>
                  {language === 'en'
                    ? objectType === 'markdown'
                      ? 'Define metadata fields for this markdown document. Fields are used for documentation and agent-facing structure.'
                      : 'Define the structure of your data object. Fields are used for documentation and validation.'
                    : objectType === 'markdown'
                      ? 'Definiere Metadaten-Felder für dieses Markdown-Dokument. Felder dienen der Dokumentation und der agentensichtbaren Struktur.'
                      : 'Definiere die Struktur deines Datenobjekts. Felder dienen der Dokumentation und Validierung.'}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPreview(!showPreview)}
                >
                  <FileJson className="mr-1.5 h-3.5 w-3.5" />
                  {showPreview
                    ? language === 'en' ? 'Hide JSON' : 'JSON ausblenden'
                    : language === 'en' ? 'Preview JSON' : 'JSON vorschau'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSchemaJson(!showSchemaJson)}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  {language === 'en' ? 'Import JSON' : 'JSON importieren'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* JSON Import Panel */}
            {showSchemaJson && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
                <Label className="text-sm font-medium">
                  {language === 'en' ? 'Paste Schema JSON' : 'Schema-JSON einfügen'}
                </Label>
                <Textarea
                  value={schemaJsonInput}
                  onChange={(e) => setSchemaJsonInput(e.target.value)}
                  placeholder={`{\n  "name": { "type": "string", "required": true },\n  "price": { "type": "price", "required": true },\n  "description": { "type": "string" }\n}`}
                  className="font-mono text-xs min-h-[160px] resize-y"
                  rows={8}
                />
                {schemaParseResult && (
                  <div className="space-y-1">
                    {schemaParseResult.valid ? (
                      <Alert>
                        <CheckCircle2 className="h-4 w-4" />
                        <AlertTitle className="text-sm">
                          {language === 'en' ? 'Valid schema' : 'Gültiges Schema'}
                        </AlertTitle>
                        <AlertDescription className="text-xs">
                          {schemaParseResult.fields.length}{' '}
                          {language === 'en' ? 'field(s) imported.' : 'Feld(er) importiert.'}
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle className="text-sm">
                          {language === 'en' ? 'Invalid schema' : 'Ungültiges Schema'}
                        </AlertTitle>
                        <AlertDescription>
                          <ul className="text-xs list-disc pl-4 space-y-0.5 mt-1">
                            {schemaParseResult.errors.map((err, i) => (
                              <li key={i}>{err}</li>
                            ))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}
                <Button size="sm" onClick={handleSchemaJsonImport} disabled={!schemaJsonInput.trim()}>
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  {language === 'en' ? 'Import & replace fields' : 'Importieren & Felder ersetzen'}
                </Button>
              </div>
            )}

            {/* JSON Preview */}
            {showPreview && (
              <div className="rounded-lg border bg-muted/30 p-4">
                <Label className="text-xs text-muted-foreground mb-2 block">
                  {language === 'en' ? 'Generated schema JSON' : 'Generiertes Schema-JSON'}
                </Label>
                <pre className="text-xs font-mono overflow-auto max-h-64 whitespace-pre-wrap">
                  {JSON.stringify(previewSchema, null, 2)}
                </pre>
              </div>
            )}

            <Separator />

            {/* Field list */}
            <div className="space-y-3">
              {fields.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {language === 'en'
                    ? 'No fields defined yet. Add a field or import a schema JSON.'
                    : 'Noch keine Felder definiert. Füge ein Feld hinzu oder importiere ein Schema-JSON.'}
                </p>
              )}
              {fields.map((field) => (
                <FieldEditor
                  key={field.editorId}
                  field={field}
                  onChange={(updated) =>
                    setFields(fields.map((f) => (f.editorId === field.editorId ? updated : f)))
                  }
                  onRemove={() =>
                    setFields(fields.filter((f) => f.editorId !== field.editorId))
                  }
                />
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFields([...fields, emptyField()])}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {language === 'en' ? 'Add field' : 'Feld hinzufügen'}
            </Button>
          </CardContent>
        </Card>

        {/* ── Data Editor ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-base">
                  {language === 'en' ? '📦 Data' : '📦 Daten'}
                </CardTitle>
                <CardDescription>
                  {language === 'en'
                    ? objectType === 'markdown'
                      ? 'Fill in metadata for this markdown document based on the schema defined above.'
                      : 'Fill in the data for this object based on the schema defined above.'
                    : objectType === 'markdown'
                      ? 'Befülle die Metadaten dieses Markdown-Dokuments anhand des oben definierten Schemas.'
                      : 'Befülle die Daten dieses Objekts anhand des oben definierten Schemas.'}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {/* Form / JSON toggle */}
                <div className="flex rounded-md border overflow-hidden text-xs">
                  <button
                    type="button"
                    onClick={handleSwitchToForm}
                    className={`px-3 py-1.5 transition-colors ${
                      dataMode === 'form'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    {language === 'en' ? 'Form' : 'Formular'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDataMode('json')}
                    className={`px-3 py-1.5 transition-colors border-l ${
                      dataMode === 'json'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    JSON
                  </button>
                </div>
                {/* Single / List toggle (form mode only) */}
                {dataMode === 'form' && objectType !== 'markdown' && (
                  <div className="flex rounded-md border overflow-hidden text-xs">
                    <button
                      type="button"
                      onClick={() => handleDataShapeChange(false)}
                      className={`px-3 py-1.5 transition-colors ${
                        !dataIsListMode
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background hover:bg-muted text-muted-foreground'
                      }`}
                    >
                      {language === 'en' ? 'Single' : 'Einzeln'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDataShapeChange(true)}
                      className={`px-3 py-1.5 transition-colors border-l ${
                        dataIsListMode
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background hover:bg-muted text-muted-foreground'
                      }`}
                    >
                      {language === 'en' ? 'List' : 'Liste'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {dataMode === 'form' ? (
              <DataFormEditor
                fields={fields}
                rows={dataRows}
                isListMode={dataIsListMode}
                onRowsChange={handleDataRowsChange}
                language={language}
              />
            ) : (
              <>
                {dataJsonError && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle className="text-sm">
                      {language === 'en' ? 'Invalid JSON' : 'Ungültiges JSON'}
                    </AlertTitle>
                    <AlertDescription className="text-xs">{dataJsonError}</AlertDescription>
                  </Alert>
                )}
                <Textarea
                  value={dataJson}
                  onChange={(e) => handleDataJsonChange(e.target.value)}
                  className="font-mono text-xs min-h-[280px] resize-y"
                  rows={14}
                  placeholder={`[\n  { "leistung": "Web Dev", "aufwand": 60, "price": 150 }\n]`}
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  {language === 'en'
                    ? objectType === 'markdown'
                      ? 'Paste or type any valid JSON object for document metadata. The saved payload also includes the content blocks below.'
                      : 'Paste or type any valid JSON object or array. This is what will be returned by the API.'
                    : objectType === 'markdown'
                      ? 'Füge ein gültiges JSON-Objekt für Dokument-Metadaten ein. Der gespeicherte Payload enthält zusätzlich die Content-Blöcke unten.'
                      : 'Füge ein gültiges JSON-Objekt oder Array ein. Dieses wird von der API zurückgegeben.'}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {objectType === 'markdown' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {language === 'en' ? '📝 Document Content' : '📝 Dokumentinhalt'}
              </CardTitle>
              <CardDescription>
                {language === 'en'
                  ? 'Build the shareable markdown object with page-builder content blocks.'
                  : 'Baue das teilbare Markdown-Objekt mit Page-Builder-Content-Blöcken auf.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ObjectContentBlocksEditor
                blocks={markdownBlocks}
                onChange={setMarkdownBlocks}
                addPrefix={slug || 'markdown-object'}
              />
            </CardContent>
          </Card>
        )}

        {/* ── Schema Type Reference ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Info className="h-4 w-4" />
              {language === 'en' ? 'Available field types' : 'Verfügbare Feldtypen'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {OBJECT_FIELD_TYPES.map((t) => (
                <Badge key={t} variant="secondary" className="font-mono text-xs">
                  {t}
                </Badge>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {language === 'en'
                ? 'Types like url, email, date, and price are semantic hints for consumers — they are stored and returned as strings or numbers in the data.'
                : 'Typen wie url, email, date und price sind semantische Hinweise für Konsumenten – sie werden als Strings oder Zahlen in den Daten gespeichert und zurückgegeben.'}
            </p>
          </CardContent>
        </Card>
      </div>
    </AdminPageLayout>
  );
};

export default ObjectEditor;
