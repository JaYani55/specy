import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Clock, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimePickerProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function TimePicker({ 
  value = '', 
  onChange, 
  placeholder = 'Select time',
  disabled = false,
  className 
}: TimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [selectedHour, setSelectedHour] = useState(9);
  const [selectedMinute, setSelectedMinute] = useState(0);

  // Parse current value when it changes
  useEffect(() => {
    if (value) {
      setInputValue(value);
      const [hours, minutes] = value.split(':').map(Number);
      if (!isNaN(hours) && !isNaN(minutes)) {
        setSelectedHour(hours);
        setSelectedMinute(minutes);
      }
    }
  }, [value]);

  // Generate time options
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5); // 0, 5, 10, 15, ..., 55

  const formatTime = (hour: number, minute: number): string => {
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  };

  const handleTimeSelect = (hour: number, minute: number) => {
    const timeString = formatTime(hour, minute);
    setSelectedHour(hour);
    setSelectedMinute(minute);
    setInputValue(timeString);
    onChange(timeString);
    setIsOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    
    // Validate and parse the input
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5]?[0-9])$/;
    if (timeRegex.test(newValue)) {
      const [hours, minutes] = newValue.split(':').map(Number);
      setSelectedHour(hours);
      setSelectedMinute(minutes);
      onChange(formatTime(hours, minutes));
    }
  };

  const handleInputBlur = () => {
    // Format the input value on blur
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5]?[0-9])$/;
    if (timeRegex.test(inputValue)) {
      const [hours, minutes] = inputValue.split(':').map(Number);
      const formattedTime = formatTime(hours, minutes);
      setInputValue(formattedTime);
      onChange(formattedTime);
    } else if (inputValue) {
      // Reset to previous valid value if invalid
      setInputValue(value);
    }
  };

  const adjustTime = (type: 'hour' | 'minute', direction: 'up' | 'down') => {
    let newHour = selectedHour;
    let newMinute = selectedMinute;

    if (type === 'hour') {
      newHour = direction === 'up' 
        ? (selectedHour + 1) % 24 
        : selectedHour === 0 ? 23 : selectedHour - 1;
    } else {
      if (direction === 'up') {
        newMinute = selectedMinute + 5;
        if (newMinute >= 60) {
          newMinute = 0;
          newHour = (selectedHour + 1) % 24;
        }
      } else {
        newMinute = selectedMinute - 5;
        if (newMinute < 0) {
          newMinute = 55;
          newHour = selectedHour === 0 ? 23 : selectedHour - 1;
        }
      }
    }

    handleTimeSelect(newHour, newMinute);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Input
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            placeholder={placeholder}
            disabled={disabled}
            className={cn("pr-10", className)}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
            onClick={() => setIsOpen(!isOpen)}
          >
            <Clock className="h-4 w-4 opacity-50" />
          </Button>
        </div>
      </PopoverTrigger>
      
      <PopoverContent className="w-64 p-0" align="start">
        <div className="p-4">
          <div className="text-sm font-medium mb-3 text-center">Select Time</div>
          
          {/* Quick adjustment controls */}
          <div className="flex items-center justify-center gap-4 mb-4">
            <div className="flex flex-col items-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => adjustTime('hour', 'up')}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <div className="text-2xl font-mono font-bold min-w-[3ch] text-center">
                {selectedHour.toString().padStart(2, '0')}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => adjustTime('hour', 'down')}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="text-2xl font-mono font-bold">:</div>
            
            <div className="flex flex-col items-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => adjustTime('minute', 'up')}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <div className="text-2xl font-mono font-bold min-w-[3ch] text-center">
                {selectedMinute.toString().padStart(2, '0')}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => adjustTime('minute', 'down')}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Quick preset buttons */}
          <div className="grid grid-cols-4 gap-1 mb-4">
            {[
              { label: '9:00', hour: 9, minute: 0 },
              { label: '10:00', hour: 10, minute: 0 },
              { label: '14:00', hour: 14, minute: 0 },
              { label: '15:30', hour: 15, minute: 30 },
            ].map((preset) => (
              <Button
                key={preset.label}
                type="button"
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => handleTimeSelect(preset.hour, preset.minute)}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          {/* Scrollable time grid for fine control */}
          <div className="border-t pt-3">
            <div className="text-xs text-muted-foreground mb-2">Or scroll to select:</div>
            <div className="flex gap-2">
              <div className="flex-1">
                <div className="text-xs font-medium mb-1">Hour</div>
                <ScrollArea className="h-32 border rounded">
                  <div className="p-1">
                    {hours.map((hour) => (
                      <Button
                        key={hour}
                        type="button"
                        variant={selectedHour === hour ? "default" : "ghost"}
                        size="sm"
                        className="w-full justify-start text-xs mb-0.5"
                        onClick={() => handleTimeSelect(hour, selectedMinute)}
                      >
                        {hour.toString().padStart(2, '0')}
                      </Button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
              
              <div className="flex-1">
                <div className="text-xs font-medium mb-1">Minute</div>
                <ScrollArea className="h-32 border rounded">
                  <div className="p-1">
                    {minutes.map((minute) => (
                      <Button
                        key={minute}
                        type="button"
                        variant={selectedMinute === minute ? "default" : "ghost"}
                        size="sm"
                        className="w-full justify-start text-xs mb-0.5"
                        onClick={() => handleTimeSelect(selectedHour, minute)}
                      >
                        {minute.toString().padStart(2, '0')}
                      </Button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}