import React, { useState, useCallback, useEffect } from 'react';
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
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@/contexts/ThemeContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import EntityActionsRow from '@/components/entity-actions/EntityActionsRow';
import { getSchema, savePage, triggerRevalidation } from '@/services/pageService';
import { setServiceProductPublication, updateServiceProduct, type ServiceProduct } from '@/services/productService';
import { setEventPagePublication, updateEventPage } from '@/services/events/eventPageService';
import type { PageRecord, PageSchema, SchemaFieldDefinition, ContentBlock, CodeBlockItem } from '@/types/pagebuilder';
import { StandaloneContentBlockEditor } from '@/components/pagebuilder/StandaloneContentBlockEditor';
import { ImageUploader } from '@/components/pagebuilder/ImageUploader';
import { JsonImporter } from './JsonImporter';
import { buildSchemaPageUrl, getExplicitPreviewSlugStructure } from '@/utils/schemaRouting';
import { PageContentTemplateControls } from './PageContentTemplateControls';
import { TenantCustomFieldsEditor } from '@/components/products/CustomFieldsEditor';
import { ProductEventsPanel } from '@/components/products/ProductEventsPanel';
import { ProductCustomFieldSchemaDialog } from '@/components/products/ProductCustomFieldSchemaDialog';
import type { TenantCustomFieldDefinitions } from '@/services/tenantCustomFieldsService';
import type { ProductCustomFieldSchema } from '@/services/productCustomFieldSchemaService';
import { validateTenantCustomFieldValues } from '@/utils/tenantCustomFields';
import { RevalidationFeedback } from '@/components/revalidation/RevalidationFeedback';
import type { RevalidationResult } from '@/services/pageService';
import { getSchemaConsolePath } from '@/utils/schemaPaths';
import { isCatalogueSchema } from '@/utils/schemaKinds';
import {
  buildSchemaContent,
  fieldValueTypeConflict,
  hasOwnKey,
  initializeSchemaContent,
  mergeSchemaContent,
} from '@/lib/schemaContent';
import { groupPresentedSchemaFields, humanizeSchemaFieldName, resolveSchemaEditorPresentation, type PageBuilderLanguage } from './editorPresentation';

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
    case 'audio':   return { id, type: 'audio', src: '', caption: '' };
  }
};

const stableBlockId = (block: ContentBlock, index: number): string =>
  typeof block?.id === 'string' && block.id ? block.id : `unidentified-${index}`;

