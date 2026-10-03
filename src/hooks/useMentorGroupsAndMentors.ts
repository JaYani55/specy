import { useState, useEffect } from 'react';
import { fetchMentorGroups, MentorGroup } from '@/services/mentorGroupService';
import { fetchMentors } from '@/services/events/productService';
import { supabase } from '@/lib/supabase';
import { ExtendedMentor } from '@/components/products/types';
import { useActiveWorkspace } from '@/contexts/ActiveWorkspaceContext';

export function useMentorGroupsAndMentors() {
  const { activeTenantId } = useActiveWorkspace();
  const [mentorGroups, setMentorGroups] = useState<MentorGroup[]>([]);
  const [mentors, setMentors] = useState<ExtendedMentor[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingMentors, setLoadingMentors] = useState(false);

  // Load traits
  useEffect(() => {
    const loadMentorGroups = async () => {
      if (!activeTenantId) {
        setMentorGroups([]);
        setLoadingGroups(false);
        return;
      }
      setLoadingGroups(true);
      try {
        const groups = await fetchMentorGroups(activeTenantId);
        setMentorGroups(groups);
      } catch (error) {
        console.error("Failed to load traits:", error);
      } finally {
        setLoadingGroups(false);
      }
    };
    
    loadMentorGroups();
  }, [activeTenantId]);

  // Load mentors  
  useEffect(() => {
    const loadMentors = async () => {
      setLoadingMentors(true);
      try {
        console.log("ProductForm: Starting to load mentor data");
        const fetchedMentors = await fetchMentors();
        console.log(`ProductForm: Successfully fetched ${fetchedMentors.length} mentors`);
        
        // Fetch traits for each mentor
        const mentorsWithTraits = await Promise.all(
          fetchedMentors.map(async (mentor) => {
            try {
              // Get traits from traits using the JSONB column
              const { data } = await supabase
                .from('mentor_groups')
                .select('group_name, user_in_group')
                .eq('tenant_id', activeTenantId)
              
              // Extract group names with proper null/undefined checks
              const traits = data
                ?.filter(group => {
                  // Check if group.user_in_group exists and is not null/undefined
                  if (!group.user_in_group) {
                    return false;
                  }
                  
                  // Try multiple matching approaches with proper null checks
                  if (Array.isArray(group.user_in_group)) {
                    return group.user_in_group.includes(mentor.id);
                  } else if (typeof group.user_in_group === 'object' && group.user_in_group !== null) {
                    // Safely get object values
                    try {
                      return Object.values(group.user_in_group).includes(mentor.id);
                    } catch (error) {
                      console.warn(`Error processing user_in_group for group ${group.group_name}:`, error);
                      return false;
                    }
                  }
                  
                  return false;
                })
                .map(group => group.group_name) || [];
              
              return {
                ...mentor,
                traits
              };
            } catch (error) {
              console.error(`Error fetching traits for mentor ${mentor.id}:`, error);
              return { ...mentor, traits: [] };
            }
          })
        );
        
        setMentors(mentorsWithTraits);
      } catch (error) {
        console.error("ProductForm: Failed to load mentors:", error);
      } finally {
        setLoadingMentors(false);
      }
    };

    loadMentors();
  }, [activeTenantId]);

  return {
    mentorGroups,
    mentors,
    loadingGroups,
    loadingMentors
  };
}