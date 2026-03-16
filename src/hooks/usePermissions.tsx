import { useMemo } from 'react';
import { UserRole } from '@/types/auth';
import { useAuth } from '@/contexts/AuthContext';
import { hasStaffPermissions, isAdministrativeRole } from '@/utils/roleUtils';
import { Event } from '@/types/event';
import { isEventInPast } from '@/utils/eventUtils';

export interface Permissions {
  // Admin permissions
  canManageTraits: boolean;
  canManageMentors: boolean;
  canManageProducts: boolean;
  canCreateEvents: boolean;
  canDeleteEvents: boolean;
  canEditEvents: boolean;
  
  // View permissions
  canViewAllProfiles: boolean;
  canViewMentorProfiles: boolean;
  canViewStaffProfiles: boolean; // <-- Add this line
  canEditOwnProfile: boolean;
  canEditAnyProfile: boolean;
  canViewAdminData: boolean;
  canEditUsername: boolean;
  
  // Event permissions
  canViewPendingRequests: boolean;
  canProcessMentorRequests: boolean;
  canAssignMentors: boolean; // <-- use this only
  
  // Access permissions
  canAccessVerwaltung: boolean;
  
  // Account administration (super-admin only)
  canManageAccounts: boolean;

  // Plugin management (super-admin only)
  canManagePlugins: boolean;
  
  // Animal icon permissions
  canChangeAnimalIcons: boolean;
  
  // Data access
  getSeaTableView: () => string;

  // Mentor permissions
  canRequestMentor: (event: Event, userId: string) => boolean; // <-- Add this line
  canMentorViewEvent: (event: { initial_selected_mentors: string[] }) => boolean; // <-- New helper

  // Role check
  hasRole: (role: 'staff' | 'mentor' | 'admin') => boolean;
}

export const usePermissions = (): Permissions => {
  const { user } = useAuth();

  return useMemo(() => {
    const isAdmin = user?.role === UserRole.SUPERADMIN;
    const isAdminOrManagement = isAdministrativeRole(user?.role);
    const hasStaffAccess = hasStaffPermissions(user?.role);
    const isMentor = user?.role === UserRole.MENTOR;
    const isMentoringManagement = user?.role === UserRole.MENTORINGMANAGEMENT;

    const hasRole = (role: 'staff' | 'mentor' | 'admin') => {
      switch (role) {
        case 'staff':
          return hasStaffAccess;
        case 'mentor':
          return isMentor;
        case 'admin':
          return isAdmin;
        default:
          return false;
      }
    };

    // Define your logic for staff profile viewing here:
    // Example: Only admins and management can view staff profiles
    const canViewStaffProfiles = isAdminOrManagement || hasStaffAccess;

    // Helper: Only mentors in initial_selected_mentors can view the event
    const canMentorViewEvent = (event: { initial_selected_mentors: string[] }) => {
      if (!isMentor) return true; // admins/staff see everything
      if (!event?.initial_selected_mentors || !Array.isArray(event.initial_selected_mentors)) return false;
      return event.initial_selected_mentors.includes(user?.id);
    };

    // Only require that the current role is mentor
    const canRequestMentor = (event: Event, userId: string) => {
      if (!userId) return false;
      const isPast    = isEventInPast(event);
      const isFull    = (event.acceptedMentors?.length || 0) >= event.amount_requiredmentors;
      const hasReq    = event.requestingMentors?.includes(userId);
      const isAcc     = event.acceptedMentors?.includes(userId);
      const isDecline = event.declinedMentors?.includes(userId);
      return (
        !isPast &&
        !isFull &&
        !hasReq &&
        !isAcc &&
        !isDecline &&
        isMentor
      );
    };

    return {
      // Admin permissions
      canManageTraits: isAdminOrManagement,
      canManageMentors: isAdminOrManagement,
      canManageProducts: hasStaffAccess,
      canCreateEvents: hasStaffAccess,
      canDeleteEvents: hasStaffAccess,
      canEditEvents: hasStaffAccess,

      // View permissions
      canViewAllProfiles: isAdminOrManagement,
      canViewMentorProfiles: hasStaffAccess,
      canViewStaffProfiles,
      canViewAdminData: isAdmin,
      canEditOwnProfile: false, // No one can edit their own profile
      canEditAnyProfile: isAdminOrManagement, // Only super-admin, admin, mentoringmanagement
      canEditUsername: isAdminOrManagement,

      // Event permissions
      canViewPendingRequests: hasStaffAccess,
      canProcessMentorRequests: hasStaffAccess,
      canAssignMentors: isMentoringManagement,

      // Access permissions
      canAccessVerwaltung: hasStaffAccess,

      // Account administration (super-admin only)
      canManageAccounts: isAdmin,

      // Plugin management (super-admin only)
      canManagePlugins: isAdmin,

      // Animal icon permissions
      canChangeAnimalIcons: isAdmin,

      // Data access
      getSeaTableView: () => {
        if (isAdmin) return 'ADMIN_VIEW';
        if (isMentoringManagement) return 'MENTORING_MANAGEMENT_VIEW';
        return 'DEFAULT_VIEW';
      },

      // Mentor permissions
      canRequestMentor,
      canMentorViewEvent,

      // Role check
      hasRole,
    };
  }, [user]);
};