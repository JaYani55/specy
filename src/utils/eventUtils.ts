import { Event, EventStatus } from '../types/event';
import { getEventStartDateTime } from './timeUtils';

// Pure function to calculate event status based on event data
export const calculateEventStatus = (event: Event): EventStatus => {
  // Don't change locked status
  if (event.status === 'locked') return 'locked';
  
  const hasRequests = (event.requestingMentors?.length || 0) > 0;
  const acceptedCount = event.acceptedMentors?.length || 0;
  const requiredCount = event.amount_requiredmentors || 1;
  
  if (acceptedCount >= requiredCount) {
    return 'successComplete';
  } else if (acceptedCount > 0) {
    return 'successPartly';
  } else if (hasRequests) {
    return 'firstRequests';
  } else {
    return 'new';
  }
};

// Format date based on language preference
export const formatDate = (dateString: string, language: string = 'en'): string => {
  if (!dateString) return '';
  
  try {
    const date = new Date(dateString);
    
    // Format based on language preference
    if (language === 'de') {
      // German format: DD.MM.YYYY
      return date.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } else {
      // Default/English format: MMM D, YYYY
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    }
  } catch (error) {
    console.error("Error formatting date:", error);
    return dateString;
  }
};

// Check if an event has pending mentor requests
export const hasPendingRequests = (event: Event): boolean => {
  return (event.requestingMentors?.length || 0) > 0;
};

/**
 * Determines if an event has already occurred (is in the past)
 */
export const isEventInPast = (event: Event): boolean => {
  const eventStart = getEventStartDateTime(event);
  if (!eventStart) return false;

  return eventStart.getTime() < Date.now();
};