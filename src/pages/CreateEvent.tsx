import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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

const CreateEvent = () => {
  const { user, loading } = useAuth();
  const permissions = usePermissions();
  const { language } = useTheme();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { refetchEvents } = useData();
  
  // Debug the component lifecycle - only in development
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log("🔄 CreateEvent component mounted or updated");
      console.log("👤 Current user:", user);
      console.log("⏳ Auth loading state:", loading);
    }
  }, [user, loading]);

  // Use centralized permission instead of role checks
  const canShowForm = !loading && user && permissions.canCreateEvents;
  
  // Redirect non-authorized users once auth is loaded
  useEffect(() => {
    if (!loading && user && !permissions.canCreateEvents) {
      if (import.meta.env.DEV) {
        console.log("👋 User cannot create events, redirecting");
      }
      navigate('/events');
    }
  }, [user, loading, navigate, permissions.canCreateEvents]);
  
  const handleSubmit = async (values: EventFormValues) => {
    setIsSubmitting(true);

    try {
      const endTime = calculateEndTime(values.time, values.duration_minutes);
      const staffMembers = values.staff_members && values.staff_members.length > 0
        ? values.staff_members
        : user?.id ? [user.id] : [];
      const companyRecord = await ensureCompanyRecord({
        companyId: values.company_id,
        companyName: values.company,
      });

      const { error } = await supabase
        .from('mentorbooking_events')
        .insert({
          company: companyRecord.name,
          company_id: companyRecord.id,
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
          teams_link: values.teams_link ?? "",
          initial_selected_mentors: values.initial_selected_mentors ?? [],
        })
        .select();
      
      if (error) throw error;
      
      await refetchEvents();
      
      toast.success(
        language === 'en' 
          ? 'Event created successfully' 
          : 'Veranstaltung erfolgreich erstellt'
      );
      
      navigate('/events');
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
  if (loading || (!canShowForm && !user)) {
    return (
      <div className="flex justify-center items-center min-h-[200px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">
          {language === "en" ? "Loading..." : "Wird geladen..."}
        </span>
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
        <h1 className="text-xl font-semibold">
          {language === "en" ? "Create New Event" : "Neue Veranstaltung erstellen"}
        </h1>
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
          product_id: undefined,
          initial_selected_mentors: []
        }}
        onSubmit={handleSubmit}
        isLoading={isSubmitting}
        mode="create"
      />
    </div>
  );
};

export default CreateEvent;