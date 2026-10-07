import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { UserPlus, Users, Loader2 } from 'lucide-react';
import { Event } from '@/types/event';
import { useTheme } from '@/contexts/ThemeContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useManualMentorApproval } from '@/hooks/useManualMentorApproval';
import { MentorSelector } from './MentorSelector';

interface ManualMentorApprovalProps {
  event: Event;
  onMentorAdded: () => Promise<void>;
  isPastEvent?: boolean;
}

export const ManualMentorApproval = ({
  event,
  onMentorAdded,
  isPastEvent = false
}: ManualMentorApprovalProps) => {
  const { language } = useTheme();
  const { canAssignMentors } = usePermissions();
  
  // Use the custom hook for manual mentor approval
  const { isApproving, approveMentorManually } = useManualMentorApproval(event);

  // Don't render if user doesn't have permission or event is in the past
  if (!canAssignMentors || isPastEvent) {
    return null;
  }

  const handleMentorSelected = async (mentorId: string, mentorName: string) => {
    try {
      await approveMentorManually(mentorId, mentorName);
      await onMentorAdded(); // Refresh the event data
    } catch (error) {
      // Error handling is already done in the hook
      console.error('Manual mentor approval failed:', error);
    }
  };

  // Calculate current mentor status
  const currentAcceptedCount = event.acceptedMentors?.length || 0;
  const requiredCount = event.amount_requiredmentors || 1;
  const isAtCapacity = currentAcceptedCount >= requiredCount;

  // Get all currently involved mentors to exclude from selector
  const excludedMentorIds = [
    ...(event.acceptedMentors || []),
    ...(event.requestingMentors || []),
    ...(event.declinedMentors || [])
  ];

  return (
    <Card className="p-6 mt-6">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            <h3 className="text-lg font-semibold">
              {language === 'en' ? 'Manual Staff Approval' : 'Manuelle Mitarbeiter-Zuweisung'}
            </h3>
          </div>
          
          <Badge variant={isAtCapacity ? "default" : "outline"} className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {currentAcceptedCount}/{requiredCount}
          </Badge>
        </div>


        {/* Capacity Warning */}
        {isAtCapacity && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-3">
            <p className="text-amber-800 dark:text-amber-200 text-sm">
              ⚠️ {language === 'en' 
                ? 'This event has reached its staff capacity. Adding more staff members will exceed the required amount.'
                : 'Dieses Event hat seine Mitarbeiter-Kapazität erreicht. Das Hinzufügen weiterer Mitarbeitender überschreitet die erforderliche Anzahl.'
              }
            </p>
          </div>
        )}

        {/* Mentor Selector */}
        <div className="space-y-3">
          <label className="text-sm font-medium">
            {language === 'en' ? 'Select staff member to approve for the event:' : 'Füge der Veranstaltung Mitarbeitende hinzu:'}
          </label>
          
          <MentorSelector
            eventId={event.id}
            excludeUserIds={excludedMentorIds}
            onMentorSelected={handleMentorSelected}
            language={language}
            disabled={isApproving}
          />
          
          {isApproving && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {language === 'en' ? 'Approving staff member...' : 'Mitarbeiter wird hinzugefügt...'}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};