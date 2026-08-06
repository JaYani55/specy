import { useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import type { Event } from '@/types/event';
import type { User } from '@/types/auth';
import { QUERY_KEYS } from '@/constants/queryKeys';
import { useActiveWorkspace } from '@/contexts/ActiveWorkspaceContext';

export function useMentorRequests(event: Event | null, user: User | null) {
  const [isRequestLoading, setIsRequestLoading] = useState(false);
  const { language } = useTheme();
  const qc = useQueryClient();
  const { activeTenantId } = useActiveWorkspace();

  /** Atomically request to be mentor */
  async function requestToMentor(): Promise<Event> {
    if (!event?.id || !user?.id) throw new Error('Missing event or user');
    setIsRequestLoading(true);
    try {
      const { data, error } = await supabase.rpc('append_unique_request', {
        event_id: event.id,
        mentor_id: user.id
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: [QUERY_KEYS.EVENTS, activeTenantId] });
      return data as Event;
    } finally {
      setIsRequestLoading(false);
    }
  }

  /**
   * Atomically approve or decline one mentor
   */
  async function processRequest(
    mentorId: string,
    action: 'approve' | 'decline'
  ): Promise<Event> {
    if (!event?.id) throw new Error('Missing event');
    const { data, error } = await supabase.rpc('process_mentor_actions', {
      event_id:   event.id,
      mentor_id:  mentorId,
      action_text: action
    });
    if (error) throw error;
    qc.invalidateQueries({ queryKey: [QUERY_KEYS.EVENTS, activeTenantId] });
    return data as Event;
  }

  return { isRequestLoading, requestToMentor, processRequest };
}
