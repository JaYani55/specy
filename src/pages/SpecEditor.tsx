import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Bot, CheckCircle2, FileCode2, Lightbulb, Loader2, Save, Sparkles, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { AdminCard, AdminPageLayout } from '@/components/admin/ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useTheme } from '@/contexts/ThemeContext';
import { createSpec, getSpec, updateSpec } from '@/services/specService';
import type { SaveSpecInput, SpecRecord } from '@/types/specs';

const DEFAULT_DEFINITION = {
  kind: 'tool-spec',
  version: '1.0.0',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'User input or structured request.' },
    },
  },
  output_schema: {
    type: 'object',
    properties: {
      result: { type: 'string', description: 'Primary result payload.' },
    },
  },
};

const SPEC_TEMPLATES: Array<{ id: string; name: string; description: string; definition: Record<string, unknown> }> = [
  {
    id: 'generic-tool',
    name: 'Generic Tool',
    description: 'A basic tool contract with input and output JSON schemas.',
    definition: DEFAULT_DEFINITION,
  },
  {
    id: 'schema-main',
    name: 'Schema Main Spec',
    description: 'A schema-centric contract for generated main specs or content contracts.',
    definition: {
      kind: 'schema-main-spec',
      version: '1.0.0',
      schema: {
        slug: 'schema-slug',
        name: 'Schema Name',
      },
      input_schema: {
        type: 'object',
        properties: {
          content: { type: 'object', description: 'Schema-compliant page content payload.' },
        },
      },
      output_expectations: {
        route_registration: 'Frontend registration stays schema-centric.',
        page_delivery: 'Use the schema pages endpoint as the canonical source of published content.',
      },
    },
  },
  {
    id: 'mcp-resource',
    name: 'MCP Resource Spec',
    description: 'A resource-oriented contract for read-heavy agent integrations.',
    definition: {
      kind: 'mcp-resource-spec',
      version: '1.0.0',
      resource: {
        uri_template: 'mcp://specs/example-resource',
        mime_type: 'application/json',
      },
      input_schema: {
        type: 'object',
        properties: {
          uri: { type: 'string', description: 'Resource URI to read.' },
        },
      },
      output_schema: {
        type: 'object',
        properties: {
          payload: { type: 'object', description: 'Returned resource payload.' },
        },
      },
    },
  },
];

const generateSlug = (value: string): string => value
  .toLowerCase()
  .replace(/ä/g, 'ae')
  .replace(/ö/g, 'oe')
  .replace(/ü/g, 'ue')
  .replace(/ß/g, 'ss')
  .replace(/[^a-z0-9\s-]/g, '')
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '');

interface DefinitionValidationResult {
  valid: boolean;
  value: Record<string, unknown> | null;
  error: string | null;
  warnings: string[];
}

function validateDefinition(definitionText: string): DefinitionValidationResult {
  try {
    const parsed = JSON.parse(definitionText) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { valid: false, value: null, error: 'Definition must be a JSON object at the root.', warnings: [] };
    }

    const warnings: string[] = [];
    const kind = parsed.kind;
    const version = parsed.version;
    const inputSchema = parsed.input_schema;
    const outputSchema = parsed.output_schema;

    if (typeof kind !== 'string' || !kind.trim()) {
      return { valid: false, value: null, error: 'Definition.kind is required and must be a string.', warnings: [] };
    }

    if (typeof version !== 'string' || !version.trim()) {
      return { valid: false, value: null, error: 'Definition.version is required and must be a string.', warnings: [] };
    }

    if (inputSchema !== undefined && (typeof inputSchema !== 'object' || inputSchema === null || Array.isArray(inputSchema))) {
      return { valid: false, value: null, error: 'Definition.input_schema must be an object when provided.', warnings: [] };
    }

    if (outputSchema !== undefined && (typeof outputSchema !== 'object' || outputSchema === null || Array.isArray(outputSchema))) {
      return { valid: false, value: null, error: 'Definition.output_schema must be an object when provided.', warnings: [] };
    }

    if (inputSchema === undefined) {
      warnings.push('No input_schema provided. Agents may have limited guidance for tool invocation.');
    }

    if (outputSchema === undefined && parsed.output_expectations === undefined) {
      warnings.push('No output_schema or output_expectations provided. Consider describing the response contract explicitly.');
    }

    if (kind === 'schema-main-spec' && parsed.schema === undefined) {
      warnings.push('schema-main-spec definitions should usually include a schema object with slug and name.');
    }

    return { valid: true, value: parsed, error: null, warnings };
  } catch (error) {
    return {
      valid: false,
      value: null,
      error: error instanceof Error ? error.message : 'Invalid JSON',
      warnings: [],
    };
  }
}

