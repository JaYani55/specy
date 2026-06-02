import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Bell, CheckCircle2, ClipboardList, Loader2, Save, Users, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { FormSchemaBuilder } from '@/components/forms/FormSchemaBuilder';
import { AdminCard, AdminPageLayout } from '@/components/admin/ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useTheme } from '@/contexts/ThemeContext';
import { createForm, getForm, getFormNotificationStaffOptions, updateForm } from '@/services/formService';
import { getTenantOptions, pickInitialTenantId, type TenantOption } from '@/services/tenantService';
import { type FormFieldDefinition, type FormNotificationStaffOption, type FormRecord } from '@/types/forms';
import { formFieldsToSchema, formatFormSchema, parseFormSchema } from '@/utils/forms';

const DEFAULT_SCHEMA = {
  first_name: {
    type: 'text',
    label: 'First name',
    placeholder: 'Ada',
    required: true,
  },
  email: {
    type: 'email',
    label: 'Email',
    placeholder: 'ada@example.com',
    required: true,
    meta_description: 'Primary contact address for follow-up.',
  },
  message: {
    type: 'textarea',
    label: 'Message',
    placeholder: 'How can we help?',
    required: true,
  },
  topics: {
    type: 'multi-select',
    label: 'Topics',
    required: false,
    options: ['Sales', 'Support', 'Partnership'],
  },
};

