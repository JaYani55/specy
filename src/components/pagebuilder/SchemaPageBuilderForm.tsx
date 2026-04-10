import React, { useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Save, Eye, Loader2, ExternalLink, Plus, Trash2, ChevronDown, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { savePage, triggerRevalidation } from '@/services/pageService';
import type { PageRecord, PageSchema, SchemaFieldDefinition, ContentBlock, CodeBlockItem } from '@/types/pagebuilder';
import { StandaloneContentBlockEditor } from './StandaloneContentBlockEditor';
import { ImageUploader } from './ImageUploader';
import { JsonImporter } from './JsonImporter';

// ─── Utilities ────────────────────────────────────────────────────────────────

const generateSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const generateBlockId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const createDefaultBlock = (type: ContentBlock['type'], prefix: string): ContentBlock => {
  const id = generateBlockId(prefix);
  switch (type) {
    case 'text':    return { id, type: 'text', content: '' };
    case 'heading': return { id, type: 'heading', content: '', level: 'heading2' };
    case 'image':   return { id, type: 'image', src: '', alt: '', width: 800, height: 600 };
    case 'quote':   return { id, type: 'quote', text: '' };
    case 'list':    return { id, type: 'list', style: 'unordered', items: [] };
    case 'video':   return { id, type: 'video', src: '', provider: 'youtube' };
    case 'form':    return { id, type: 'form', form_id: '', form_slug: '', form_name: '' };
  }
};

const createDefaultCodeBlock = (prefix: string): CodeBlockItem => ({
  id: generateBlockId(`${prefix}-code`),
  label: '',
  language: '',
  pattern: '',
  frameworks: [],
  code: '',
});

const createSchemaFieldDefinition = (
  name: string,
  value: Record<string, unknown>,
): SchemaFieldDefinition => {
  const field: SchemaFieldDefinition = {
    name,
    type: (value.type as SchemaFieldDefinition['type']) || 'string',
    description: (value.description as string) || undefined,
    placeholder: (value.placeholder as string) || undefined,
    meta_description: (value.meta_description as string) || undefined,
    required: (value.required as boolean) || false,
  };

  if (value.enum) {
    field.enum = value.enum as string[];
  }

  if (value.properties && typeof value.properties === 'object') {
    field.properties = parseSchemaFields(value.properties as Record<string, unknown>);
  }

  if (value.items && typeof value.items === 'object') {
    field.items = createSchemaFieldDefinition('item', value.items as Record<string, unknown>);
  }

  return field;
};

/** Parse schema.schema (flat JSON object with type+required+etc.) into SchemaFieldDefinition[] */
const parseSchemaFields = (schemaObj: Record<string, unknown>): SchemaFieldDefinition[] => {
  const fields: SchemaFieldDefinition[] = [];
  for (const [name, value] of Object.entries(schemaObj)) {
    fields.push(createSchemaFieldDefinition(name, value as Record<string, unknown>));
  }
  return fields;
};

/** Build initial form data from schema fields */
const buildInitialData = (fields: SchemaFieldDefinition[]): Record<string, unknown> => {
  const defaults: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type === 'ContentBlock[]' || field.type === 'CodeBlock[]' || field.type === 'array') defaults[field.name] = [];
    else if (field.type === 'object') defaults[field.name] = {};
    else if (field.type === 'boolean') defaults[field.name] = false;
    else if (field.type === 'number') defaults[field.name] = 0;
    else defaults[field.name] = ''; // covers 'string' and 'media'
  }
  return defaults;
};

// ─── ContentBlocks Editor ─────────────────────────────────────────────────────

interface ContentBlocksEditorProps {
  fieldName: string;
  blocks: ContentBlock[];
  onChange: (blocks: ContentBlock[]) => void;
}

