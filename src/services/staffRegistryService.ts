import { supabase } from '@/lib/supabase';
import { normalizeProfileImageUrl } from '@/utils/staffUtils';

export interface StaffRecord {
  id: string;
  accountUserId?: string | null;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  jobTitle?: string | null;
  status: 'active' | 'inactive' | 'archived';
  notes?: string | null;
  profile: Record<string, unknown>;
}

export interface CreateStaffInput {
  displayName: string;
  accountUserId?: string | null;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  jobTitle?: string | null;
  status?: 'active' | 'inactive' | 'archived';
  notes?: string | null;
  profile?: Record<string, unknown>;
}

export interface UpdateStaffInput {
  displayName?: string;
  accountUserId?: string | null;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  jobTitle?: string | null;
  status?: 'active' | 'inactive' | 'archived';
  notes?: string | null;
  profile?: Record<string, unknown>;
}

export interface StaffTraitDefinition {
  id: number;
  name: string;
  description?: string;
  metadata: Record<string, string>;
  category?: string | null;
  isActive: boolean;
  assignmentCount?: number;
}

export interface LegacyStaffTraitGroup {
  id: number;
  group_name: string;
  description: string | null;
  user_in_group: string[];
}

export interface StaffTraitInput {
  name: string;
  description?: string;
  metadata?: Record<string, string>;
  category?: string | null;
}

interface StaffRow {
  id: string;
  account_user_id: string | null;
  display_name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  job_title: string | null;
  status: 'active' | 'inactive' | 'archived';
  notes: string | null;
  profile: Record<string, unknown> | null;
}

interface StaffTraitRow {
  id: number;
  name: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  category: string | null;
  is_active: boolean;
}

interface StaffTraitAssignmentRow {
  staff_id: string;
  trait_id: number;
}

const isMissingRelationError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
  const message = 'message' in error ? (error as { message?: unknown }).message : undefined;
  return code === '42P01' || (typeof message === 'string' && message.toLowerCase().includes('does not exist'));
};

const normalizeMetadata = (value: Record<string, unknown> | null | undefined): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, string>>((result, [key, entryValue]) => {
    if (!key.trim()) return result;
    result[key] = entryValue == null ? '' : String(entryValue);
    return result;
  }, {});
};

const mapStaffRow = (row: StaffRow): StaffRecord => ({
  id: row.id,
  accountUserId: row.account_user_id,
  displayName: row.display_name,
  email: row.email,
  phone: row.phone,
  avatarUrl: normalizeProfileImageUrl(row.avatar_url, 160),
  jobTitle: row.job_title,
  status: row.status,
  notes: row.notes,
  profile: row.profile || {},
});

const fetchLegacyStaffDirectory = async (): Promise<StaffRecord[]> => {
  const { data: roleData, error: roleError } = await supabase
    .from('roles')
    .select('id')
    .eq('name', 'staff')
    .single();

  if (roleError || !roleData) {
    return [];
  }

  const { data: userRoles, error: userRolesError } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role_id', roleData.id);

  if (userRolesError || !userRoles?.length) {
    return [];
  }

  const userIds = userRoles.map((row) => row.user_id);
  const { data: profiles, error: profilesError } = await supabase
    .from('user_profile')
    .select('user_id, Username, pfp_url')
    .in('user_id', userIds)
    .order('Username', { ascending: true });

  if (profilesError) {
    return [];
  }

  return (profiles || []).map((profile) => ({
    id: profile.user_id,
    accountUserId: profile.user_id,
    displayName: profile.Username || 'Unnamed staff',
    avatarUrl: normalizeProfileImageUrl(profile.pfp_url, 160),
    status: 'active',
    profile: {},
  }));
};

export const fetchStaffDirectory = async (): Promise<StaffRecord[]> => {
  const { data, error } = await supabase
    .from('staff')
    .select('id, account_user_id, display_name, email, phone, avatar_url, job_title, status, notes, profile')
    .order('display_name', { ascending: true });

  if (error) {
    if (isMissingRelationError(error)) {
      return fetchLegacyStaffDirectory();
    }
    console.error('Error fetching staff registry:', error);
    return [];
  }

  const mapped = ((data || []) as StaffRow[]).map(mapStaffRow);
  if (mapped.length > 0) {
    return mapped;
  }

  return fetchLegacyStaffDirectory();
};

export const fetchStaffRecord = async (staffId: string): Promise<StaffRecord | null> => {
  const { data, error } = await supabase
    .from('staff')
    .select('id, account_user_id, display_name, email, phone, avatar_url, job_title, status, notes, profile')
    .eq('id', staffId)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) {
      const legacyRecords = await fetchLegacyStaffDirectory();
      return legacyRecords.find((staff) => staff.id === staffId) || null;
    }
    throw error;
  }

  if (!data) {
    const legacyRecords = await fetchLegacyStaffDirectory();
    return legacyRecords.find((staff) => staff.id === staffId) || null;
  }

  return mapStaffRow(data as StaffRow);
};

