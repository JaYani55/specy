import React from "react";
import { Event } from "@/types/event";
import type { User as UserType } from "@/types/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { usePermissions } from '@/hooks/usePermissions';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CounterButton } from "@/components/ui/counter-button";
import {
  CalendarIcon as CalendarIc,
  SortAsc,
  SortDesc,
  SendHorizonal,
  User,
  ShieldCheck
} from "lucide-react";
import { useTheme } from '@/contexts/ThemeContext';
import PillarIcon from "@/components/ui/PillarIcon";
import { MentorStatusBadge } from "@/components/mentors/MentorStatusBadge";
import { AssignedStaffBadge } from "@/components/staff/AssignedStaffBadge";
import { 
  Tooltip,
  TooltipContent,
  TooltipTrigger 
} from "@/components/ui/tooltip";
import { LoadingState } from "@/components/ui/LoadingState";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { parseISO } from "date-fns";
import { getIconByName } from "@/constants/pillaricons";

interface ListTableProps {
  events: Event[];
  isLoadingEvents: boolean;
  filteredEvents: Event[];
  language: string;
  user: UserType | null;
  isMentor: boolean;
  sortBy: keyof Event;
  sortDirection: "asc" | "desc";
  mentorNamesByEventId: Record<string, string[]>;
  setSortBy: (value: keyof Event) => void;
  toggleSortDirection: () => void;
  handleEventClick: (event: Event) => void;
  handleRequestMentorClick: (event: Event, e: React.MouseEvent) => void;
  openMentorRequestsModal: (event: Event) => void;
  refetchEvents?: () => Promise<void>;
}

