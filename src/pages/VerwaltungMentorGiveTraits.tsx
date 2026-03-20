import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from '@/hooks/usePermissions';
import { supabase } from "@/lib/supabase";
import { useData } from "@/contexts/DataContext";
import { Users, Settings } from "lucide-react";
import { toast } from "sonner";

// Import consistent admin components
import { AdminPageLayout, AdminLoading } from '@/components/admin/ui';
import { EditButton } from '@/components/admin/ui';

import { ImprovedMentorList } from "@/components/admin/ImprovedMentorList";
import { TraitAssignment } from "@/components/admin/TraitAssignment";
import { fetchMentorGroups, MentorGroup } from "@/services/mentorGroupService";

interface Mentor {
  id: string;
  name: string;
  profilePic?: string;
  email?: string;
}

interface MentorGroupData {
  id: number;
  group_name: string;
  description: string | null;
  user_in_group: string[];
}

const VerwaltungMentorAdmin = () => {
  const { language } = useTheme();
  const { user } = useAuth();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const { getUserProfile } = useData();

  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [groups, setGroups] = useState<MentorGroupData[]>([]);
  const [availableTraits, setAvailableTraits] = useState<MentorGroup[]>([]);
  const [isLoadingMentors, setIsLoadingMentors] = useState(true);
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);
  const [selectedMentor, setSelectedMentor] = useState<Mentor | null>(null);

  const hasPermission = permissions.canManageTraits;

  const fetchMentors = useCallback(async () => {
    try {
      setIsLoadingMentors(true);
      
      const { data: roleData } = await supabase
        .from('roles')
        .select('id')
        .eq('name', 'mentor')
        .single();

      if (!roleData?.id) throw new Error('Mentor role not found');

      const { data: userData, error: userError } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role_id', roleData.id);

      if (userError) throw userError;

      if (!userData?.length) {
        setMentors([]);
        setIsLoadingMentors(false);
        return;
      }

      const mentorProfiles = await Promise.all(
        userData.map(async (item) => {
          const profile = await getUserProfile(item.user_id);
          if (profile) {
            return {
              id: item.user_id,
              name: profile.Username || 'Unknown User',
              profilePic: profile.profile_picture_url,
              email: profile.email
            };
          }
          return null;
        })
      );

      const validProfiles = mentorProfiles
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));

      setMentors(validProfiles);
    } catch (error) {
      console.error('Error fetching mentors:', error);
      toast.error(
        language === 'en' 
          ? 'Failed to load mentors' 
          : 'Fehler beim Laden der MentorInnen'
      );
    } finally {
      setIsLoadingMentors(false);
    }
  }, [getUserProfile, language]);

  const fetchGroups = useCallback(async () => {
    try {
      setIsLoadingGroups(true);
      const { data, error } = await supabase
        .from('mentor_groups')
        .select('*')
        .order('group_name', { ascending: true });

      if (error) throw error;
      
      const processedGroups = (data || []).map(group => ({
        ...group,
        user_in_group: Array.isArray(group.user_in_group) ? group.user_in_group : []
      }));
      
      setGroups(processedGroups);
    } catch (error) {
      console.error('Error fetching groups:', error);
      toast.error(
        language === 'en' 
          ? 'Failed to load traits' 
          : 'Fehler beim Laden der Eigenschaften'
      );
    } finally {
      setIsLoadingGroups(false);
    }
  }, [language]);

  const loadAvailableTraits = useCallback(async () => {
    const traits = await fetchMentorGroups();
    setAvailableTraits(traits);
  }, []);

  useEffect(() => {
    if (!hasPermission) {
      navigate('/verwaltung');
      return;
    }

    void fetchMentors();
    void fetchGroups();
    void loadAvailableTraits();
  }, [fetchGroups, fetchMentors, hasPermission, loadAvailableTraits, navigate]);

  const getInitials = (name: string) => {
    if (!name || name === 'Unknown User') return 'UN';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  };

  const getMentorGroups = (mentorId: string) => {
    return groups
      .filter(group => group.user_in_group?.includes(mentorId))
      .map(group => group.group_name);
  };

  const handleEditMentor = (mentor: Mentor) => {
    setSelectedMentor(mentor);
  };

  const handleCloseTraitAssignment = () => {
    setSelectedMentor(null);
  };

  const handleUpdateComplete = useCallback(() => {
    void fetchGroups();
    void loadAvailableTraits();
  }, [fetchGroups, loadAvailableTraits]);

  if (isLoadingMentors || isLoadingGroups) {
    return (
      <AdminPageLayout
        title={language === 'en' ? 'Mentor Trait Management' : 'MentorInnen Eigenschaften Verwaltung'}
        description={language === 'en' 
          ? 'Assign traits to mentors by clicking on a mentor card.'
          : 'Weisen Sie MentorInnen Eigenschaften zu, indem Sie auf eine MentorIn-Karte klicken.'}
        icon={Users}
      >
        <AdminLoading language={language} />
      </AdminPageLayout>
    );
  }

  return (
    <AdminPageLayout
      title={language === 'en' ? 'Mentor Trait Management' : 'MentorInnen Eigenschaften Verwaltung'}
      description={language === 'en' 
        ? 'Assign traits to mentors by clicking on a mentor card.'
        : 'Weisen Sie MentorInnen Eigenschaften zu, indem Sie auf eine MentorIn-Karte klicken.'}
      icon={Users}
      actions={
        <EditButton onClick={() => navigate('/verwaltung/trait')}>
          <Settings className="h-4 w-4 mr-2" />
          {language === 'en' ? 'Manage Traits' : 'Eigenschaften verwalten'}
        </EditButton>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-200px)]">
        {/* Left column: Mentor list */}
        <div className="h-full">
          <ImprovedMentorList
            mentors={mentors}
            availableTraits={availableTraits}
            language={language}
            getInitials={getInitials}
            getMentorGroups={getMentorGroups}
            onEditMentor={handleEditMentor}
          />
        </div>

        {/* Right column: Trait assignment */}
        <div className="h-full">
          {selectedMentor ? (
            <TraitAssignment
              mentor={selectedMentor}
              availableTraits={availableTraits}
              language={language}
              onClose={handleCloseTraitAssignment}
              onUpdate={handleUpdateComplete}
              getInitials={getInitials}
            />
          ) : (
            <div className="h-full flex items-center justify-center border-2 border-dashed border-muted-foreground/25 rounded-lg bg-muted/5">
              <div className="text-center text-muted-foreground max-w-md p-6">
                <div className="mb-4">
                  <svg 
                    className="h-16 w-16 mx-auto mb-4 opacity-50" 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path 
                      strokeLinecap="round" 
                      strokeLinejoin="round" 
                      strokeWidth={1.5} 
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" 
                    />
                  </svg>
                </div>
                <h3 className="text-lg font-medium mb-2">
                  {language === 'en' 
                    ? 'Select a mentor to get started' 
                    : 'Wählen Sie eine MentorIn aus, um zu beginnen'}
                </h3>
                <p>
                  {language === 'en' 
                    ? 'Click on any mentor card in the list to assign or modify their traits.' 
                    : 'Klicken Sie auf eine beliebige MentorIn-Karte in der Liste, um deren Eigenschaften zuzuweisen oder zu ändern.'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminPageLayout>
  );
};

export default VerwaltungMentorAdmin;