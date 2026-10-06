import * as React from "react";
import { Check, ChevronsUpDown, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "../../contexts/ThemeContext";
import { useActiveWorkspace } from "@/contexts/ActiveWorkspaceContext";
import { fetchStaffDirectory, fetchStaffRecord } from "@/services/staffRegistryService";

interface Staff {
  user_id: string;
  Username: string;
}

interface StaffComboboxProps {
  value: string[]; // Array of selected staff IDs
  onChange: (value: string[]) => void; // Returns array of IDs
  disabled?: boolean;
  maxSelection?: number; // Optional limit on how many can be selected
}

export function StaffCombobox({ 
  value = [], 
  onChange, 
  disabled = false,
  maxSelection 
}: StaffComboboxProps) {
  const { language } = useTheme();
  const { activeTenantId } = useActiveWorkspace();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [searchText, setSearchText] = React.useState("");
  const [staff, setStaff] = React.useState<Staff[]>([]);
  const [selectedStaff, setSelectedStaff] = React.useState<Staff[]>([]);
  const [highlightedIndex, setHighlightedIndex] = React.useState<number>(-1);
  const itemsRef = React.useRef<(HTMLDivElement | null)[]>([]);

  // Load staff when popover opens
  React.useEffect(() => {
    if (open) {
      loadStaff();
    }
  }, [open, activeTenantId]);
  
  // Load selected staff when value changes
  React.useEffect(() => {
    if (value.length > 0) {
      loadStaffByIds(value);
    } else {
      setSelectedStaff([]);
    }
  }, [value]);
  
  // Function to load all staff from the workspace staff registry.
  // Only registry staff entries are offered; login/tenant accounts are not selectable.
  const loadStaff = async () => {
    setLoading(true);
    try {
      const staffRecords = await fetchStaffDirectory(activeTenantId);
      setStaff(staffRecords.map((record) => ({
        user_id: record.id,
        Username: record.displayName || 'Unknown',
      })));
    } catch (err) {
      console.error('Error loading staff registry:', err);
    } finally {
      setLoading(false);
    }
  };
  
  // Function to load specific staff by registry IDs
  const loadStaffByIds = async (ids: string[]) => {
    try {
      const results = await Promise.all(ids.map((id) => fetchStaffRecord(id, activeTenantId)));
      const staffData = results
        .filter((record): record is NonNullable<typeof record> => Boolean(record))
        .map((record) => ({
          user_id: record.id,
          Username: record.displayName || 'Unknown',
        }));
      setSelectedStaff(staffData);
    } catch (err) {
      // silent
    }
  };
  
  // Filter staff based on search text
  const filteredStaff = React.useMemo(() => {
    if (!searchText) return staff;
    const text = searchText.toLowerCase().trim();
    return staff.filter(member => 
      member.Username.toLowerCase().includes(text)
    );
  }, [staff, searchText]);
  
  // Handle staff selection/deselection
  const toggleStaff = (staffMember: Staff) => {
    const isSelected = value.includes(staffMember.user_id);
    if (isSelected) {
      const newValue = value.filter(id => id !== staffMember.user_id);
      onChange(newValue);
    } else {
      if (!maxSelection || value.length < maxSelection) {
        const newValue = [...value, staffMember.user_id];
        onChange(newValue);
      }
    }
  };

  // Remove staff member from selection
  const removeStaff = (staffId: string, e: React.SyntheticEvent) => {
    e.stopPropagation();
    const newValue = value.filter(id => id !== staffId);
    onChange(newValue);
  };

  // Keyboard navigation: reset highlight when open/filter changes
  React.useEffect(() => {
    setHighlightedIndex(filteredStaff.length > 0 ? 0 : -1);
  }, [open, searchText, filteredStaff.length]);

  // Keyboard navigation: handle up/down/enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < filteredStaff.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredStaff.length - 1
      );
    } else if (e.key === "Enter" && highlightedIndex >= 0) {
      e.preventDefault();
      const member = filteredStaff[highlightedIndex];
      if (member) toggleStaff(member);
    }
  };

  // Keyboard navigation: scroll to highlighted item
  React.useEffect(() => {
    if (highlightedIndex >= 0 && itemsRef.current[highlightedIndex]) {
      itemsRef.current[highlightedIndex]?.scrollIntoView({
        block: "nearest",
      });
    }
  }, [highlightedIndex]);

  return (
    <div className="relative">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            disabled={disabled}
            className="w-full justify-between min-h-[40px] h-auto"
            onKeyDown={handleKeyDown}
            tabIndex={0}
          >
            <div className="flex flex-wrap gap-1 flex-1">
              {selectedStaff.length > 0 ? (
                selectedStaff.map((member) => (
                  <Badge
                    key={member.user_id}
                    variant="secondary"
                    className="flex items-center gap-1"
                  >
                    {member.Username}
                    <span
                      tabIndex={0}
                      role="button"
                      className="ml-1 p-0.5 rounded hover:bg-red-100 focus:bg-red-200 cursor-pointer"
                      onClick={(e) => removeStaff(member.user_id, e)}
                      aria-label={language === "en" ? "Remove staff" : "Mitarbeiter entfernen"}
                      onKeyDown={e => {
                        if (e.key === "Enter" || e.key === " ") removeStaff(member.user_id, e);
                      }}
                    >
                      <X className="h-3 w-3 text-gray-500 hover:text-red-500 transition-colors" />
                    </span>
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground">
                  {language === "en" ? "Select staff members..." : "Mitarbeiter auswählen..."}
                </span>
              )}
            </div>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <div
            tabIndex={0}
            onKeyDown={handleKeyDown}
            className="outline-none"
            style={{ outline: "none" }}
          >
            <div className="flex items-center border-b p-2">
              <Search className="mr-2 h-4 w-4 shrink-0 opacity-70" />
              <Input
                placeholder={language === "en" ? "Search staff..." : "Mitarbeiter suchen..."}
                className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </div>
            {loading ? (
              <div className="flex items-center justify-center p-4">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <p>{language === "en" ? "Loading..." : "Wird geladen..."}</p>
              </div>
            ) : (
              <ScrollArea className="h-72">
                <div className="p-1">
                  {maxSelection && (
                    <div className="px-2 py-1 text-xs text-muted-foreground border-b mb-1">
                      {language === "en" 
                        ? `${value.length}/${maxSelection} selected`
                        : `${value.length}/${maxSelection} ausgewählt`
                      }
                    </div>
                  )}
                  {filteredStaff.length === 0 ? (
                    <div className="text-center p-4 text-sm text-muted-foreground">
                      {language === "en" ? "No staff found" : "Keine Mitarbeiter gefunden"}
                    </div>
                  ) : (
                    filteredStaff.map((member, idx) => {
                      const isSelected = value.includes(member.user_id);
                      const isDisabled = !isSelected && maxSelection && value.length >= maxSelection;
                      return (
                        <div
                          key={member.user_id}
                          ref={el => itemsRef.current[idx] = el}
                          className={`
                            flex items-center px-2 py-1 rounded-sm text-sm cursor-pointer
                            ${isSelected ? 'bg-primary/10' : isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted'}
                            ${highlightedIndex === idx ? 'bg-muted' : ''}
                          `}
                          onClick={() => !isDisabled && toggleStaff(member)}
                          onMouseEnter={() => setHighlightedIndex(idx)}
                        >
                          {isSelected && (
                            <Check className="mr-2 h-4 w-4 text-primary" />
                          )}
                          <span className={isSelected ? "ml-6" : "ml-8"}>
                            {member.Username}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}