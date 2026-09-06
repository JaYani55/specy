import { useState, useEffect, useCallback } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

type ProfileRow = {
  user_id: string;
  Username?: string | null;
  pfp_url?: string | null;
} & Record<string, unknown>;

type RoleRow = {
  role_id: string;
  roles: {
    name: string | null;
  } | null;
};

const toProfileRow = (value: unknown): ProfileRow | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as ProfileRow;
  return typeof record.user_id === 'string' ? record : null;
};

const extractRoleNames = (rows: unknown[] | null | undefined): string[] => {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') {
      return [];
    }

    const { roles } = row as RoleRow;
    const name = roles?.name;
    return typeof name === 'string' && name.length > 0 ? [name] : [];
  });
};

interface ProfileUser {
  id: string;
  Username?: string;
  pfp_url?: string;
  email?: string;
  role?: string;
  [key: string]: unknown;
}

export const useProfileData = (language: 'en' | 'de') => {
  const { userId } = useParams<{ userId: string }>();
  const { user: currentUser } = useAuth();
  // Permissions
  const { canEditUsername } = usePermissions();
  const [isLoading, setIsLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [isRegistrationInProcess, setIsRegistrationInProcess] = useState(false);

  // Determine the actual user ID to fetch
  const targetUserId = userId || currentUser?.id;
  const isOwnProfile = !userId || userId === currentUser?.id;

  // Check access permissions
  const checkAccess = useCallback(async () => {
    if (!targetUserId) {
      setHasAccess(false);
      setAccessChecked(true);
      setIsLoading(false);
      return;
    }

    try {
      console.log('[useProfileData] Checking access for user:', targetUserId);
      
      // Query user_profile table
      const { data: profileData, error: profileError } = await supabase
        .from('user_profile')
        .select('*')
        .eq('user_id', targetUserId)
        .single();

      if (profileError) {
        console.error('[useProfileData] Error fetching profile:', profileError);
        
        // If it's a "not found" error, the user might not have a profile yet
        if (profileError.code === 'PGRST116') {
          console.log('[useProfileData] User profile not found, checking if user exists in auth');
          
          // User exists in auth but no profile - this is registration in process
          setIsRegistrationInProcess(true);
          setUser({
            id: targetUserId,
            Username: 'Registration in Process'
          });
          setHasAccess(true);
          setAccessChecked(true);
          setIsLoading(false);
          return;
        }
        
        throw profileError;
      }

      // Check if user has mentor role
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select(`
          role_id,
          roles (
            name
          )
        `)
        .eq('user_id', targetUserId);

      if (roleError) {
        console.error('[useProfileData] Error fetching roles:', roleError);
        throw roleError;
      }

      // Fix: The roles property is an object, not an array
      const userRoles = extractRoleNames(roleData);
      const isMentor = userRoles.includes('mentor');

      console.log('[useProfileData] User roles:', userRoles);
      console.log('[useProfileData] Is mentor:', isMentor);

      // Set user profile data
      const profileRow = toProfileRow(profileData);

      if (!profileRow) {
        throw new Error('Received invalid profile data from Supabase');
      }

      setUser({
        id: targetUserId,
        Username: typeof profileRow.Username === 'string' ? profileRow.Username : undefined,
        pfp_url: typeof profileRow.pfp_url === 'string' ? profileRow.pfp_url : undefined,
        ...profileRow
      });

      // Access control logic
      if (isOwnProfile) {
        // Always allow access to own profile
        setHasAccess(true);
      } else {
        // For other profiles, check if current user has permission
        const currentUserRoles = currentUser?.roles || [];
        
        // Define elevated roles that can view other profiles
        const elevatedRoles = ['super-admin', 'staff', 'mentoringmanagement'];
        
        // Check if user has any elevated roles
        const hasElevatedRole = currentUserRoles.some(role => 
          elevatedRoles.includes(role)
        );
        
        if (hasElevatedRole) {
          // User has elevated permissions - can view any profile
          setHasAccess(true);
        } else {
          // User does not have elevated permissions - cannot view other profiles
          // This includes users who are ONLY mentors
          setHasAccess(false);
        }
      }

      setAccessChecked(true);

    } catch (error) {
      console.error('[useProfileData] Error in checkAccess:', error);
      setHasAccess(false);
      setAccessChecked(true);
    } finally {
      setIsLoading(false);
    }
  }, [targetUserId, isOwnProfile, currentUser?.roles]);

  // Update username function
  const updateUsername = useCallback(async (newUsername: string): Promise<boolean> => {
    if (!targetUserId || (!isOwnProfile && !canEditUsername)) return false;

    try {
      const { error } = await supabase
        .from('user_profile')
        .update({ Username: newUsername })
        .eq('user_id', targetUserId);

      if (error) throw error;

      // Update local state
      setUser(prev => prev ? { ...prev, Username: newUsername } : null);
      return true;

    } catch (error) {
      console.error('[useProfileData] Error updating username:', error);
      return false;
    }
  }, [targetUserId, isOwnProfile, canEditUsername]);

  // Effects
  useEffect(() => {
    if (targetUserId) {
      setIsLoading(true);
      setAccessChecked(false);
      checkAccess();
    }
  }, [targetUserId, checkAccess]);

  return {
    isLoading,
    hasAccess,
    accessChecked,
    user,
    isRegistrationInProcess,
    updateUsername,
    isOwnProfile,
    targetUserId
  };
};