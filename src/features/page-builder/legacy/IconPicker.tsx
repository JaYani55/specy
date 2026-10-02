import React, { useState, useMemo } from 'react';
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

interface IconPickerProps {
  value: string;
  onChange: (iconName: string) => void;
}

export const IconPicker: React.FC<IconPickerProps> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { allIconNames, iconMap } = useMemo(() => {
    const isLucideIcon = (component: unknown): component is LucideIcon =>
      typeof component === 'function';

    const entries = Object.entries(LucideIcons)
      .filter(([key, component]) => {
        const isValidExport =
          isLucideIcon(component) &&
          !['createLucideIcon', 'Icon'].includes(key) &&
          key[0] === key[0].toUpperCase();
        return isValidExport;
      })
      .sort(([a], [b]) => a.localeCompare(b));

    return {
      allIconNames: entries.map(([key]) => key),
      iconMap: Object.fromEntries(entries) as Record<string, LucideIcon>,
    };
  }, []);

  // Filter icons based on search
  const filteredIcons = useMemo(() => {
    if (!search) return allIconNames;
    return allIconNames.filter(name => 
      name.toLowerCase().includes(search.toLowerCase())
    );
  }, [allIconNames, search]);

  // Get the icon component
  const SelectedIcon = value && iconMap[value]
    ? iconMap[value]
    : LucideIcons.HelpCircle;

  return (
    <div className="space-y-2">
      <Label className="font-semibold">Icon</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          >
            <div className="flex items-center gap-2">
              <SelectedIcon className="h-4 w-4" />
              <span>{value || 'Icon auswählen...'}</span>
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <div className="p-2 border-b">
            <Input
              placeholder="Icon suchen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9"
            />
          </div>
          <ScrollArea className="h-[300px]">
            <div className="grid grid-cols-4 gap-2 p-2">
              {filteredIcons.map((iconName) => {
                const IconComponent = iconMap[iconName] ?? LucideIcons.HelpCircle;
                const isSelected = value === iconName;
                
                return (
                  <button
                    key={iconName}
                    type="button"
                    onClick={() => {
                      onChange(iconName);
                      setOpen(false);
                      setSearch('');
                    }}
                    className={`
                      flex flex-col items-center justify-center p-3 rounded-md
                      border-2 transition-all hover:bg-accent hover:border-primary/50
                      ${isSelected ? 'border-primary bg-accent' : 'border-transparent'}
                    `}
                    title={iconName}
                  >
                    <IconComponent className="h-5 w-5 mb-1" />
                    <span className="text-[9px] text-center leading-tight truncate w-full">
                      {iconName}
                    </span>
                  </button>
                );
              })}
            </div>
            {filteredIcons.length === 0 && (
              <div className="text-center py-6 text-muted-foreground text-sm">
                Keine Icons gefunden
              </div>
            )}
          </ScrollArea>
          <div className="p-2 border-t bg-muted/30">
            <Badge variant="secondary" className="text-xs">
              {filteredIcons.length} von {allIconNames.length} Icons
            </Badge>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
