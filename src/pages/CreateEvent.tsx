import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useTheme } from '../contexts/ThemeContext';
import { EventForm, EventFormValues } from '../components/events/EventForm';
import { supabase } from '../lib/supabase';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { useData } from '../contexts/DataContext';
import { calculateEndTime } from '@/utils/timeUtils';
import { ensureCompanyRecord } from '@/services/company/companyService';
import { useActiveWorkspace } from '@/contexts/ActiveWorkspaceContext';
import { createPublicEventPage } from '@/services/events/eventPageService';
import { getSchema } from '@/services/pageService';
import { getSchemaConsolePath } from '@/utils/schemaPaths';
import { normalizeEventPageSlug } from '@/utils/eventPage';
import { isCatalogueSchema } from '@/utils/schemaKinds';

interface CreateEventNavigationState {
  preselectedProductId?: unknown;
  returnTo?: unknown;
}

const CreateEvent = () => {
  const { user, loading } = useAuth();
  const permissions = usePermissions();
  const { language } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationState = location.state as CreateEventNavigationState | null;
  const preselectedProductId = Number.isSafeInteger(navigationState?.preselectedProductId)
    ? navigationState?.preselectedProductId as number
    : undefined;
  const returnTo = typeof navigationState?.returnTo === 'string'
    && navigationState.returnTo.startsWith('/')
    && !navigationState.returnTo.startsWith('//')
    ? navigationState.returnTo
    : null;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { refetchEvents } = useData();
  const { activeTenantId, loading: workspaceLoading } = useActiveWorkspace();
  
  // Use centralized permission instead of role checks
  const canShowForm = !loading && user && permissions.canCreateEvents;
  
  // Redirect non-authorized users once auth is loaded
  useEffect(() => {
    if (!loading && user && !permissions.canCreateEvents) {
      navigate('/events');
    }
  }, [user, loading, navigate, permissions.canCreateEvents]);
  
  const handleSubmit = async (values: EventFormValues) => {
    setIsSubmitting(true);

    try {
      if (!activeTenantId) throw new Error(language === 'en' ? 'Select a workspace before creating an event.' : 'Wähle vor dem Erstellen einen Workspace aus.');
      const endTime = calculateEndTime(values.time, values.duration_minutes);
      const staffMembers = values.staff_members && values.staff_members.length > 0
        ? values.staff_members
        : user?.id ? [user.id] : [];
      const companyName = values.company?.trim() ?? '';
      const companyRecord = companyName
        ? await ensureCompanyRecord({
            companyId: values.company_id,
            companyName,
            tenantId: activeTenantId,
          })
        : null;

      let createdRecord: { id: string; tenant_id: string } | null = null;
      let publicPage: { page_id: string; editor_path: string } | null = null;
      if (values.event_schema_id) {
        const schema = await getSchema(values.event_schema_id);
        if (schema.tenant_id !== activeTenantId || !isCatalogueSchema(schema.entity_kind) || schema.content_scope !== 'page-collection') {
          throw new Error(language === 'en' ? 'The selected event catalogue is not available in this workspace.' : 'Der gewählte Veranstaltungskatalog ist in diesem Workspace nicht verfügbar.');
        }
        const result = await createPublicEventPage({
          tenant_id: activeTenantId,
          schema_id: schema.id,
          expected_definition_revision: schema.definition_revision ?? 1,
          event: {
            company: companyRecord?.name ?? '',
            company_id: companyRecord?.id ?? null,
            date: values.date,
            time: values.time,
            end_time: endTime,
            duration_minutes: values.duration_minutes,
            description: values.description ?? '',
            status: values.status,
            mode: values.mode ?? 'online',
            staff_members: staffMembers,
            requesting_mentors: [],
            accepted_mentors: [],
            declined_mentors: [],
            amount_requiredmentors: values.required_staff_count,
            required_staff_count: values.required_staff_count,
            required_trait_id: values.required_trait_id ?? null,
            product_id: values.product_id ?? null,
            teams_link: values.teams_link ?? '',
            initial_selected_mentors: values.initial_selected_mentors ?? [],
            timezone: values.timezone ?? '',
            custom_fields: values.custom_fields ?? {},
            registration_status: values.registration_status ?? 'closed',
            participant_min: values.participant_min ?? null,
            participant_max: values.participant_max ?? null,
          },
          page_name: values.event_page_name ?? '',
          page_slug: normalizeEventPageSlug(`${values.event_page_name}-${values.date}-${values.time.replace(':', '-')}`),
        });
        createdRecord = { id: result.event_id, tenant_id: result.tenant_id };
        publicPage = { page_id: result.page_id, editor_path: `${getSchemaConsolePath(schema)}/edit/${result.page_id}` };
      } else {
        const { data: createdRecords, error } = await supabase
          .from('mentorbooking_events')
          .insert({
            company: companyRecord?.name ?? '',
            company_id: companyRecord?.id ?? null,
            date: values.date,
            time: values.time,
            end_time: endTime,
            duration_minutes: values.duration_minutes,
            description: values.description ?? '',
            staff_members: staffMembers,
            status: values.status,
            mode: values.mode ?? 'online',
            requesting_mentors: [],
            accepted_mentors: [],
            declined_mentors: [],
            amount_requiredmentors: values.required_staff_count,
            required_staff_count: values.required_staff_count,
            required_trait_id: values.required_trait_id ?? null,
            product_id: values.product_id ?? null,
            teams_link: values.teams_link ?? '',
            initial_selected_mentors: values.initial_selected_mentors ?? [],
            custom_fields: values.custom_fields ?? {},
            registration_status: values.registration_status ?? 'closed',
            participant_min: values.participant_min ?? null,
            participant_max: values.participant_max ?? null,
            tenant_id: activeTenantId,
            owner_user_id: user?.id,
          })
          .select('id, tenant_id');
        if (error) throw error;
        createdRecord = createdRecords?.[0] ?? null;
      }
      if (!createdRecord?.id) throw new Error(language === 'en'
        ? 'The event was not returned after saving. Please check the event list before trying again.'
        : 'Nach dem Speichern wurde keine Veranstaltung zurückgegeben. Bitte prüfe die Veranstaltungsliste, bevor du es erneut versuchst.');

      // Trigger afterCreate hook for KB auto sync
      if (createdRecord?.id) {
        try {
          const { getPluginHooks } = await import('@/plugins/loader');
          const hooks = getPluginHooks('knowledgeBase.entity.afterCreate', user?.roles || []);
          const context = {
            entityType: 'event',
            entityId: createdRecord.id,
            tenantId: createdRecord.tenant_id || null,
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
      
      try {
        await refetchEvents();
      } catch (refreshError) {
        console.error('Event was created, but the event list could not be refreshed:', refreshError);
      }
      
      toast.success(
        language === 'en' 
          ? 'Event created successfully' 
          : 'Veranstaltung erfolgreich erstellt'
      );
      
      if (publicPage) {
        navigate(publicPage.editor_path);
      } else {
        navigate(returnTo || '/events');
      }
    } catch (error: unknown) {
      console.error('Error creating event:', error);
      const message = error instanceof Error ? error.message : undefined;
      toast.error(
        language === 'en' 
          ? message || 'Failed to create event' 
          : 'Fehler beim Erstellen der Veranstaltung'
      );
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Show loading state while we wait for authentication
  if (loading || workspaceLoading || (!canShowForm && !user)) {
    return (
      <div className="flex justify-center items-center min-h-[200px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">
          {language === "en" ? "Loading..." : "Wird geladen..."}
        </span>
      </div>
    );
  }
  
  if (!activeTenantId) {
    return <div className="rounded-lg border p-6 text-center text-muted-foreground">{language === 'en' ? 'Select a workspace before creating an event.' : 'Wähle vor dem Erstellen einer Veranstaltung einen Workspace aus.'}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" onClick={() => navigate(-1)} size="sm">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {language === "en" ? "Back" : "Zurück"}
        </Button>
        <div>
          <h1 className="text-xl font-semibold">
            {language === "en" ? "Create New Event" : "Neue Veranstaltung erstellen"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {language === 'en'
              ? 'Schedule another occurrence for a product, then optionally create its public event page.'
              : 'Plane einen weiteren Termin für ein Produkt und erstelle bei Bedarf eine öffentliche Veranstaltungsseite.'}
          </p>
        </div>
      </div>
    
      <EventForm
        key="create-event-form"
        initialValues={{
          status: 'new',
          required_staff_count: 1,
          required_trait_id: null,
          company_id: "",
          company: "",
          date: new Date().toISOString().split('T')[0],
          time: "09:00",
          duration_minutes: 60,
          description: "",
          staff_members: user?.id ? [user.id] : [],
          teams_link: "",
          product_id: preselectedProductId,
          initial_selected_mentors: [],
          custom_fields: {},
          registration_status: 'closed',
          participant_min: null,
          participant_max: null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          event_page_name: '',
          event_schema_id: undefined,
        }}
        onSubmit={handleSubmit}
        isLoading={isSubmitting}
        mode="create"
      />
    </div>
  );
};

export default CreateEvent;