const isEditableContentBlock = (value: unknown): value is ContentBlock => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const block = value as Record<string, unknown>;
  if (typeof block.id !== 'string' || typeof block.type !== 'string') return false;
  switch (block.type) {
    case 'text': return typeof block.content === 'string';
    case 'heading': return typeof block.content === 'string' && typeof block.level === 'string';
    case 'image': return typeof block.src === 'string' && typeof block.alt === 'string';
    case 'quote': return typeof block.text === 'string';
    case 'list': return (block.style === 'ordered' || block.style === 'unordered') && Array.isArray(block.items) && block.items.every((item) => typeof item === 'string');
    case 'video': return typeof block.src === 'string' && typeof block.provider === 'string';
    case 'form': return typeof block.form_id === 'string' && typeof block.form_slug === 'string' && typeof block.form_name === 'string';
    case 'audio': return typeof block.src === 'string';
    default: return false;
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
    nullable: value.nullable === true,
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
      const oldIndex = blocks.findIndex((block, index) => stableBlockId(block, index) === active.id);
      const newIndex = blocks.findIndex((block, index) => stableBlockId(block, index) === over.id);
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
          items={blocks.map((block, index) => stableBlockId(block, index))}
          strategy={verticalListSortingStrategy}
        >
          {blocks.map((block, idx) => isEditableContentBlock(block) ? (
            <StandaloneContentBlockEditor
              key={stableBlockId(block, idx)}
              sortableId={stableBlockId(block, idx)}
              block={block}
              onChange={(updated) => updateBlock(idx, updated)}
              onRemove={() => onChange(blocks.filter((_, i) => i !== idx))}
            />
          ) : (
            <Card key={stableBlockId(block, idx)} className="border-amber-500/60 bg-amber-50/40 dark:bg-amber-950/10">
              <CardContent className="space-y-3 p-4">
                <div className="text-sm font-medium">Unbekannter oder fehlerhafter Block bleibt unverändert erhalten.</div>
                <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(block, null, 2)}</pre>
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange(blocks.filter((_, i) => i !== idx))}>
                  <Trash2 className="h-4 w-4 mr-1" /> Entfernen
                </Button>
              </CardContent>
            </Card>
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
          {(['text', 'heading', 'image', 'quote', 'list', 'video', 'form', 'audio'] as ContentBlock['type'][]).map((t) => (
            <DropdownMenuItem key={t} onClick={() => addBlock(t)}>
              {t === 'text'    && '📝 '}
              {t === 'heading' && '📋 '}
              {t === 'image'   && '🖼️ '}
              {t === 'quote'   && '💬 '}
              {t === 'list'    && '📄 '}
              {t === 'video'   && '🎥 '}
              {t === 'form'    && '🧾 '}
              {t === 'audio'   && '🎵 '}
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
  language: PageBuilderLanguage;
}

const CodeBlocksEditor: React.FC<CodeBlocksEditorProps> = ({ field, blocks, onChange, language }) => {
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
                  <Label>{humanizeSchemaFieldName(property.name, language)}</Label>
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
  const { language } = useTheme();
  const { canManageAccounts } = usePermissions();
  const fieldLabel = humanizeSchemaFieldName(field.name, language);

  // media → ImageUploader
  if (fieldValueTypeConflict(field, value)) {
    let rawValue: string;
    try {
      rawValue = JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      rawValue = String(value);
    }
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription className="space-y-2">
          <p>{language === 'en'
            ? `The saved value for “${fieldLabel}” could not be edited with this field and was kept unchanged.`
            : `Der gespeicherte Wert für „${fieldLabel}“ passt nicht zu diesem Feld und wurde unverändert beibehalten.`}</p>
          {canManageAccounts ? (
            <details>
              <summary className="cursor-pointer text-sm">{language === 'en' ? 'Technical value details' : 'Technische Wertdetails'}</summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{rawValue}</pre>
            </details>
          ) : (
            <p>{language === 'en' ? 'Ask a technical administrator to review this field.' : 'Bitte eine technische Administration um Prüfung dieses Feldes.'}</p>
          )}
        </AlertDescription>
      </Alert>
    );
  }

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
      <CodeBlocksEditor field={field} blocks={blocks} onChange={onChange} language={language} />
    );
  }

  // string with enum → Select
  if (field.type === 'string' && field.enum && field.enum.length > 0) {
    return (
      <Select value={(value as string) || ''} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={field.placeholder || `${fieldLabel} wählen...`} />
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
          placeholder={field.placeholder || field.description || `${fieldLabel} eingeben...`}
          rows={4}
        />
      );
    }
    return (
      <Input
        value={(value as string) || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder || field.description || `${fieldLabel} eingeben...`}
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
          {field.placeholder || field.description || fieldLabel}
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
              {humanizeSchemaFieldName(prop.name, language)}
              {prop.required && <span className="text-destructive text-xs">*</span>}
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

interface SchemaContentEditorProps {
  schema: PageSchema;
  schemaSlug: string;
  pageId?: string;
  initialData?: Record<string, unknown> | null;
  initialName?: string;
  initialSlug?: string;
  initialStatus?: PageRecord['status'];
  productAggregateId?: string;
  productVersion?: number;
  initialProductCustomFields?: Record<string, unknown>;
  initialProductCustomFieldSchema?: ProductCustomFieldSchema;
  eventAggregateId?: string;
  eventProductId?: number;
  initialPageUpdatedAt?: string;
}

export const SchemaContentEditor: React.FC<SchemaContentEditorProps> = ({
  schema,
  schemaSlug,
  pageId,
  initialData,
  initialName,
  initialSlug,
  initialStatus,
  productAggregateId,
  productVersion: initialProductVersion,
  initialProductCustomFields,
  initialProductCustomFieldSchema,
  eventAggregateId,
  eventProductId,
  initialPageUpdatedAt,
}) => {
  const { language } = useTheme();
  const permissions = usePermissions();
  const fields = parseSchemaFields(schema.schema as Record<string, unknown>);
  const fieldPresentation = resolveSchemaEditorPresentation(fields, schema.editor_config, language);
  const requiredFields = fields.filter((f) => f.required);
  const optionalFields = fields.filter((f) => !f.required);

  // ── Form state
  const [pageName, setPageName]           = useState(initialName || '');
  const [pageSlug, setPageSlug]           = useState(() => (initialSlug || (initialName ? generateSlug(initialName) : '')));
  const [slugEdited, setSlugEdited]       = useState(Boolean(initialSlug));
  const [baseContent, setBaseContent]     = useState<Record<string, unknown>>(() => initialData ?? {});
  const [formData, setFormData]           = useState<Record<string, unknown>>(() =>
    initializeSchemaContent(buildInitialData(fields), initialData)
  );

  // Track which optional fields are active.
  // On edit, activate any optional field that has non-empty initial data.
  const [activeOptional, setActiveOptional] = useState<Set<string>>(() => {
    if (!initialData) return new Set();
    return new Set(optionalFields
      .filter((field) => hasOwnKey(initialData, field.name))
      .map((field) => field.name));
  });
  const [removedOptional, setRemovedOptional] = useState<Set<string>>(() => new Set());

  // ── Save state
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isSaving, setIsSaving]                 = useState(false);
  const [savedSlug, setSavedSlug]               = useState<string | null>(null);
  const [aggregateVersion, setAggregateVersion] = useState(initialProductVersion);
  const [productCustomFields, setProductCustomFields] = useState<Record<string, unknown>>(() => initialProductCustomFields ?? {});
  const [productCustomFieldDefinitions, setProductCustomFieldDefinitions] = useState<TenantCustomFieldDefinitions>(() => initialProductCustomFieldSchema?.product ?? {});
  const [customFieldsValid, setCustomFieldsValid] = useState(true);
  const [pageUpdatedAt, setPageUpdatedAt] = useState(initialPageUpdatedAt);
  const [publicationStatus, setPublicationStatus] = useState(initialStatus ?? 'draft');
  const [revalResult, setRevalResult]           = useState<RevalidationResult | null>(null);

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

  const addOptionalField = (fieldName: string) => {
    setRemovedOptional((prev) => {
      const next = new Set(prev);
      next.delete(fieldName);
      return next;
    });
    setActiveOptional((prev) => new Set([...prev, fieldName]));
  };

  const removeOptionalField = (fieldName: string) => {
    setActiveOptional((prev) => {
      const next = new Set(prev);
      next.delete(fieldName);
      return next;
    });
    setRemovedOptional((prev) => new Set([...prev, fieldName]));
    setFormData((prev) => {
      const next = { ...prev };
      delete next[fieldName];
      return next;
    });
  };

  const requiredGroups = groupPresentedSchemaFields(fieldPresentation.filter(({ field }) => field.required));
  const activeOptionalGroups = groupPresentedSchemaFields(fieldPresentation.filter(({ field }) => !field.required && activeOptional.has(field.name)));
  const inactiveOptionalGroups = groupPresentedSchemaFields(fieldPresentation.filter(({ field }) => !field.required && !activeOptional.has(field.name)));
  const inactiveOptionalCount = inactiveOptionalGroups.reduce((total, group) => total + group.fields.length, 0);
  // Catalogue pages are classified by their linked aggregate, not the schema kind.
  const isServiceProduct = Boolean(productAggregateId);
  const isEventPage = Boolean(eventAggregateId) && !productAggregateId;
  const currentPageContent = buildSchemaContent(baseContent, formData, fields, activeOptional, removedOptional);
  const hasUnsavedChanges = pageName !== (initialName || '')
    || pageSlug !== (initialSlug || (initialName ? generateSlug(initialName) : ''))
    || JSON.stringify(currentPageContent) !== JSON.stringify(initialData ?? {})
    || JSON.stringify(productCustomFields) !== JSON.stringify(initialProductCustomFields ?? {})
    || !customFieldsValid;

  useEffect(() => {
    setProductCustomFieldDefinitions(isServiceProduct ? initialProductCustomFieldSchema?.product ?? {} : {});
    setCustomFieldsValid(true);
  }, [isServiceProduct, productAggregateId, initialProductCustomFieldSchema]);

  // ── JSON import handler
  const handleJsonImport = useCallback((data: Record<string, unknown>) => {
    setFormData((prev) => mergeSchemaContent(prev, data));
    const newActive = new Set(activeOptional);
    for (const field of optionalFields) {
      if (hasOwnKey(data, field.name)) newActive.add(field.name);
    }
    setActiveOptional(newActive);
    setRemovedOptional((prev) => {
      const next = new Set(prev);
      for (const fieldName of Object.keys(data)) next.delete(fieldName);
      return next;
    });
  }, [activeOptional, optionalFields]);

  // ── Save handler
  const handleSave = async (statusAfterSave?: 'draft' | 'published') => {
    if (!pageName.trim()) {
      toast.error(language === 'en' ? 'Page name is required.' : 'Seitenname ist erforderlich.');
      return;
    }
    if (isServiceProduct) {
      if (!customFieldsValid) {
        toast.error(language === 'en' ? 'Fix the invalid JSON custom fields.' : 'Bitte korrigiere die ungültigen JSON-Felder.');
        return;
      }
      const customFieldError = validateTenantCustomFieldValues(productCustomFieldDefinitions, productCustomFields);
      if (customFieldError) {
        toast.error(customFieldError);
        return;
      }
    }
    setIsSaving(true);
    setRevalResult(null);
    try {
      const content = buildSchemaContent(baseContent, formData, fields, activeOptional, removedOptional);

      let updatedProduct: ServiceProduct | null = null;
      let updatedEventPage: { updated_at: string } | null = null;
      const result = isServiceProduct
        ? await (async () => {
            if (!productAggregateId || !aggregateVersion || !schema.tenant_id) {
              throw new Error('Produktaggregate konnten nicht geladen werden. Bitte Seite neu laden.');
            }
            const product = await updateServiceProduct({
              id: productAggregateId,
              tenant_id: schema.tenant_id,
              expected_version: aggregateVersion,
              expected_definition_revision: schema.definition_revision ?? 1,
              name: pageName,
              slug: pageSlug,
              content,
              custom_fields: productCustomFields,
            });
            updatedProduct = product;
            setAggregateVersion(product.version);
            setProductCustomFields(product.custom_fields ?? productCustomFields);
            return { id: product.page_id, slug: product.slug || pageSlug };
          })()
        : isEventPage
          ? await (async () => {
              if (!eventAggregateId || !schema.tenant_id || !pageUpdatedAt) {
                throw new Error('Event aggregate or page revision could not be loaded. Reload the page and retry.');
              }
              const result = await updateEventPage({
                event_id: eventAggregateId,
                tenant_id: schema.tenant_id,
                expected_definition_revision: schema.definition_revision ?? 1,
                expected_page_updated_at: pageUpdatedAt,
                name: pageName,
                slug: pageSlug,
                content,
              });
              updatedEventPage = result;
              setPageUpdatedAt(result.updated_at);
              return { id: result.page_id, slug: result.slug };
            })()
          : await savePage(pageId, content, pageName, schema.id, pageSlug, schema.tenant_id ?? null);
      setSavedSlug(result.slug);

      if (isServiceProduct && statusAfterSave && updatedProduct && schema.tenant_id) {
        updatedProduct = await setServiceProductPublication({
          id: updatedProduct.id,
          tenant_id: schema.tenant_id,
          expected_version: updatedProduct.version,
          expected_definition_revision: schema.definition_revision ?? 1,
          status: statusAfterSave,
        });
        setAggregateVersion(updatedProduct.version);
        setPublicationStatus(statusAfterSave);
      } else if (isEventPage && statusAfterSave && updatedEventPage && eventAggregateId && schema.tenant_id) {
        const publication = await setEventPagePublication({
          event_id: eventAggregateId,
          tenant_id: schema.tenant_id,
          expected_definition_revision: schema.definition_revision ?? 1,
          expected_page_updated_at: updatedEventPage.updated_at,
          status: statusAfterSave,
        });
        setPageUpdatedAt(publication.updated_at);
        setPublicationStatus(statusAfterSave);
      }
      // Trigger afterCreate hook for KB auto sync
      if (!pageId && result.id) {
        try {
          const { getPluginHooks } = await import('@/plugins/loader');
          const hooks = getPluginHooks('knowledgeBase.entity.afterCreate', user?.roles || []);
          const context = {
            entityType: 'page',
            entityId: result.id,
            tenantId: schema.tenant_id || null,
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

        navigate(`${getSchemaConsolePath(schema)}/edit/${result.id}`, { replace: true });
      }

      toast.success(`Seite "${pageName}" gespeichert als /${result.slug}`);

      if (schema.registration_status === 'registered'
        && (publicationStatus === 'published' || statusAfterSave === 'published')
        && result.slug) {
        try {
          const pageResults = [await triggerRevalidation(schemaSlug, result.slug)];
          if (isEventPage && eventProductId && schema.tenant_id) {
            const { data: product, error: productError } = await supabase.from('mentorbooking_products')
              .select('product_page_id')
              .eq('id', eventProductId)
              .eq('tenant_id', schema.tenant_id)
              .maybeSingle();
            if (productError) throw productError;
            if (product?.product_page_id) {
              const { data: productPage, error: productPageError } = await supabase.from('pages')
                .select('slug, schema_id, status')
                .eq('id', product.product_page_id)
                .eq('tenant_id', schema.tenant_id)
                .eq('status', 'published')
                .maybeSingle();
              if (productPageError) throw productPageError;
              if (productPage) {
                const productSchema = await getSchema(productPage.schema_id);
                if (productSchema.tenant_id === schema.tenant_id
                  && isCatalogueSchema(productSchema.entity_kind)
                  && productSchema.registration_status === 'registered') {
                  pageResults.push(await triggerRevalidation(productSchema.api_slug, productPage.slug));
                }
              }
            }
          }
          const failedResult = pageResults.find((item) => !item.success);
          setRevalResult(failedResult ?? pageResults[0]);
          if (!failedResult) {
            toast.success(language === 'en' ? 'Website pages updated.' : 'Website-Seiten wurden aktualisiert.');
          } else {
            toast.warning(language === 'en'
              ? 'Page saved, but one or more website pages could not be refreshed.'
              : 'Seite gespeichert, aber eine oder mehrere Website-Seiten konnten nicht aktualisiert werden.');
          }
        } catch (error) {
          const diagnostic = error instanceof Error ? error.message : 'Unknown revalidation error.';
          setRevalResult({
            success: false,
            message: language === 'en' ? 'Could not reach the revalidation service.' : 'Der Aktualisierungsdienst war nicht erreichbar.',
            diagnostics: { error: diagnostic },
          });
          toast.warning(language === 'en'
            ? 'Page saved, but one or more website pages could not be refreshed.'
            : 'Seite gespeichert, aber eine oder mehrere Website-Seiten konnten nicht aktualisiert werden.');
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

  // ── Build preview URL from schema config. The preview slug structure must be
  // explicitly set (enabled detail-page target with a ":slug" host_path);
  // there is no implicit fallback. Without it the editor works normally but the
  // preview view errors out with guidance on how to set the structure.
  const previewSlugStructure = getExplicitPreviewSlugStructure(schema);
  const previewConfigured = Boolean(schema.frontend_url && previewSlugStructure);
  const previewUrl =
    savedSlug && previewConfigured && previewSlugStructure
      ? buildSchemaPageUrl(schema.frontend_url, previewSlugStructure, savedSlug)
      : null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-24">

      {/* PageBuilder is the content layer; schema design remains in SchemaEditor. */}
      <PageContentTemplateControls
        schemaId={schema.id}
        tenantId={schema.tenant_id ?? null}
        pageName={pageName}
        content={buildSchemaContent(baseContent, formData, fields, activeOptional, removedOptional)}
        language={language}
        onApply={(templateContent) => {
          setBaseContent(templateContent);
          setFormData(initializeSchemaContent(buildInitialData(fields), templateContent));
          setActiveOptional(new Set(optionalFields
            .filter((field) => hasOwnKey(templateContent, field.name))
            .map((field) => field.name)));
          setRemovedOptional(new Set());
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>{isServiceProduct ? '📦' : isEventPage ? '📅' : '📝'}</span>
            <span>{isServiceProduct
              ? (language === 'en' ? 'Product details' : 'Produktdetails')
              : isEventPage
                ? (language === 'en' ? 'Event page details' : 'Veranstaltungsseite')
                : (language === 'en' ? 'Page details' : 'Seitendetails')}</span>
          </CardTitle>
          {schema.description && <CardDescription>{schema.description}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-2xl space-y-1.5">
            <Label htmlFor="page-name" className="text-sm font-medium">
              {isServiceProduct
                ? (language === 'en' ? 'Product name' : 'Produktname')
                : isEventPage
                  ? (language === 'en' ? 'Public event page title' : 'Titel der Veranstaltungsseite')
                  : (language === 'en' ? 'Page name' : 'Seitenname')}
              <span className="text-destructive"> *</span>
            </Label>
            <Input
              id="page-name"
              value={pageName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder={language === 'en' ? 'Enter a name' : 'Namen eingeben'}
            />
          </div>
          {permissions.canManageAccounts && (
            <details className="rounded-lg border px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium">
                {language === 'en' ? 'Advanced page settings' : 'Erweiterte Seiteneinstellungen'}
              </summary>
              <div className="mt-4 space-y-4">
                {pageId && (
                  <EntityActionsRow
                    entityType="page"
                    entityId={pageId}
                    tenantId={schema.tenant_id}
                  />
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="page-slug" className="text-sm font-medium">
                    {language === 'en' ? 'URL slug' : 'URL-Slug'}
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
                  {schema.frontend_url && previewSlugStructure ? (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{buildSchemaPageUrl(schema.frontend_url, previewSlugStructure, pageSlug || 'example-slug')}</span>
                    </p>
                  ) : schema.frontend_url && schema.frontend_targets?.some((target) => target.kind === 'collection-slot' && target.enabled) ? (
                    <p className="text-xs text-muted-foreground">
                      {language === 'en'
                        ? 'This entry is displayed in a registered collection slot and has no individual preview URL.'
                        : 'Dieser Eintrag wird in einem registrierten Sammlungsslot angezeigt und hat keine eigene Vorschau-URL.'}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {language === 'en' ? 'Generated from the name unless changed.' : 'Wird automatisch aus dem Namen gebildet.'}
                    </p>
                  )}
                  {schema.registration_status === 'registered' && schema.frontend_url && (
                    <p className="text-xs text-muted-foreground">
                      {language === 'en' ? 'Connected frontend:' : 'Verbundenes Frontend:'}{' '}
                      <a href={schema.frontend_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        {schema.frontend_url.replace(/^https?:\/\//, '')}
                      </a>
                    </p>
                  )}
                </div>
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      {/* Required content fields, grouped and labelled for the content editor. */}
      {fields.length === 0 && (
        <Card className="border-dashed border-amber-300 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="py-8 text-center text-sm text-amber-700 dark:text-amber-400">
            {language === 'en'
              ? 'This content type has no editable fields yet. Ask a technical administrator to update its schema.'
              : 'Für diesen Inhaltstyp sind noch keine bearbeitbaren Felder definiert. Bitte eine technische Administration um Aktualisierung des Schemas.'}
          </CardContent>
        </Card>
      )}

      {requiredGroups.map((group) => (
        <section key={`required-${group.key}`} className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">{group.label}</h2>
            {group.description && <p className="text-sm text-muted-foreground">{group.description}</p>}
          </div>
          <div className="space-y-3">
            {group.fields.map(({ field, label, helpText }) => (
              <Card key={field.name}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span>{fieldIcon(field.name)}</span>
                    <span>{label}</span>
                    <Badge variant="destructive" className="text-[10px] h-4 px-1.5">
                      {language === 'en' ? 'Required' : 'Pflichtfeld'}
                    </Badge>
                  </CardTitle>
                  {helpText && <CardDescription>{helpText}</CardDescription>}
                </CardHeader>
                <CardContent>
                  <SchemaFieldRenderer
                    field={field}
                    value={formData[field.name]}
                    onChange={(value) => updateField(field.name, value)}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}

      {/* Active optional fields stay visible until explicitly removed. */}
      {activeOptionalGroups.map((group) => (
        <section key={`optional-${group.key}`} className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">{group.label}</h2>
            {group.description && <p className="text-sm text-muted-foreground">{group.description}</p>}
          </div>
          <div className="space-y-3">
            {group.fields.map(({ field, label, helpText }) => (
              <Card key={field.name}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1 flex-1">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <span>{fieldIcon(field.name)}</span>
                        <span>{label}</span>
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                          {language === 'en' ? 'Optional' : 'Optional'}
                        </Badge>
                      </CardTitle>
                      {helpText && <CardDescription>{helpText}</CardDescription>}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive shrink-0 ml-2"
                      onClick={() => removeOptionalField(field.name)}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      {language === 'en' ? 'Remove' : 'Entfernen'}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <SchemaFieldRenderer
                    field={field}
                    value={formData[field.name]}
                    onChange={(value) => updateField(field.name, value)}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}

      {/* Optional fields are available when the developer schema defines them. */}
      {inactiveOptionalCount > 0 && (
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{language === 'en' ? 'More fields' : 'Weitere Felder'}</CardTitle>
            <CardDescription>
              {language === 'en'
                ? isServiceProduct ? 'Add optional details when they apply to this product.' : 'Add optional details when they apply to this page.'
                : isServiceProduct ? 'Füge optionale Angaben hinzu, wenn sie für dieses Produkt relevant sind.' : 'Füge optionale Angaben hinzu, wenn sie für diese Seite relevant sind.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {inactiveOptionalGroups.map((group) => (
              <div key={`available-${group.key}`} className="space-y-2">
                {inactiveOptionalGroups.length > 1 && <p className="text-xs font-medium text-muted-foreground">{group.label}</p>}
                <div className="flex flex-wrap gap-2">
                  {group.fields.map(({ field, label }) => (
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
                      <span>{label}</span>
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {isServiceProduct && schema.tenant_id && productAggregateId && (
        <ProductEventsPanel
          tenantId={schema.tenant_id}
          serviceProductId={productAggregateId}
          onBeforeCreateEvent={() => !hasUnsavedChanges || window.confirm('Du hast nicht gespeicherte Änderungen am Produkt. Möchtest du die Seite verlassen und die Änderungen verwerfen?')}
        />
      )}

      {isServiceProduct && schema.tenant_id && productAggregateId && (
        <div className="flex justify-end">
          <ProductCustomFieldSchemaDialog
            productId={productAggregateId}
            tenantId={schema.tenant_id}
            version={aggregateVersion ?? initialProductVersion ?? 1}
            productName={pageName}
            onSaved={(fieldSchema, version) => {
              setProductCustomFieldDefinitions(fieldSchema.product);
              setAggregateVersion(version);
            }}
          />
        </div>
      )}

      {isServiceProduct && Object.keys(productCustomFieldDefinitions).length > 0 && (
        <TenantCustomFieldsEditor
          key={`${schema.id}-${productAggregateId ?? 'new-product'}`}
          definitions={productCustomFieldDefinitions}
          values={productCustomFields}
          language={language}
          title="Weitere Produktangaben"
          description="Zusätzliche Angaben zu diesem Produkt."
          onChange={setProductCustomFields}
          onValidityChange={setCustomFieldsValid}
        />
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
                {isServiceProduct ? (language === 'en' ? 'Product saved:' : 'Produkt gespeichert:') : isEventPage ? (language === 'en' ? 'Event page saved:' : 'Veranstaltungsseite gespeichert:') : (language === 'en' ? 'Page saved:' : 'Seite gespeichert:')}{' '}
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
              ) : !previewSlugStructure ? (
                <span className="text-xs text-destructive" role="alert">
                  {language === 'en'
                    ? 'Preview unavailable: no preview slug structure set. Add an enabled detail-page target with a host path containing ":slug" in the schema settings.'
                    : 'Vorschau nicht verfügbar: Keine Vorschau-Slug-Struktur gesetzt. Hinterlege in den Schema-Einstellungen ein aktiviertes Detailseiten-Ziel mit „:slug“ im Host-Pfad.'}
                </span>
              ) : (
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  {language === 'en'
                    ? 'No frontend URL registered — preview available after registration.'
                    : 'Kein Frontend registriert — Vorschau nach Registrierung verfügbar.'}
                </span>
              )}
            </div>
            {schema.registration_status === 'registered' && revalResult && (
                <RevalidationFeedback result={revalResult} language={language} />
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* ── Sticky Footer ─────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-t z-50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">
              {isServiceProduct
                ? (language === 'en' ? 'Product' : 'Produkt')
                : isEventPage ? (language === 'en' ? 'Event page' : 'Veranstaltungsseite') : (language === 'en' ? 'Page' : 'Seite')}:{' '}
              <span className="font-semibold">{pageName || (language === 'en' ? 'Untitled' : 'Unbenannt')}</span>
              {permissions.canManageAccounts && schema.registration_status === 'registered' && (
                <Badge variant="default" className="ml-2 text-[10px]">ISR aktiv</Badge>
              )}
            </p>
            {permissions.canManageAccounts && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  {language === 'en' ? 'Developer tools' : 'Entwicklerwerkzeuge'}
                </summary>
                <div className="mt-2 rounded-lg border bg-background p-2">
                  <JsonImporter fields={fields} onImport={handleJsonImport} />
                </div>
              </details>
            )}
          </div>
          <div className="flex items-center gap-2">
          {(isServiceProduct || isEventPage) && publicationStatus === 'published' && (
            <Button type="button" variant="outline" onClick={() => handleSave('draft')} size="lg" disabled={isSaving}>
              Veröffentlichung zurückziehen
            </Button>
          )}
          <Button
            type="button"
            onClick={() => handleSave()}
            size="lg"
            variant={schema.entity_kind === 'service-product' || isEventPage ? 'outline' : 'default'}
            disabled={isSaving}
            className="min-w-[180px]"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Wird gespeichert...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                {(isServiceProduct || isEventPage) && publicationStatus === 'published' ? 'Änderungen speichern' : 'Speichern'}
              </>
            )}
          </Button>
          {(isServiceProduct || isEventPage) && publicationStatus !== 'published' && (
            <Button type="button" onClick={() => handleSave('published')} size="lg" disabled={isSaving} className="min-w-[180px]">
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}
              Veröffentlichen
            </Button>
          )}
          </div>
        </div>
      </div>
    </div>
  );
};
