import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Event, EventStatus } from "../types/event";
import { useTheme } from "../contexts/ThemeContext";
// Removed useStatusHelpers import
import { useAuth } from "../contexts/AuthContext";
import { useData } from "../contexts/DataContext";
import MentorRequestsModal from "@/components/events/MentorRequestsModal";
import { TooltipProvider } from "@/components/ui/tooltip";
import ListHeader from "@/components/lists/ListHeader";
import ListFilters from "@/components/lists/ListFilters";
import ListTable from "@/components/lists/ListTable";
import { useEventFilters } from "@/hooks/useEventFilters";
import { EventsNavigation } from "@/components/events/EventsNavigation";
import { useMentorRequests } from '@/hooks/useMentorRequests';
import ConfirmationModal from "@/components/shared/ConfirmationModal";
import { toast } from "sonner";

// Define a new type for your filter
type StatusFilterType = EventStatus | 'needsMentors' | null;

const EventList = () => {
  const { language } = useTheme();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<keyof Event>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc"); // Changed from "asc" to "desc"
  const [statusFilter, setStatusFilter] = useState<StatusFilterType>(null);
  const [viewMode, setViewMode] = useState<'all' | 'myEvents' | 'coachEvents' | 'past'>('all');
  const isMentor = user?.role === 'mentor';
  const isCoach = user?.role === 'coach';

  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false); // Add this
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false); // Add this
  const [newAcceptedEventIds, setNewAcceptedEventIds] = useState<string[]>([]);

  const { events: contextEvents, isLoadingEvents, refetchEvents, getUserProfile } = useData();
  const [events, setEvents] = useState<Event[]>([]);

  const [requestsModalOpen, setRequestsModalOpen] = useState(false);
  const [selectedEventForRequests, setSelectedEventForRequests] = useState<Event | null>(null);
  const [mentorNamesByEventId, setMentorNamesByEventId] = useState<Record<string, string[]>>({});
  
  // Add this hook for mentor requests
  const { requestToMentor } = useMentorRequests(selectedEvent, user);

  const { filteredEvents, upcomingEvents, pastEvents } = useEventFilters({
    events: events || [],
    viewMode,
    statusFilter,
    user,
    search,
    sortBy,
    sortDirection
  });

  const handleEventClick = (event: Event) => {
    navigate(`/events/${event.id}`, {
      state: { from: '/list' }
    });
  };

  // Use a handler that only takes the event (from EventsGridView signature)
  const handleRequestMentorClick = (event: Event, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedEvent(event);
    setConfirmModalOpen(true);
  };
  
  // Add this function to handle the confirmed request
  const handleConfirmedRequest = async () => {
    try {
      setIsSubmittingRequest(true);
      await requestToMentor();
      
      // Refresh data after successful request
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

  const toggleSortDirection = () => {
    setSortDirection(sortDirection === "asc" ? "desc" : "asc");
  };

  useEffect(() => {
    void refetchEvents();
  }, [refetchEvents]);

  useEffect(() => {
    if (contextEvents) {
      setEvents(contextEvents);
    }
  }, [contextEvents]);

  const handleStatusFilterChange = (status: EventStatus | null) => {
    if (!status) {
      setStatusFilter(null);
      return;
    }

    if (status === 'new') {
      setStatusFilter('needsMentors');
    } else {
      setStatusFilter(status);
    }
  };

  useEffect(() => {
    const loadMentorNames = async () => {
      if (!events.length) return;

      const eventMentorsMap: Record<string, string[]> = {};

      const eventsWithMentors = events.filter(event => event.acceptedMentors?.length > 0);

      for (const event of eventsWithMentors) {
        try {
          const profiles = await Promise.all(
            event.acceptedMentors.map(id => getUserProfile(id))
          );

          const usernames = profiles
            .filter(profile => profile && profile.Username)
            .map(profile => profile.Username);

          if (usernames.length) {
            eventMentorsMap[event.id] = usernames;
          }
        } catch (error) {
          console.error(`Error loading mentor names for event ${event.id}:`, error);
        }
      }

      setMentorNamesByEventId(eventMentorsMap);
    };

    loadMentorNames();
  }, [events, getUserProfile]);

  const getDisplayStatusForFilter = (statusFilter: StatusFilterType): EventStatus => {
    if (statusFilter === 'needsMentors') {
      return 'new';
    }
    return statusFilter as EventStatus;
  };

  return (
    <TooltipProvider>
      <div className="space-y-1">
        <ListHeader
          language={language}
          isLoadingEvents={isLoadingEvents}
          refetchEvents={refetchEvents}
        />

        <EventsNavigation
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          isMentor={isMentor}
          isCoach={isCoach}
        />

        <ListFilters
          search={search}
          onSearchChange={setSearch}
          sortDirection={sortDirection}
          onSortDirectionChange={toggleSortDirection}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          statusFilter={statusFilter}
          onStatusFilterChange={handleStatusFilterChange}
          getDisplayStatusForFilter={getDisplayStatusForFilter}
          // Removed getStatusDotColor
          language={language}
        />

        {(viewMode === 'myEvents' || viewMode === 'coachEvents') ? (
          <div className="space-y-10">
            {/* Add Upcoming Events Section Header */}
            <div>
              <div className="relative flex items-center py-4">
                <div className="flex-grow border-t border-gray-300"></div>
                <h2 className="px-4 text-2xl font-semibold">
                  {language === "en" ? "My Upcoming Events" : "Meine bevorstehenden Veranstaltungen"}
                </h2>
                <div className="flex-grow border-t border-gray-300"></div>
              </div>
              
              <ListTable
                filteredEvents={upcomingEvents}
                events={events}
                isLoadingEvents={isLoadingEvents}
                language={language}
                user={user}
                isMentor={isMentor}
                sortBy={sortBy}
                sortDirection={sortDirection}
                mentorNamesByEventId={mentorNamesByEventId}
                setSortBy={setSortBy}
                toggleSortDirection={toggleSortDirection}
                handleEventClick={handleEventClick}
                handleRequestMentorClick={handleRequestMentorClick}
                openMentorRequestsModal={(event) => {
                  setSelectedEventForRequests(event);
                  setRequestsModalOpen(true);
                }}
              />
            </div>
            
            {/* Add Past Events Section Header */}
            <div>
              <div className="relative flex items-center py-4">
                <div className="flex-grow border-t border-gray-300"></div>
                <h2 className="px-4 text-2xl font-semibold">
                  {language === "en" ? "My Past Events" : "Meine vergangenen Veranstaltungen"}
                </h2>
                <div className="flex-grow border-t border-gray-300"></div>
              </div>
              
              <ListTable 
                filteredEvents={pastEvents}
                events={events}
                isLoadingEvents={isLoadingEvents}
                language={language}
                user={user}
                isMentor={isMentor}
                sortBy={sortBy}
                sortDirection={sortDirection}
                mentorNamesByEventId={mentorNamesByEventId}
                setSortBy={setSortBy}
                toggleSortDirection={toggleSortDirection}
                handleEventClick={handleEventClick}
                handleRequestMentorClick={handleRequestMentorClick}
                openMentorRequestsModal={(event) => {
                  setSelectedEventForRequests(event);
                  setRequestsModalOpen(true);
                }}
              />
            </div>
          </div>
        ) : (
          <ListTable
            filteredEvents={filteredEvents}
            events={events}
            isLoadingEvents={isLoadingEvents}
            language={language}
            user={user}
            isMentor={isMentor}
            sortBy={sortBy}
            sortDirection={sortDirection}
            mentorNamesByEventId={mentorNamesByEventId}
            setSortBy={setSortBy}
            toggleSortDirection={toggleSortDirection}
            handleEventClick={handleEventClick}
            handleRequestMentorClick={handleRequestMentorClick}
            openMentorRequestsModal={(event) => {
              setSelectedEventForRequests(event);
              setRequestsModalOpen(true);
            }}
          />
        )}

        <MentorRequestsModal
          event={selectedEventForRequests}
          open={requestsModalOpen}
          onOpenChange={setRequestsModalOpen}
          onSuccess={async () => {
            await fetchEvents();
            setRequestsModalOpen(false);
          }}
        />

        {/* Add the confirmation modal */}
        <ConfirmationModal
          event={selectedEvent}
          open={confirmModalOpen}
          onOpenChange={setConfirmModalOpen}
          onConfirm={handleConfirmedRequest}
          isLoading={isSubmittingRequest}
        />
      </div>
    </TooltipProvider>
  );
};

export default EventList;
