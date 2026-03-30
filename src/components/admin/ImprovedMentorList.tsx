import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Users, Edit3, Filter } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MentorGroup } from '@/services/mentorGroupService';
import { usePermissions } from '@/hooks/usePermissions';
import { normalizeProfileImageUrl } from '@/utils/staffUtils';

interface Mentor {
  id: string;
  name: string;
  email?: string;
  profilePic?: string;
}

interface ImprovedMentorListProps {
  mentors: Mentor[];
  availableTraits: MentorGroup[];
  language: 'en' | 'de';
  getInitials: (name: string) => string;
  getMentorGroups: (mentorId: string) => string[];
  onEditMentor: (mentor: Mentor) => void;
}

export const ImprovedMentorList: React.FC<ImprovedMentorListProps> = ({
  mentors,
  availableTraits,
  language,
  getInitials,
  getMentorGroups,
  onEditMentor
}) => {
  const { canManageTraits, canViewMentorProfiles } = usePermissions();
  const [searchQuery, setSearchQuery] = useState('');
  const [traitFilter, setTraitFilter] = useState<string>('all');

  const filteredMentors = mentors.filter(mentor => {
    const matchesSearch = mentor.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (mentor.email && mentor.email.toLowerCase().includes(searchQuery.toLowerCase()));
    
    if (!matchesSearch) return false;

    if (traitFilter === 'all') return true;
    if (traitFilter === 'none') return getMentorGroups(mentor.id).length === 0;
    
    const mentorTraits = getMentorGroups(mentor.id);
    return mentorTraits.some(traitName => 
      availableTraits.find(trait => trait.name === traitName)?.id.toString() === traitFilter
    );
  });

  if (!canViewMentorProfiles) {
    return (
      <Card className="h-full flex items-center justify-center">
        <div className="text-center p-6">
          <p className="text-muted-foreground">
            {language === 'en' 
              ? 'You do not have permission to view staff profiles' 
              : 'Sie haben keine Berechtigung, Mitarbeiterprofile zu sehen'}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <div className="p-4 border-b">
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-5 w-5" />
          <h3 className="text-lg font-semibold">
            {language === 'en' ? 'Staff' : 'Mitarbeiter'}
          </h3>
          <Badge variant="secondary" className="ml-auto">
            {filteredMentors.length} / {mentors.length}
          </Badge>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={language === 'en' ? 'Search staff...' : 'Mitarbeiter suchen...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            aria-label={language === 'en' ? 'Search staff' : 'Mitarbeiter suchen'}
          />
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={traitFilter} onValueChange={setTraitFilter}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {language === 'en' ? 'All staff' : 'Alle Mitarbeiter'}
              </SelectItem>
              <SelectItem value="none">
                {language === 'en' ? 'No traits assigned' : 'Keine Eigenschaften'}
              </SelectItem>
              {availableTraits.map(trait => (
                <SelectItem key={trait.id} value={trait.id.toString()}>
                  {trait.name} ({trait.memberCount || 0})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3">
          {filteredMentors.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {language === 'en' 
                ? 'No staff found' 
                : 'Keine Mitarbeiter gefunden'}
            </div>
          ) : (
            filteredMentors.map(mentor => {
              const mentorTraits = getMentorGroups(mentor.id);
              
              return (
                <Card 
                  key={mentor.id} 
                  className="p-4 hover:shadow-md transition-shadow cursor-pointer group"
                  role="button"
                  tabIndex={0}
                  onClick={() => onEditMentor(mentor)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onEditMentor(mentor);
                    }
                  }}
                  aria-label={canManageTraits ? `${language === 'en' ? 'Edit traits for' : 'Eigenschaften bearbeiten für'} ${mentor.name}` : mentor.name}
                >
                  <div className="flex items-start gap-3">
                    <Avatar className="h-12 w-12 flex-shrink-0">
                      <AvatarImage
                        src={normalizeProfileImageUrl(mentor.profilePic, 128) || undefined}
                        alt={mentor.name}
                        className="object-cover"
                      />
                      <AvatarFallback className="bg-primary/10">
                        {getInitials(mentor.name)}
                      </AvatarFallback>
                    </Avatar>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium truncate pr-2">{mentor.name}</h4>
                        {canManageTraits && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 h-8 w-8"
                            aria-label={`${language === 'en' ? 'Edit' : 'Bearbeiten'} ${mentor.name}`}
                          >
                            <Edit3 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      
                      {mentor.email && (
                        <p className="text-sm text-muted-foreground mb-2 truncate">
                          {mentor.email}
                        </p>
                      )}
                      
                      <div className="flex flex-wrap gap-1">
                        {mentorTraits.length === 0 ? (
                          <Badge variant="outline" className="text-xs">
                            {language === 'en' ? 'No traits' : 'Keine Eigenschaften'}
                          </Badge>
                        ) : (
                          mentorTraits.slice(0, 3).map(trait => (
                            <Badge key={trait} variant="secondary" className="text-xs">
                              {trait}
                            </Badge>
                          ))
                        )}
                        {mentorTraits.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{mentorTraits.length - 3}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      </ScrollArea>
    </Card>
  );
};