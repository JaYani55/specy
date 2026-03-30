import * as React from "react";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../contexts/ThemeContext";

interface Company {
  id: string;
  name: string;
  logo_url?: string;
}

interface CompanyComboboxProps {
  value: string;
  onChange: (value: string, displayName: string) => void;
  disabled?: boolean;
}

export function CompanyCombobox({ value, onChange, disabled = false }: CompanyComboboxProps) {
  const { language } = useTheme();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [searchText, setSearchText] = React.useState("");
  const [companies, setCompanies] = React.useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = React.useState<Company | null>(null);
  const [highlightedIndex, setHighlightedIndex] = React.useState<number>(-1);
  const itemsRef = React.useRef<(HTMLDivElement | null)[]>([]);

  // Debug logging and load selected company by value
  React.useEffect(() => {
    if (value !== undefined) {
      if (value) {
        loadCompanyById(value);
      } else {
        setSelectedCompany(null);
      }
    }
  }, [value]);

  // Load companies when popover opens
  React.useEffect(() => {
    if (open) {
      loadCompanies();
    }
  }, [open]);

  // Function to load all companies
  const loadCompanies = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('companies')
        .select('id, name, logo_url')
        .order('name');
      if (error) {
        console.error("Error loading companies:", error);
        return;
      }
      setCompanies(data);
    } catch (err) {
      console.error("Exception loading companies:", err);
    } finally {
      setLoading(false);
    }
  };

  // Load company by ID and add to companies list if not present
  const loadCompanyById = async (id: string) => {
    try {
      const { data, error } = await supabase
        .from('companies')
        .select('id, name, logo_url')
        .eq('id', id)
        .single();
      if (error) {
        console.error("Error loading company by ID:", error);
        return;
      }
      if (data) {
        setSelectedCompany(data);
        setCompanies(prevCompanies => {
          if (!prevCompanies.find(c => c.id === data.id)) {
            return [...prevCompanies, data];
          }
          return prevCompanies;
        });
      }
    } catch (err) {
      console.error("Exception loading company by ID:", err);
    }
  };

  // Filter companies based on search text
  const filteredCompanies = React.useMemo(() => {
    if (!searchText) return companies;
    const text = searchText.toLowerCase().trim();
    return companies.filter(company =>
      company.name.toLowerCase().includes(text)
    );
  }, [companies, searchText]);

  // Handle company selection
  const selectCompany = (company: Company) => {
    onChange(company.id, company.name);
    setSelectedCompany(company);
    setOpen(false);
  };

  // Keyboard navigation: reset highlight when open/filter changes
  React.useEffect(() => {
    setHighlightedIndex(filteredCompanies.length > 0 ? 0 : -1);
  }, [open, searchText, filteredCompanies.length]);

  // Keyboard navigation: handle up/down/enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < filteredCompanies.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredCompanies.length - 1
      );
    } else if (e.key === "Enter" && highlightedIndex >= 0) {
      e.preventDefault();
      selectCompany(filteredCompanies[highlightedIndex]);
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
            className="w-full justify-between"
            onKeyDown={handleKeyDown}
            tabIndex={0}
          >
            {selectedCompany ? selectedCompany.name : (language === "en" ? "Select company..." : "Unternehmen auswählen...")}
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
                placeholder={language === "en" ? "Search..." : "Suchen..."}
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
                  {filteredCompanies.length === 0 ? (
                    <div className="text-center p-4 text-sm text-muted-foreground">
                      {language === "en" ? "No companies found" : "Keine Unternehmen gefunden"}
                    </div>
                  ) : (
                    filteredCompanies.map((company, idx) => (
                      <div
                        key={company.id}
                        ref={el => itemsRef.current[idx] = el}
                        className={`
                          flex items-center px-2 py-1 rounded-sm text-sm cursor-pointer
                          ${value === company.id ? 'bg-primary/10' : 'hover:bg-muted'}
                          ${highlightedIndex === idx ? 'bg-muted' : ''}
                        `}
                        onClick={() => selectCompany(company)}
                        onMouseEnter={() => setHighlightedIndex(idx)}
                      >
                        {value === company.id && (
                          <Check className="mr-2 h-4 w-4 text-primary" />
                        )}
                        <span className={value === company.id ? "ml-6" : "ml-8"}>
                          {company.name}
                        </span>
                      </div>
                    ))
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