import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useData } from "../contexts/DataContext";
import { useEventAcceptance } from "@/hooks/useEventAcceptance";
import { EventsHeader } from "@/components/events/EventsHeader";
import { EventsNavigation } from "@/components/events/EventsNavigation";
import { MyEventsView } from "@/components/events/MyEventsView";
import { EventsGridView } from "@/components/events/EventsGridView";
import { LoadingState } from "@/components/ui/LoadingState";
import MentorRequestsModal from "@/components/events/MentorRequestsModal";
import { Event } from "@/types/event";
import { useEventFilters } from "@/hooks/useEventFilters";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import ConfirmationModal from "@/components/shared/ConfirmationModal";
import { usePermissions } from "@/hooks/usePermissions";
import { useActiveWorkspace } from "@/contexts/ActiveWorkspaceContext";

const Events = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const viewModeParam = searchParams.get('view');
  const { user } = useAuth();
  const { language } = useTheme();
  const { events, isLoadingEvents, refetchEvents } = useData();
  const permissions = usePermissions();
  const { activeTenantId } = useActiveWorkspace();
  
  const isMentor = user?.role === 'mentor';
  const hasStaffPermissions = permissions.canViewMentorProfiles;
  
  // View mode state
  const [viewMode, setViewMode] = useState<'all' | 'myEvents' | 'coachEvents' | 'past'>(
    (viewModeParam === 'myEvents' || viewModeParam === 'coachEvents' || viewModeParam === 'past') 
      ? viewModeParam as 'all' | 'myEvents' | 'coachEvents' | 'past'
      : 'all'
  );
  const [viewedMyEvents, setViewedMyEvents] = useState(false);

  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [sortBy, setSortBy] = useState<keyof Event>("date");

  const { filteredEvents, upcomingEvents, pastEvents } = useEventFilters({
    events: events || [],
    viewMode,
    statusFilter: null,
    user,
    search: '',
    sortBy,
    sortDirection
  });
  const { newAcceptedEventIds, clearNewAcceptedEvent } = useEventAcceptance(user, events || []);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [selectedEventForRequests, setSelectedEventForRequests] = useState<Event | null>(null);
  const [requestsModalOpen, setRequestsModalOpen] = useState(false);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [selectedRequestEvent, setSelectedRequestEvent] = useState<Event | null>(null);
  
  const handleRequestMentorClick = async (event: Event, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    
    if (!user) {
      toast.error(language === "en" ? "You must be logged in" : "Sie müssen angemeldet sein");
      return;
    }
    
    setSelectedRequestEvent(event);
    setConfirmModalOpen(true);
  };
  
  const handleConfirmedRequest = async () => {
    if (!selectedRequestEvent || !user || !activeTenantId) return;
    
    setIsSubmittingRequest(true);
    
    try {
      let updateQuery = supabase
        .from('mentorbooking_events')
        .update({
          requesting_mentors: [...(selectedRequestEvent.requestingMentors || []), user.id]
        })
        .eq('id', selectedRequestEvent.id);
      if (activeTenantId) updateQuery = updateQuery.eq('tenant_id', activeTenantId);
      const { error } = await updateQuery;
        
      if (error) throw error;
      
      await refetchEvents();
      
      toast.success(
        language === "en" 
          ? "Request submitted successfully" 
          : "Anfrage erfolgreich gesendet"
      );
    } catch (error) {
      console.error("Error submitting mentor request:", error);
      toast.error(
        language === "en" 
          ? "Failed to submit request. Please try again." 
          : "Fehler beim Senden der Anfrage. Bitte versuchen Sie es erneut."
      );
    } finally {
      setIsSubmittingRequest(false);
    }
  };
  
  const handlePendingRequestsClick = (eventId: string) => {
    const eventToSelect = events?.find(e => e.id === eventId);
    if (eventToSelect) {
      setSelectedEventForRequests(eventToSelect);
      setRequestsModalOpen(true);
    }
  };

  const handleEventClick = (event) => {
    if (newAcceptedEventIds.includes(event.id)) {
      clearNewAcceptedEvent(event.id);
    }
    navigate(`/events/${event.id}`, {
      state: { from: `/events?view=${viewMode}` }
    });
  };

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    if (mode === 'myEvents' && isMentor) {
      setViewedMyEvents(true);
    }
  };

  const handleDismissNewBadge = (eventId: string) => {
    clearNewAcceptedEvent(eventId);
  };

  const handleSuccessfulOperation = async () => {
    await refetchEvents();
  };

  return (
    <div className="space-y-6">
      <EventsHeader 
        refetchEvents={refetchEvents} 
        isLoadingEvents={isLoadingEvents} 
      />
      
      <EventsNavigation 
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        isMentor={isMentor}
        isCoach={hasStaffPermissions}
      />
      
      {isLoadingEvents || !events ? (
        <LoadingState />
      ) : viewMode === 'myEvents' || viewMode === 'coachEvents' ? (
          <MyEventsView
            upcomingEvents={upcomingEvents}
            pastEvents={pastEvents}
            user={user}
            newAcceptedEventIds={newAcceptedEventIds}
            onEventClick={handleEventClick}
            onRequestMentorClick={handleRequestMentorClick}
            onPendingRequestsClick={handlePendingRequestsClick}
            onDismissNewBadge={handleDismissNewBadge}
            refreshEvents={refetchEvents}
          />
      ) : (
        <EventsGridView
          events={filteredEvents}
          userRole={user?.role}
          userId={user?.id}
          newAcceptedEventIds={newAcceptedEventIds}
          onEventClick={handleEventClick}
          onRequestClick={handleRequestMentorClick}
          onPendingRequestsClick={handlePendingRequestsClick}
          isSubmittingRequest={isSubmittingRequest}
          refetchEvents={refetchEvents}
        />
      )}

      <ConfirmationModal
        event={selectedRequestEvent}
        open={confirmModalOpen}
        onOpenChange={setConfirmModalOpen}
        onConfirm={handleConfirmedRequest}
        isLoading={isSubmittingRequest}
      />
      
      <MentorRequestsModal
        event={selectedEventForRequests}
        open={requestsModalOpen}
        onOpenChange={setRequestsModalOpen}
        onSuccess={handleSuccessfulOperation}
      />
    </div>
  );
};



export default Events;
