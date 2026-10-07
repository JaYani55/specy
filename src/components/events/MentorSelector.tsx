import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { User, ChevronsUpDown, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/hooks/usePermissions";

interface MentorSelectorProps {
  eventId: string;
  excludeUserIds: string[];
  onMentorSelected: (userId: string, username: string) => Promise<void>;
  language: 'en' | 'de';
  disabled?: boolean;
}

// Add proper types for database responses
interface UserProfile {
  user_id: string;
  Username?: string;
  email?: string;
  pfp_url?: string;
  created_at?: string;
}

interface MentorItem {
  user_id: string;
  Username: string;
}

export function MentorSelector({ eventId, excludeUserIds, onMentorSelected, language, disabled = false }: MentorSelectorProps) {
  const { canAssignMentors } = usePermissions();
  const [open, setOpen] = useState(false);
  const [mentors, setMentors] = useState<MentorItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadMentors = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      
      // First try a simpler query to get all user profiles
      const { data: allUsers, error: userError } = await supabase
        .from('user_profile')
        .select('user_id, Username')
        .order('Username');
      
      if (userError || !allUsers) {
        console.error("Error loading users:", userError);
        setErrorMessage("Could not load users");
        return;
      }

      // Next, get the role data - we'll filter it on the client side
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select(`
          user_id,
          role_id,
          roles!inner (name)
        `);
      
      if (roleError || !roleData) {
        console.error("Error loading roles:", roleError);
        setErrorMessage("Could not load user roles");
        return;
      }
      
      // Filter for mentor role (case insensitive) with improved type safety
      const mentorRoleAssignments = roleData.filter(role => {
        // Safer role name extraction
        let roleName: string | undefined;
        
        if (role.roles) {
          if (Array.isArray(role.roles)) {
            // Handle array case
            roleName = role.roles[0]?.name;
          } else {
            // Handle object case
            roleName = (role.roles as {name: string}).name;
          }
        }
        
        return (roleName || '').toLowerCase() === 'mentor';
      });
      
      // Get mentor user IDs
      const mentorUserIds = mentorRoleAssignments.map(role => role.user_id);
      
      // Filter users who are mentors
      const mentorUsers = allUsers.filter(
        user => mentorUserIds.includes(user.user_id)
      );
      
      // Filter out already assigned mentors
      const availableMentors = mentorUsers
        .filter(item => !excludeUserIds.includes(item.user_id))
        .map(item => ({
          user_id: item.user_id,
          Username: item.Username || 'Unknown User'
        }));
      
      setMentors(availableMentors);
      
      if (availableMentors.length === 0) {
        setErrorMessage(
          excludeUserIds.length > 0 
            ? language === "en" 
              ? "No additional staff available" 
              : "Keine weiteren Mitarbeitende verfügbar" 
            : language === "en"
              ? "No staff found in the system"
              : "Keine Mitarbeitenden im System gefunden"
        );
      }
    } catch (err) {
      console.error("Exception loading mentors:", err);
      setErrorMessage(language === "en" ? "Error loading staff" : "Fehler beim Laden der Mitarbeitenden");
    } finally {
      setLoading(false);
    }
  }, [excludeUserIds, language]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadMentors();
  }, [open, loadMentors]);

  // Filter mentors based on search text
  const filteredMentors = useMemo(() => {
    if (!searchText) return mentors;
    
    const text = searchText.toLowerCase().trim();
    return mentors.filter(mentor => 
      (mentor.Username?.toLowerCase() || '').includes(text)
    );
  }, [mentors, searchText]);
  
  // Don't render if user doesn't have permission to assign mentors
  if (!canAssignMentors) {
    return null;
  }
  
  // Handle mentor selection
  const selectMentor = async (mentor: MentorItem) => {
    try {
      await onMentorSelected(mentor.user_id, mentor.Username);
      setOpen(false);
      
      // Clear search after successful selection
      setSearchText('');
    } catch (error) {
      console.error("Error selecting mentor:", error);
      setErrorMessage(language === "en" ? "Error assigning staff" : "Fehler bei der Zuweisung von Mitarbeitenden");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="w-full justify-between"
        >
          {language === "en" ? "Assign staff..." : "Mitarbeitende zuweisen..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput 
            placeholder={language === "en" ? "Search staff..." : "Mitarbeitende suchen..."}
            onValueChange={setSearchText}
          />
          {loading ? (
            <div className="py-6 text-center text-sm flex flex-col items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {language === "en" ? "Loading staff..." : "Lade Mitarbeitende..."}
            </div>
          ) : (
            <>
              <CommandEmpty>
                {errorMessage || 
                  (language === "en" ? "No staff found. Try a different search term." : 
                  "Keine Mitarbeitenden gefunden. Versuche einen anderen Suchbegriff.")}
              </CommandEmpty>
              <CommandGroup>
                {filteredMentors.map((mentor) => (
                  <CommandItem
                    key={mentor.user_id}
                    value={mentor.Username}
                    onSelect={() => selectMentor(mentor)}
                  >
                    <User className="mr-2 h-4 w-4" />
                    {mentor.Username}
                  </CommandItem>
                ))}
              </CommandGroup>
              {mentors.length > 0 && (
                <div className="py-2 px-2 text-xs text-muted-foreground border-t">
                  {language === "en" 
                    ? `Showing ${filteredMentors.length} of ${mentors.length} staff` 
                    : `Zeige ${filteredMentors.length} von ${mentors.length} Mitarbeitende`}
                </div>
              )}
            </>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}