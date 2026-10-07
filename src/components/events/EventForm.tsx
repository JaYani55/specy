import React, { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as zod from 'zod';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTheme } from "../../contexts/ThemeContext";
import { useActiveWorkspace } from '@/contexts/ActiveWorkspaceContext';
import { getSchemas } from '@/services/pageService';
import type { PageSchema } from '@/types/pagebuilder';
import { isValidIanaTimezone } from '@/utils/eventPage';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EventStatus, EventMode, EventRegistrationStatus } from '@/types/event';
import { format } from 'date-fns';
import { fetchProductById, Product } from '../../services/events/productService';
import { supabase } from "@/lib/supabase";
import { calculateEndTime } from '@/utils/timeUtils';
import { PastEventWarningDialog } from './PastEventWarningDialog';
import { ProductSection } from "./EventFormSections/ProductSection";
import { StaffSection } from "./EventFormSections/StaffSection";
import { CompanySection } from "./EventFormSections/CompanySection";
import { DateTimeSection } from "./EventFormSections/DateTimeSection";
import { AdditionalInfoAndLinkSection } from "./EventFormSections/AdditionalInfoAndLinkSection";
import { LockAndMentorCountSection } from "./EventFormSections/LockAndMentorCountSection";
import { FooterSection } from "./EventFormSections/FooterSection";
import { MissingEntryTooltipLabel } from "./EventFormSections/MissingEntryTooltipLabel";
import { Users, Building2, CalendarDays, Info } from "lucide-react";
import { toast } from 'sonner';
import { TenantCustomFieldsEditor } from '@/components/products/CustomFieldsEditor';
import { getTenantCustomFieldDefinitions, type TenantCustomFieldDefinitions } from '@/services/tenantCustomFieldsService';
import { validateTenantCustomFieldValues } from '@/utils/tenantCustomFields';
import { isCatalogueSchema } from '@/utils/schemaKinds';

const formSchema = zod.object({
  company_id: zod.string().optional(),
  company: zod.string().trim().optional(),
  date: zod.string().min(1, { message: "Date is required" }),
  time: zod.string().min(1, { message: "Time is required" }),
  duration_minutes: zod.number().min(1, { message: "Duration is required" }),
  description: zod.string().optional(),
  status: zod.enum(['new', 'firstRequests', 'successPartly', 'successComplete', 'locked']),
  mode: zod.enum(['live', 'online', 'hybrid']).optional(),
  required_staff_count: zod.number().min(1, { message: "At least one staff member is required" }),
  required_trait_id: zod.number().nullable().optional(),
  product_id: zod.number().optional(),
  event_schema_id: zod.string().optional(),
  event_page_name: zod.string().optional(),
  timezone: zod.string().optional(),
  staff_members: zod.array(zod.string()).min(1, { message: "At least one staff member is required" }),
  teams_link: zod.string().optional(),
  initial_selected_mentors: zod.array(zod.string()).optional(),
  custom_fields: zod.record(zod.string(), zod.unknown()).default({}),
  registration_status: zod.enum(['open', 'waitlist', 'full', 'closed', 'cancelled']).nullable(),
  participant_min: zod.number().int().min(1).nullable(),
  participant_max: zod.number().int().min(1).nullable(),
  ProductInfo: zod.object({
    id: zod.number(),
    name: zod.string(),
    icon_name: zod.string().optional(),
    gradient: zod.string().optional(),
    description_de: zod.string(),
    description_effort: zod.string(),
  }).optional(),
}).superRefine((values, context) => {
  if (values.event_schema_id && !values.event_page_name?.trim()) {
    context.addIssue({ code: zod.ZodIssueCode.custom, path: ['event_page_name'], message: 'A public page title is required.' });
  }
  if (values.event_schema_id && !values.company?.trim()) {
    context.addIssue({ code: zod.ZodIssueCode.custom, path: ['company'], message: 'Für öffentliche Veranstaltungsseiten ist ein Unternehmen erforderlich.' });
  }
  if (values.event_schema_id && !isValidIanaTimezone(values.timezone ?? '')) {
    context.addIssue({ code: zod.ZodIssueCode.custom, path: ['timezone'], message: 'Choose a valid IANA timezone.' });
  }
  if (values.participant_min !== null && values.participant_max !== null
    && values.participant_min !== undefined && values.participant_max !== undefined
    && values.participant_min > values.participant_max) {
    context.addIssue({ code: zod.ZodIssueCode.custom, path: ['participant_min'], message: 'Die Mindestzahl darf die Höchstzahl nicht überschreiten.' });
  }
});

