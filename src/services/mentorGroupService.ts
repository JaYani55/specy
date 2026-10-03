import { supabase } from '../lib/supabase';

export interface MentorGroup {
  id: number;
  name: string;
  description?: string;
  memberCount?: number;
  members?: string[]; // Add this line - array of user IDs
}

export interface MentorWithTraits {
  id: string;
  name: string;
  email?: string;
  profilePic?: string;
  traits: number[];
}

export const fetchMentorGroups = async (tenantId: string): Promise<MentorGroup[]> => {
  if (!tenantId) return [];
  const { data, error } = await supabase
    .from('mentor_groups')
    .select('id, group_name, description, user_in_group')
    .eq('tenant_id', tenantId)
    .order('group_name', { ascending: true });

  if (error) {
    console.error('Error fetching traits:', error);
    return [];
  }

  return (data || []).map(group => ({
    id: group.id,
    name: group.group_name,
    description: group.description,
    memberCount: Array.isArray(group.user_in_group) ? group.user_in_group.length : 0,
    members: Array.isArray(group.user_in_group) ? group.user_in_group : [] // Add this line
  }));
};

export const updateMentorTraits = async (mentorId: string, traitIds: number[]): Promise<boolean> => {
  try {
    // Get all groups to update
    const { data: allGroups, error: fetchError } = await supabase
      .from('mentor_groups')
      .select('id, user_in_group');

    if (fetchError) throw fetchError;

    // Update each group
    for (const group of allGroups || []) {
      const currentMembers = Array.isArray(group.user_in_group) ? group.user_in_group : [];
      const shouldIncludeMentor = traitIds.includes(group.id);
      const currentlyIncluded = currentMembers.includes(mentorId);

      if (shouldIncludeMentor && !currentlyIncluded) {
        // Add mentor to group
        const { error } = await supabase
          .from('mentor_groups')
          .update({ user_in_group: [...currentMembers, mentorId] })
          .eq('id', group.id);
        if (error) throw error;
      } else if (!shouldIncludeMentor && currentlyIncluded) {
        // Remove mentor from group
        const { error } = await supabase
          .from('mentor_groups')
          .update({ user_in_group: currentMembers.filter(id => id !== mentorId) })
          .eq('id', group.id);
        if (error) throw error;
      }
    }

    return true;
  } catch (error) {
    console.error('Error updating mentor traits:', error);
    return false;
  }
};

export const getMentorTraits = async (mentorId: string): Promise<number[]> => {
  try {
    const { data, error } = await supabase
      .from('mentor_groups')
      .select('id, user_in_group');

    if (error) throw error;

    return (data || [])
      .filter(group => {
        const members = Array.isArray(group.user_in_group) ? group.user_in_group : [];
        return members.includes(mentorId);
      })
      .map(group => group.id);
  } catch (error) {
    console.error('Error fetching mentor traits:', error);
    return [];
  }
};