const SpecEditor = () => {
  const { specSlug } = useParams<{ specSlug: string }>();
  const navigate = useNavigate();
  const { language } = useTheme();
  const isEditing = Boolean(specSlug && specSlug !== 'new');

  const [isLoading, setIsLoading] = useState(isEditing);
  const [isSaving, setIsSaving] = useState(false);
  const [existingSpec, setExistingSpec] = useState<SpecRecord | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [definitionText, setDefinitionText] = useState(JSON.stringify(DEFAULT_DEFINITION, null, 2));
  const [llmInstructions, setLlmInstructions] = useState('');
  const [status, setStatus] = useState<SpecRecord['status']>('draft');
  const [isPublic, setIsPublic] = useState(false);
  const [isMainTemplate, setIsMainTemplate] = useState(false);
  const [tagsText, setTagsText] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('generic-tool');

  useEffect(() => {
    if (!isEditing || !specSlug) {
      setIsLoading(false);
      return;
    }

    const loadSpec = async () => {
      try {
        const spec = await getSpec(specSlug);
        setExistingSpec(spec);
        setName(spec.name);
        setSlug(spec.slug);
        setSlugEdited(true);
        setDescription(spec.description ?? '');
        setDefinitionText(JSON.stringify(spec.definition, null, 2));
        setLlmInstructions(spec.llm_instructions ?? '');
        setStatus(spec.status);
        setIsPublic(spec.is_public);
        setIsMainTemplate(spec.is_main_template);
        setTagsText(spec.tags.join(', '));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to load spec.');
        navigate('/specs', { replace: true });
      } finally {
        setIsLoading(false);
      }
    };

    void loadSpec();
  }, [isEditing, navigate, specSlug]);

  useEffect(() => {
    if (!slugEdited) {
      setSlug(generateSlug(name));
    }
  }, [name, slugEdited]);

  const parsedDefinition = useMemo(() => validateDefinition(definitionText), [definitionText]);

  const applyTemplate = (templateId: string) => {
    const template = SPEC_TEMPLATES.find((entry) => entry.id === templateId);
    if (!template) {
      return;
    }

    setSelectedTemplateId(templateId);
    setDefinitionText(JSON.stringify(template.definition, null, 2));
    if (!name.trim()) {
      setName(template.name);
    }
    toast.success(language === 'en' ? `Loaded template: ${template.name}` : `Vorlage geladen: ${template.name}`);
  };

  const handleSave = async (nextStatus?: SpecRecord['status']) => {
    const targetStatus = nextStatus ?? status;

    if (!name.trim()) {
      toast.error(language === 'en' ? 'Name is required.' : 'Name ist erforderlich.');
      return;
    }

    if (!slug.trim()) {
      toast.error(language === 'en' ? 'Slug is required.' : 'Slug ist erforderlich.');
      return;
    }

    if (!parsedDefinition.valid || !parsedDefinition.value) {
      toast.error(language === 'en' ? 'Definition JSON must be valid.' : 'Definition-JSON muss gültig sein.');
      return;
    }

    const payload: SaveSpecInput = {
      name,
      slug,
      description: description || null,
      definition: parsedDefinition.value,
      llm_instructions: llmInstructions || null,
      status: targetStatus,
      is_public: isPublic,
      is_main_template: isMainTemplate,
      tags: tagsText.split(',').map((entry) => entry.trim()).filter(Boolean),
      metadata: existingSpec?.metadata ?? {},
    };

    try {
      setIsSaving(true);
      const savedSpec = existingSpec
        ? await updateSpec(existingSpec.id, payload)
        : await createSpec(payload);
      setStatus(savedSpec.status);
      toast.success(
        targetStatus === 'published'
          ? (language === 'en' ? 'Spec published.' : 'Spec veröffentlicht.')
          : (language === 'en' ? 'Spec saved.' : 'Spec gespeichert.'),
      );
      navigate(`/specs/${savedSpec.slug}`, { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save spec.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <AdminPageLayout title={language === 'en' ? 'Specs' : 'Specs'} icon={Bot}>
        <AdminCard className="flex min-h-[280px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </AdminCard>
      </AdminPageLayout>
    );
  }

  return (
    <AdminPageLayout
      title={isEditing ? (language === 'en' ? 'Edit Spec' : 'Spec bearbeiten') : (language === 'en' ? 'New Spec' : 'Neue Spec')}
      description={language === 'en'
        ? 'Define reusable agent-readable tool contracts for schema registration, REST discovery, and MCP.'
        : 'Definiere wiederverwendbare agentenlesbare Tool-Verträge für Schema-Registrierung, REST-Discovery und MCP.'}
      icon={Bot}
      actions={(
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link to="/specs">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {language === 'en' ? 'Back' : 'Zurück'}
            </Link>
          </Button>
          {status !== 'published' ? (
            <Button variant="secondary" onClick={() => void handleSave('published')} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {language === 'en' ? 'Publish spec' : 'Spec veröffentlichen'}
            </Button>
          ) : null}
          <Button onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {language === 'en' ? 'Save spec' : 'Spec speichern'}
          </Button>
        </div>
      )}
    >
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <AdminCard title={language === 'en' ? 'Definition' : 'Definition'} icon={FileCode2} iconColor="from-indigo-500 to-cyan-600">
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="spec-name">{language === 'en' ? 'Name' : 'Name'}</Label>
                <Input id="spec-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Customer Support Bot" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="spec-slug">Slug</Label>
                <Input
                  id="spec-slug"
                  value={slug}
                  onChange={(event) => {
                    setSlugEdited(true);
                    setSlug(generateSlug(event.target.value));
                  }}
                  placeholder="customer-support-bot"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="spec-description">{language === 'en' ? 'Description' : 'Beschreibung'}</Label>
              <Textarea id="spec-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{language === 'en' ? 'Status' : 'Status'}</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as SpecRecord['status'])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="spec-tags">Tags</Label>
                <Input id="spec-tags" value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="schema, customer-support, public-tool" />
                <p className="text-xs text-muted-foreground">
                  {language === 'en' ? 'Comma-separated tags for discovery and filtering.' : 'Kommagetrennte Tags für Discovery und Filterung.'}
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label>{language === 'en' ? 'Public discovery' : 'Öffentliche Discovery'}</Label>
                    <p className="text-xs text-muted-foreground">
                      {language === 'en' ? 'Allow the spec to be returned by public REST/MCP discovery when attached to registered schemas.' : 'Erlaube, dass die Spec bei öffentlicher REST/MCP-Discovery erscheint, wenn sie an registrierte Schemas angehängt ist.'}
                    </p>
                  </div>
                  <Switch checked={isPublic} onCheckedChange={setIsPublic} />
                </div>
              </div>

              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label>{language === 'en' ? 'Registry template' : 'Registry-Vorlage'}</Label>
                    <p className="text-xs text-muted-foreground">
                      {language === 'en' ? 'Mark this spec as a reusable template for schema editors.' : 'Markiere diese Spec als wiederverwendbare Vorlage für Schema-Editoren.'}
                    </p>
                  </div>
                  <Switch checked={isMainTemplate} onCheckedChange={setIsMainTemplate} />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="spec-llm-instructions">LLM Instructions</Label>
              <Textarea
                id="spec-llm-instructions"
                value={llmInstructions}
                onChange={(event) => setLlmInstructions(event.target.value)}
                rows={5}
                placeholder="Explain how agents should interpret and use this spec."
              />
            </div>

            <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">{language === 'en' ? 'Starter Templates' : 'Startvorlagen'}</p>
              </div>
              <Select value={selectedTemplateId} onValueChange={applyTemplate}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPEC_TEMPLATES.map((template) => (
                    <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {SPEC_TEMPLATES.find((template) => template.id === selectedTemplateId)?.description}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="spec-definition">Definition JSON</Label>
              <Textarea
                id="spec-definition"
                value={definitionText}
                onChange={(event) => setDefinitionText(event.target.value)}
                rows={22}
                className="font-mono text-xs"
              />
            </div>
          </div>
        </AdminCard>

        <div className="space-y-6">
          <AdminCard title={language === 'en' ? 'Validation' : 'Validierung'} icon={parsedDefinition.valid ? CheckCircle2 : AlertCircle} iconColor={parsedDefinition.valid ? 'from-emerald-500 to-teal-600' : 'from-amber-500 to-red-600'}>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant={parsedDefinition.valid ? 'default' : 'destructive'}>
                  {parsedDefinition.valid ? (language === 'en' ? 'Definition valid' : 'Definition gültig') : (language === 'en' ? 'Definition invalid' : 'Definition ungültig')}
                </Badge>
                <Badge variant="outline">{status}</Badge>
                <Badge variant="outline">{isPublic ? (language === 'en' ? 'Public' : 'Öffentlich') : (language === 'en' ? 'Private' : 'Privat')}</Badge>
              </div>

              {!parsedDefinition.valid && parsedDefinition.error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{language === 'en' ? 'JSON Error' : 'JSON-Fehler'}</AlertTitle>
                  <AlertDescription>{parsedDefinition.error}</AlertDescription>
                </Alert>
              )}

              {parsedDefinition.warnings.length > 0 && (
                <Alert>
                  <Lightbulb className="h-4 w-4" />
                  <AlertTitle>{language === 'en' ? 'Authoring Hints' : 'Authoring-Hinweise'}</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-4">
                      {parsedDefinition.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {parsedDefinition.valid && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>{language === 'en' ? 'Ready for discovery' : 'Bereit für Discovery'}</AlertTitle>
                  <AlertDescription>
                    {language === 'en'
                      ? 'Public exposure still depends on schema attachment and schema registration status.'
                      : 'Die öffentliche Sichtbarkeit hängt weiterhin von Schema-Anhang und Schema-Registrierungsstatus ab.'}
                  </AlertDescription>
                </Alert>
              )}

              <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-2">
                  {language === 'en' ? 'Recommended structure' : 'Empfohlene Struktur'}
                </p>
                <p>
                  {language === 'en'
                    ? 'At minimum include kind, version, and either input_schema or schema. Add output_schema or output_expectations when agents should understand the response contract.'
                    : 'Enthalten sein sollten mindestens kind, version und entweder input_schema oder schema. Ergänze output_schema oder output_expectations, wenn Agenten den Antwortvertrag verstehen sollen.'}
                </p>
              </div>
            </div>
          </AdminCard>

          <AdminCard title={language === 'en' ? 'Definition Preview' : 'Definitionsvorschau'} icon={FileCode2} iconColor="from-slate-700 to-slate-900">
            <pre className="max-h-[460px] overflow-auto rounded-lg bg-muted p-4 text-xs font-mono">
              {parsedDefinition.valid
                ? JSON.stringify(parsedDefinition.value, null, 2)
                : definitionText}
            </pre>
          </AdminCard>
        </div>
      </div>
    </AdminPageLayout>
  );
};

export default SpecEditor;