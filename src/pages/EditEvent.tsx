import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions'; // Add this import
import { useTheme } from '../contexts/ThemeContext';
import { EventForm, EventFormValues } from '../components/events/EventForm';
import { supabase } from '../lib/supabase';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { useData } from '../contexts/DataContext'; 
import { calculateEndTime } from '@/utils/timeUtils';
import { calculateEventStatus } from '../utils/eventUtils';
import { EventStatus, EventMode } from '@/types/event';
import { ensureCompanyRecord } from '@/services/company/companyService';

type EventFormInitialValues = NonNullable<React.ComponentProps<typeof EventForm>["initialValues"]>;

type SupabaseEventRow = {
  id: string;
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
  const permissions = usePermissions(); // Use centralized permissions
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);
  const [eventData, setEventData] = useState<EventFormInitialValues | null>(null);
  const [isSubmitSuccessful, setIsSubmitSuccessful] = useState(false);
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
      if (!id) {
        setIsLoadingEvent(false);
        return;
      }
      
      setIsLoadingEvent(true);
      try {
        const cachedEvent = getEventById(id);

        if (cachedEvent) {
          const normalizedFromCache = toInitialValues({
            id: cachedEvent.id,
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
          });

          setEventData(normalizedFromCache);
          return;
        }

        const { data, error } = await supabase
          .from('mentorbooking_events')
          .select('*')
          .eq('id', id)
          .single<SupabaseEventRow>();

        if (error) throw error;

        const normalizedFromDb = toInitialValues({
          id: data.id,
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
  }, [id, getEventById, language]);

  const handleSubmit = async (values: EventFormValues) => {
    setIsLoading(true);
    try {
      const staffMembers = values.staff_members && values.staff_members.length > 0
        ? values.staff_members
        : [];
      const companyRecord = await ensureCompanyRecord({
        companyId: values.company_id,
        companyName: values.company,
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

      const { error } = await supabase
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
        })
        .eq('id', id);

      if (error) throw error;

      // Mark submission as successful
      setIsSubmitSuccessful(true);
      
      // Refresh the cache after successful update
      await refetchEvents();
      
      toast.success(
        language === 'en' 
          ? 'Event updated successfully' 
          : 'Veranstaltung erfolgreich aktualisiert'
      );
      
      // Navigate with a slight delay to allow the toast to be seen
      setTimeout(() => {
        navigate(`/events/${id}`, { 
          state: { from: sessionStorage.getItem('eventReferrer') } 
        });
      }, 500);
    } catch (error: unknown) {
      console.error("Error updating event:", error);
      const message = error instanceof Error ? error.message : undefined;
      toast.error(
        language === 'en' 
          ? message || 'Failed to update event' 
          : 'Fehler beim Aktualisieren der Veranstaltung'
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
    
      <EventForm
        initialValues={eventData}
        onSubmit={handleSubmit}
        isLoading={isLoading}
        mode="edit"
      />
    </div>
  );
};

export default EditEvent;