const ListTable: React.FC<ListTableProps> = ({
  events,
  isLoadingEvents,
  filteredEvents,
  language,
  user,
  isMentor,
  sortBy,
  sortDirection,
  mentorNamesByEventId,
  setSortBy,
  toggleSortDirection,
  handleEventClick,
  handleRequestMentorClick,
  openMentorRequestsModal,
  refetchEvents
}) => {
  const { theme } = useTheme();
  const permissions = usePermissions();
  const { canMentorViewEvent } = permissions;
  
  // Helper to render mentor names in tooltip
  const renderMentorNames = (eventId: string) => {
    const mentorNames = mentorNamesByEventId[eventId] || [];
    
    if (mentorNames.length === 0) {
      return language === "en" ? "No mentors assigned" : "Keine MentorInnen zugewiesen";
    }
    
    return (
      <div className="space-y-1">
        <p className="font-semibold mb-1">
          {language === "en" ? "Assigned Mentors:" : "Zugewiesene MentorInnen:"}
        </p>
        <ul className="list-disc pl-4">
          {mentorNames.map((name, idx) => (
            <li key={idx}>{name}</li>
          ))}
        </ul>
      </div>
    );
  };
  
  const canViewMentorProfiles = permissions.canViewMentorProfiles;
  const canProcessRequests = permissions.canProcessMentorRequests;
  
  // For both mobile and desktop, filter events for mentors
  const displayEvents = isMentor ? filteredEvents.filter(event => canMentorViewEvent({ initial_selected_mentors: event.initial_selected_mentors || [] })) : filteredEvents;
  
  return (
    <div>
      {/* Mobile view */}
      <div className="md:hidden mobile-card-list">
        {isLoadingEvents ? (
          <LoadingState className="py-8" />
        ) : displayEvents.length === 0 ? (
          <div className="text-center py-8 text-lg">
            {language === "en" ? "No events found" : "Keine Veranstaltungen gefunden"}
          </div>
        ) : (
          <div className="space-y-4">
            {displayEvents.map((event) => (
              <div 
                key={event.id}
                className="border rounded-lg p-4 hover:bg-muted/50 cursor-pointer shadow-sm" 
                onClick={() => handleEventClick(event)}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="font-medium text-base truncate mr-2">{event.company}</div>
                  {event.ProductInfo && (
                    <PillarIcon 
                      ProductInfo={event.ProductInfo}
                      isDark={theme === 'dark'}
                      showLabel={false}
                    />
                  )}
                </div>
                
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="text-sm text-muted-foreground">{event.date}</div>
                  <div className="text-sm text-muted-foreground">{event.time}</div>
                </div>
                
                <div className="flex flex-wrap gap-2 mb-3">
                  <div className="text-sm">
                    <span className="text-muted-foreground">{language === "en" ? "Staff:" : "Mitarbeiter:"}</span> {event.primaryStaffName}
                  </div>
                </div>
                
                {isMentor ? (
                  <div className="flex justify-end mt-3">
                    {isMentor && user && (
                      <MentorStatusBadge 
                        event={event} 
                        userId={user.id}
                        size="sm" 
                      />
                    )}
                    {['new', 'firstRequests', 'successPartly'].includes(event.status) && 
                      !(user && (
                        event.requestingMentors?.includes(user.id) || 
                        event.acceptedMentors?.includes(user.id) ||
                        event.declinedMentors?.includes(user.id)
                      )) &&
                      (event.acceptedMentors?.length || 0) < event.amount_requiredmentors && (
                        <Button 
                          size="sm" 
                          onClick={(e) => handleRequestMentorClick(event, e)}
                          className="ml-auto text-sm text-black px-2"
                        >
                          <SendHorizonal className="h-4 w-4 mr-2" />
                          {language === "en" ? "Request" : "Anfragen"}
                        </Button>
                      )}
                  </div>
                ) : (
                  <>
                    {event.acceptedMentors && event.acceptedMentors.length > 0 ? (
                      <div className="mt-3">
                        <span className="text-sm text-muted-foreground">{language === "en" ? "Mentors:" : "MentorInnen:"}</span>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {mentorNamesByEventId[event.id]?.map((name, index) => (
                            <div key={index} className="inline-flex items-center text-xs px-2 py-1 rounded bg-primary/10">
                              <User className="h-3 w-3 mr-1" />
                              {name}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground mt-3">
                        {language === "en" ? "No mentors" : "Keine MentorInnen"}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block border rounded-lg overflow-hidden shadow-md">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/60">
              <TableHead className="w-[220px]">{language === "en" ? "Product" : "Produkt"}</TableHead>
              <TableHead className="w-[180px]">{language === "en" ? "Company" : "Unternehmen"}</TableHead>
              <TableHead className="w-[120px]">{language === "en" ? "Date" : "Datum"}</TableHead>
              <TableHead className="w-[100px]">{language === "en" ? "Time" : "Zeit"}</TableHead>
              <TableHead className="w-[160px]">{language === "en" ? "Time until event" : "Zeit bis Event"}</TableHead>
              <TableHead className="w-[120px]">{language === "en" ? "Mentors" : "MentorInnen"}</TableHead>
              <TableHead className="w-[100px]">{language === "en" ? "Mode" : "Modus"}</TableHead>
              <TableHead className="w-[180px]">{language === "en" ? "Staff" : "Mitarbeiter"}</TableHead>
              <TableHead className="w-[120px] text-right">{language === "en" ? "Actions" : "Aktionen"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoadingEvents ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : displayEvents.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8">{language === "en" ? "No events found" : "Keine Veranstaltungen gefunden"}</TableCell></TableRow>
            ) : (
              displayEvents.map((event) => {
                const product = event.ProductInfo;
                const productName = product?.name;
                const productIconName = product?.icon_name;
                const productGradient = product?.gradient;
                const iconUrl = productIconName ? getIconByName(productIconName, theme === "dark") : undefined;
                const eventDate = parseISO(event.date);
                const timeUntilEvent = formatDistanceToNow(eventDate, { addSuffix: true, locale: language === 'de' ? de : undefined });
                const staffUsernames = event.staffNames?.length ? event.staffNames.join(', ') : event.staff_members?.join(', ');
                return (
                  <TableRow key={event.id} className="cursor-pointer hover:bg-muted/50 text-base" onClick={() => handleEventClick(event)}>
                    <TableCell className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="rounded px-3 py-1 flex items-center" style={{ background: productGradient || "#e0e7ff" }}>
                          {iconUrl && <img src={iconUrl} alt={productName} className="w-6 h-6 mr-2" />}
                          <span className="font-semibold">{productName}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-3 px-4">{event.company}</TableCell>
                    <TableCell className="py-3 px-4">{event.date}</TableCell>
                    <TableCell className="py-3 px-4">{event.time}</TableCell>
                    <TableCell className="py-3 px-4">{timeUntilEvent}</TableCell>
                    <TableCell className="py-3 px-4 text-center">{(event.acceptedMentors?.length || 0)}/{event.amount_requiredmentors}</TableCell>
                    <TableCell className="py-3 px-4">{event.mode}</TableCell>
                    <TableCell className="py-3 px-4">{staffUsernames}</TableCell>
                    <TableCell className="py-3 px-4 text-right">
                      {isMentor && ['new', 'firstRequests', 'successPartly'].includes(event.status) &&
                        !(user && (
                          event.requestingMentors?.includes(user.id) ||
                          event.acceptedMentors?.includes(user.id) ||
                          event.declinedMentors?.includes(user.id)
                        )) &&
                        (event.acceptedMentors?.length || 0) < event.amount_requiredmentors ? (
                          <Button size="sm" onClick={(e) => handleRequestMentorClick(event, e)} className="px-3 py-1 h-auto">
                            <SendHorizonal className="h-4 w-4 mr-2" />
                            <span>{language === "en" ? "Request" : "Anfragen"}</span>
                          </Button>
                        ) : (
                          permissions.canProcessMentorRequests && (
                            <CounterButton
                              count={event.requestingMentors?.length || 0}
                              englishLabel="View Requests"
                              germanLabel="Anfragen ansehen"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); openMentorRequestsModal(event); }}
                              className="w-full"
                              disabled={event.requestingMentors?.length === 0}
                            />
                          )
                        )
                      }
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default ListTable;