export type EventFormValues = zod.infer<typeof formSchema>;

interface EventFormProps {
  initialValues?: {
    id?: string;
    company_id?: string;
    tenant_id?: string;
    company?: string;
    date?: string;
    time?: string;
    end_time?: string;
    duration_minutes?: number;
    description?: string;
    status?: EventStatus;
    mode?: EventMode;
    required_staff_count?: number;
    required_trait_id?: number | null;
    product_id?: number;
    staff_members?: string[];
    teams_link?: string;
    initial_selected_mentors?: string[];
    page_id?: string | null;
    event_schema_id?: string;
    event_page_name?: string;
    timezone?: string;
    custom_fields?: Record<string, unknown>;
    registration_status?: EventRegistrationStatus | null;
    participant_min?: number | null;
    participant_max?: number | null;
  };
  onSubmit: (values: EventFormValues) => Promise<void>;
  isLoading: boolean;
  mode: 'create' | 'edit';
}

export const EventForm: React.FC<EventFormProps> = ({
  initialValues,
  onSubmit,
  isLoading,
  mode
}) => {
  const { language } = useTheme();
  const { activeTenantId, loading: workspaceLoading } = useActiveWorkspace();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const [eventSchemas, setEventSchemas] = useState<PageSchema[]>([]);
  const [customFieldDefinitions, setCustomFieldDefinitions] = useState<TenantCustomFieldDefinitions>({});
  const [customFieldsValid, setCustomFieldsValid] = useState(true);

  const form = useForm<EventFormValues>({
    resolver: zodResolver(formSchema),
    shouldFocusError: true,
    defaultValues: {
      company_id: initialValues?.company_id || "",
      company: initialValues?.company || "",
      date: initialValues?.date || format(new Date(), 'yyyy-MM-dd'),
      time: initialValues?.time || '09:00',
      duration_minutes: initialValues?.duration_minutes || 60,
      description: initialValues?.description || '',
      status: initialValues?.status || 'new',
      mode: initialValues?.mode || 'online',
      required_staff_count: initialValues?.required_staff_count ?? 1,
      required_trait_id: initialValues?.required_trait_id ?? null,
      product_id: initialValues?.product_id,
      event_schema_id: initialValues?.event_schema_id,
      event_page_name: initialValues?.event_page_name || '',
      timezone: initialValues?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      staff_members: initialValues?.staff_members || [],
      teams_link: initialValues?.teams_link || "",
      initial_selected_mentors: initialValues?.initial_selected_mentors || [],
      custom_fields: initialValues?.custom_fields || {},
      registration_status: initialValues?.registration_status === undefined ? 'closed' : initialValues.registration_status,
      participant_min: initialValues?.participant_min ?? null,
      participant_max: initialValues?.participant_max ?? null,
    }
  });

  const formElementRef = useRef<HTMLFormElement>(null);
  const validationMessages = Object.values(form.formState.errors)
    .map((error) => error?.message)
    .filter((message): message is string => typeof message === 'string');
  const isDirty = form.formState.isDirty;

  const selectedMode = form.watch('mode');
  const showTeamsLink = selectedMode === 'online' || selectedMode === 'hybrid';
  const watchedProductId = form.watch('product_id');
  const customFieldValues = form.watch('custom_fields') ?? {};

  useEffect(() => {
    const warnUnsavedChanges = (e: BeforeUnloadEvent) => {
      if (isDirty && !isLoading) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    
    window.addEventListener('beforeunload', warnUnsavedChanges);
    return () => window.removeEventListener('beforeunload', warnUnsavedChanges);
  }, [isDirty, isLoading]);

  const [showPastEventWarning, setShowPastEventWarning] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState<EventFormValues | null>(null);

  const handleInvalidSubmit = () => {
    toast.error(mode === 'create'
      ? language === 'en' ? 'Check the highlighted fields before creating the event.' : 'Bitte prüfe die markierten Felder, bevor du die Veranstaltung erstellst.'
      : language === 'en' ? 'Check the highlighted fields before saving the event.' : 'Bitte prüfe die markierten Felder, bevor du die Veranstaltung speicherst.');
    formElementRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleSubmit = async (values: EventFormValues) => {
    try {
      if (!customFieldsValid) throw new Error(language === 'en' ? 'Fix the invalid JSON custom fields.' : 'Bitte korrigiere die ungültigen JSON-Felder.');
      const customFieldError = validateTenantCustomFieldValues(customFieldDefinitions, values.custom_fields ?? {});
      if (customFieldError) throw new Error(customFieldError);
      if (mode === 'create') {
        const selectedDate = new Date(values.date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        selectedDate.setHours(0, 0, 0, 0);

        if (selectedDate < today) {
          setPendingSubmission(values);
          setShowPastEventWarning(true);
          return;
        }
      }

      await submitEvent(values);
    } catch (error) {
      console.error('Error submitting event form:', error);
      toast.error(error instanceof Error
        ? error.message
        : language === 'en' ? 'Event form could not be submitted.' : 'Das Veranstaltungsformular konnte nicht gesendet werden.');
    }
  };

  const submitEvent = async (values: EventFormValues) => {
    if (values.product_id) {
      const productDetails = activeTenantId ? await fetchProductById(values.product_id, activeTenantId) : null;

      if (productDetails) {
        values.ProductInfo = {
          id: productDetails.id,
          name: productDetails.name,
          icon_name: productDetails.icon_name,
          gradient: productDetails.gradient,
          description_de: productDetails.description_de,
          description_effort: productDetails.description_effort,
        };
      }
    }
    
    await onSubmit(values);
  };

  const selectedEventSchemaId = form.watch('event_schema_id');
  const watchedTime = form.watch('time');
  const watchedDuration = form.watch('duration_minutes');

  useEffect(() => {
    let cancelled = false;
    if (!activeTenantId) {
      setEventSchemas([]);
      if (mode === 'create') form.setValue('event_schema_id', undefined);
      return;
    }
    void getSchemas(activeTenantId).then((schemas) => {
      if (cancelled) return;
      const eligibleSchemas = schemas.filter((schema) =>
        isCatalogueSchema(schema.entity_kind) && schema.content_scope === 'page-collection' && schema.tenant_id === activeTenantId
      );
      setEventSchemas(eligibleSchemas);
      const selectedSchemaId = form.getValues('event_schema_id');
      if (mode === 'create' && selectedSchemaId && !eligibleSchemas.some((schema) => schema.id === selectedSchemaId)) {
        form.setValue('event_schema_id', undefined, { shouldDirty: true });
        form.setValue('event_page_name', '', { shouldDirty: true });
      }
      // Preselect the first available event catalogue so new events default
      // to a public page whenever a schema is configured for the workspace.
      if (mode === 'create' && !selectedSchemaId && eligibleSchemas.length > 0) {
        form.setValue('event_schema_id', eligibleSchemas[0].id, { shouldDirty: true });
      }
    }).catch((error) => {
      console.error('Could not load event schemas for the active workspace:', error);
      if (!cancelled) setEventSchemas([]);
    });
    return () => { cancelled = true; };
  }, [activeTenantId, form, mode]);

  useEffect(() => {
    const fetchSelectedProduct = async () => {
      const productId = form.getValues('product_id');
      if (productId) {
        try {
          if (!activeTenantId) {
            if (!workspaceLoading) form.setValue('product_id', undefined, { shouldDirty: true });
            setSelectedProduct(null);
            return;
          }
          const product = await fetchProductById(productId, activeTenantId);
          setSelectedProduct(product);
          if (!product) form.setValue('product_id', undefined, { shouldDirty: true });

          if (
            product?.min_amount_mentors != null &&
            (mode === 'create' || !form.getValues('required_staff_count'))
          ) {
            form.setValue('required_staff_count', product.min_amount_mentors, { shouldDirty: true });
          }
        } catch (error) {
          console.error('Error fetching product details:', error);
        }
      } else {
        setSelectedProduct(null);
      }
    };

    void fetchSelectedProduct();
  }, [watchedProductId, form, mode, activeTenantId, workspaceLoading]);

  useEffect(() => {
    let cancelled = false;
    setCustomFieldDefinitions({});
    setCustomFieldsValid(true);
    if (!activeTenantId) return;
    const loadEventFields = async () => {
      try {
        if (watchedProductId !== undefined) {
          const product = await fetchProductById(watchedProductId, activeTenantId);
          if (!cancelled) setCustomFieldDefinitions(product?.custom_field_schema?.event ?? {});
        } else {
          // Compatibility for private/legacy Events that have no Product association.
          const definitions = await getTenantCustomFieldDefinitions(activeTenantId, 'event');
          if (!cancelled) setCustomFieldDefinitions(definitions);
        }
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : 'Eigene Veranstaltungsangaben konnten nicht geladen werden.');
      }
    };
    void loadEventFields();
    return () => { cancelled = true; };
  }, [activeTenantId, watchedProductId]);

  useEffect(() => {
    const fetchGroupNames = async () => {
      try {
        const { data, error } = await supabase
          .from('mentor_groups')
          .select('id, group_name')
          .eq('tenant_id', activeTenantId);
          
        if (error) {
          console.error('Error fetching traits:', error);
          return;
        }

        const groupMap = data.reduce((acc, group) => {
          acc[group.id] = group.group_name;
          return acc;
        }, {} as Record<string, string>);
        
        setGroupNames(groupMap);
      } catch (err) {
        console.error('Error in fetchGroupNames:', err);
      }
    };

    void fetchGroupNames();
  }, [activeTenantId]);

  const endTime = React.useMemo(() => {
    if (watchedTime && watchedDuration) {
      return calculateEndTime(watchedTime, watchedDuration);
    }
    return '';
  }, [watchedTime, watchedDuration]);

  return (
    <Card className="w-full bg-background/80 shadow-xl border-none rounded-2xl p-0">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-2xl font-bold">
          {mode === 'create'
            ? language === 'en' ? 'Create New Event' : 'Neue Veranstaltung erstellen'
            : language === 'en' ? 'Edit Event' : 'Veranstaltung bearbeiten'
          }
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        <Form {...form}>
          <form ref={formElementRef} onSubmit={form.handleSubmit(handleSubmit, handleInvalidSubmit)} className="space-y-10">
            {form.formState.isSubmitted && validationMessages.length > 0 && (
              <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <p className="font-semibold">
                  {language === 'en' ? 'Please fix the following before saving:' : 'Bitte korrigiere vor dem Speichern:'}
                </p>
                <ul className="mt-1 list-inside list-disc">
                  {validationMessages.map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}
                </ul>
              </div>
            )}
            {/* Product Section */}
            <div>
              <ProductSection
                form={form}
                selectedProduct={selectedProduct}
                groupNames={groupNames}
                isLoading={isLoading}
                language={language}
              />
            </div>
            {(mode === 'create' || Boolean(initialValues?.page_id)) && (
              <section className="space-y-4 rounded-xl border p-5">
                <div>
                  <h2 className="text-lg font-semibold">{language === 'en' ? 'Public event page' : 'Öffentliche Veranstaltungsseite'}</h2>
                  <p className="text-sm text-muted-foreground">
                    {language === 'en'
                      ? 'Optional. The page starts as a draft and is published separately from the event schedule.'
                      : 'Optional. Die Seite wird zunächst als Entwurf angelegt und unabhängig vom Veranstaltungsstatus veröffentlicht.'}
                  </p>
                </div>
                <FormField control={form.control} name="event_schema_id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{language === 'en' ? 'Event catalogue' : 'Veranstaltungskatalog'}</FormLabel>
                    <Select value={field.value || 'private'} onValueChange={(value) => field.onChange(value === 'private' ? undefined : value)}>
                      <FormControl><SelectTrigger disabled={isLoading || eventSchemas.length === 0 || mode === 'edit'}><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="private">{language === 'en' ? 'No public page' : 'Keine öffentliche Seite'}</SelectItem>
                        {eventSchemas.map((schema) => <SelectItem key={schema.id} value={schema.id}>{schema.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                    {eventSchemas.length === 0 && <p className="text-xs text-muted-foreground">{language === 'en' ? 'No event catalogue is configured for this workspace.' : 'Für diesen Workspace ist kein Veranstaltungskatalog eingerichtet.'}</p>}
                  </FormItem>
                )} />
                {selectedEventSchemaId && (
                  <>
                    {mode === 'create' && <FormField control={form.control} name="event_page_name" render={({ field }) => (
                      <FormItem>
                        <MissingEntryTooltipLabel
                          label={language === 'en' ? 'Public page title' : 'Titel der öffentlichen Seite'}
                          missingText={!(field.value || '').trim()
                            ? language === 'en'
                              ? 'The public page title is missing. Please enter the title under which the event page will be published.'
                              : 'Der Titel der öffentlichen Seite fehlt. Bitte gib den Titel ein, unter dem die Veranstaltungsseite veröffentlicht wird.'
                            : null}
                        />
                        <FormControl><Input {...field} value={field.value || ''} placeholder={language === 'en' ? 'Event title' : 'Veranstaltungstitel'} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />}
                    <FormField control={form.control} name="timezone" render={({ field }) => (
                      <FormItem>
                        <MissingEntryTooltipLabel
                          label={language === 'en' ? 'Event timezone (IANA)' : 'Zeitzone der Veranstaltung (IANA)'}
                          missingText={!(field.value || '').trim()
                            ? language === 'en'
                              ? 'The event timezone is missing. Please confirm the IANA timezone used for public delivery.'
                              : 'Die Zeitzone der Veranstaltung fehlt. Bitte bestätige die IANA-Zeitzone für die öffentliche Auslieferung.'
                            : null}
                        />
                        <FormControl><Input {...field} value={field.value || ''} placeholder="Europe/Berlin" /></FormControl>
                        <FormMessage />
                        <p className="text-xs text-muted-foreground">{language === 'en' ? 'Confirm the timezone used for the event; it is included in public delivery.' : 'Bestätige die Zeitzone der Veranstaltung; sie wird öffentlich mit ausgeliefert.'}</p>
                      </FormItem>
                    )} />
                  </>
                )}
              </section>
            )}
            {/* Staff Section with optional Company subsection */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-6 w-6 text-primary" />
                <span className="font-semibold text-xl">{language === "en" ? "Staff" : "Mitarbeiter"}</span>
              </div>
              <StaffSection
                form={form}
                isLoading={isLoading}
                language={language}
              />
              <div className="mt-6">
                <div className="flex items-center gap-2 mb-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  <span className="font-semibold text-lg">{language === "en" ? "Company (optional)" : "Unternehmen (optional)"}</span>
                </div>
                <CompanySection
                  form={form}
                  isLoading={isLoading}
                  language={language}
                />
              </div>
            </div>
            {/* Date & Time Section */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <CalendarDays className="h-6 w-6 text-primary" />
                <span className="font-semibold text-xl">{language === "en" ? "Date & Time" : "Datum & Zeit"}</span>
              </div>
              <DateTimeSection
                form={form}
                endTime={endTime}
                language={language}
                isLoading={isLoading}
              />
            </div>
            {/* Required Staff Section */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-6 w-6 text-primary" />
                <span className="font-semibold text-xl">{language === "en" ? "Required Staff" : "Benötigte Mitarbeiter"}</span>
              </div>
              <LockAndMentorCountSection
                form={form}
                selectedProduct={selectedProduct}
                language={language}
                isLoading={isLoading}
              />
            </div>
            {/* Additional Info Section */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Info className="h-6 w-6 text-primary" />
                <span className="font-semibold text-xl">{language === "en" ? "Special Info" : "Spezielle Infos"}</span>
              </div>
              <AdditionalInfoAndLinkSection
                form={form}
                showTeamsLink={showTeamsLink}
                language={language}
              />
            </div>
            <section className="space-y-4 rounded-lg border p-4">
              <div>
                <h3 className="font-semibold">Anmeldung und Teilnehmendenzahl</h3>
                <p className="text-sm text-muted-foreground">Operative Angaben; unabhängig vom Veröffentlichungsstatus der Seite und vom Personalbedarf.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <FormField control={form.control} name="registration_status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Anmeldestatus</FormLabel>
                    <Select value={field.value ?? '__unset'} onValueChange={(value) => field.onChange(value === '__unset' ? null : value)} disabled={isLoading}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="__unset">Nicht festgelegt</SelectItem>
                        <SelectItem value="open">Offen</SelectItem>
                        <SelectItem value="waitlist">Warteliste</SelectItem>
                        <SelectItem value="full">Ausgebucht</SelectItem>
                        <SelectItem value="closed">Geschlossen</SelectItem>
                        <SelectItem value="cancelled">Abgesagt</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="participant_min" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mindestens Teilnehmende</FormLabel>
                    <FormControl><Input type="number" min={1} step={1} value={field.value ?? ''} onChange={(event) => field.onChange(event.target.value === '' ? null : Number(event.target.value))} disabled={isLoading} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="participant_max" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Höchstens Teilnehmende</FormLabel>
                    <FormControl><Input type="number" min={1} step={1} value={field.value ?? ''} onChange={(event) => field.onChange(event.target.value === '' ? null : Number(event.target.value))} disabled={isLoading} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </section>
            {Object.keys(customFieldDefinitions).length > 0 && (
              <TenantCustomFieldsEditor
                key={`${activeTenantId ?? 'no-workspace'}-${initialValues?.id ?? 'new-event'}-${watchedProductId ?? 'no-product'}`}
                definitions={customFieldDefinitions}
                values={customFieldValues}
                language={language}
                title="Weitere Veranstaltungsangaben"
                description="Zusätzliche Angaben zu dieser Veranstaltung."
                onChange={(customFields) => form.setValue('custom_fields', customFields, { shouldDirty: true })}
                onValidityChange={setCustomFieldsValid}
              />
            )}
            <FooterSection
              isLoading={isLoading}
              mode={mode}
              language={language}
            />
          </form>
        </Form>
      </CardContent>
      <PastEventWarningDialog
        open={showPastEventWarning}
        onOpenChange={setShowPastEventWarning}
        selectedDate={pendingSubmission?.date || ''}
        onContinueCreate={async () => {
          if (pendingSubmission) {
            setShowPastEventWarning(false);
            await submitEvent(pendingSubmission);
            setPendingSubmission(null);
          }
        }}
      />
    </Card>
  );
};