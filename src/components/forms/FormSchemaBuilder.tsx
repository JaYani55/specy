import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, ListChecks, Paperclip, Plus, Rows3, SquareCheckBig, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getMediaSources, type MediaSourceInfo } from '@/services/connectionsService';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { FormFieldDefinition, FormFieldType } from '@/types/forms';
import { generateFormSlug } from '@/utils/forms';

const createEditorFieldId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `form-field-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

interface FormSchemaBuilderProps {
  fields: FormFieldDefinition[];
  language: 'en' | 'de';
  onChange: (fields: FormFieldDefinition[]) => void;
}

type BuilderPreset = {
  label: { en: string; de: string };
  description: { en: string; de: string };
  type: FormFieldType;
  icon: typeof Rows3;
};

const BUILDER_PRESETS: BuilderPreset[] = [
  {
    label: { en: 'Short Text', de: 'Kurzer Text' },
    description: { en: 'One-line answer, name, company, title.', de: 'Einzeilige Antwort, Name, Firma, Titel.' },
    type: 'text',
    icon: Rows3,
  },
  {
    label: { en: 'Long Text', de: 'Langer Text' },
    description: { en: 'Paragraph answer or message.', de: 'Längere Antwort oder Nachricht.' },
    type: 'textarea',
    icon: Rows3,
  },
  {
    label: { en: 'Email', de: 'E-Mail' },
    description: { en: 'Validated email input.', de: 'Validiertes E-Mail-Feld.' },
    type: 'email',
    icon: Rows3,
  },
  {
    label: { en: 'Number', de: 'Zahl' },
    description: { en: 'Numeric input.', de: 'Numerische Eingabe.' },
    type: 'number',
    icon: Rows3,
  },
  {
    label: { en: 'File Upload', de: 'Datei-Upload' },
    description: { en: 'Upload one file into object storage.', de: 'Eine Datei in den Objektspeicher hochladen.' },
    type: 'file-upload',
    icon: Paperclip,
  },
  {
    label: { en: 'Checkbox', de: 'Checkbox' },
    description: { en: 'Single true/false value.', de: 'Einzelner Ja/Nein-Wert.' },
    type: 'checkbox',
    icon: SquareCheckBig,
  },
  {
    label: { en: 'Single Select', de: 'Single-Select' },
    description: { en: 'Choose one option from a list.', de: 'Eine Option aus einer Liste wählen.' },
    type: 'single-select',
    icon: ListChecks,
  },
  {
    label: { en: 'Multi Select', de: 'Multi-Select' },
    description: { en: 'Choose multiple options.', de: 'Mehrere Optionen auswählen.' },
    type: 'multi-select',
    icon: ListChecks,
  },
  {
    label: { en: 'Date', de: 'Datum' },
    description: { en: 'Date picker or ISO date input.', de: 'Datumsfeld oder ISO-Datum.' },
    type: 'date',
    icon: Rows3,
  },
];

const typeLabels: Record<FormFieldType, string> = {
  text: 'Text',
  textarea: 'Textarea',
  email: 'Email',
  number: 'Number',
  'file-upload': 'File Upload',
  checkbox: 'Checkbox',
  select: 'Select',
  radio: 'Radio',
  date: 'Date',
  'single-select': 'Single Select',
  'multi-select': 'Multi Select',
};

const DEFAULT_UPLOAD_MOUNT = '__default__';

const createField = (type: FormFieldType, index: number): FormFieldDefinition => {
  const baseName = type === 'single-select' || type === 'multi-select'
    ? `${type.replace('-', '_')}_${index + 1}`
    : `${type}_${index + 1}`;

  return {
    editorId: createEditorFieldId(),
    name: generateFormSlug(baseName).replace(/-/g, '_'),
    type,
    label: typeLabels[type],
    description: '',
    placeholder: '',
    meta_description: '',
    required: false,
    options: type === 'single-select' || type === 'multi-select' || type === 'select' || type === 'radio'
      ? ['Option 1', 'Option 2']
      : undefined,
    upload_mount: type === 'file-upload' ? undefined : undefined,
    upload_bucket: type === 'file-upload' ? '' : undefined,
    upload_folder: type === 'file-upload' ? 'forms/{form_slug}/{field_name}/{submission_id}' : undefined,
  };
};

const supportsOptions = (type: FormFieldType) => (
  type === 'single-select' || type === 'multi-select' || type === 'select' || type === 'radio'
);

const supportsUploadConfig = (type: FormFieldType) => type === 'file-upload';

interface OptionTagInputProps {
  options: string[];
  language: 'en' | 'de';
  onChange: (options: string[]) => void;
}

const OptionTagInput = ({ options, language, onChange }: OptionTagInputProps) => {
  const [draft, setDraft] = useState('');

  const addOption = () => {
    const normalized = draft.trim();
    if (!normalized) return;
    if (options.includes(normalized)) {
      setDraft('');
      return;
    }
    onChange([...options, normalized]);
    setDraft('');
  };

  const removeOption = (index: number) => {
    onChange(options.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <div className="space-y-3 rounded-2xl border bg-muted/20 p-4">
      <div className="flex flex-wrap gap-2">
        {options.map((option, index) => (
          <Badge key={`${option}-${index}`} variant="secondary" className="flex items-center gap-1 rounded-full px-3 py-1 text-sm">
            <span>{option}</span>
            <button
              type="button"
              onClick={() => removeOption(index)}
              className="rounded-full p-0.5 text-muted-foreground transition hover:bg-background hover:text-foreground"
              aria-label={language === 'en' ? `Remove option ${option}` : `Option ${option} entfernen`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}

        {options.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {language === 'en' ? 'No options yet. Add the first tag below.' : 'Noch keine Optionen. Füge unten den ersten Tag hinzu.'}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              addOption();
            }
          }}
          placeholder={language === 'en' ? 'Type an option and press Enter' : 'Option eingeben und Enter drücken'}
        />
        <Button type="button" variant="outline" onClick={addOption} className="shrink-0">
          <Plus className="mr-2 h-4 w-4" />
          {language === 'en' ? 'Add option' : 'Option hinzufügen'}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {language === 'en'
          ? 'Press Enter or comma to create a new option tag.'
          : 'Drücke Enter oder Komma, um einen neuen Options-Tag anzulegen.'}
      </p>
    </div>
  );
};

export const FormSchemaBuilder = ({ fields, language, onChange }: FormSchemaBuilderProps) => {
  const [mediaSources, setMediaSources] = useState<MediaSourceInfo[]>([]);

  useEffect(() => {
    let active = true;

    void getMediaSources()
      .then((sources) => {
        if (!active) return;
        setMediaSources(sources.filter((source) => source.configured));
      })
      .catch(() => {
        if (!active) return;
        setMediaSources([]);
      });

    return () => {
      active = false;
    };
  }, []);

  const updateField = (index: number, patch: Partial<FormFieldDefinition>) => {
    const next = [...fields];
    next[index] = { ...next[index], ...patch };

    if (!supportsOptions(next[index].type)) {
      next[index].options = undefined;
    } else if (!next[index].options || next[index].options.length === 0) {
      next[index].options = ['Option 1', 'Option 2'];
    }

    if (!supportsUploadConfig(next[index].type)) {
      next[index].upload_mount = undefined;
      next[index].upload_bucket = undefined;
      next[index].upload_folder = undefined;
    } else {
      next[index].upload_mount = next[index].upload_mount || undefined;
      next[index].upload_bucket = next[index].upload_bucket || '';
      next[index].upload_folder = next[index].upload_folder || 'forms/{form_slug}/{field_name}/{submission_id}';
    }

    onChange(next);
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= fields.length) return;
    const next = [...fields];
    const [field] = next.splice(index, 1);
    next.splice(targetIndex, 0, field);
    onChange(next);
  };

  const removeField = (index: number) => {
    onChange(fields.filter((_, currentIndex) => currentIndex !== index));
  };

  const addField = (type: FormFieldType) => {
    onChange([...fields, createField(type, fields.length)]);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {BUILDER_PRESETS.map((preset) => (
          <button
            key={preset.type}
            type="button"
            onClick={() => addField(preset.type)}
            className="rounded-2xl border bg-gradient-to-br from-white to-muted/30 p-4 text-left transition hover:border-primary/40 hover:shadow-md dark:from-slate-950 dark:to-slate-900"
          >
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
                <preset.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold">{preset.label[language]}</p>
                <p className="text-xs text-muted-foreground">{typeLabels[preset.type]}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{preset.description[language]}</p>
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {fields.map((field, index) => (
          <Card key={field.editorId || `form-field-${index}`} className="overflow-hidden border-0 shadow-sm">
            <CardHeader className="bg-muted/30">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-lg">{field.label || `${language === 'en' ? 'Field' : 'Feld'} ${index + 1}`}</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{typeLabels[field.type]}</Badge>
                    <Badge variant="outline">{field.name || 'unnamed_field'}</Badge>
                    {field.required && <Badge>{language === 'en' ? 'Required' : 'Pflichtfeld'}</Badge>}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="icon" onClick={() => moveField(index, -1)} disabled={index === 0}>
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" onClick={() => moveField(index, 1)} disabled={index === fields.length - 1}>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="destructive" size="icon" onClick={() => removeField(index)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{language === 'en' ? 'Field Label' : 'Feldbezeichnung'}</Label>
                  <Input
                    value={field.label}
                    onChange={(event) => updateField(index, { label: event.target.value })}
                    placeholder={language === 'en' ? 'Customer Email' : 'Kunden-E-Mail'}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{language === 'en' ? 'Field Type' : 'Feldtyp'}</Label>
                  <Select value={field.type} onValueChange={(value) => updateField(index, { type: value as FormFieldType })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BUILDER_PRESETS.map((preset) => (
                        <SelectItem key={preset.type} value={preset.type}>{preset.label[language]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{language === 'en' ? 'Field Key' : 'Feldschlüssel'}</Label>
                  <Input
                    value={field.name}
                    onChange={(event) => updateField(index, { name: event.target.value })}
                    placeholder="customer_email"
                  />
                </div>

                <div className="space-y-2">
                  <Label>{language === 'en' ? 'Placeholder' : 'Platzhalter'}</Label>
                  <Input
                    value={field.placeholder || ''}
                    onChange={(event) => updateField(index, { placeholder: event.target.value })}
                    placeholder={language === 'en' ? 'e.g. john@example.com' : 'z.B. max@example.com'}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>{language === 'en' ? 'Description' : 'Beschreibung'}</Label>
                <Textarea
                  value={field.description || ''}
                  onChange={(event) => updateField(index, { description: event.target.value })}
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label>{language === 'en' ? 'Meta Description for Agents' : 'Meta-Beschreibung für Agenten'}</Label>
                <Textarea
                  value={field.meta_description || ''}
                  onChange={(event) => updateField(index, { meta_description: event.target.value })}
                  rows={3}
                />
              </div>

              {supportsOptions(field.type) && (
                <div className="space-y-2">
                  <Label>{language === 'en' ? 'Options' : 'Optionen'}</Label>
                  <OptionTagInput
                    options={field.options || []}
                    language={language}
                    onChange={(options) => updateField(index, { options })}
                  />
                </div>
              )}

              {supportsUploadConfig(field.type) && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{language === 'en' ? 'Upload Storage Mount' : 'Upload-Speicher-Mount'}</Label>
                    <Select
                      value={field.upload_mount || DEFAULT_UPLOAD_MOUNT}
                      onValueChange={(value) => updateField(index, {
                        upload_mount: value === DEFAULT_UPLOAD_MOUNT ? undefined : value,
                        upload_bucket: value === DEFAULT_UPLOAD_MOUNT ? field.upload_bucket || '' : '',
                      })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={language === 'en' ? 'Use default storage mount' : 'Standard-Speicher-Mount verwenden'} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DEFAULT_UPLOAD_MOUNT}>
                          {language === 'en' ? 'Default mount from Connections' : 'Standard-Mount aus Connections'}
                        </SelectItem>
                        {mediaSources.map((source) => (
                          <SelectItem key={source.id} value={source.id}>
                            {source.label}{source.isDefault ? ` (${language === 'en' ? 'Default' : 'Standard'})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {language === 'en'
                        ? 'Select a mounted drive or keep the default active storage mount from Connections.'
                        : 'Wähle ein gemountetes Laufwerk oder nutze den aktiven Standard-Mount aus Connections.'}
                    </p>
                    {field.upload_bucket && !field.upload_mount ? (
                      <p className="text-xs text-amber-600">
                        {language === 'en'
                          ? `Legacy bucket override is still saved: ${field.upload_bucket}`
                          : `Legacy-Bucket-Override ist noch gespeichert: ${field.upload_bucket}`}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label>{language === 'en' ? 'Upload Folder Template' : 'Upload-Ordner-Template'}</Label>
                    <Input
                      value={field.upload_folder || ''}
                      onChange={(event) => updateField(index, { upload_folder: event.target.value })}
                      placeholder="forms/{form_slug}/{field_name}/{submission_id}"
                    />
                    <p className="text-xs text-muted-foreground">
                      {language === 'en' ? 'Supported tokens: {form_slug}, {field_name}, {submission_id}.' : 'Unterstützte Tokens: {form_slug}, {field_name}, {submission_id}.'}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between rounded-xl border bg-muted/20 px-4 py-3">
                <div>
                  <Label>{language === 'en' ? 'Required Field' : 'Pflichtfeld'}</Label>
                  <p className="text-xs text-muted-foreground">
                    {language === 'en' ? 'Require a value before submission.' : 'Vor dem Absenden ist ein Wert erforderlich.'}
                  </p>
                </div>
                <Switch checked={Boolean(field.required)} onCheckedChange={(checked) => updateField(index, { required: checked })} />
              </div>
            </CardContent>
          </Card>
        ))}

        {fields.length === 0 && (
          <div className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Plus className="h-5 w-5" />
            </div>
            <p className="font-medium">{language === 'en' ? 'No fields yet' : 'Noch keine Felder'}</p>
            <p className="mt-1 text-sm">
              {language === 'en' ? 'Add the first block above to start building the form.' : 'Füge oben den ersten Block hinzu, um das Formular zu erstellen.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};