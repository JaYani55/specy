import { Event } from '@/types/event';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { UserRound, CalendarIcon, Building2, ExternalLink, Users } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useMentorRequests } from '@/hooks/useMentorRequests';
import ConfirmationModal from '../shared/ConfirmationModal';
import { CounterButton } from "@/components/ui/counter-button";
import { getEventTimeDisplay } from '@/utils/timeUtils';
import { isEventInPast } from '@/utils/eventUtils';
import { usePermissions } from '@/hooks/usePermissions';
import { supabase } from '@/lib/supabase';

interface EventInfoCardProps {
  event: Event;
  refreshEventData?: () => Promise<void>;
  onViewRequestsClick?: () => void;
  isPastEvent?: boolean;
}

export const EventInfoCard = ({
  event,
  refreshEventData,
  onViewRequestsClick,
  isPastEvent = false,
}: EventInfoCardProps) => {
  const { language } = useTheme();
  const { user } = useAuth();
  const permissions = usePermissions();
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [requiredTraitName, setRequiredTraitName] = useState<string | null>(null);
  const { requestToMentor, isRequestLoading } = useMentorRequests(event, user);

  const isEventPast = isPastEvent || isEventInPast(event);
  const requiredStaffCount = event.required_staff_count || event.amount_requiredmentors || 1;

  // Logic for mentor request button (copied from EventCard)
  const userId = user?.id;
  const hasAlreadyRequested = event.requestingMentors?.includes(userId || '') || false;
  const isAcceptedMentor = event.acceptedMentors?.includes(userId || '') || false;
  const isDeclinedMentor = event.declinedMentors?.includes(userId || '') || false;
  const mentorSlotsFilled = (event.acceptedMentors?.length || 0) >= requiredStaffCount;

  useEffect(() => {
    const loadRequiredTrait = async () => {
      if (!event.required_trait_id) {
        setRequiredTraitName(null);
        return;
      }

      const { data, error } = await supabase
        .from('staff_traits')
        .select('name')
        .eq('id', event.required_trait_id)
        .maybeSingle<{ name: string }>();

      if (error) {
        console.error('Error loading required trait:', error);
        setRequiredTraitName(null);
        return;
      }

      setRequiredTraitName(data?.name ?? null);
    };

    void loadRequiredTrait();
  }, [event.required_trait_id]);

  const canRequest = useMemo(() => {
    if (!userId || isEventPast) return false;
    if (hasAlreadyRequested || isAcceptedMentor || isDeclinedMentor) return false;
    if (mentorSlotsFilled) return false;
    if (!permissions.canRequestMentor(event, userId)) return false;
    return true;
  }, [userId, isEventPast, hasAlreadyRequested, isAcceptedMentor, isDeclinedMentor, mentorSlotsFilled, event, permissions]);

  // Update handleViewRequestsClick to remove local flags
  const handleViewRequestsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onViewRequestsClick?.();
  };

  return (
    <Card className="p-6 glass">
      <div className="space-y-4">
        {/* Staff profile picture */}
        {event.staffProfilePicture && (
          <div className="flex justify-center mb-4">
            <Avatar className="w-20 h-20">
              <AvatarImage 
                src={event.staffProfilePicture}
                alt={event.primaryStaffName}
              />
              <AvatarFallback>{event.primaryStaffName?.charAt(0) || 'S'}</AvatarFallback>
            </Avatar>
          </div>
        )}
        
        {/* Staff info */}
        <div className="flex items-start gap-4">
          <UserRound className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div>
            <p className="font-medium">
              {language === "en" ? "Staff" : "Mitarbeiter"}
            </p>
            <p className="text-muted-foreground">
              {event.staffNames && event.staffNames.length > 1 ? (
                `${event.staffNames[0]} (+${event.staffNames.length - 1} ${language === "en" ? "more" : "weitere"})`
              ) : (
                event.primaryStaffName || event.staffNames?.[0] || 'No staff assigned'
              )}
            </p>
          </div>
        </div>
        
        <div className="flex items-start gap-4">
          <CalendarIcon className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div>
            <p className="font-medium">{event.date}</p>
            <p className="text-muted-foreground">
              {getEventTimeDisplay(event, language)}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <Building2 className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div>
            <p className="font-medium">{event.company}</p>
            {event.companyInfo?.name && event.companyInfo.name !== event.company && (
              <p className="text-muted-foreground">{event.companyInfo.name}</p>
            )}
          </div>
        </div>

        <div className="flex items-start gap-4">
          <Users className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div>
            <p className="font-medium">
              {language === "en" ? "Required Staff" : "Benötigte Mitarbeiter"}
            </p>
            <p className="text-muted-foreground">
              {`${event.acceptedMentors?.length || 0} / ${requiredStaffCount}`}
            </p>
            {requiredTraitName && (
              <p className="text-muted-foreground">
                {language === "en" ? `Required trait: ${requiredTraitName}` : `Erforderliche Eigenschaft: ${requiredTraitName}`}
              </p>
            )}
          </div>
        </div>

        {/* Teams Link */}
        {event.teams_link && (
          <div className="pt-2">
            <a
              href={event.teams_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              {language === "en" ? "Join Teams Meeting" : "Teams-Meeting beitreten"}
            </a>
          </div>
        )}
        


        {/* REQUEST TO MENTOR BUTTON – only if active role = Mentor */}
        {user && canRequest && (
          <div className="pt-4 space-y-2">
            <Button
              variant="request"
              size="xl"
              className={`w-full mt-2 ${isEventPast ? "bg-gray-200 text-gray-500 border-gray-300 cursor-not-allowed hover:bg-gray-200 hover:text-gray-500" : ""}`}
              onClick={e => {
                e.stopPropagation();
                setConfirmModalOpen(true);
              }}
              disabled={isRequestLoading || isEventPast}
            >
              {isRequestLoading
                ? (language === "en" ? 'Requesting…' : 'Anfrage läuft…')
                : (language === "en" ? "Request to be a mentor" : "Anfrage als MentorIn")}
            </Button>
            {isEventPast && (
              <div className="w-full mt-2 text-center text-sm text-muted-foreground bg-gray-50 rounded px-2 py-1 border border-gray-200">
                {language === "en"
                  ? "This event has already taken place. Requests no longer available."
                  : "Diese Veranstaltung hat bereits stattgefunden. Anfragen nicht mehr möglich."}
              </div>
            )}
          </div>
        )}

        {/* VIEW REQUESTS BUTTON - For staff with pending requests */}
        {user && permissions.canProcessMentorRequests && event?.requestingMentors?.length > 0 && onViewRequestsClick && (
          <div className="pt-4">
            <CounterButton
              count={event.requestingMentors?.length || 0}
              englishLabel={language === "en" ? `${event.requestingMentors?.length || 0} Pending Request${(event.requestingMentors?.length || 0) !== 1 ? 's' : ''}` : undefined}
              germanLabel={language === "de" ? `${event.requestingMentors?.length || 0} Anfrage${(event.requestingMentors?.length || 0) !== 1 ? 'n' : ''}` : undefined}
              className="max-w-[200px] w-full px-6 py-2 flex items-center justify-center"
              onClick={handleViewRequestsClick}
              disabled={isEventPast}
            />
          </div>
        )}

        {/* Confirmation Modal for mentor request */}
        <ConfirmationModal
          event={event}
          open={confirmModalOpen}
          onOpenChange={setConfirmModalOpen}
          onConfirm={async () => {
            await requestToMentor();
            if (refreshEventData) {
              await refreshEventData();
            }
            setConfirmModalOpen(false);
          }}
          isLoading={isRequestLoading}
        />
      </div>
    </Card>
  );
};