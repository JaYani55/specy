import React, { useEffect, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { usePermissions } from '@/hooks/usePermissions';
import { useNavigate } from "react-router-dom";
import { Users } from 'lucide-react';
import {
  fetchStaffDirectory,
  fetchStaffTraitGroupsLegacy,
  fetchStaffTraits,
  type LegacyStaffTraitGroup,
  type StaffTraitDefinition,
} from '@/services/staffRegistryService';
import { getTenantOptions } from '@/services/tenantService';

// Import consistent admin components
import { AdminPageLayout, AdminLoading, AdminCard } from '@/components/admin/ui';
import { AddButton } from '@/components/admin/ui';
import { ImprovedMentorList } from "@/components/admin/ImprovedMentorList";
import { TraitAssignment } from "@/components/admin/TraitAssignment";

interface Mentor {
  id: string;
  name: string;
  email?: string;
  profilePic?: string;
}

const VerwaltungAllMentors = () => {
  const { language } = useTheme();
  const permissions = usePermissions();
  const navigate = useNavigate();
  
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [availableTraits, setAvailableTraits] = useState<StaffTraitDefinition[]>([]);
  const [traitGroups, setTraitGroups] = useState<LegacyStaffTraitGroup[]>([]);
  const [selectedMentor, setSelectedMentor] = useState<Mentor | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasTenantAdminAccess, setHasTenantAdminAccess] = useState(false);

  // Check permissions and redirect if needed
  useEffect(() => {
    if (!permissions.canViewMentorProfiles) {
      navigate('/admin');
    }
  }, [permissions.canViewMentorProfiles, navigate]);

  useEffect(() => {
    const loadTenantAccess = async () => {
      try {
        const options = await getTenantOptions();
        setHasTenantAdminAccess(options.some((option) => option.is_tenant_admin));
      } catch (error) {
        console.error('Error loading tenant admin access:', error);
        setHasTenantAdminAccess(false);
      }
    };

    void loadTenantAccess();
  }, []);

  // Load mentors efficiently using batch operations
  useEffect(() => {
    const loadMentors = async () => {
      try {
        setIsLoading(true);

        const staffRecords = await fetchStaffDirectory();
        const processedMentors: Mentor[] = staffRecords.map((staff) => ({
          id: staff.id,
          name: staff.displayName || 'No Username given',
          email: staff.email || undefined,
          profilePic: staff.avatarUrl || undefined,
        }));

        setMentors(processedMentors);
        console.log(`[VerwaltungAllMentors] Loaded ${processedMentors.length} staff records`);

      } catch (error) {
        console.error('Error loading staff:', error);
        setMentors([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadMentors();
  }, []);

  // Load available traits
  useEffect(() => {
    const loadTraits = async () => {
      try {
        const [traits, groups] = await Promise.all([
          fetchStaffTraits(),
          fetchStaffTraitGroupsLegacy(),
        ]);
        setAvailableTraits(traits);
        setTraitGroups(groups);
      } catch (error) {
        console.error('Error loading traits:', error);
        setAvailableTraits([]);
        setTraitGroups([]);
      }
    };

    loadTraits();
  }, []);

  // Helper functions
  const getInitials = (name: string) => {
    if (!name || name === 'No Username given') return 'NU';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  };

  // FIX: This function was using wrong property - should use 'members' not 'memberCount'
  const getMentorGroups = (mentorId: string): string[] => {
    return traitGroups
      .filter(trait => trait.user_in_group.includes(mentorId))
      .map(trait => trait.group_name);
  };

  // FIX: Navigate to mentor profile instead of opening trait assignment
  const handleEditMentor = (mentor: Mentor) => {
    navigate(`/admin/add-mentor?edit=${mentor.id}`);
  };

  // Keep trait assignment for when we implement it properly
  const handleTraitAssignment = (mentor: Mentor) => {
    setSelectedMentor(mentor);
  };

  const handleTraitUpdate = async () => {
    try {
      // Reload traits after update
      const traits = await fetchMentorGroups();
      setAvailableTraits(traits);
    } catch (error) {
      console.error('Error refreshing traits:', error);
    }
  };

  // Permission checks
  const canViewMentors = permissions.canViewMentorProfiles;
  const canManageMentors = permissions.canManageMentors || hasTenantAdminAccess;

  if (!canViewMentors) {
    return null;
  }

  if (isLoading) {
    return (
      <AdminPageLayout
        title={language === 'en' ? 'All Staff' : 'Alle Mitarbeiter'}
        icon={Users}
      >
        <AdminLoading language={language} />
      </AdminPageLayout>
    );
  }

  return (
    <AdminPageLayout
      title={language === 'en' ? 'All Staff' : 'Alle Mitarbeiter'}
      description={language === 'en' 
        ? 'Overview and management of all registered staff' 
        : 'Übersicht und Verwaltung aller registrierten Mitarbeiter'}
      icon={Users}
      actions={
        canManageMentors && (
          <AddButton onClick={() => navigate('/admin/add-mentor')}>
            {language === 'en' ? 'Add Staff' : 'Mitarbeiter hinzufügen'}
          </AddButton>
        )
      }
    >
      {!mentors || mentors.length === 0 ? (
        <AdminCard>
          <div className="text-center py-12">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">
              {language === 'en' ? 'No staff found' : 'Keine Mitarbeiter gefunden'}
            </h3>
            <p className="text-muted-foreground mb-4">
              {language === 'en' 
                ? 'There are no staff members registered yet.' 
                : 'Es sind noch keine Mitarbeiter registriert.'}
            </p>
            {canManageMentors && (
              <AddButton onClick={() => navigate('/admin/add-mentor')}>
                {language === 'en' ? 'Add First Staff Member' : 'Ersten Mitarbeiter hinzufügen'}
              </AddButton>
            )}
          </div>
        </AdminCard>
      ) : (
        <ImprovedMentorList
          mentors={mentors}
          availableTraits={availableTraits}
          language={language}
          getInitials={getInitials}
          getMentorGroups={getMentorGroups}
          onEditMentor={handleEditMentor}
        />
      )}

      {/* Trait Assignment Modal - for future use */}
      {selectedMentor && (
        <TraitAssignment
          mentor={selectedMentor}
          availableTraits={availableTraits}
          language={language}
          onClose={() => setSelectedMentor(null)}
          onUpdate={handleTraitUpdate}
          getInitials={getInitials}
        />
      )}
    </AdminPageLayout>
  );
};

export default VerwaltungAllMentors;