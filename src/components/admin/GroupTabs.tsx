import React, { useState, useEffect } from "react";
import { Droppable } from "@hello-pangea/dnd";
import { Card } from "@/components/ui/card";
import { UsersRound, ArrowDownSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { MentorCard } from "./MentorCard";
import { EmptyState } from "./EmptyState";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePermissions } from '@/hooks/usePermissions';

interface Mentor {
  id: string;
  name: string;
  profilePic?: string;
  email?: string;
}

interface MentorGroup {
  id: number;
  group_name: string;
  description: string | null;
  user_in_group: string[];
}

interface GroupTabsProps {
  groups: MentorGroup[];
  mentors: Mentor[];
  updatingGroups: Record<number, boolean>;
  language: "en" | "de";
  getInitials: (name: string) => string;
  onRemoveMentor: (mentorId: string, groupId: number) => void;
}

export const GroupTabs = ({
  groups,
  mentors,
  updatingGroups,
  language,
  getInitials,
  onRemoveMentor
}: GroupTabsProps) => {
  const navigate = useNavigate();
  const { canManageTraits } = usePermissions();
  
  if (!canManageTraits) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">
          {language === 'en' 
            ? 'You do not have permission to manage traits.' 
            : 'Sie haben keine Berechtigung, Eigenschaften zu verwalten.'}
        </p>
      </Card>
    );
  }
  
  if (groups.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">
          {language === 'en' 
            ? 'No traits have been created yet.' 
            : 'Es wurden noch keine Eigenschaften erstellt.'}
        </p>
        <Button 
          className="mt-4" 
          onClick={() => navigate('/admin/trait')}
        >
          {language === 'en' 
            ? 'Create traits' 
            : 'Eigenschaften anlegen'}
        </Button>
      </Card>
    );
  }

  return (
    <div className="overflow-visible">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-medium flex items-center gap-2">
          <UsersRound className="h-5 w-5" />
          {language === 'en' ? 'Traits' : 'Eigenschaften'}
        </h3>
        
        <Button 
          variant="outline"
          size="sm"
          onClick={() => navigate('/admin/trait')}
        >
          {language === 'en' ? 'Manage Traits' : 'Eigenschaften verwalten'}
        </Button>
      </div>

      <ScrollArea className="h-[calc(100vh-200px)]">
        <div className="space-y-4 pr-2">
          {[...groups]
            .sort((a, b) => a.group_name.localeCompare(b.group_name, undefined, { sensitivity: 'base' }))
            .map((group, index) => (
              <Card 
                key={group.id} 
                className="overflow-visible group-card"
              >
                <div className="p-3 border-b bg-muted/20 flex items-center justify-between group-card-header">
                  <div className="flex items-center">
                    <h4 className="text-lg font-medium">{group.group_name}</h4>
                    {group.user_in_group.length > 0 && (
                      <span className="ml-2 text-xs rounded-full bg-primary/10 text-primary px-2 py-0.5">
                        {group.user_in_group.length}
                      </span>
                    )}
                  </div>
                  {updatingGroups[group.id] && (
                    <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"></div>
                  )}
                </div>
                
                <Droppable droppableId={`group-${group.id}`}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`p-3 min-h-[100px] transition-colors overflow-visible
                        ${snapshot.isDraggingOver 
                          ? 'bg-primary/10 border-2 border-primary/40 border-dashed' 
                          : 'border-2 border-transparent hover:border-primary/20 hover:border-dashed hover:bg-muted/20'} 
                        rounded-md`}
                    >
                      {group.user_in_group.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full py-6 drop-indicator">
                          <ArrowDownSquare className="h-10 w-10 text-primary/40 mb-2" />
                          <p className="text-center text-muted-foreground">
                            {language === 'en' 
                              ? 'Drop staff here' 
                              : 'Mitarbeitende hier ablegen'}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {/* Drop indicator above mentor list */}
                          <div className="flex flex-col items-center py-2 border-b border-dashed border-primary/30">
                            <div className="flex items-center gap-2">
                              <ArrowDownSquare className="h-5 w-5 text-primary/60" />
                              <p className="text-sm text-primary/80">
                                {language === 'en' 
                                  ? 'Drop staff here' 
                                  : 'Mitarbeitende hier ablegen'}
                              </p>
                            </div>
                          </div>
                          
                          {/* Mentor list */}
                          <div className="space-y-2">
                            {group.user_in_group.map((mentorId, index) => {
                              const mentor = mentors.find(m => m.id === mentorId);
                              if (!mentor) return null;
                              
                              return (
                                <div key={mentorId} className="flex gap-2 items-center">
                                  <div className="flex-grow">
                                    <MentorCard
                                      mentor={mentor}
                                      groupCount={0}
                                      language={language}
                                      getInitials={getInitials}
                                      innerRef={null}
                                    />
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => canManageTraits && onRemoveMentor(mentorId, group.id)}
                                    disabled={!canManageTraits}
                                    className="flex-shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M18 6L6 18"></path>
                                      <path d="M6 6l12 12"></path>
                                    </svg>
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </Card>
            ))}
        </div>
      </ScrollArea>
    </div>
  );
};