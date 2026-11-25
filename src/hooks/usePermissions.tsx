import { useMemo } from 'react';
import type { AppRole } from '@/types/auth';
import { useAuth } from '@/contexts/AuthContext';
import { Event } from '@/types/event';
import { isEventInPast } from '@/utils/eventUtils';

export interface Permissions {
  userRoles: string[];

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

  // Logging management (support or super-admin only)
  canManageLogging: boolean;

  // Outbound webhooks (support or super-admin only — creation is RBAC-restricted)
  canManageWebhooks: boolean;
  
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
  hasRole: (role: AppRole) => boolean;
}

export const usePermissions = (): Permissions => {
  const { user } = useAuth();

  return useMemo(() => {
    const userRoles = user?.roles || [];
    const isSuperAdmin = userRoles.includes('super-admin');
    const isAdmin = isSuperAdmin || userRoles.includes('admin');
    const isSupport = userRoles.includes('support');
    const isUser = isAdmin || userRoles.includes('user') || userRoles.includes('staff');

    const hasRole = (role: AppRole) => {
      switch (role) {
        case 'user':
          return isUser;
        case 'admin':
          return isAdmin;
        case 'super-admin':
          return isSuperAdmin;
        default:
          return false;
      }
    };

    const canViewStaffProfiles = isAdmin;

    const canMentorViewEvent = (event: { initial_selected_mentors: string[] }) => {
      return true;
    };

    const canRequestMentor = (event: Event, userId: string) => {
      void event;
      void userId;
      return false;
    };

    return {
      userRoles,

      // Admin permissions
      canManageTraits: isAdmin,
      canManageMentors: isAdmin,
      canManageProducts: isUser,
      canCreateEvents: isUser,
      canDeleteEvents: isUser,
      canEditEvents: isUser,

      // View permissions
      canViewAllProfiles: isAdmin,
      canViewMentorProfiles: isUser,
      canViewStaffProfiles,
      canViewAdminData: isSuperAdmin,
      canEditOwnProfile: false, // No one can edit their own profile
      canEditAnyProfile: isAdmin,
      canEditUsername: isAdmin,

      // Event permissions
      canViewPendingRequests: isUser,
      canProcessMentorRequests: isUser,
      canAssignMentors: isAdmin,

      // Access permissions
      canAccessVerwaltung: isUser,

      // Logging management (support or super-admin)
      canManageLogging: isSuperAdmin || isSupport,

      // Outbound webhooks (support or super-admin — mirrored by the API RBAC)
      canManageWebhooks: isSuperAdmin || isSupport,

      // Account administration
      canManageAccounts: isAdmin,

      // Plugin management
      canManagePlugins: isAdmin,

      // Animal icon permissions
      canChangeAnimalIcons: isAdmin,

      // Data access
      getSeaTableView: () => {
        if (isSuperAdmin) return 'SUPER_ADMIN_VIEW';
        if (isAdmin) return 'ADMIN_VIEW';
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