const ContentBlocksEditor: React.FC<ContentBlocksEditorProps> = ({ fieldName, blocks, onChange }) => {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Requires moving 5px before drag starts to not interfere with clicks
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = blocks.findIndex((b) => b.id === active.id);
      const newIndex = blocks.findIndex((b) => b.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        onChange(arrayMove(blocks, oldIndex, newIndex));
      }
    }
  };

  const addBlock = (type: ContentBlock['type']) =>
    onChange([...blocks, createDefaultBlock(type, fieldName)]);

  const updateBlock = (idx: number, updated: ContentBlock) => {
    const next = [...blocks];
    next[idx] = updated;
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      >
        <SortableContext
          items={blocks.map((b) => b.id)}
          strategy={verticalListSortingStrategy}
        >
          {blocks.map((block, idx) => (
            <StandaloneContentBlockEditor
              key={block.id}
              block={block}
              onChange={(b) => updateBlock(idx, b)}
              onRemove={() => onChange(blocks.filter((_, i) => i !== idx))}
            />
          ))}
        </SortableContext>
      </DndContext>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="outline" className="w-full border-dashed">
            <Plus className="h-4 w-4 mr-2" />
            Content-Block hinzufügen
            <ChevronDown className="h-4 w-4 ml-auto" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          {(['text', 'heading', 'image', 'quote', 'list', 'video', 'form'] as ContentBlock['type'][]).map((t) => (
            <DropdownMenuItem key={t} onClick={() => addBlock(t)}>
              {t === 'text'    && '📝 '}
              {t === 'heading' && '📋 '}
              {t === 'image'   && '🖼️ '}
              {t === 'quote'   && '💬 '}
              {t === 'list'    && '📄 '}
              {t === 'video'   && '🎥 '}
              {t === 'form'    && '🧾 '}
              {t.charAt(0).toUpperCase() + t.slice(1)} Block
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

interface CodeBlocksEditorProps {
  field: SchemaFieldDefinition;
  blocks: CodeBlockItem[];
  onChange: (blocks: CodeBlockItem[]) => void;
}

const CodeBlocksEditor: React.FC<CodeBlocksEditorProps> = ({ field, blocks, onChange }) => {
  const properties = field.items?.properties || [];
  const getProperty = (propertyName: string): SchemaFieldDefinition | undefined =>
    properties.find((property) => property.name === propertyName);

  const labelField = getProperty('label');
  const languageField = getProperty('language');
  const patternField = getProperty('pattern');
  const frameworksField = getProperty('frameworks');
  const codeField = getProperty('code');
  const extraFields = properties.filter(
    (property) => !['label', 'language', 'pattern', 'frameworks', 'code'].includes(property.name),
  );
  const frameworkOptions = frameworksField?.items?.enum || [];

  const updateBlock = (index: number, update: Partial<CodeBlockItem> & Record<string, unknown>) => {
    const next = [...blocks];
    next[index] = { ...next[index], ...update };
    onChange(next);
  };

  const toggleFramework = (index: number, framework: string, checked: boolean) => {
    const current = blocks[index]?.frameworks || [];
    const nextFrameworks = checked
      ? Array.from(new Set([...current, framework]))
      : current.filter((entry) => entry !== framework);
    updateBlock(index, { frameworks: nextFrameworks });
  };

  const addBlock = () => onChange([...blocks, createDefaultCodeBlock(field.name)]);

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => (
        <Card key={block.id} className="p-4 space-y-4 bg-muted/20">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">💻</span>
              <div>
                <p className="text-sm font-semibold">
                  {block.label?.trim() || `Code-Variante ${index + 1}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(block.language || 'Sprache offen')}
                  {block.pattern ? ` · ${block.pattern}` : ''}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onChange(blocks.filter((_, blockIndex) => blockIndex !== index))}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Entfernen
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{labelField?.description || 'Label'}</Label>
              <Input
                value={block.label || ''}
                onChange={(event) => updateBlock(index, { label: event.target.value })}
                placeholder={labelField?.placeholder || 'z.B. Next.js Server Action'}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{languageField?.description || 'Sprache'}</Label>
              {languageField?.enum && languageField.enum.length > 0 ? (
                <Select
                  value={block.language || ''}
                  onValueChange={(language) => updateBlock(index, { language })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={languageField.placeholder || 'Sprache wählen...'} />
                  </SelectTrigger>
                  <SelectContent>
                    {languageField.enum.map((option) => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={block.language || ''}
                  onChange={(event) => updateBlock(index, { language: event.target.value })}
                  placeholder={languageField?.placeholder || 'z.B. typescript'}
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label>{patternField?.description || 'Pattern / Stil'}</Label>
              {patternField?.enum && patternField.enum.length > 0 ? (
                <Select
                  value={block.pattern || ''}
                  onValueChange={(pattern) => updateBlock(index, { pattern })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={patternField.placeholder || 'Pattern wählen...'} />
                  </SelectTrigger>
                  <SelectContent>
                    {patternField.enum.map((option) => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={block.pattern || ''}
                  onChange={(event) => updateBlock(index, { pattern: event.target.value })}
                  placeholder={patternField?.placeholder || 'z.B. React Hook'}
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label>{frameworksField?.description || 'Frameworks'}</Label>
              {frameworkOptions.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 rounded-lg border p-3 bg-muted/30">
                  {frameworkOptions.map((option) => (
                    <label key={option} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={(block.frameworks || []).includes(option)}
                        onCheckedChange={(checked) => toggleFramework(index, option, Boolean(checked))}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <Input
                  value={(block.frameworks || []).join(', ')}
                  onChange={(event) => updateBlock(index, {
                    frameworks: event.target.value
                      .split(',')
                      .map((entry) => entry.trim())
                      .filter(Boolean),
                  })}
                  placeholder={frameworksField?.placeholder || 'z.B. react, nextjs'}
                />
              )}
            </div>
          </div>

          {extraFields.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              {extraFields.map((property) => (
                <div key={property.name} className="space-y-1.5">
                  <Label className="flex items-center gap-1">
                    <span>{property.name}</span>
                    <Badge variant="outline" className="text-[10px] h-4 px-1 font-mono">{property.type}</Badge>
                  </Label>
                  <SchemaFieldRenderer
                    field={property}
                    value={(block as unknown as Record<string, unknown>)[property.name]}
                    onChange={(propertyValue) => updateBlock(index, { [property.name]: propertyValue })}
                    depth={1}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{codeField?.description || 'Code'}</Label>
            <Textarea
              value={block.code || ''}
              onChange={(event) => updateBlock(index, { code: event.target.value })}
              placeholder={codeField?.placeholder || 'Code hier einfügen...'}
              rows={12}
              className="font-mono text-sm"
            />
          </div>
        </Card>
      ))}

      <Button type="button" size="sm" variant="outline" className="w-full border-dashed" onClick={addBlock}>
        <Plus className="h-4 w-4 mr-2" />
        Code-Variante hinzufügen
      </Button>
    </div>
  );
};

// ─── Generic Schema Field Renderer ───────────────────────────────────────────

interface SchemaFieldRendererProps {
  field: SchemaFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  depth?: number;
}

const SchemaFieldRenderer: React.FC<SchemaFieldRendererProps> = ({
  field,
  value,
  onChange,
  depth = 0,
}) => {
  // media → ImageUploader
  if (field.type === 'media') {
    const nameLower = field.name.toLowerCase();
    const isAvatar =
      nameLower.includes('avatar') ||
      nameLower.includes('picture') ||
      nameLower.includes('photo') ||
      nameLower.includes('portrait') ||
      nameLower.includes('headshot') ||
      nameLower.includes('profile');
    return (
      <ImageUploader
        value={(value as string) || ''}
        onChange={(url) => onChange(url)}
        previewVariant={isAvatar ? 'avatar' : 'banner'}
        bucket="booking_media"
        folder="product-images"
      />
    );
  }

  // ContentBlock[] → content blocks editor
  if (field.type === 'ContentBlock[]') {
    const blocks = Array.isArray(value) ? (value as ContentBlock[]) : [];
    return (
      <ContentBlocksEditor fieldName={field.name} blocks={blocks} onChange={onChange} />
    );
  }

  // CodeBlock[] → code variants editor
  if (field.type === 'CodeBlock[]') {
    const blocks = Array.isArray(value) ? (value as CodeBlockItem[]) : [];
    return (
      <CodeBlocksEditor field={field} blocks={blocks} onChange={onChange} />
    );
  }

  // string with enum → Select
  if (field.type === 'string' && field.enum && field.enum.length > 0) {
    return (
      <Select value={(value as string) || ''} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={field.placeholder || `${field.name} wählen...`} />
        </SelectTrigger>
        <SelectContent>
          {field.enum.map((opt) => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // string → Input or Textarea (detect long-text from name/description)
  if (field.type === 'string') {
    const nameLower = field.name.toLowerCase();
    const descLower = (field.description || '').toLowerCase();
    const isLong =
      nameLower.includes('content') ||
      nameLower.includes('description') ||
      nameLower.includes('body') ||
      nameLower.includes('text') ||
      nameLower.includes('excerpt') ||
      descLower.includes('text') ||
      descLower.includes('beschreibung') ||
      descLower.includes('mehrzeilig');
    if (isLong) {
      return (
        <Textarea
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || field.description || `${field.name} eingeben...`}
          rows={4}
        />
      );
    }
    return (
      <Input
        value={(value as string) || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder || field.description || `${field.name} eingeben...`}
      />
    );
  }

  // number
  if (field.type === 'number') {
    return (
      <Input
        type="number"
        value={(value as number) ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        placeholder={field.placeholder || '0'}
      />
    );
  }

  // boolean
  if (field.type === 'boolean') {
    return (
      <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30">
        <Checkbox
          id={`field-bool-${field.name}-${depth}`}
          checked={(value as boolean) || false}
          onCheckedChange={(checked) => onChange(checked as boolean)}
        />
        <Label htmlFor={`field-bool-${field.name}-${depth}`} className="cursor-pointer">
          {field.placeholder || field.description || field.name}
        </Label>
      </div>
    );
  }

  // object → nested card
  if (field.type === 'object' && field.properties) {
    const obj = (value && typeof value === 'object' && !Array.isArray(value))
      ? (value as Record<string, unknown>)
      : {};
    return (
      <div className={`space-y-4 ${depth > 0 ? 'border-l-2 border-dashed border-muted pl-4 ml-1' : ''}`}>
        {field.properties.map((prop) => (
          <div key={prop.name} className="space-y-1.5">
            <Label className="text-sm font-medium flex items-center gap-1">
              {prop.name}
              {prop.required && <span className="text-destructive text-xs">*</span>}
              <Badge variant="outline" className="text-[10px] h-4 px-1 font-mono ml-1">{prop.type}</Badge>
            </Label>
            {prop.description && (
              <p className="text-xs text-muted-foreground">{prop.description}</p>
            )}
            <SchemaFieldRenderer
              field={prop}
              value={obj[prop.name]}
              onChange={(v) => onChange({ ...obj, [prop.name]: v })}
              depth={depth + 1}
            />
          </div>
        ))}
      </div>
    );
  }

  // array → repeatable items
  if (field.type === 'array') {
    const arr = Array.isArray(value) ? value : [];
    const itemType = field.items?.type || 'string';

    const addItem = () => {
      let defaultItem: unknown = '';
      if (itemType === 'number') defaultItem = 0;
      else if (itemType === 'boolean') defaultItem = false;
      else if (itemType === 'object') {
        const def: Record<string, unknown> = {};
        for (const p of field.items?.properties || []) {
          if (p.type === 'number') def[p.name] = 0;
          else if (p.type === 'boolean') def[p.name] = false;
          else def[p.name] = '';
        }
        defaultItem = def;
      }
      onChange([...arr, defaultItem]);
    };

    return (
      <div className="space-y-2">
        {arr.map((item, idx) => (
          <div key={idx} className="border rounded-lg p-3 space-y-2 bg-muted/20">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">
                {field.items?.type === 'object' ? `#${idx + 1}` : `Element ${idx + 1}`}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onChange(arr.filter((_, i) => i !== idx))}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            {field.items ? (
              <SchemaFieldRenderer
                field={{ ...field.items, name: `${field.name}[${idx}]` }}
                value={item}
                onChange={(v) => {
                  const next = [...arr];
                  next[idx] = v;
                  onChange(next);
                }}
                depth={depth + 1}
              />
            ) : (
              <Input
                value={(item as string) || ''}
                onChange={(e) => {
                  const next = [...arr];
                  next[idx] = e.target.value;
                  onChange(next);
                }}
                placeholder={field.placeholder || `Wert ${idx + 1}...`}
              />
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full border-dashed"
          onClick={addItem}
        >
          <Plus className="h-4 w-4 mr-2" />
          {itemType === 'object' ? `${field.name}-Eintrag hinzufügen` : 'Element hinzufügen'}
        </Button>
      </div>
    );
  }

  // Fallback
  return (
    <Input
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder || `${field.name}...`}
    />
  );
};

// ─── Field-Icon helper ────────────────────────────────────────────────────────

const SECTION_ICONS: Record<string, string> = {
  hero: '🦸', cta: '📢', faq: '❓', cards: '📇', features: '⭐',
  author: '👤', meta: '⚙️', content: '📝', cover: '🖼️',
  title: '✏️', description: '📄', slug: '🔗', tags: '🏷️',
  date: '📅', category: '📁', image: '🖼️', video: '🎥', name: '📋',
};

const fieldIcon = (name: string): string => {
  const lower = name.toLowerCase();
  for (const [key, icon] of Object.entries(SECTION_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return '📋';
};

// ─── Main Component ───────────────────────────────────────────────────────────

interface SchemaPageBuilderFormProps {
  schema: PageSchema;
  schemaSlug: string;
  pageId?: string;
  initialData?: Record<string, unknown> | null;
  initialName?: string;
  initialSlug?: string;
  initialStatus?: PageRecord['status'];
}

export const SchemaPageBuilderForm: React.FC<SchemaPageBuilderFormProps> = ({
  schema,
  schemaSlug,
  pageId,
  initialData,
  initialName,
  initialSlug,
  initialStatus,
}) => {
  const fields = parseSchemaFields(schema.schema as Record<string, unknown>);
  const requiredFields = fields.filter((f) => f.required);
  const optionalFields = fields.filter((f) => !f.required);

  // ── Form state
  const [pageName, setPageName]           = useState(initialName || '');
  const [pageSlug, setPageSlug]           = useState(() => (initialSlug || (initialName ? generateSlug(initialName) : '')));
  const [slugEdited, setSlugEdited]       = useState(false);
  const [formData, setFormData]           = useState<Record<string, unknown>>(() =>
    initialData ? { ...initialData } : buildInitialData(fields)
  );

  // Track which optional fields are active.
  // On edit, activate any optional field that has non-empty initial data.
  const [activeOptional, setActiveOptional] = useState<Set<string>>(() => {
    if (!initialData) return new Set();
    const active = new Set<string>();
    for (const f of optionalFields) {
      const v = (initialData as Record<string, unknown>)[f.name];
      const isEmpty =
        v === undefined || v === null || v === '' || v === false || v === 0 ||
        (Array.isArray(v) && v.length === 0) ||
        (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);
      if (!isEmpty) active.add(f.name);
    }
    return active;
  });

  // ── Save state
  const [isSaving, setIsSaving]                 = useState(false);
  const [savedSlug, setSavedSlug]               = useState<string | null>(null);
  const [revalResult, setRevalResult]           = useState<{ success: boolean; message: string } | null>(null);

  // ── Helpers
  const updateField = useCallback((name: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleNameChange = (name: string) => {
    setPageName(name);
    if (!slugEdited) setPageSlug(generateSlug(name));
  };

  const handleSlugChange = (slug: string) => {
    setPageSlug(slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'));
    setSlugEdited(true);
  };

  const addOptionalField = (fieldName: string) =>
    setActiveOptional((prev) => new Set([...prev, fieldName]));

  const removeOptionalField = (fieldName: string) => {
    setActiveOptional((prev) => {
      const next = new Set(prev);
      next.delete(fieldName);
      return next;
    });
    // Reset the field value to its empty default
    const f = optionalFields.find((x) => x.name === fieldName);
    if (f) {
      let empty: unknown = '';
      if (f.type === 'ContentBlock[]' || f.type === 'CodeBlock[]' || f.type === 'array') empty = [];
      else if (f.type === 'object') empty = {};
      else if (f.type === 'boolean') empty = false;
      else if (f.type === 'number') empty = 0;
      updateField(fieldName, empty);
    }
  };

  const inactiveOptional = optionalFields.filter((f) => !activeOptional.has(f.name));

  // ── JSON import handler
  const handleJsonImport = useCallback((data: Record<string, unknown>) => {
    setFormData((prev) => ({ ...prev, ...data }));
    // Activate any optional field that received non-empty data
    const newActive = new Set(activeOptional);
    for (const f of optionalFields) {
      if (!(f.name in data)) continue;
      const v = data[f.name];
      const isEmpty =
        v === undefined || v === null || v === '' || v === false || v === 0 ||
        (Array.isArray(v) && v.length === 0) ||
        (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);
      if (!isEmpty) newActive.add(f.name);
    }
    setActiveOptional(newActive);
  }, [activeOptional, optionalFields]);

  // ── Save handler
  const handleSave = async () => {
    if (!pageName.trim()) {
      toast.error('Seitenname ist erforderlich.');
      return;
    }
    setIsSaving(true);
    setRevalResult(null);
    try {
      // Build content — only include active fields
      const content: Record<string, unknown> = {};
      for (const f of requiredFields) {
        content[f.name] = formData[f.name];
      }
      for (const f of optionalFields) {
        if (activeOptional.has(f.name)) content[f.name] = formData[f.name];
      }

      const result = await savePage(pageId, content, pageName, schema.id, pageSlug);
      setSavedSlug(result.slug);
      toast.success(`Seite "${pageName}" gespeichert als /${result.slug}`);

      if (schema.registration_status === 'registered' && initialStatus === 'published' && result.slug) {
        try {
          const rev = await triggerRevalidation(schemaSlug, result.slug);
          setRevalResult(rev);
          if (rev.success) {
            toast.success(`ISR: /${result.slug} wurde revalidiert`);
          } else {
            toast.warning(`ISR-Revalidierung fehlgeschlagen: ${rev.message}`);
          }
        } catch {
          const msg = 'Konnte Revalidierungs-Endpunkt nicht erreichen';
          setRevalResult({ success: false, message: msg });
          toast.warning(`Seite gespeichert — ISR-Fehler: ${msg}`);
        }
      } else {
        setRevalResult(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler beim Speichern');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Build preview URL from schema config
  const previewUrl =
    savedSlug && schema.frontend_url
      ? `${schema.frontend_url.replace(/\/$/, '')}${(schema.slug_structure || '/:slug')
          .replace(':slug', savedSlug)
          .replace(/^([^/])/, '/$1')}`
      : null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-24">

      {/* ── Page Identity ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>📝</span>
            <span>Seiteninformationen</span>
          </CardTitle>
          <CardDescription>
            Schema: <strong>{schema.name}</strong>
            {schema.registration_status === 'registered' && schema.frontend_url && (
              <> · Domain: <a href={schema.frontend_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{schema.frontend_url.replace(/^https?:\/\//, '')}</a></>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="page-name" className="text-sm font-medium">
                Seitenname <span className="text-destructive">*</span>
              </Label>
              <Input
                id="page-name"
                value={pageName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="z.B. Über uns"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="page-slug" className="text-sm font-medium">
                URL-Slug
              </Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground shrink-0">/</span>
                <Input
                  id="page-slug"
                  value={pageSlug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  placeholder="url-slug"
                  className="font-mono text-sm"
                />
              </div>
              {schema.frontend_url ? (
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{schema.frontend_url.replace(/\/$/, '')}/{pageSlug}</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Wird automatisch aus dem Namen generiert
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Required Fields ───────────────────────────────── */}
      {requiredFields.length === 0 && optionalFields.length === 0 && (
        <Card className="border-dashed border-amber-300 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="py-8 text-center text-sm text-amber-700 dark:text-amber-400">
            Dieses Schema hat noch keine Felder definiert. Öffne den Schema-Editor um Felder hinzuzufügen.
          </CardContent>
        </Card>
      )}

      {requiredFields.map((field) => (
        <Card key={field.name}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <span>{fieldIcon(field.name)}</span>
              <span className="capitalize">{field.name.replace(/_/g, ' ')}</span>
              <Badge variant="destructive" className="text-[10px] h-4 px-1.5">Pflichtfeld</Badge>
              <Badge variant="outline" className="text-[10px] h-4 px-1 font-mono">{field.type}</Badge>
            </CardTitle>
            {field.description && (
              <CardDescription>{field.description}</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <SchemaFieldRenderer
              field={field}
              value={formData[field.name]}
              onChange={(v) => updateField(field.name, v)}
            />
          </CardContent>
        </Card>
      ))}

      {/* ── Active Optional Fields ────────────────────────── */}
      {optionalFields
        .filter((f) => activeOptional.has(f.name))
        .map((field) => (
          <Card key={field.name}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="space-y-1 flex-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span>{fieldIcon(field.name)}</span>
                    <span className="capitalize">{field.name.replace(/_/g, ' ')}</span>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Optional</Badge>
                    <Badge variant="outline" className="text-[10px] h-4 px-1 font-mono">{field.type}</Badge>
                  </CardTitle>
                  {field.description && (
                    <CardDescription>{field.description}</CardDescription>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive shrink-0 ml-2"
                  onClick={() => removeOptionalField(field.name)}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Entfernen
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <SchemaFieldRenderer
                field={field}
                value={formData[field.name]}
                onChange={(v) => updateField(field.name, v)}
              />
            </CardContent>
          </Card>
        ))}

      {/* ── Add Optional Fields ───────────────────────────── */}
      {inactiveOptional.length > 0 && (
        <Card className="border-dashed">
          <CardContent className="py-6">
            <div className="space-y-3 text-center">
              <p className="text-sm text-muted-foreground">
                {inactiveOptional.length} optionale{inactiveOptional.length !== 1 ? ' Felder' : 's Feld'} verfügbar — klicke um hinzuzufügen
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {inactiveOptional.map((field) => (
                  <Button
                    key={field.name}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => addOptionalField(field.name)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>{fieldIcon(field.name)}</span>
                    <span className="capitalize">{field.name.replace(/_/g, ' ')}</span>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1 font-mono ml-1">
                      {field.type}
                    </Badge>
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Save Feedback ─────────────────────────────────── */}
      {savedSlug && (
        <Alert
          className={
            revalResult?.success === false
              ? 'border-amber-500 bg-amber-50 dark:bg-amber-950'
              : 'border-green-500 bg-green-50 dark:bg-green-950'
          }
        >
          {revalResult?.success === false
            ? <AlertTriangle className="h-4 w-4 text-amber-600" />
            : <CheckCircle2 className="h-4 w-4 text-green-600" />
          }
          <AlertDescription className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-green-800 dark:text-green-200 font-medium">
                Seite gespeichert:{' '}
                <code className="font-mono text-sm bg-green-100 dark:bg-green-900 px-1.5 py-0.5 rounded">
                  /{savedSlug}
                </code>
              </span>
              {previewUrl ? (
                <Button variant="outline" size="sm" asChild>
                  <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="flex items-center">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Vorschau ansehen
                  </a>
                </Button>
              ) : (
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  Kein Frontend registriert — Vorschau nach Registrierung verfügbar.
                </span>
              )}
            </div>
            {schema.registration_status === 'registered' && revalResult && (
              <p
                className={`text-xs ${
                  revalResult.success
                    ? 'text-green-700 dark:text-green-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                ISR: {revalResult.message}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* ── Sticky Footer ─────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-t z-50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Schema: <span className="font-semibold">{schema.name}</span>
            {' '}—{' '}
            Seite: <span className="font-semibold">{pageName || 'Unbenannt'}</span>
            {schema.registration_status === 'registered' && (
              <Badge variant="default" className="ml-2 text-[10px]">ISR aktiv</Badge>
            )}
          </p>
            <JsonImporter fields={fields} onImport={handleJsonImport} />
          </div>
          <Button
            type="button"
            onClick={handleSave}
            size="lg"
            disabled={isSaving}
            className="min-w-[200px]"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Wird gespeichert...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Speichern
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
