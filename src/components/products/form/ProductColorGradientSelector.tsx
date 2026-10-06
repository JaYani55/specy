import React, { useEffect, useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ColorSelectorProps {
  onChange: (color: string) => void;
  value?: string;
}

const DEFAULT_COLOR = '#f8f1ee';

const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const normalizeHex = (input: string): string | null => {
  const trimmed = input.trim();
  if (!HEX_PATTERN.test(trimmed)) return null;
  const body = trimmed.slice(1);
  if (body.length === 3) {
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`.toLowerCase();
  }
  return trimmed.toLowerCase();
};

/**
 * Standard color picker for the optional product menu/card color.
 * Stores a hex color string; an empty string keeps the menu's default styling.
 */
export function ProductColorGradientSelector({
  onChange,
  value,
}: ColorSelectorProps) {
  const { language } = useTheme();
  const [hexInput, setHexInput] = useState<string>('');
  const [hexInputError, setHexInputError] = useState<boolean>(false);

  const storedColor = value?.trim() ?? '';
  const isHexColor = normalizeHex(storedColor) !== null;
  const pickerColor = isHexColor ? normalizeHex(storedColor)! : DEFAULT_COLOR;

  useEffect(() => {
    setHexInput(isHexColor ? normalizeHex(storedColor)! : '');
    setHexInputError(false);
  }, [storedColor, isHexColor]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative inline-flex h-10 w-14 cursor-pointer overflow-hidden rounded-md border border-input shadow-sm" title={language === 'en' ? 'Pick a menu color' : 'Menüfarbe wählen'}>
          <input
            type="color"
            value={pickerColor}
            onChange={(event) => {
              setHexInputError(false);
              onChange(event.target.value);
            }}
            className="absolute inset-0 h-full w-full cursor-pointer border-0 bg-transparent p-0"
            aria-label={language === 'en' ? 'Pick a menu color' : 'Menüfarbe wählen'}
          />
        </label>
        <Input
          type="text"
          value={hexInput}
          placeholder="#1a80f7"
          className="w-32 font-mono"
          aria-label={language === 'en' ? 'Menu color hex value' : 'Hex-Wert der Menüfarbe'}
          onChange={(event) => {
            setHexInput(event.target.value);
            setHexInputError(false);
          }}
          onBlur={() => {
            const normalized = normalizeHex(hexInput);
            if (!hexInput.trim()) {
              setHexInputError(false);
              return;
            }
            if (normalized) {
              onChange(normalized);
            } else {
              setHexInputError(true);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              (event.target as HTMLInputElement).blur();
            }
          }}
        />
        {storedColor && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={language === 'en' ? 'Use default menu color' : 'Standardfarbe des Menüs verwenden'}
            onClick={() => {
              setHexInput('');
              setHexInputError(false);
              onChange('');
            }}
          >
            {language === 'en' ? 'Use default menu style' : 'Menü-Standard verwenden'}
          </Button>
        )}
      </div>
      {hexInputError ? (
        <p className="text-sm text-destructive">
          {language === 'en'
            ? 'Please enter a valid hex color, e.g. #1a80f7.'
            : 'Bitte gib einen gültigen Hex-Farbwert ein, z. B. #1a80f7.'}
        </p>
      ) : null}
    </div>
  );
}