export const createStaffRecord = async (input: CreateStaffInput): Promise<StaffRecord> => {
  const { data, error } = await supabase
    .from('staff')
    .insert({
      display_name: input.displayName.trim(),
      account_user_id: input.accountUserId || null,
      email: input.email || null,
      phone: input.phone || null,
      avatar_url: input.avatarUrl || null,
      job_title: input.jobTitle || null,
      status: input.status || 'active',
      notes: input.notes || null,
      profile: input.profile || {},
    })
    .select('id, account_user_id, display_name, email, phone, avatar_url, job_title, status, notes, profile')
    .single();

  if (error) {
    throw error;
  }

  return mapStaffRow(data as StaffRow);
};

export const updateStaffRecord = async (staffId: string, input: UpdateStaffInput): Promise<StaffRecord> => {
  const payload = {
    display_name: input.displayName?.trim(),
    account_user_id: input.accountUserId === undefined ? undefined : input.accountUserId || null,
    email: input.email === undefined ? undefined : input.email || null,
    phone: input.phone === undefined ? undefined : input.phone || null,
    avatar_url: input.avatarUrl === undefined ? undefined : input.avatarUrl || null,
    job_title: input.jobTitle === undefined ? undefined : input.jobTitle || null,
    status: input.status,
    notes: input.notes === undefined ? undefined : input.notes || null,
    profile: input.profile,
    updated_at: new Date().toISOString(),
  };

  const sanitizedPayload = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );

  const { data, error } = await supabase
    .from('staff')
    .update(sanitizedPayload)
    .eq('id', staffId)
    .select('id, account_user_id, display_name, email, phone, avatar_url, job_title, status, notes, profile')
    .single();

  if (error) {
    throw error;
  }

  return mapStaffRow(data as StaffRow);
};

export const fetchStaffTraits = async (): Promise<StaffTraitDefinition[]> => {
  const [{ data: traits, error: traitsError }, { data: assignments, error: assignmentsError }] = await Promise.all([
    supabase
      .from('staff_traits')
      .select('id, name, description, metadata, category, is_active')
      .order('name', { ascending: true }),
    supabase
      .from('staff_trait_assignments')
      .select('staff_id, trait_id'),
  ]);

  if (traitsError || assignmentsError) {
    if (isMissingRelationError(traitsError) || isMissingRelationError(assignmentsError)) {
      const { data: legacyTraits, error: legacyError } = await supabase
        .from('mentor_groups')
        .select('id, group_name, description, user_in_group')
        .order('group_name', { ascending: true });

      if (legacyError) {
        console.error('Error fetching legacy traits:', legacyError);
        return [];
      }

      return (legacyTraits || []).map((trait) => ({
        id: trait.id,
        name: trait.group_name,
        description: trait.description || undefined,
        metadata: {},
        category: null,
        isActive: true,
        assignmentCount: Array.isArray(trait.user_in_group) ? trait.user_in_group.length : 0,
      }));
    }

    console.error('Error fetching staff traits:', traitsError || assignmentsError);
    return [];
  }

  const assignmentCountMap = ((assignments || []) as StaffTraitAssignmentRow[]).reduce<Record<number, number>>((result, assignment) => {
    result[assignment.trait_id] = (result[assignment.trait_id] || 0) + 1;
    return result;
  }, {});

  return ((traits || []) as StaffTraitRow[]).map((trait) => ({
    id: trait.id,
    name: trait.name,
    description: trait.description || undefined,
    metadata: normalizeMetadata(trait.metadata),
    category: trait.category,
    isActive: trait.is_active,
    assignmentCount: assignmentCountMap[trait.id] || 0,
  }));
};

export const fetchStaffTraitGroupsLegacy = async (): Promise<LegacyStaffTraitGroup[]> => {
  const [traits, assignments] = await Promise.all([
    fetchStaffTraits(),
    supabase.from('staff_trait_assignments').select('staff_id, trait_id'),
  ]);

  if (assignments.error) {
    if (isMissingRelationError(assignments.error)) {
      const { data: legacyGroups, error: legacyError } = await supabase
        .from('mentor_groups')
        .select('id, group_name, description, user_in_group')
        .order('group_name', { ascending: true });

      if (legacyError) {
        console.error('Error fetching legacy trait groups:', legacyError);
        return [];
      }

      return (legacyGroups || []).map((group) => ({
        id: group.id,
        group_name: group.group_name,
        description: group.description,
        user_in_group: Array.isArray(group.user_in_group) ? group.user_in_group : [],
      }));
    }

    console.error('Error fetching staff trait assignments:', assignments.error);
    return [];
  }

  const groupedAssignments = ((assignments.data || []) as StaffTraitAssignmentRow[]).reduce<Record<number, string[]>>((result, assignment) => {
    if (!result[assignment.trait_id]) {
      result[assignment.trait_id] = [];
    }
    result[assignment.trait_id].push(assignment.staff_id);
    return result;
  }, {});

  return traits.map((trait) => ({
    id: trait.id,
    group_name: trait.name,
    description: trait.description || null,
    user_in_group: groupedAssignments[trait.id] || [],
  }));
};

