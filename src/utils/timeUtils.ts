import { formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';

/**
 * Calculates the end time based on start time and duration
 */
export function calculateEndTime(startTime: string, durationMinutes: number): string {
    if (!startTime || !durationMinutes) return '';
    
    const [hours, minutes] = startTime.split(':').map(Number);
    
  // Calculate total minutes
  const totalMinutes = hours * 60 + minutes + durationMinutes;
    
    // Calculate new hours and minutes
    const newHours = Math.floor(totalMinutes / 60) % 24;
    const newMinutes = totalMinutes % 60;
    
    // Format as HH:MM
    return `${newHours.toString().padStart(2, '0')}:${newMinutes.toString().padStart(2, '0')}`;
  }
  
  /**
   * Calculates duration in minutes between start and end time
   */
  export function calculateDuration(startTime: string, endTime: string): number {
    if (!startTime || !endTime) return 0;
    
    const [startHours, startMinutes] = startTime.split(':').map(Number);
    const [endHours, endMinutes] = endTime.split(':').map(Number);
    
    // Calculate total minutes for each time
    const startTotalMinutes = startHours * 60 + startMinutes;
    let endTotalMinutes = endHours * 60 + endMinutes;
    
    // Handle case where end time is on the next day
    if (endTotalMinutes < startTotalMinutes) {
      endTotalMinutes += 24 * 60; // Add 24 hours
    }
    
    return endTotalMinutes - startTotalMinutes;
  }
  
  /**
   * Format duration in minutes to a human-readable string
   */
  export function formatDuration(minutes: number, language: 'en' | 'de' = 'en'): string {
    if (!minutes) return '';
    
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (hours === 0) {
      return `${mins} ${language === 'en' ? 'minutes' : 'Minuten'}`;
    } else if (mins === 0) {
      return `${hours} ${hours === 1 ? (language === 'en' ? 'hour' : 'Stunde') : (language === 'en' ? 'hours' : 'Stunden')}`;
    } else {
      return `${hours} ${hours === 1 ? (language === 'en' ? 'hour' : 'Stunde') : (language === 'en' ? 'hours' : 'Stunden')} ${mins} ${language === 'en' ? 'minutes' : 'Minuten'}`;
    }
  }
  
  /**
   * Get display time string for an event (e.g., "9:00 - 10:30")
   */
  export function getEventTimeDisplay(event: { time: string; duration_minutes?: number }, language: 'en' | 'de' = 'en'): string {
    if (!event.time) return '';
    
    // Calculate end time based on duration
    if (event.duration_minutes) {
      const calculatedEndTime = calculateEndTime(event.time, event.duration_minutes);
      return `${event.time} - ${calculatedEndTime}`;
    }
    
    // If no duration is specified, just show start time
    return event.time;
  }

export function parseLocalDateTime(date: string, time = '00:00'): Date | null {
  if (!date) return null;

  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes)
  ) {
    return null;
  }

  const parsed = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getEventStartDateTime(event: { date: string; time?: string }): Date | null {
  return parseLocalDateTime(event.date, event.time || '00:00');
}

export function getRelativeEventTime(
  event: { date: string; time?: string },
  language: 'en' | 'de' = 'en'
): string {
  const eventStart = getEventStartDateTime(event);

  if (!eventStart) {
    return '';
  }

  return formatDistanceToNow(eventStart, {
    addSuffix: true,
    locale: language === 'de' ? de : undefined,
  });
}