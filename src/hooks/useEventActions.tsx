import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@/contexts/DataContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { supabase } from '@/lib/supabase';
import { assignMentorToEvent, removeMentorFromEvent } from '@/services/events/mentorService';
import { Event } from '@/types/event';
import { toast } from 'sonner';

interface UseEventActionsReturn {
  isDeleting: boolean;
  showDeleteDialog: boolean;
  setShowDeleteDialog: (show: boolean) => void;
  handleDeleteEvent: () => Promise<void>;
  handleAssignMentor: (mentorId: string) => Promise<void>;
  handleRemoveMentor: (mentorId: string) => Promise<void>;
  handleUpdateStaffMembers: (staffIds: string[]) => Promise<void>;
}

const useEventActions = (event: Event | null, setEvent: (event: Event) => void): UseEventActionsReturn => {
  const navigate = useNavigate();
  const { refetchEvents } = useData();
  const { user } = useAuth();
  const permissions = usePermissions();
  
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const buildUpdatedStaffFields = async (staffIds: string[]) => {
    if (staffIds.length === 0) {
      return {
        primaryStaffId: '',
        primaryStaffName: '',
        staffNames: [] as string[],
      };
    }

    const { data, error } = await supabase
      .from('user_profile')
      .select('user_id, Username')
      .in('user_id', staffIds);

    if (error) {
      throw error;
    }

    const nameMap = new Map(
      (data || []).map(profile => [profile.user_id, profile.Username || 'Unknown'])
    );
    const staffNames = staffIds.map(staffId => nameMap.get(staffId) || 'Unknown');

    return {
      primaryStaffId: staffIds[0] || '',
      primaryStaffName: staffNames[0] || '',
      staffNames,
    };
  };

  const handleDeleteEvent = async () => {
    if (!event || !permissions.canDeleteEvents) {
      console.error('Cannot delete event: missing event or permissions');
      return;
    }

    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from('mentorbooking_events')
        .delete()
        .eq('id', event.id);

      if (error) throw error;

      toast.success('Event deleted successfully');
      await refetchEvents();
      navigate('/events');
    } catch (error) {
      console.error('Error deleting event:', error);
      toast.error('Failed to delete event');
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const handleAssignMentor = async (mentorId: string) => {
    if (!event || !permissions.canAssignMentors) {
      console.error('Cannot assign mentor: missing event or permissions');
      return;
    }

    try {
      await assignMentorToEvent(event.id, mentorId);
      toast.success('Mentor assigned successfully');
      
      // Update local event state
      const updatedEvent = {
        ...event,
        acceptedMentors: [...(event.acceptedMentors || []), mentorId],
        requestingMentors: (event.requestingMentors || []).filter(id => id !== mentorId)
      };
      setEvent(updatedEvent);
      
      await refetchEvents();
    } catch (error) {
      console.error('Error assigning mentor:', error);
      toast.error('Failed to assign mentor');
    }
  };

  const handleRemoveMentor = async (mentorId: string) => {
    if (!event || !permissions.canAssignMentors) {
      console.error('Cannot remove mentor: missing event or permissions');
      return;
    }

    try {
      await removeMentorFromEvent(event.id, mentorId);
      toast.success('Mentor removed successfully');
      
      // Update local event state
      const updatedEvent = {
        ...event,
        acceptedMentors: (event.acceptedMentors || []).filter(id => id !== mentorId)
      };
      setEvent(updatedEvent);
      
      await refetchEvents();
    } catch (error) {
      console.error('Error removing mentor:', error);
      toast.error('Failed to remove mentor');
    }
  };

  const handleUpdateStaffMembers = async (staffIds: string[]) => {
    if (!event || !permissions.canAssignMentors) {
      console.error('Cannot update staff members: missing event or permissions');
      return;
    }

    try {
      const { error } = await supabase
        .from('mentorbooking_events')
        .update({ staff_members: staffIds })
        .eq('id', event.id);

      if (error) {
        throw error;
      }

      const updatedStaffFields = await buildUpdatedStaffFields(staffIds);
      setEvent({
        ...event,
        staff_members: staffIds,
        ...updatedStaffFields,
      });

      await refetchEvents();
      toast.success('Assigned staff updated successfully');
    } catch (error) {
      console.error('Error updating staff members:', error);
      toast.error('Failed to update assigned staff');
    }
  };

  return {
    isDeleting,
    showDeleteDialog,
    setShowDeleteDialog,
    handleDeleteEvent,
    handleAssignMentor,
    handleRemoveMentor,
    handleUpdateStaffMembers
  };
};

export default useEventActions;