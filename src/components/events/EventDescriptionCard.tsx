import { Event } from '@/types/event';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useTheme } from '@/contexts/ThemeContext';
import MentorRequestsModal from './MentorRequestsModal';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { MentorStatusBadge } from '@/components/mentors/MentorStatusBadge';
import { Package } from 'lucide-react';
import { StaffStatusBadge } from '@/components/staff/StaffStatusBadge';
import { AssignedStaffBadge } from "@/components/staff/AssignedStaffBadge";

interface EventDescriptionCardProps {
  event: Event;
  shouldShowMentorRequests: boolean;
  onMentorActionsProcessed: () => Promise<void>;
  isPastEvent?: boolean;
}

export const EventDescriptionCard = ({ 
  event, 
  shouldShowMentorRequests, 
  onMentorActionsProcessed,
  isPastEvent = false
}: EventDescriptionCardProps) => {
  const { language } = useTheme();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { user } = useAuth();
  const { canViewMentorProfiles, canViewStaffProfiles } = usePermissions();
  
  return (
    <Card className="lg:col-span-2 p-6">
      <div className="space-y-6">
        
        {/* Main Event Description (from Product) */}
        <div>
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Package className="h-5 w-5" />
            {language === "en" ? "Event Description" : "Veranstaltungsbeschreibung"}
          </h3>
          
          {event.ProductInfo?.description_de ? (
            <div className="space-y-4">
              {/* Product name badge */}
              <div className="flex items-center gap-2 mb-3">
                <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                  {event.ProductInfo.name}
                </Badge>
              </div>
              
              {/* Main product description */}
              <div className="prose prose-sm max-w-none">
                <p className="text-base leading-relaxed whitespace-pre-wrap">
                  {event.ProductInfo.description_de}
                </p>
              </div>
              
              {/* Effort description if available */}
              {event.ProductInfo.description_effort && (
                <div className="mt-4 p-3 bg-muted/30 rounded-lg border-l-4 border-primary/30">
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">
                    {language === "en" ? "Required Effort:" : "Erforderlicher Aufwand:"}
                  </h4>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {event.ProductInfo.description_effort}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground italic">
              {language === "en" 
                ? "No product description available." 
                : "Keine Produktbeschreibung verfügbar."}
            </p>
          )}
        </div>
        
        {/* Additional Information Section (from event.description) */}
        {event.description && event.description.trim() !== '' && (
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold mb-3">
              {language === "en" 
                ? "Additional Information" 
                : "Zusätzliche Informationen"}
            </h3>
            <div className="bg-blue-50/50 dark:bg-blue-900/10 p-4 rounded-lg border border-blue-200/30">
              <p className="whitespace-pre-wrap text-base leading-relaxed">
                {event.description}
              </p>
            </div>
          </div>
        )}
        
        {/* Mentor Requests Section (for event owner) */}
        {shouldShowMentorRequests && (
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold mb-3">
              {language === "en" ? "Staff Requests" : "Mitarbeiter-Anfragen"}
            </h3>
            
            <MentorRequestsModal
              event={event}
              open={isModalOpen}
              onOpenChange={setIsModalOpen}
              onSuccess={onMentorActionsProcessed}
              isPastEvent={isPastEvent}
            />
          </div>
        )}
        
        {/* STATUS BADGES SECTION */}
        <div className="border-t pt-6">
          <h3 className="text-lg font-semibold mb-3">
            {language === "en" ? "Your Status" : "Dein Status"}
          </h3>
          
          <div className="flex flex-wrap gap-2">
            {/* Mentor status badge */}
            {canViewMentorProfiles && user?.id && (
              <MentorStatusBadge 
                event={event} 
                userId={user.id}
                size="lg"
              />
            )}
            
            {/* Coach status badges */}
            {canViewStaffProfiles && user?.id && (
              <div className="flex flex-wrap gap-2">
                <AssignedStaffBadge 
                  event={event} 
                  userId={user.id}
                  size="lg"
                />
                <StaffStatusBadge 
                  event={event} 
                  userId={user.id}
                  size="lg"
                />
              </div>
            )}
            
            {/* If no status, show a message */}
            {(!user?.id || (!canViewMentorProfiles && !canViewStaffProfiles)) && 
              <p className="text-muted-foreground italic">
                {language === "en" 
                  ? "You aren't currently involved with this event." 
                  : "Du bist derzeit nicht an dieser Veranstaltung beteiligt."}
              </p>
            }
          </div>
        </div>
      </div>
    </Card>
  );
};