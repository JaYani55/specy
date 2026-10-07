import { Button } from "@/components/ui/button";
import { Event, EventStatus } from "@/types/event"; 
import { Search, Filter, SortAsc, SortDesc } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Define a type for your filter
type StatusFilterType = EventStatus | 'needsMentors' | null;

// Use the custom Event type from your project, not the global Event
interface ListFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  sortDirection: "asc" | "desc";
  onSortDirectionChange: () => void;
  sortBy: keyof Event;
  onSortByChange: (value: keyof Event) => void;
  statusFilter: StatusFilterType;
  onStatusFilterChange: (value: StatusFilterType | null) => void;
  getDisplayStatusForFilter: (statusFilter: StatusFilterType) => EventStatus;
  language: string;
}

const ListFilters = ({
  search,
  onSearchChange,
  sortDirection,
  onSortDirectionChange,
  sortBy,
  onSortByChange,
  statusFilter,
  onStatusFilterChange,
  getDisplayStatusForFilter,
  language
}: ListFiltersProps) => {
  // Helper function to get the display text for a status filter
  const getStatusFilterDisplayText = (filter: StatusFilterType): string => {
    if (!filter) return '';
    
    if (filter === 'needsMentors') {
      return language === 'en' ? 'Looking for staff' : 'Mitarbeitende gesucht';
    } else if (filter === 'successComplete') {
      return language === 'en' ? 'All staff found' : 'Alle Mitarbeitenden gefunden';
    } else if (filter === 'locked') {
      return language === 'en' ? 'Locked' : 'Gesperrt';
    }
    
    return String(filter);
  };
  
  return (
    <>
      <div className="flex flex-col sm:flex-row gap-5 items-start sm:items-center justify-between mb-6">
          {/* Search field commented out */}
        
        <div className="flex gap-3 w-full sm:w-auto justify-between sm:justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="text-sm sm:text-base flex items-center gap-2">
                <Filter className="h-4 w-4 sm:h-5 sm:w-5" />
                {language === "en" ? "Status" : "Status"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuItem className="text-base py-3" onClick={() => onStatusFilterChange(null)}>
                {language === "en" ? "All" : "Alle"}
              </DropdownMenuItem>
              
              <DropdownMenuItem className="text-base py-3" onClick={() => onStatusFilterChange('needsMentors')}>
                <div className="flex items-center gap-3">
                  {/* Removed status color dot */}
                  {language === "en" ? "Looking for staff" : "Mitarbeitende gesucht"}
                </div>
              </DropdownMenuItem>
              
              <DropdownMenuItem className="text-base py-3" onClick={() => onStatusFilterChange('successComplete')}>
                <div className="flex items-center gap-3">
                  {/* Removed status color dot */}
                  {language === "en" ? "All staff found" : "Alle Mitarbeitenden gefunden"}
                </div>
              </DropdownMenuItem>
              
              <DropdownMenuItem className="text-base py-3" onClick={() => onStatusFilterChange('locked')}>
                <div className="flex items-center gap-3">
                  {/* Removed status color dot */}
                  {language === "en" ? "Locked" : "Gesperrt"}
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {statusFilter && (
        <div className="flex items-center gap-3 mb-4 bg-muted/50 p-3 rounded-lg">
          <span className="text-base">{language === "en" ? "Filtered by:" : "Gefiltert nach:"}</span>
          <div className="flex items-center gap-2 px-4 py-2 rounded-md border text-base">
            {/* Removed status color dot */}
            <span>{getStatusFilterDisplayText(statusFilter)}</span>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => onStatusFilterChange(null)}
            className="h-8 w-8 p-0 rounded-full"
          >
            ×
          </Button>
        </div>
      )}
    </>
  );
};

export default ListFilters;