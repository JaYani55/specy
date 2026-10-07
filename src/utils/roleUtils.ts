import { UserRole } from '@/types/auth';

/**
 * Check if a user role has staff-level permissions
 * This includes coaches, staff, mentoring management, and super admins
 */
export const hasStaffPermissions = (userRole?: UserRole): boolean => {
  return [
    UserRole.SUPERADMIN,
    UserRole.MENTORINGMANAGEMENT,
    UserRole.STAFF // Only staff has permissions now
    // UserRole.COACH removed - now purely cosmetic
  ].includes(userRole || UserRole.GUEST);
};

/**
 * Get the display name for a role based on language
 */
export const getDisplayRoleName = (role: UserRole, language: 'en' | 'de' = 'en'): string => {
  switch (role) {
    case UserRole.SUPERADMIN:
      return language === 'en' ? 'Super Admin' : 'Super Admin';
    case UserRole.COACH:
      return language === 'en' ? 'Coach' : 'Coach';
    case UserRole.STAFF:
      return language === 'en' ? 'Staff' : 'Mitarbeiter';
    case UserRole.MENTORINGMANAGEMENT:
      return language === 'en' ? 'Staff Management' : 'Mitarbeiter-Management';
    case UserRole.MENTOR:
      return language === 'en' ? 'Staff' : 'Mitarbeiter';
    default:
      return role;
  }
};

/**
 * Check if a role is considered administrative (has elevated permissions)
 */
export const isAdministrativeRole = (userRole?: UserRole): boolean => {
  return [
    UserRole.SUPERADMIN,
    UserRole.MENTORINGMANAGEMENT
  ].includes(userRole || UserRole.GUEST);
};