const createEditorFieldId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `form-field-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

const withEditorIds = (fields: FormFieldDefinition[]): FormFieldDefinition[] => (
  fields.map((field) => ({
    ...field,
    editorId: field.editorId || createEditorFieldId(),
  }))
);

const FormEditor = () => {
  const { formId } = useParams<{ formId: string }>();
  const navigate = useNavigate();
  const { language } = useTheme();
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(formId));
  const [isSaving, setIsSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [schemaText, setSchemaText] = useState(JSON.stringify(DEFAULT_SCHEMA, null, 2));
  const [llmInstructions, setLlmInstructions] = useState('');
  const [status, setStatus] = useState<FormRecord['status']>('published');
  const [shareEnabled, setShareEnabled] = useState(false);
  const [shareSlug, setShareSlug] = useState('');
  const [requiresAuth, setRequiresAuth] = useState(false);
  const [apiEnabled, setApiEnabled] = useState(true);
  const [tenantId, setTenantId] = useState('');
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [tenantOptionsLoading, setTenantOptionsLoading] = useState(false);
  const [notifyOwner, setNotifyOwner] = useState(false);
  const [notifyStaff, setNotifyStaff] = useState(false);
  const [deleteAnswerAfterEmail, setDeleteAnswerAfterEmail] = useState(false);
  const [staffRecipientIds, setStaffRecipientIds] = useState<string[]>([]);
  const [staffOptions, setStaffOptions] = useState<FormNotificationStaffOption[]>([]);
  const [staffSearch, setStaffSearch] = useState('');
  const [staffOptionsLoading, setStaffOptionsLoading] = useState(false);
  const [builderFields, setBuilderFields] = useState<FormFieldDefinition[]>(withEditorIds(parseFormSchema(JSON.stringify(DEFAULT_SCHEMA)).fields));
  const schemaSyncSourceRef = useRef<'builder' | 'json' | 'load'>('load');

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

  useEffect(() => {
    const loadStaffOptions = async () => {
      try {
        setStaffOptionsLoading(true);
        const options = await getFormNotificationStaffOptions();
        setStaffOptions(options);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to load staff recipients.');
      } finally {
        setStaffOptionsLoading(false);
      }
    };

    void loadStaffOptions();
  }, []);

  useEffect(() => {
    if (!formId) {
      setIsLoading(false);
      return;
    }

    const loadForm = async () => {
      try {
        const form = await getForm(formId);
        const formattedSchema = formatFormSchema(form.schema);
        setName(form.name);
        setDescription(form.description ?? '');
        schemaSyncSourceRef.current = 'load';
        setSchemaText(formattedSchema);
        setBuilderFields(withEditorIds(parseFormSchema(formattedSchema).fields));
        setLlmInstructions(form.llm_instructions ?? '');
        setStatus(form.status);
        setShareEnabled(form.share_enabled);
        setShareSlug(form.share_slug ?? '');
        setRequiresAuth(form.requires_auth);
        setApiEnabled(form.api_enabled);
        setTenantId(form.tenant_id ?? '');
        setNotifyOwner(Boolean(form.notification_settings?.notify_owner));
        setNotifyStaff(Boolean(form.notification_settings?.notify_staff));
        setDeleteAnswerAfterEmail(Boolean(form.notification_settings?.delete_answer_after_email));
        setStaffRecipientIds(form.notification_settings?.recipients.map((recipient) => recipient.staff_id) ?? []);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to load form.');
        navigate('/forms', { replace: true });
      } finally {
        setIsLoading(false);
      }
    };

    void loadForm();
  }, [formId, navigate]);

  const parsedSchema = useMemo(() => parseFormSchema(schemaText), [schemaText]);

  useEffect(() => {
    if (schemaSyncSourceRef.current !== 'json' && schemaSyncSourceRef.current !== 'load') {
      return;
    }

    if (parsedSchema.valid) {
      setBuilderFields(withEditorIds(parsedSchema.fields));
    }
  }, [parsedSchema.valid, parsedSchema.fields]);

  const handleBuilderChange = (fields: FormFieldDefinition[]) => {
    schemaSyncSourceRef.current = 'builder';
    setBuilderFields(fields);
    setSchemaText(formatFormSchema(formFieldsToSchema(fields)));
  };

  const handleSchemaTextChange = (value: string) => {
    schemaSyncSourceRef.current = 'json';
    setSchemaText(value);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(language === 'en' ? 'Name is required.' : 'Name ist erforderlich.');
      return;
    }

    if (!parsedSchema.valid || !parsedSchema.normalizedSchema) {
      toast.error(language === 'en' ? 'Fix the schema errors first.' : 'Bitte zuerst die Schema-Fehler beheben.');
      return;
    }

    if (tenantOptions.length > 0 && !tenantId) {
      toast.error(language === 'en' ? 'Select a workspace first.' : 'Bitte zuerst einen Workspace auswählen.');
      return;
    }

    try {
      setIsSaving(true);
      const payload = {
        name,
        description,
        schema: parsedSchema.normalizedSchema,
        llm_instructions: llmInstructions,
        status,
        share_enabled: shareEnabled,
        share_slug: shareEnabled ? shareSlug || name : null,
        requires_auth: requiresAuth,
        api_enabled: apiEnabled,
        tenant_id: tenantId || null,
        notification_settings: {
          notify_owner: notifyOwner,
          notify_staff: notifyStaff,
          delete_answer_after_email: deleteAnswerAfterEmail,
          staff_recipient_ids: staffRecipientIds,
        },
      };

      const savedForm = formId
        ? await updateForm(formId, payload)
        : await createForm(payload);

      toast.success(language === 'en' ? 'Form saved.' : 'Formular gespeichert.');
      navigate(`/forms/${savedForm.id}`, { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save form.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <AdminPageLayout title={language === 'en' ? 'Forms' : 'Formulare'} icon={ClipboardList}>
        <AdminCard className="flex min-h-[280px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </AdminCard>
      </AdminPageLayout>
    );
  }

  const filteredStaffOptions = staffOptions.filter((option) => {
    const query = staffSearch.trim().toLowerCase();
    if (!query) return true;
    return option.display_name.toLowerCase().includes(query) || (option.email ?? '').toLowerCase().includes(query);
  });

  const toggleStaffRecipient = (staffId: string, checked: boolean) => {
    setStaffRecipientIds((current) => (
      checked ? [...new Set([...current, staffId])] : current.filter((value) => value !== staffId)
    ));
  };

  return (
    <AdminPageLayout
      title={formId ? (language === 'en' ? 'Edit Form' : 'Formular bearbeiten') : (language === 'en' ? 'New Form' : 'Neues Formular')}
      description={language === 'en'
        ? 'Define the form JSON schema, share settings, and agent instructions.'
        : 'Definiere das JSON-Schema des Formulars, die Share-Einstellungen und die Agent-Anweisungen.'}
      icon={ClipboardList}
      actions={(
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link to="/forms">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {language === 'en' ? 'Back' : 'Zurück'}
            </Link>
          </Button>
          <Button onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {language === 'en' ? 'Save form' : 'Formular speichern'}
          </Button>
        </div>
      )}
    >
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <AdminCard title={language === 'en' ? 'Definition' : 'Definition'} icon={ClipboardList} iconColor="from-emerald-500 to-teal-600">
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="form-name">{language === 'en' ? 'Name' : 'Name'}</Label>
                <Input id="form-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Lead Capture" />
              </div>
              <div className="space-y-2">
                <Label>{language === 'en' ? 'Status' : 'Status'}</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as FormRecord['status'])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="published">Published</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="form-description">{language === 'en' ? 'Description' : 'Beschreibung'}</Label>
              <Textarea id="form-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
            </div>

            <div className="space-y-2">
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
                  ? 'This controls which tenant can manage the form, notifications, and embedded page connections.'
                  : 'Dies steuert, welcher Tenant das Formular, Benachrichtigungen und eingebettete Seitenverknüpfungen verwalten kann.'}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label>{language === 'en' ? 'Share page' : 'Share-Seite'}</Label>
                    <p className="text-xs text-muted-foreground">
                      {language === 'en' ? 'Expose this form at a public or authenticated ServiceCMS URL.' : 'Stelle dieses Formular unter einer öffentlichen oder authentifizierten ServiceCMS-URL bereit.'}
                    </p>
                  </div>
                  <Switch checked={shareEnabled} onCheckedChange={setShareEnabled} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="share-slug">{language === 'en' ? 'Share slug' : 'Share-Slug'}</Label>
                  <Input id="share-slug" value={shareSlug} onChange={(event) => setShareSlug(event.target.value)} disabled={!shareEnabled} placeholder="contact-form" />
                </div>
              </div>

              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label>{language === 'en' ? 'Agent API' : 'Agent-API'}</Label>
                    <p className="text-xs text-muted-foreground">
                      {language === 'en' ? 'Allow GET/POST form access through the worker API.' : 'Erlaube GET/POST-Zugriff auf das Formular über die Worker-API.'}
                    </p>
                  </div>
                  <Switch checked={apiEnabled} onCheckedChange={setApiEnabled} />
                </div>

                <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 p-3">
                  <div>
                    <Label>{language === 'en' ? 'Authentication required' : 'Authentifizierung erforderlich'}</Label>
                    <p className="text-xs text-muted-foreground">
                      {language === 'en' ? 'One setting applies to both share page and REST submissions.' : 'Eine Einstellung gilt sowohl für die Share-Seite als auch für REST-Submits.'}
                    </p>
                  </div>
                  <Switch checked={requiresAuth} onCheckedChange={setRequiresAuth} />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border bg-gradient-to-br from-amber-50 via-white to-orange-50 p-5 dark:from-slate-950 dark:via-slate-900 dark:to-slate-900">
              <div className="mb-4 flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-sm">
                  <Bell className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">
                    {language === 'en' ? 'Submission notifications' : 'Benachrichtigungen bei Einreichungen'}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {language === 'en'
                      ? 'Choose who receives e-mail alerts when this form is submitted.'
                      : 'Lege fest, wer bei einer Einreichung dieses Formulars per E-Mail informiert wird.'}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[0.92fr_1.08fr]">
                <div className="space-y-3 rounded-xl border bg-background/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label>{language === 'en' ? 'Notify form owner' : 'Formularbesitzer benachrichtigen'}</Label>
                      <p className="text-xs text-muted-foreground">
                        {language === 'en'
                          ? 'Sends the alert to the owner account of this form.'
                          : 'Sendet die Benachrichtigung an das Besitzerkonto dieses Formulars.'}
                      </p>
                    </div>
                    <Switch checked={notifyOwner} onCheckedChange={setNotifyOwner} />
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 p-3">
                    <div>
                      <Label>{language === 'en' ? 'Notify staff recipients' : 'Mitarbeiter benachrichtigen'}</Label>
                      <p className="text-xs text-muted-foreground">
                        {language === 'en'
                          ? 'Use the recipient list to notify specific staff records.'
                          : 'Verwende die Empfängerliste, um bestimmte Mitarbeiter-Einträge zu benachrichtigen.'}
                      </p>
                    </div>
                    <Switch checked={notifyStaff} onCheckedChange={setNotifyStaff} />
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 p-3">
                    <div>
                      <Label>{language === 'en' ? 'Delete answer after e-mail delivery' : 'Antwort nach E-Mail-Versand löschen'}</Label>
                      <p className="text-xs text-muted-foreground">
                        {language === 'en'
                          ? 'Removes the saved answer after all notification e-mails for that submission were sent successfully.'
                          : 'Entfernt die gespeicherte Antwort, nachdem alle Benachrichtigungs-E-Mails dieser Einreichung erfolgreich versendet wurden.'}
                      </p>
                    </div>
                    <Switch checked={deleteAnswerAfterEmail} onCheckedChange={setDeleteAnswerAfterEmail} />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {notifyOwner && <Badge>{language === 'en' ? 'Owner enabled' : 'Besitzer aktiv'}</Badge>}
                    {notifyStaff && <Badge variant="secondary">{staffRecipientIds.length} {language === 'en' ? 'staff selected' : 'Mitarbeiter ausgewählt'}</Badge>}
                    {deleteAnswerAfterEmail && (
                      <Badge variant="outline">{language === 'en' ? 'Auto-delete answers' : 'Antworten automatisch löschen'}</Badge>
                    )}
                    {!notifyOwner && !notifyStaff && (
                      <Badge variant="outline">{language === 'en' ? 'No e-mail notifications' : 'Keine E-Mail-Benachrichtigungen'}</Badge>
                    )}
                  </div>
                </div>

                <div className="space-y-3 rounded-xl border bg-background/80 p-4">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <Label htmlFor="staff-recipient-search">{language === 'en' ? 'Staff recipients' : 'Mitarbeiter-Empfänger'}</Label>
                  </div>

                  <Input
                    id="staff-recipient-search"
                    value={staffSearch}
                    onChange={(event) => setStaffSearch(event.target.value)}
                    placeholder={language === 'en' ? 'Search by name or e-mail' : 'Nach Name oder E-Mail suchen'}
                    disabled={staffOptionsLoading}
                  />

                  <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border bg-muted/20 p-2">
                    {staffOptionsLoading && (
                      <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {language === 'en' ? 'Loading staff...' : 'Lade Mitarbeiter...'}
                      </div>
                    )}

                    {!staffOptionsLoading && filteredStaffOptions.length === 0 && (
                      <p className="px-2 py-3 text-sm text-muted-foreground">
                        {language === 'en' ? 'No matching staff found.' : 'Keine passenden Mitarbeiter gefunden.'}
                      </p>
                    )}

                    {!staffOptionsLoading && filteredStaffOptions.map((option) => {
                      const checked = staffRecipientIds.includes(option.id);
                      return (
                        <label
                          key={option.id}
                          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${checked ? 'border-amber-300 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/30' : 'bg-background hover:bg-muted/50'} ${!notifyStaff ? 'opacity-60' : ''}`}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) => toggleStaffRecipient(option.id, Boolean(value))}
                            disabled={!notifyStaff}
                            className="mt-0.5"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{option.display_name}</span>
                              {option.email && <Badge variant="outline">{option.email}</Badge>}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {option.account_user_id
                                ? (language === 'en' ? 'Linked to a user account.' : 'Mit einem Benutzerkonto verknüpft.')
                                : (language === 'en' ? 'Standalone staff record.' : 'Eigenständiger Mitarbeiter-Eintrag.')}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="llm-instructions">LLM Instructions</Label>
              <Textarea
                id="llm-instructions"
                value={llmInstructions}
                onChange={(event) => setLlmInstructions(event.target.value)}
                rows={5}
                placeholder="Explain how agents should fill or validate this form."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="schema-json">{language === 'en' ? 'Schema JSON' : 'Schema-JSON'}</Label>
              <div className="rounded-2xl border bg-gradient-to-br from-white to-muted/20 p-5 dark:from-slate-950 dark:to-slate-900">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
                    <Wand2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">
                      {language === 'en' ? 'Form Builder' : 'Form Builder'}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {language === 'en'
                        ? 'Add field blocks above and keep the generated JSON schema below in sync.'
                        : 'Füge oben Feld-Blöcke hinzu und halte das generierte JSON-Schema unten synchron.'}
                    </p>
                  </div>
                </div>
                <FormSchemaBuilder
                  fields={builderFields}
                  language={language}
                  tenantId={tenantId || null}
                  onChange={handleBuilderChange}
                />
              </div>

              <Textarea
                id="schema-json"
                value={schemaText}
                onChange={(event) => handleSchemaTextChange(event.target.value)}
                rows={22}
                className="font-mono text-xs"
              />
            </div>
          </div>
        </AdminCard>

        <div className="space-y-6">
          <AdminCard title={language === 'en' ? 'Validation' : 'Validierung'} icon={parsedSchema.valid ? CheckCircle2 : AlertCircle} iconColor={parsedSchema.valid ? 'from-emerald-500 to-teal-600' : 'from-amber-500 to-red-600'}>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant={parsedSchema.valid ? 'default' : 'destructive'}>
                  {parsedSchema.valid ? (language === 'en' ? 'Schema valid' : 'Schema gültig') : (language === 'en' ? 'Schema invalid' : 'Schema ungültig')}
                </Badge>
                <Badge variant="outline">{parsedSchema.fields.length} fields</Badge>
              </div>

              {parsedSchema.errors.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{language === 'en' ? 'Errors' : 'Fehler'}</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4 space-y-1">
                      {parsedSchema.errors.map((error) => <li key={error}>{error}</li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {parsedSchema.warnings.length > 0 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{language === 'en' ? 'Warnings' : 'Hinweise'}</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4 space-y-1">
                      {parsedSchema.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </AdminCard>

          <AdminCard title={language === 'en' ? 'Fields Preview' : 'Feldvorschau'} icon={ClipboardList} iconColor="from-slate-700 to-slate-900">
            <div className="space-y-3">
              {parsedSchema.fields.map((field) => (
                <div key={field.name} className="rounded-lg border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{field.label}</p>
                      <p className="text-xs text-muted-foreground">{field.name}</p>
                    </div>
                    <div className="flex gap-2">
                      <Badge variant="outline">{field.type}</Badge>
                      {field.required && <Badge>{language === 'en' ? 'Required' : 'Pflichtfeld'}</Badge>}
                    </div>
                  </div>
                  {field.description && (
                    <p className="mt-2 text-sm text-muted-foreground">{field.description}</p>
                  )}
                  {field.options && field.options.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {field.options.map((option) => <Badge key={option} variant="secondary">{option}</Badge>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </AdminCard>
        </div>
      </div>
    </AdminPageLayout>
  );
};

export default FormEditor;