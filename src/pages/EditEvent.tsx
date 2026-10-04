import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions'; // Add this import
import { useTheme } from '../contexts/ThemeContext';
import { EventForm, EventFormValues } from '../components/events/EventForm';
import { supabase } from '../lib/supabase';
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RevalidationFeedback } from '@/components/revalidation/RevalidationFeedback';
import { useData } from '../contexts/DataContext'; 
import { calculateEndTime } from '@/utils/timeUtils';
import { calculateEventStatus } from '../utils/eventUtils';
import { EventStatus, EventMode } from '@/types/event';
import { ensureCompanyRecord } from '@/services/company/companyService';
import { useActiveWorkspace } from '@/contexts/ActiveWorkspaceContext';
import { getSchema, triggerRevalidation, type RevalidationResult } from '@/services/pageService';
import { getSchemaConsolePath } from '@/utils/schemaPaths';
import EntityActionsRow from '@/components/entity-actions/EntityActionsRow';

type EventFormInitialValues = NonNullable<React.ComponentProps<typeof EventForm>["initialValues"]>;

interface EventSaveError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

const toEventSaveError = (error: unknown): EventSaveError => {
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    return {
      message: typeof value.message === 'string' ? value.message : 'The event could not be saved.',
      ...(typeof value.code === 'string' ? { code: value.code } : {}),
      ...(typeof value.details === 'string' ? { details: value.details } : {}),
      ...(typeof value.hint === 'string' ? { hint: value.hint } : {}),
    };
  }
  return { message: typeof error === 'string' ? error : 'The event could not be saved.' };
};

type SupabaseEventRow = {
  id: string;
  tenant_id: string;
  page_id: string | null;
  timezone: string | null;
  company_id: string | null;
  company: string | null;
  date: string | null;
  time: string | null;
  end_time: string | null;
  duration_minutes: number | null;
  description: string | null;
  status: EventStatus | null;
  mode: EventMode | null;
  amount_requiredmentors: number | null;
  required_staff_count: number | null;
  required_trait_id: number | null;
  product_id: number | null;
  staff_members: string[] | null;
  teams_link: string | null;
  initial_selected_mentors: string[] | null;
};

const toInitialValues = (input: Partial<EventFormInitialValues>): EventFormInitialValues => ({
  id: input.id,
  tenant_id: input.tenant_id,
  page_id: input.page_id ?? null,
  timezone: input.timezone ?? undefined,
  event_schema_id: input.event_schema_id,
  event_page_name: input.event_page_name,
  company_id: input.company_id ?? "",
  company: input.company ?? "",
  date: input.date ?? "",
  time: input.time ?? "",
  end_time: input.end_time,
  duration_minutes: input.duration_minutes ?? 60,
  description: input.description ?? "",
  status: input.status ?? 'new',
  mode: input.mode ?? 'online',
  required_staff_count: input.required_staff_count ?? 1,
  required_trait_id: input.required_trait_id ?? null,
  product_id: input.product_id ?? undefined,
  staff_members: Array.isArray(input.staff_members) ? input.staff_members : [],
  teams_link: input.teams_link ?? "",
  initial_selected_mentors: Array.isArray(input.initial_selected_mentors)
    ? input.initial_selected_mentors
    : [],
});