export const createStaffTrait = async (input: StaffTraitInput): Promise<StaffTraitDefinition> => {
  const { data, error } = await supabase
    .from('staff_traits')
    .insert({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      metadata: input.metadata || {},
      category: input.category || null,
    })
    .select('id, name, description, metadata, category, is_active')
    .single();

  if (error) {
    throw error;
  }

  const row = data as StaffTraitRow;
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    metadata: normalizeMetadata(row.metadata),
    category: row.category,
    isActive: row.is_active,
    assignmentCount: 0,
  };
};

export const updateStaffTrait = async (traitId: number, input: StaffTraitInput): Promise<void> => {
  const { error } = await supabase
    .from('staff_traits')
    .update({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      metadata: input.metadata || {},
      category: input.category || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', traitId);

  if (error) {
    throw error;
  }
};

export const deleteStaffTrait = async (traitId: number): Promise<void> => {
  const { error } = await supabase
    .from('staff_traits')
    .delete()
    .eq('id', traitId);

  if (error) {
    throw error;
  }
};

export const getStaffTraits = async (staffId: string): Promise<number[]> => {
  const { data, error } = await supabase
    .from('staff_trait_assignments')
    .select('trait_id')
    .eq('staff_id', staffId);

  if (error) {
    if (isMissingRelationError(error)) {
      const { data: legacyGroups, error: legacyError } = await supabase
        .from('mentor_groups')
        .select('id, user_in_group');

      if (legacyError) {
        console.error('Error fetching legacy staff traits:', legacyError);
        return [];
      }

      return (legacyGroups || [])
        .filter((group) => Array.isArray(group.user_in_group) && group.user_in_group.includes(staffId))
        .map((group) => group.id);
    }

    console.error('Error fetching staff traits:', error);
    return [];
  }

  return (data || []).map((assignment) => assignment.trait_id);
};

export const updateStaffTraits = async (staffId: string, traitIds: number[]): Promise<boolean> => {
  try {
    const { data: existingAssignments, error: existingError } = await supabase
      .from('staff_trait_assignments')
      .select('trait_id')
      .eq('staff_id', staffId);

    if (existingError) {
      if (isMissingRelationError(existingError)) {
        const { data: allGroups, error: legacyFetchError } = await supabase
          .from('mentor_groups')
          .select('id, user_in_group');

        if (legacyFetchError) throw legacyFetchError;

        for (const group of allGroups || []) {
          const currentMembers = Array.isArray(group.user_in_group) ? group.user_in_group : [];
          const shouldInclude = traitIds.includes(group.id);
          const currentlyIncluded = currentMembers.includes(staffId);

          if (shouldInclude && !currentlyIncluded) {
            const { error } = await supabase
              .from('mentor_groups')
              .update({ user_in_group: [...currentMembers, staffId] })
              .eq('id', group.id);
            if (error) throw error;
          } else if (!shouldInclude && currentlyIncluded) {
            const { error } = await supabase
              .from('mentor_groups')
              .update({ user_in_group: currentMembers.filter((memberId) => memberId !== staffId) })
              .eq('id', group.id);
            if (error) throw error;
          }
        }

        return true;
      }

      throw existingError;
    }

    const currentIds = new Set((existingAssignments || []).map((assignment) => assignment.trait_id));
    const nextIds = new Set(traitIds);
    const toDelete = [...currentIds].filter((traitId) => !nextIds.has(traitId));
    const toInsert = [...nextIds].filter((traitId) => !currentIds.has(traitId));

    if (toDelete.length > 0) {
      const { error } = await supabase
        .from('staff_trait_assignments')
        .delete()
        .eq('staff_id', staffId)
        .in('trait_id', toDelete);

      if (error) throw error;
    }

    if (toInsert.length > 0) {
      const { error } = await supabase
        .from('staff_trait_assignments')
        .insert(toInsert.map((traitId) => ({ staff_id: staffId, trait_id: traitId })));

      if (error) throw error;
    }

    return true;
  } catch (error) {
    console.error('Error updating staff traits:', error);
    return false;
  }
};