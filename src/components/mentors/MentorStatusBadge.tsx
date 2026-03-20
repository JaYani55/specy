import React, { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Event } from "@/types/event";
import { useTheme } from "@/contexts/ThemeContext";
import { 
  CheckCircle, 
  Clock, 
  XCircle
} from "lucide-react";

interface MentorStatusBadgeProps {
  event: Event;
  userId: string;
  size?: "sm" | "default" | "lg";
  className?: string;
}

export const MentorStatusBadge = ({ 
  event, 
  userId, 
  size = "default",
  className = ""
}: MentorStatusBadgeProps) => {
  const { language } = useTheme();
  
  const [localStatuses, setLocalStatuses] = useState({
    isAccepted: false,
    isPending: false,
    isDeclined: false
  });

  // Determine mentor status
  const isAccepted = event?.acceptedMentors?.includes(userId);
  const isPending = event?.requestingMentors?.includes(userId);
  const isDeclined = event?.declinedMentors?.includes(userId);

  useEffect(() => {
    setLocalStatuses((current) => {
      const next = {
        isAccepted: current.isAccepted || Boolean(isAccepted),
        isPending: current.isPending || Boolean(isPending),
        isDeclined: current.isDeclined || Boolean(isDeclined),
      };

      if (
        next.isAccepted === current.isAccepted
        && next.isPending === current.isPending
        && next.isDeclined === current.isDeclined
      ) {
        return current;
      }

      return next;
    });
  }, [
    event?.id,
    isAccepted, 
    isPending, 
    isDeclined
  ]);

  // Use either the current props OR local state for rendering
  const finalAccepted = isAccepted || localStatuses.isAccepted;
  const finalPending = isPending || localStatuses.isPending;
  const finalDeclined = isDeclined || localStatuses.isDeclined;

  // Early return if not involved
  if (!finalAccepted && !finalPending && !finalDeclined) {
    return null;
  }

  const sizeClasses = {
    sm: "px-2 py-1 text-xs gap-1",
    default: "px-3 py-1.5 text-sm gap-1.5",
    lg: "px-4 py-2 text-base gap-2"
  };

  const iconSize = {
    sm: 12,
    default: 14,
    lg: 16
  }[size];

  // Status-specific rendering
  if (finalAccepted) {
    return (
      <Badge 
        variant="outline" 
        className={`bg-green-100/80 dark:bg-green-900/30 text-green-900 dark:text-green-400 border-green-500/30 ${sizeClasses[size]} ${className}`}
      >
        <CheckCircle size={iconSize} />
        {language === "en" ? "You're a Mentor" : "Du bist MentorIn"}
      </Badge>
    );
  }

  if (finalPending) {
    return (
      <Badge 
        variant="outline" 
        className={`bg-blue-100/80 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 border-blue-500/30 ${sizeClasses[size]} ${className}`}
      >
        <Clock size={iconSize} />
        {language === "en" ? "Request Pending" : "Anfrage ausstehend"}
      </Badge>
    );
  }

  if (finalDeclined) {
    return (
      <Badge 
        variant="outline" 
        className={`bg-red-100/80 dark:bg-red-900/30 text-red-800 dark:text-red-400 border-red-500/30 ${sizeClasses[size]} ${className}`}
      >
        <XCircle size={iconSize} />
        {language === "en" ? "Request Declined" : "Anfrage abgelehnt"}
      </Badge>
    );
  }

  return null;
};