const EditEvent = () => {
  const { id } = useParams<{ id: string }>();
  const { language } = useTheme();
  const { getEventById, refetchEvents } = useData();
  const { user } = useAuth();
  const { activeTenantId, loading: workspaceLoading } = useActiveWorkspace();
  const permissions = usePermissions(); // Use centralized permissions
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);
  const [eventData, setEventData] = useState<EventFormInitialValues | null>(null);
  const [saveError, setSaveError] = useState<EventSaveError | null>(null);
  const [revalidationResult, setRevalidationResult] = useState<RevalidationResult | null>(null);
  const [eventPageInfo, setEventPageInfo] = useState<{ path: string; slug: string; schemaSlug: string; status: string; registered: boolean } | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  
  // Permission check: Use centralized permission instead of role checks
  useEffect(() => {
    if (user && !permissions.canEditEvents) {
      navigate('/events');
    }
  }, [user, navigate, permissions.canEditEvents]);
  
  // Store the referrer in session storage when component mounts
  useEffect(() => {
    // Get the referrer from state passed by the navigation, or use pathname
    const referrer = location.state?.from || 
                    sessionStorage.getItem('eventReferrer') || 
                    '/events';
    
    // Store it for the detail page to use later
    sessionStorage.setItem('eventReferrer', referrer);
  }, [location]);
  
  // Fetch event data directly to ensure we have the latest data
  useEffect(() => {
    const fetchEvent = async () => {
      if (workspaceLoading) return;
      if (!id || !activeTenantId) {
        setIsLoadingEvent(false);
        setEventData(null);
        setEventPageInfo(null);
        return;
      }
      
      setIsLoadingEvent(true);
      try {
        const cachedEvent = getEventById(id);

        if (cachedEvent) {
          const normalizedFromCache = toInitialValues({
            id: cachedEvent.id,
            tenant_id: cachedEvent.tenant_id,
            company_id: cachedEvent.company_id,
            company: cachedEvent.company,
            date: cachedEvent.date,
            time: cachedEvent.time,
            end_time: cachedEvent.end_time,
            duration_minutes: cachedEvent.duration_minutes,
            description: cachedEvent.description,
            status: cachedEvent.status,
            mode: cachedEvent.mode,
            required_staff_count: cachedEvent.required_staff_count,
            required_trait_id: cachedEvent.required_trait_id,
            product_id: cachedEvent.product_id,
            staff_members: cachedEvent.staff_members,
            teams_link: cachedEvent.teams_link,
            initial_selected_mentors: cachedEvent.initial_selected_mentors,
            page_id: cachedEvent.page_id,
            timezone: cachedEvent.timezone,
          });

          setEventData(normalizedFromCache);
          return;
        }

        const { data, error } = await supabase
          .from('mentorbooking_events')
          .select('*')
          .eq('id', id)
          .eq('tenant_id', activeTenantId)
          .single<SupabaseEventRow>();

        if (error) throw error;

        const normalizedFromDb = toInitialValues({
          id: data.id,
          tenant_id: data.tenant_id,
          page_id: data.page_id,
          timezone: data.timezone,
          company_id: data.company_id ?? undefined,
          company: data.company ?? undefined,
          date: data.date ?? undefined,
          time: data.time ?? undefined,
          end_time: data.end_time ?? undefined,
          duration_minutes: data.duration_minutes ?? undefined,
          description: data.description ?? undefined,
          status: data.status ?? undefined,
          mode: data.mode ?? undefined,
          required_staff_count: data.required_staff_count ?? data.amount_requiredmentors ?? undefined,
          required_trait_id: data.required_trait_id ?? undefined,
          product_id: data.product_id ?? undefined,
          staff_members: Array.isArray(data.staff_members) ? data.staff_members : undefined,
          teams_link: data.teams_link ?? undefined,
          initial_selected_mentors: Array.isArray(data.initial_selected_mentors)
            ? data.initial_selected_mentors
            : undefined,
        });

        setEventData(normalizedFromDb);
      } catch (error) {
        console.error("Error loading event:", error);
        toast.error(
          language === 'en' 
            ? 'Failed to load event' 
            : 'Fehler beim Laden der Veranstaltung'
        );
      } finally {
        setIsLoadingEvent(false);
      }
    };
    
    fetchEvent();
  }, [activeTenantId, workspaceLoading, id, getEventById, language]);

  useEffect(() => {
    let cancelled = false;
    const loadPublicPage = async () => {
      setEventPageInfo(null);
      if (!activeTenantId || !eventData?.page_id) return;
      try {
        const { data: page, error } = await supabase.from('pages')
          .select('id, schema_id, name, slug, status')
          .eq('id', eventData.page_id)
          .eq('tenant_id', activeTenantId)
          .maybeSingle();
        if (error) throw error;
        if (!page) throw new Error('Event page not found in the active workspace.');
        const schema = await getSchema(page.schema_id);
        if (schema.tenant_id !== activeTenantId || schema.entity_kind !== 'event') {
          throw new Error('The linked page is not owned by this workspace event schema.');
        }
        if (cancelled) return;
        setEventData((current) => current ? {
          ...current,
          event_schema_id: schema.id,
          event_page_name: page.name,
        } : current);
        setEventPageInfo({
          path: `${getSchemaConsolePath(schema)}/edit/${page.id}`,
          slug: page.slug,
          schemaSlug: schema.api_slug,
          status: page.status,
          registered: schema.registration_status === 'registered',
        });
      } catch (error) {
        if (!cancelled) {
          console.error('Could not load event page link:', error);
          setEventPageInfo(null);
        }
      }
    };
    void loadPublicPage();
    return () => { cancelled = true; };
  }, [activeTenantId, eventData?.page_id]);

  const handleSubmit = async (values: EventFormValues) => {
    setIsLoading(true);
    setSaveError(null);
    setRevalidationResult(null);
    try {
      if (!id || !activeTenantId) throw new Error(language === 'en' ? 'Select a workspace before updating this event.' : 'Wähle vor dem Aktualisieren einen Workspace aus.');
      const staffMembers = values.staff_members && values.staff_members.length > 0
        ? values.staff_members
        : [];
      const companyRecord = await ensureCompanyRecord({
        companyId: values.company_id,
        companyName: values.company,
        tenantId: activeTenantId,
      });
      const endTime = calculateEndTime(values.time, values.duration_minutes);
      const currentEvent = getEventById(id);

      const newStatus = values.status === 'locked'
        ? 'locked'
        : (currentEvent
            ? calculateEventStatus({
                ...currentEvent,
                amount_requiredmentors: values.required_staff_count,
                required_staff_count: values.required_staff_count,
              })
            : 'new');

      const { data: updatedEvent, error } = await supabase
        .from('mentorbooking_events')
        .update({
          company_id: companyRecord.id,
          company: companyRecord.name,
          date: values.date,
          time: values.time,
          end_time: endTime,
          duration_minutes: values.duration_minutes,
          description: values.description ?? '',
          staff_members: staffMembers,
          status: newStatus,
          mode: values.mode ?? 'online',
          amount_requiredmentors: values.required_staff_count,
          required_staff_count: values.required_staff_count,
          required_trait_id: values.required_trait_id ?? null,
          product_id: values.product_id ?? null,
          teams_link: values.teams_link ?? "",
          ...(eventData?.page_id ? { timezone: values.timezone ?? null } : {}),
        })
        .eq('id', id)
        .eq('tenant_id', activeTenantId)
        .select('id')
        .maybeSingle();

      if (error) throw error;
      if (!updatedEvent) throw new Error(language === 'en'
        ? 'No event was updated in the selected workspace. Check your access and try again.'
        : 'Im ausgewählten Workspace wurde keine Veranstaltung aktualisiert. Prüfe deine Berechtigung und versuche es erneut.');

      let revalidationFailed = false;
      if (eventPageInfo?.registered && eventPageInfo.status === 'published') {
        const result = await triggerRevalidation(eventPageInfo.schemaSlug, eventPageInfo.slug);
        setRevalidationResult(result);
        if (!result.success) {
          revalidationFailed = true;
          toast.warning(language === 'en'
            ? 'Event saved, but the frontend could not be updated.'
            : 'Veranstaltung gespeichert, aber das Frontend konnte nicht aktualisiert werden.');
        }
      }

      try {
        await refetchEvents();
      } catch (refreshError) {
        console.error('Event was saved, but the event list could not be refreshed:', refreshError);
      }

      toast.success(
        language === 'en' 
          ? 'Event updated successfully' 
          : 'Veranstaltung erfolgreich aktualisiert'
      );
      
      // Keep the editor open after a revalidation failure so the inline details remain visible.
      if (!revalidationFailed) {
        setTimeout(() => {
          navigate(`/events/${id}`, {
            state: { from: sessionStorage.getItem('eventReferrer') }
          });
        }, 500);
      }
    } catch (error: unknown) {
      console.error("Error updating event:", error);
      const failure = toEventSaveError(error);
      setSaveError(failure);
      toast.error(
        language === 'en' ? 'The event could not be saved.' : 'Die Veranstaltung konnte nicht gespeichert werden.',
        { description: failure.message },
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoadingEvent) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!eventData && !isLoadingEvent) {
    return (
      <div className="p-4">
        <p className="text-center text-red-500">
          {language === 'en' ? 'Event not found' : 'Veranstaltung nicht gefunden'}
        </p>
        <div className="flex justify-center mt-4">
          <Button onClick={() => navigate('/events')}>
            {language === 'en' ? 'Back to Events' : 'Zurück zu Veranstaltungen'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" onClick={() => navigate(-1)} size="sm">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {language === "en" ? "Back" : "Zurück"}
        </Button>
      </div>
    
      {eventPageInfo && (
        <Button variant="outline" onClick={() => navigate(eventPageInfo.path)}>
          <ExternalLink className="mr-2 h-4 w-4" />
          {language === 'en' ? 'Edit public event page' : 'Öffentliche Veranstaltungsseite bearbeiten'}
        </Button>
      )}

      {saveError && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{language === 'en' ? 'Event could not be saved' : 'Veranstaltung konnte nicht gespeichert werden'}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{saveError.message}</p>
            {(saveError.code || saveError.details || saveError.hint) && (
              <details className="rounded-md border border-destructive/30 px-3 py-2">
                <summary className="cursor-pointer font-medium">
                  {language === 'en' ? 'Error details' : 'Fehlerdetails'}
                </summary>
                <div className="mt-2 space-y-1 break-words font-mono text-xs">
                  {saveError.code && <p>Code: {saveError.code}</p>}
                  {saveError.details && <p>{saveError.details}</p>}
                  {saveError.hint && <p>Hint: {saveError.hint}</p>}
                </div>
              </details>
            )}
          </AlertDescription>
        </Alert>
      )}

      {revalidationResult && !revalidationResult.success && (
        <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950">
          <AlertTitle>{language === 'en' ? 'Event saved; frontend update failed' : 'Veranstaltung gespeichert; Frontend-Aktualisierung fehlgeschlagen'}</AlertTitle>
          <AlertDescription>
            <RevalidationFeedback result={revalidationResult} language={language} />
          </AlertDescription>
        </Alert>
      )}

      <EventForm
        initialValues={eventData}
        onSubmit={handleSubmit}
        isLoading={isLoading}
        mode="edit"
      />

      {id && eventData?.tenant_id && (
        <EntityActionsRow
          entityType="event"
          entityId={id}
          tenantId={eventData.tenant_id}
        />
      )}
    </div>
  );
};

export default EditEvent;