import React, { useState, useEffect } from 'react';
import { Event } from '@/types/event';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useData } from '@/contexts/DataContext';
import { useTheme } from '@/contexts/ThemeContext';
import { CheckCircle, XCircle, Loader2, Send, Clock } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/constants/queryKeys';
import { toast } from 'sonner';
import { isEventInPast } from '@/utils/eventUtils';
import { Badge } from "@/components/ui/badge";
import { useAuth } from '@/contexts/AuthContext';
import { useMentorRequests } from '@/hooks/useMentorRequests';
import { useActiveWorkspace } from '@/contexts/ActiveWorkspaceContext';


// Define action types for mentor requests
type MentorAction = 'accept' | 'decline' | null;

interface MentorWithAction {
  id: string;
  name: string;
  action: MentorAction;
}

interface MentorRequestsModalProps {
  event: Event;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => Promise<void>;
  isPastEvent?: boolean;
}

const MentorRequestsModal = ({
  event,
  open,
  onOpenChange,
  onSuccess,
  isPastEvent = false
}: MentorRequestsModalProps) => {
  const { language } = useTheme();
  const { getUserProfile } = useData();
  const [requestingMentors, setRequestingMentors] = useState<MentorWithAction[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [processingSubmit, setProcessingSubmit] = useState(false);
  const [processingMentors, setProcessingMentors] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const { activeTenantId } = useActiveWorkspace();

  useEffect(() => {
    const loadMentorData = async () => {
      if (!event) return;
      
      try {
        const mentors = [];
        for (const mentorId of event.requestingMentors) {
          const profile = await getUserProfile(mentorId);
          if (profile) {
            mentors.push({
              id: mentorId,
              name: profile.Username || 'Unknown User',
              action: null // Initially no action selected
            });
          }
        }
        setRequestingMentors(mentors);
      } catch (error) {
        console.error("Error loading mentor data:", error);
      }
    };
    
    if (open && event) {
      loadMentorData();
    }
  }, [event, open, getUserProfile]);

  const { user } = useAuth();
  const { processRequest } = useMentorRequests(event, user);

  // Count how many mentors would be accepted after this action
  const getAcceptedMentorsCount = (mentorId?: string, action?: MentorAction) => {
    if (!event) return 0;
    
    // Count currently accepted mentors
    const currentAcceptedCount = event.acceptedMentors?.length || 0;
    
    // Count new "accept" actions
    const newAccepted = requestingMentors.reduce((count, mentor) => {
      // If this is the mentor we're currently toggling
      if (mentorId && mentor.id === mentorId) {
        // If we're toggling on the accept action
        if (action === 'accept' && mentor.action !== 'accept') {
          return count + 1;
        }
        // If we're toggling off the accept action
        if (action === 'accept' && mentor.action === 'accept') {
          return count;
        }
      } else {
        // Count other mentors who are marked for acceptance
        return mentor.action === 'accept' ? count + 1 : count;
      }
      return count;
    }, 0);
    
    return currentAcceptedCount + newAccepted;
  };

  // ADD THIS MISSING FUNCTION
  const getDeclinedMentorsCount = () => {
    return requestingMentors.filter(mentor => mentor.action === 'decline').length;
  };

  // Optimized mentor action handler
  const setMentorAction = (mentorId: string, action: MentorAction) => {
    // Add processing state
    setProcessingMentors(prev => new Set(prev).add(mentorId));
    
    // Check capacity limits
    if (action === 'accept') {
      const requiredMentors = event?.amount_requiredmentors || 1;
      const currentAcceptedCount = event?.acceptedMentors?.length || 0;
      const pendingAcceptCount = requestingMentors.filter(m => m.action === 'accept').length;
      const totalWouldBeAccepted = currentAcceptedCount + pendingAcceptCount + 1;
      
      const isTogglingOff = requestingMentors.find(m => m.id === mentorId)?.action === 'accept';
      
      if (!isTogglingOff && totalWouldBeAccepted > requiredMentors) {
        toast.error(
          language === "en"
            ? `This event only requires ${requiredMentors} mentor(s). Accepting this would exceed the limit.`
            : `Für dieses Event sind nur ${requiredMentors} MentorInnen benötigt. Diese Annahme würde das Limit überschreiten.`
        );
        setProcessingMentors(prev => {
          const newSet = new Set(prev);
          newSet.delete(mentorId);
          return newSet;
        });
        return;
      }
    }
    
    // Update the action
    setRequestingMentors(mentors => 
      mentors.map(mentor => 
        mentor.id === mentorId 
          ? { ...mentor, action: mentor.action === action ? null : action } 
          : mentor
      )
    );
    
    // Remove processing state
    setTimeout(() => {
      setProcessingMentors(prev => {
        const newSet = new Set(prev);
        newSet.delete(mentorId);
        return newSet;
      });
    }, 300);
  };

  // Add a function to update the cache directly
  const updateEventInCache = (updatedFields: Partial<Event>) => {
    if (!event) return;
    
    // Get the current events from cache
    const events = queryClient.getQueryData<Event[]>([QUERY_KEYS.EVENTS, activeTenantId]);
    
    if (events) {
      // Find and update the specific event
      const updatedEvents = events.map(cachedEvent => {
        if (cachedEvent.id === event.id) {
          return { ...cachedEvent, ...updatedFields };
        }
        return cachedEvent;
      });
      
      // Update the cache
      queryClient.setQueryData([QUERY_KEYS.EVENTS, activeTenantId], updatedEvents);
    }
  };

  // After successful action, make sure the event is fully updated
  const handleSuccessfulAction = async () => {
    if (onSuccess) {
      await onSuccess();
    }
  };

  // Submit all actions at once
  const handleSubmit = async () => {
    if (!event || processingSubmit) return;
    setProcessingSubmit(true);
    try {
      // one RPC per mentor, mapping 'accept' to 'approve'
      for (const m of requestingMentors) {
        if (m.action === 'accept') {
          await processRequest(m.id, 'approve');
        } else if (m.action === 'decline') {
          await processRequest(m.id, 'decline');
        }
      }
      if (onSuccess) {
        await onSuccess();
      }
      onOpenChange(false);
    } catch (error) {
      console.error('Error processing mentor actions:', error);
    } finally {
      setProcessingSubmit(false);
    }
  };


  // Check if any actions have been selected
  const hasSelectedActions = requestingMentors.some(mentor => mentor.action !== null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {language === "en" ? "Manage Mentor Requests" : "MentorInnen-Anfragen verwalten"}
          </DialogTitle>
        </DialogHeader>
        
        {isPastEvent && (
          <div className="bg-muted/20 rounded-md p-3 mb-4 border border-muted">
            <p className="text-muted-foreground text-sm flex items-center">
              <Clock className="h-4 w-4 mr-2" />
              {language === "en" 
                ? "This event has already taken place. Actions are no longer available." 
                : "Diese Veranstaltung hat bereits stattgefunden. Aktionen sind nicht mehr verfügbar."}
            </p>
          </div>
        )}
        
        <div className="mt-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {requestingMentors.length === 0 ? (
            <p>{language === "en" ? "No pending requests" : "Keine ausstehenden Anfragen"}</p>
          ) : (
            <div className="space-y-4">
              {requestingMentors.map((mentor) => (
                <div key={mentor.id} className="flex items-center justify-between p-4 border rounded-lg bg-card hover:bg-muted/30 transition-colors">
                  <div className="flex-1">
                    <p className="font-medium">{mentor.name}</p>
                    {mentor.action && (
                      <Badge 
                        variant={mentor.action === 'accept' ? 'default' : 'destructive'}
                        className="mt-1"
                      >
                        {mentor.action === 'accept' 
                          ? (language === 'en' ? 'Will Accept' : 'Wird akzeptiert')
                          : (language === 'en' ? 'Will Decline' : 'Wird abgelehnt')
                        }
                      </Badge>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Button 
                      size="icon"
                      variant="outline"
                      className={`rounded-full h-9 w-9 transition-all duration-200 ${
                        mentor.action === 'decline' 
                          ? 'bg-red-100 border-red-500 text-red-700 dark:bg-red-900/30 dark:border-red-600 dark:text-red-400' 
                          : 'hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20'
                      } ${processingMentors.has(mentor.id) ? 'opacity-50' : ''}`}
                      onClick={() => setMentorAction(mentor.id, 'decline')}
                      disabled={isLoading || processingSubmit || isPastEvent || processingMentors.has(mentor.id)}
                    >
                      {processingMentors.has(mentor.id) ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <XCircle className="h-5 w-5" />
                      )}
                    </Button>
                    
                    <Button 
                      size="icon"
                      variant="outline"
                      className={`rounded-full h-9 w-9 transition-all duration-200 ${
                        mentor.action === 'accept' 
                          ? 'bg-green-100 border-green-500 text-green-700 dark:bg-green-900/30 dark:border-green-600 dark:text-green-400' 
                          : 'hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/20'
                      } ${processingMentors.has(mentor.id) ? 'opacity-50' : ''}`}
                      onClick={() => setMentorAction(mentor.id, 'accept')}
                      disabled={isLoading || processingSubmit || isPastEvent || processingMentors.has(mentor.id)}
                    >
                      {processingMentors.has(mentor.id) ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle className="h-5 w-5" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Enhanced summary section */}
        <div className="border-t pt-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span>{language === 'en' ? 'Total Requests:' : 'Anfragen gesamt:'}</span>
            <span className="font-medium">{requestingMentors.length}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>{language === 'en' ? 'Will Accept:' : 'Werden akzeptiert:'}</span>
            <span className="font-medium text-green-600">{getAcceptedMentorsCount()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>{language === 'en' ? 'Will Decline:' : 'Werden abgelehnt:'}</span>
            <span className="font-medium text-red-600">{getDeclinedMentorsCount()}</span>
          </div>
          <div className="flex justify-between text-sm font-medium border-t pt-2">
            <span>{language === 'en' ? 'Required Mentors:' : 'Benötigte MentorInnen:'}</span>
            <span>{event?.amount_requiredmentors || 1}</span>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <div className="w-full flex flex-col gap-2">
            {/* Submit button - disabled for past events */}
            <Button 
              onClick={handleSubmit}
              disabled={!hasSelectedActions || processingSubmit || isPastEvent}
              className="mt-2 w-full"
            >
              {processingSubmit && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              <Send className="h-4 w-4 mr-2" />
              {language === "en" ? "Submit All Actions" : "Alle Aktionen senden"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MentorRequestsModal;