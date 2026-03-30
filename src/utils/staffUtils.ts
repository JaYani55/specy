import { supabase } from "@/lib/supabase";

// Cache for staff names to avoid redundant fetches
const staffNamesCache = new Map<string, string>();

export interface Staff {
  user_id: string;
  Username: string;
}

export interface StaffProfile extends Staff {
  profile_picture_url?: string | null;
}

type StaffRegistryRow = {
  id?: string | null;
  account_user_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

export const normalizeProfileImageUrl = (url?: string | null, size = 96): string | null => {
  if (!url) {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    const isSupabaseStorageUrl = parsedUrl.pathname.includes('/storage/v1/object/public/')
      || parsedUrl.pathname.includes('/storage/v1/render/image/public/');

    if (!isSupabaseStorageUrl) {
      return url;
    }

    parsedUrl.pathname = parsedUrl.pathname.replace(
      '/storage/v1/object/public/',
      '/storage/v1/render/image/public/'
    );
    parsedUrl.searchParams.set('width', String(size));
    parsedUrl.searchParams.set('height', String(size));
    parsedUrl.searchParams.set('resize', 'cover');
    parsedUrl.searchParams.set('quality', '80');

    return parsedUrl.toString();
  } catch {
    return url;
  }
};

// Base query builder to keep queries consistent
const getBaseStaffQuery = () => 
  supabase
    .from('user_profile')
    .select(`
      user_id,
      Username,
      user_roles!inner (
        role_id,
        roles!inner (
          id,
          name
        )
      )
    `)
    .eq('user_roles.roles.name', 'staff');

export const searchStaff = async (searchTerm: string): Promise<Staff[]> => {
  const { data, error } = await getBaseStaffQuery()
    .ilike('Username', `%${searchTerm}%`)
    .limit(10);

  if (error) {
    console.error('Error searching staff:', error);
    return [];
  }

  const staff = data?.map(item => ({
    user_id: item.user_id,
    Username: item.Username
  })) || [];

  // Update cache with fetched staff
  staff.forEach(staffMember => {
    staffNamesCache.set(staffMember.user_id, staffMember.Username);
  });

  return staff;
};

export const getStaffById = async (id: string): Promise<Staff | null> => {
  // Check cache first
  if (staffNamesCache.has(id)) {
    return {
      user_id: id,
      Username: staffNamesCache.get(id)!
    };
  }

  const { data, error } = await getBaseStaffQuery()
    .eq('user_id', id)
    .single();

  if (error) {
    console.error('Error fetching staff member:', error);
    return null;
  }

  if (data) {
    const staffMember = {
      user_id: data.user_id,
      Username: data.Username
    };
    staffNamesCache.set(staffMember.user_id, staffMember.Username);
    return staffMember;
  }

  return null;
};

export const fetchStaffNames = async (staffIds: string[]): Promise<Record<string, string>> => {
  try {
    const uniqueIds = [...new Set(staffIds.filter(Boolean))];
    const uncachedIds = uniqueIds.filter(id => !staffNamesCache.has(id));

    if (uncachedIds.length > 0) {
      const [{ data: staffRows, error: staffError }, { data: userProfiles, error: profileError }] = await Promise.all([
        supabase
          .from('staff')
          .select('account_user_id, display_name')
          .in('account_user_id', uncachedIds),
        supabase
          .from('user_profile')
          .select('user_id, Username')
          .in('user_id', uncachedIds)
      ]);

      if (staffError) throw staffError;
      if (profileError) throw profileError;

      const staffNameMap = new Map(
        ((staffRows || []) as StaffRegistryRow[])
          .filter((row) => row.account_user_id)
          .map((row) => [row.account_user_id as string, row.display_name || 'Unnamed'])
      );

      (userProfiles || []).forEach((user) => {
        const preferredName = staffNameMap.get(user.user_id) || user.Username || 'Unnamed';
        staffNamesCache.set(user.user_id, preferredName);
      });

      uncachedIds.forEach((id) => {
        if (!staffNamesCache.has(id)) {
          staffNamesCache.set(id, staffNameMap.get(id) || 'Unknown');
        }
      });
    }

    // Return mapping for all requested IDs
    return uniqueIds.reduce((acc, id) => {
      acc[id] = staffNamesCache.get(id) || 'Unknown';
      return acc;
    }, {} as Record<string, string>);
  } catch (error) {
    console.error("Error fetching staff names:", error);
    return {};
  }
};

export const fetchStaffProfiles = async (staffIds: string[]): Promise<StaffProfile[]> => {
  const uniqueIds = [...new Set(staffIds.filter(Boolean))];

  if (uniqueIds.length === 0) {
    return [];
  }

  const [{ data: staffRows, error: staffError }, { data: userProfiles, error: profileError }] = await Promise.all([
    supabase
      .from('staff')
      .select('id, account_user_id, display_name, avatar_url')
      .or(`account_user_id.in.(${uniqueIds.join(',')}),id.in.(${uniqueIds.join(',')})`),
    supabase
      .from('user_profile')
      .select('user_id, Username, profile_picture_url, pfp_url')
      .in('user_id', uniqueIds)
  ]);

  if (staffError || profileError) {
    console.error('Error fetching staff profiles:', staffError || profileError);
    return uniqueIds.map((id) => ({
      user_id: id,
      Username: staffNamesCache.get(id) || 'Unknown',
      profile_picture_url: null,
    }));
  }

  const staffMap = new Map(
    ((staffRows || []) as StaffRegistryRow[])
      .flatMap((row) => {
        const entries: Array<[string, StaffRegistryRow]> = [];
        if (row.account_user_id) {
          entries.push([row.account_user_id, row]);
        }
        if (row.id) {
          entries.push([row.id, row]);
        }
        return entries;
      })
  );

  const profileMap = new Map(
    (userProfiles || []).map((profile) => [
      profile.user_id,
      {
        user_id: profile.user_id,
        Username: staffMap.get(profile.user_id)?.display_name || profile.Username || staffNamesCache.get(profile.user_id) || 'Unknown',
        profile_picture_url: normalizeProfileImageUrl(
          staffMap.get(profile.user_id)?.avatar_url || profile.pfp_url || profile.profile_picture_url || null
        ),
      },
    ])
  );

  return uniqueIds.map((id) => {
    const profile = profileMap.get(id);
    const staffRow = staffMap.get(id);
    const username = profile?.Username || staffRow?.display_name || staffNamesCache.get(id) || 'Unknown';
    staffNamesCache.set(id, username);

    return profile || {
      user_id: id,
      Username: username,
      profile_picture_url: normalizeProfileImageUrl(staffRow?.avatar_url || null),
    };
  });
};