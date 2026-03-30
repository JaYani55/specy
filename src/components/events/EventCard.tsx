import React, { useMemo } from 'react';
import { Event } from '@/types/event';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Product } from '@/services/events/productService'; // Nur Typ importieren
import { Calendar, Clock, MapPin, Users, User, Loader2, Eye, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useData } from '@/contexts/DataContext'; // Produkte aus globalem Cache holen
import { usePermissions } from '@/hooks/usePermissions';
import { useMentorRequests } from '@/hooks/useMentorRequests';
import { isEventInPast } from "@/utils/eventUtils";
import * as LucideIcons from "lucide-react";
import { getIconByName } from "@/constants/pillaricons";
import ConfirmationModal from '../shared/ConfirmationModal';
import { CounterButton } from '@/components/ui/counter-button';
import type { UserProfileRecord } from '@/types/auth';

// Helper to determine if a color is "dark" (returns true for dark backgrounds)
function isColorDark(hexColor: string): boolean {
  // Remove hash if present
  const c = hexColor.replace('#', '');
  // Parse r,g,b
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  // Perceived brightness
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness < 128;
}
 
// Helper to extract first color from a linear-gradient string, fallback to blue
function extractFirstColor(gradient?: string): string {
  if (!gradient) return "#3b82f6";
  const match = gradient.match(/#([0-9a-fA-F]{6})/);
  return match ? `#${match[1]}` : "#3b82f6";
}

interface EventCardProps {
  event: Event;
  language: 'en' | 'de';
  userId?: string;
  onEventClick: (event: Event) => void;
  onRequestClick: (e: React.MouseEvent) => Promise<void>;
  onPendingRequestsClick: (eventId: string) => void;
  isNewlyAccepted?: boolean;
  onDismissNewBadge?: (eventId: string) => void;
  isPendingRequest?: boolean;
  refetchEvents: () => Promise<void>;
  isSubmittingRequest?: boolean;
}

export const EventCard = ({
  event,
  language,
  userId,
  onEventClick,
  onRequestClick,
  onPendingRequestsClick,
  isNewlyAccepted,
  onDismissNewBadge,
  isPendingRequest,
  refetchEvents,
  isSubmittingRequest = false,
}: EventCardProps) => {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { requestToMentor, isRequestLoading } = useMentorRequests(event, user);
  const { getUserProfile, products, isLoadingProducts } = useData(); // Produkte holen
  const { canViewMentorProfiles, canViewStaffProfiles, canProcessMentorRequests, canRequestMentor } = usePermissions();

  // Produkt aus globalem Cache holen
  const product: Product | undefined = useMemo(() => {
    if (isLoadingProducts || !products || !event.product_id) {
      return undefined;
    }
    return products.find(p => p.id === event.product_id);
  }, [event.product_id, products, isLoadingProducts]);

  // Skeleton-Loader anzeigen, wenn Produkte noch laden oder Produkt nicht gefunden
  const showSkeleton = isLoadingProducts || (event.product_id && !product);

  // Produkt-Infos
  const productName = product?.name;
  const productIconName = product?.icon_name;
  const productGradient = product?.gradient;
  const productColor = productGradient || "#3b82f6";
  const iconUrl = productIconName ? getIconByName(productIconName, theme === "dark") : undefined;
  const firstColor = extractFirstColor(productGradient);
  const shouldUseWhiteText = isColorDark(firstColor);
  const [staffProfile, setStaffProfile] = React.useState<UserProfileRecord | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = React.useState<boolean>(false);
  const [confirmModalOpen, setConfirmModalOpen] = React.useState<boolean>(false);

  const isPastEvent = useMemo(() => isEventInPast(event), [event]);

  
  // Now declare other computed values that depend on isPastEvent
  const hasAlreadyRequested = event.requestingMentors?.includes(userId || '') || false;
  const acceptedMentorCount = event.acceptedMentors?.length ?? 0;
  const requiredStaffCount = event.required_staff_count || event.amount_requiredmentors || 1;
  const isAcceptedMentor = event.acceptedMentors?.includes(userId || '') || false;
  const isDeclinedMentor = event.declinedMentors?.includes(userId || '') || false;
  
  // Load staff profile effect
  React.useEffect(() => {
    const loadStaffProfile = async () => {
      if (!event.primaryStaffId || !canViewStaffProfiles || showSkeleton) {
        setIsLoadingProfile(false);
        setStaffProfile(null);
        return;
      }

      setIsLoadingProfile(true);
      try {
        const profile = await getUserProfile(event.primaryStaffId);
        setStaffProfile(profile);
      } catch (error) {
        console.error('Error loading staff profile:', error);
        setStaffProfile(null);
      } finally {
        setIsLoadingProfile(false);
      }
    };

    void loadStaffProfile();
  }, [event.primaryStaffId, canViewStaffProfiles, getUserProfile, showSkeleton]);

  const canRequest = useMemo(() => {
    if (!userId || isPastEvent) return false;
    if (hasAlreadyRequested || isAcceptedMentor || isDeclinedMentor) return false;
    if (acceptedMentorCount >= requiredStaffCount) return false;
    if (!canRequestMentor(event, userId)) return false; // <-- FIX: call the function with arguments
    return true;
  }, [
    userId,
    isPastEvent,
    hasAlreadyRequested,
    isAcceptedMentor,
    isDeclinedMentor,
    acceptedMentorCount,
    requiredStaffCount,
    canRequestMentor,
    event,
  ]);

  // Format event date
  const eventDate = useMemo(() => {
    try {
      return parseISO(event.date);
    } catch (error) {
      console.error('Error parsing event date:', error);
      return new Date();
    }
  }, [event.date]);

  const timeUntilEvent = useMemo(() => {
    try {
      return formatDistanceToNow(eventDate, { 
        addSuffix: true, 
        locale: language === 'de' ? de : undefined 
      });
    } catch (error) {
      console.error('Error formatting time until event:', error);
      return '';
    }
  }, [eventDate, language]);

  if (showSkeleton) {
    return (
      <div className="w-full min-h-[420px] max-w-xl mx-auto rounded-3xl bg-gray-100 dark:bg-gray-800 animate-pulse flex items-center justify-center">
        <span className="text-lg text-muted-foreground">{language === "en" ? "Loading event…" : "Event wird geladen…"}</span>
      </div>
    );
  }

  // Fallback: Event ohne Produkt
  if (!product && event.product_id === null) {
    return (
      <div className="w-full min-h-[420px] max-w-xl mx-auto rounded-3xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-muted-foreground">
        {language === "en" ? "Event without product info" : "Veranstaltung ohne Produktinformation"}
      </div>
    );
  }

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't trigger card click if clicking on buttons
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }
    onEventClick(event);
  };

  const handleDismissClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDismissNewBadge) {
      onDismissNewBadge(event.id);
    }
  };

  // Keyboard accessibility: handle Enter/Space
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onEventClick(event);
    }
  };

  return (
    <Card
      className={`w-full cursor-pointer transition-all duration-200 hover:shadow-lg border overflow-hidden
        rounded-3xl
        min-h-[420px] max-w-xl mx-auto
        ${isNewlyAccepted ? 'border-green-400 bg-green-50 dark:bg-green-900/10' : ''}
        ${isPendingRequest ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/10' : ''}
      `}
      onClick={handleCardClick}
      tabIndex={0}
      role="button"
      aria-label={event.company}
      onKeyDown={handleKeyDown}
    >
      {/* Product Color Header */}
      <div
        className="relative flex flex-col items-center justify-center"
        style={{
          background: productColor,
          backgroundImage: productGradient,
          height: "110px",
        }}
      >
        {iconUrl && (
          <img
            src={iconUrl}
            alt={productName}
            className="w-12 h-12 mb-1"
            style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.10))" }}
          />
        )}
        <span
          className="font-semibold text-lg text-center"
          style={{
            color: shouldUseWhiteText ? "#fff" : "#111",
            textShadow: shouldUseWhiteText ? "0 1px 4px rgba(0,0,0,0.18)" : "none"
          }}
        >
          {productName}
        </span>
      </div>

      <CardContent className="p-6 space-y-4">
        {/* Header with company and status */}
        <div className="flex items-start justify-between mt-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg text-foreground truncate">
              {event.company}
            </h3>
            {isNewlyAccepted && (
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="default" className="bg-green-600 text-white">
                  {language === "en" ? "✓ Accepted" : "✓ Akzeptiert"}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={handleDismissClick}
                >
                  {language === "en" ? "Dismiss" : "Ausblenden"}
                </Button>
              </div>
            )}
            {isPendingRequest && (
              <Badge variant="secondary" className="mt-1 bg-amber-100 text-amber-800">
                {language === "en" ? "⏳ Pending" : "⏳ Ausstehend"}
              </Badge>
            )}
          </div>
        </div>

        {/* Event Details */}
        <div className="space-y-2 text-sm">
          <InfoItem
            value={event.date}
            label={language === "en" ? "Date" : "Datum"}
          />
          <InfoItem
            value={`${event.time}${event.end_time ? ` - ${event.end_time}` : ''}`}
            label={language === "en" ? "Time" : "Zeit"}
          />
          <InfoItem
            value={timeUntilEvent}
            label={language === "en" ? "Time until event" : "Zeit bis Event"}
            valueClassName={isPastEvent ? "text-muted-foreground" : "text-foreground"}
          />
          <InfoItem
            value={`${event.acceptedMentors?.length || 0} / ${requiredStaffCount}`}
            label={language === "en" ? "Required Staff" : "Benötigte Mitarbeiter"}
          />
          {event.mode && (
            <InfoItem
              value={event.mode === 'online' ? 'Online' : event.mode === 'live' ? 'In Person' : 'Hybrid'}
              label={language === "en" ? "Mode" : "Modus"}
            />
          )}
        </div>

        {/* Staff Information */}
        {canViewStaffProfiles && staffProfile && (
          <div className="pt-2 border-t border-border">
            <div className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-muted-foreground">
                {language === "en" ? "Staff/Coach:" : "Mitarbeiter/Coach:"}
              </span>
              <span className="font-medium text-foreground">
                {isLoadingProfile ? "Loading..." : staffProfile.Username || event.primaryStaffName}
              </span>
            </div>
          </div>
        )}

        {/* Actions Section - Always at bottom */}
        <div className="w-full flex flex-col items-center gap-2 mt-4">
          {/* Mentor request button – only if active role = Mentor */}
          {user && canRequestMentor && canRequestMentor(event, user.id) && (
            <>
              <Button
                variant="request"
                size="xl"
                disabled={isRequestLoading || isPastEvent}
                onClick={e => {
                  e.stopPropagation();
                  setConfirmModalOpen(true);
                }}
                className="w-full mt-2"
              >
                {isRequestLoading
                  ? (language === 'en' ? 'Requesting…' : 'Anfrage läuft…')
                  : (language === 'en' ? 'Request to be a mentor' : 'Anfrage als MentorIn')}
              </Button>
              <ConfirmationModal
                event={event}
                open={confirmModalOpen}
                onOpenChange={setConfirmModalOpen}
                onConfirm={async () => {
                  await requestToMentor();
                  await refetchEvents();
                  setConfirmModalOpen(false);
                }}
                isLoading={isRequestLoading}
              />
            </>
          )}

          {/* VIEW REQUESTS BUTTON - For staff with pending requests */}
          {canProcessMentorRequests && event.requestingMentors?.length > 0 && (
            <CounterButton
              count={event.requestingMentors?.length || 0}
              englishLabel={language === "en" ? `${event.requestingMentors?.length || 0} Pending Request${(event.requestingMentors?.length || 0) !== 1 ? 's' : ''}` : undefined}
              germanLabel={language === "de" ? `${event.requestingMentors?.length || 0} Anfrage${(event.requestingMentors?.length || 0) !== 1 ? 'n' : ''}` : undefined}
              className="max-w-[200px] w-full px-6 py-2 flex items-center justify-center"
              onClick={() => onPendingRequestsClick(event.id)}
              disabled={isPastEvent}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
};

const InfoItem = ({ value, label, valueClassName = "" }: {
  value: string | number;
  label: string;
  valueClassName?: string;
}) => (
  <div className="flex items-center justify-between text-sm">
    <span className="text-muted-foreground">{label}:</span>
    <span className={`font-medium ${valueClassName || "text-foreground"}`}>{value}</span>
  </div>
);