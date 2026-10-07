import React from 'react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, User, Shield, Users, Crown, Briefcase } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { UserRole } from "@/types/auth";
import { useTheme } from "@/contexts/ThemeContext";

interface RoleIndicatorProps {
  language: 'en' | 'de';
}

export const RoleIndicator: React.FC<RoleIndicatorProps> = ({ language }) => {
  const { user, switchRole, getAvailableRoles } = useAuth();
  const availableRoles = getAvailableRoles();
  const { theme } = useTheme();
  
  // Don't show if user has only one role or no roles
  if (!user || availableRoles.length <= 1) {
    return null;
  }

  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case UserRole.SUPERADMIN:
        return Crown;
      case UserRole.COACH:
        return Briefcase;
      case UserRole.STAFF:
        return Users;
      case UserRole.MENTORINGMANAGEMENT:
        return Shield;
      case UserRole.MENTOR:
        return User;
      default:
        return User;
    }
  };

  const getRoleDisplayName = (role: UserRole): string => {
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

  // Tailwind classes for light/dark mode
  const getRoleColor = (role: UserRole) => {
    if (theme === 'dark') {
      switch (role) {
        case UserRole.SUPERADMIN:
          return 'bg-red-900 text-red-200 border-red-700 hover:bg-red-800';
        case UserRole.COACH:
          return 'bg-purple-900 text-purple-200 border-purple-700 hover:bg-purple-800';
        case UserRole.STAFF:
          return 'bg-blue-900 text-blue-200 border-blue-700 hover:bg-blue-800';
        case UserRole.MENTORINGMANAGEMENT:
          return 'bg-green-900 text-green-200 border-green-700 hover:bg-green-800';
        case UserRole.MENTOR:
          return 'bg-orange-900 text-orange-200 border-orange-700 hover:bg-orange-800';
        default:
          return 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700';
      }
    } else {
      switch (role) {
        case UserRole.SUPERADMIN:
          return 'bg-red-100 text-red-800 border-red-200 hover:bg-red-200';
        case UserRole.COACH:
          return 'bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-200';
        case UserRole.STAFF:
          return 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200';
        case UserRole.MENTORINGMANAGEMENT:
          return 'bg-green-100 text-green-800 border-green-200 hover:bg-green-200';
        case UserRole.MENTOR:
          return 'bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-200';
        default:
          return 'bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-200';
      }
    }
  };

  // Container classes for light/dark mode
  const containerClass = theme === 'dark'
    ? 'w-full bg-gradient-to-r from-slate-900 to-slate-800 border-b border-slate-700 py-2 px-4'
    : 'w-full bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200 py-2 px-4';

  const dropdownMenuClass = theme === 'dark' ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200';
  const dropdownItemActiveClass = theme === 'dark' ? 'bg-slate-800 font-medium' : 'bg-slate-100 font-medium';
  const dropdownItemHoverClass = theme === 'dark' ? 'hover:bg-slate-800' : 'hover:bg-slate-50';
  const textColor = theme === 'dark' ? 'text-slate-200' : 'text-slate-600';
  const iconColor = theme === 'dark' ? 'text-slate-300' : 'text-slate-600';

  const currentRole = user.role;
  const CurrentRoleIcon = getRoleIcon(currentRole);
  const currentRoleColor = getRoleColor(currentRole);

  const handleRoleSwitch = (role: UserRole) => {
    switchRole(role);
  };

  return (
    <div className={containerClass}
         role="banner"
         aria-label={language === 'en' ? 'Role selector' : 'Rollenauswahl'}>
      <div className="container mx-auto">
        <div className="flex items-center justify-end">
          {/* All content grouped together on the right */}
          <div className="flex items-center gap-4">
            {/* Current role display */}
            <div className="flex items-center gap-3">
              <span className={`text-sm font-medium hidden sm:inline ${textColor}`} id="current-role-label">
                {language === 'en' ? 'Active Role:' : 'Aktive Rolle:'}
              </span>
              <div className="flex items-center gap-2" role="status" aria-labelledby="current-role-label">
                <CurrentRoleIcon className={`h-4 w-4 ${iconColor}`} aria-hidden="true" />
                <Badge 
                  variant="secondary" 
                  className={`${currentRoleColor} font-medium text-sm px-3 py-1`}
                >
                  {getRoleDisplayName(currentRole)}
                </Badge>
              </div>
            </div>

            {/* Role switcher */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className={`h-8 ${textColor} hover:text-slate-50 hover:bg-slate-700 dark:hover:bg-slate-700`}
                  aria-label={language === 'en' ? 'Switch to different role' : 'Zu anderer Rolle wechseln'}
                  aria-haspopup="menu"
                  aria-expanded={false}
                >
                  <ChevronDown className={`h-4 w-4 mr-1 ${iconColor}`} aria-hidden="true" />
                  <span className="hidden sm:inline text-sm">
                    {language === 'en' ? 'Switch Role' : 'Rolle wechseln'}
                  </span>
                  <span className="sm:hidden text-sm">
                    {language === 'en' ? 'Switch' : 'Wechseln'}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={`w-56 ${dropdownMenuClass}`} role="menu">
                {availableRoles.map((role) => {
                  const RoleIcon = getRoleIcon(role);
                  const isActive = role === currentRole;
                  return (
                    <DropdownMenuItem
                      key={role}
                      onClick={() => handleRoleSwitch(role)}
                      className={`flex items-center gap-3 py-2 px-3 cursor-pointer ${isActive ? dropdownItemActiveClass : dropdownItemHoverClass}`}
                      disabled={isActive}
                      role="menuitem"
                      aria-current={isActive ? 'true' : 'false'}
                    >
                      <RoleIcon className={`h-4 w-4 ${iconColor}`} aria-hidden="true" />
                      <span className="flex-1">{getRoleDisplayName(role)}</span>
                      {isActive && (
                        <Badge variant="default" className="text-xs px-2 py-0">
                          {language === 'en' ? 'Active' : 'Aktiv'}
                        </Badge>
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
};