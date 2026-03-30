import React, { useEffect, useMemo, useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/usePermissions';

interface UsedColor {
  color: string;
  productName: string;
}

interface ColorSelectorProps {
  onChange: (color: string) => void;
  value?: string;
  usedColors?: UsedColor[];
}

const DEFAULT_COLOR = '#f8f1ee';

export function ProductColorGradientSelector({ 
  onChange, 
  value, 
  usedColors = [] 
}: ColorSelectorProps) {
  const { language } = useTheme();
  const { canChangeAnimalIcons } = usePermissions();
  const [selectedBaseColor, setSelectedBaseColor] = useState<string | null>(null);
  
  // Set default color if no value is provided
  useEffect(() => {
    if (!value) {
      onChange(DEFAULT_COLOR);
    }
  }, [value, onChange]);

  void usedColors;

  // Color palette with 12 base colors (darkest shades) and 4 shades each
  const colorPalette = useMemo(() => [
    {
      name: language === 'en' ? 'Default' : 'Standard',
      baseColor: DEFAULT_COLOR,
      shades: [DEFAULT_COLOR]
    },
    {
      name: language === 'en' ? 'Green' : 'Grün',
      baseColor: '#2f9e44',
      shades: ['#2f9e44', '#40c057', '#69db7c', '#b2f2bb']
    },
    {
      name: language === 'en' ? 'Teal' : 'Blaugrün',
      baseColor: '#099268',
      shades: ['#099268', '#12b886', '#38d9a9', '#96f2d7']
    },
    {
      name: language === 'en' ? 'Cyan' : 'Cyan',
      baseColor: '#0c8599',
      shades: ['#0c8599', '#15aabf', '#3bc9db', '#99e9f2']
    },
    {
      name: language === 'en' ? 'Blue' : 'Blau',
      baseColor: '#1971c2',
      shades: ['#1971c2', '#228be6', '#4dabf7', '#a5d8ff']
    },
    {
      name: language === 'en' ? 'Purple' : 'Lila',
      baseColor: '#6741d9',
      shades: ['#6741d9', '#7950f2', '#9775fa', '#d0bfff']
    },
    {
      name: language === 'en' ? 'Violet' : 'Violett',
      baseColor: '#9c36b5',
      shades: ['#9c36b5', '#be4bdb', '#da77f2', '#eebefa']
    },
    {
      name: language === 'en' ? 'Pink' : 'Rosa',
      baseColor: '#c2255c',
      shades: ['#c2255c', '#e64980', '#f783ac', '#fcc2d7']
    },
    {
      name: language === 'en' ? 'Orange' : 'Orange',
      baseColor: '#f08c00',
      shades: ['#f08c00', '#fab005', '#ffd43b', '#ffec99']
    },
    {
      name: language === 'en' ? 'Red Orange' : 'Rotorange',
      baseColor: '#e8590c',
      shades: ['#e8590c', '#fd7e14', '#ffa94d', '#ffd8a8']
    },
    {
      name: language === 'en' ? 'Red' : 'Rot',
      baseColor: '#e03131',
      shades: ['#e03131', '#ff6b6b', '#ff8787', '#ffc9c9']
    },
    {
      name: language === 'en' ? 'Brown' : 'Braun',
      baseColor: '#846358',
      shades: ['#846358', '#a0856b', '#d2bab0', '#eaddd7']
    },
    {
      name: language === 'en' ? 'Gray' : 'Grau',
      baseColor: '#343a40',
      shades: ['#343a40', '#868e96', '#ced4da', '#e9ecef']
    }
  ], [language]);

  // Find the base color for the current value
  useEffect(() => {
    if (value) {
      const foundColor = colorPalette.find(color => 
        color.shades.includes(value.toLowerCase())
      );
      if (foundColor) {
        setSelectedBaseColor(foundColor.baseColor);
      }
    }
  }, [colorPalette, value]);

  // Get available shades for the selected base color
  const getAvailableShades = (baseColor: string) => {
    const colorGroup = colorPalette.find(color => color.baseColor === baseColor);
    return colorGroup ? colorGroup.shades : [];
  };

  // Check if a color is currently selected
  const isSelected = (color: string): boolean => {
    return value?.toLowerCase() === color.toLowerCase();
  };

  return (
    <div className="space-y-4">
      {/* Base Color Selection - Only for MentoringManagement */}
      {canChangeAnimalIcons && (
        <div>
          <label className="block text-sm font-medium mb-2">
            {language === 'en' ? 'Select Base Color' : 'Grundfarbe wählen'}
          </label>
          <div 
            className="grid gap-2"
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(32px, 1fr))',
              maxWidth: '100%'
            }}
          >
            {colorPalette.map((color, index) => (
              <div key={index} className="relative">
                <button
                  type="button"
                  onClick={() => setSelectedBaseColor(color.baseColor)}
                  title={color.name}
                  className={cn(
                    "h-8 w-8 rounded-md transition-all border-2",
                    selectedBaseColor === color.baseColor 
                      ? "border-black" 
                      : "border-gray-200 hover:border-gray-300",
                    "hover:scale-105"
                  )}
                  style={{ backgroundColor: color.baseColor }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shade Selection */}
      <div>
        <label className="block text-sm font-medium mb-2">
          {language === 'en' ? 'Select Shade' : 'Farbton wählen'}
        </label>
        
        {selectedBaseColor || !canChangeAnimalIcons ? (
          <div className="grid grid-cols-4 gap-2">
            {(selectedBaseColor 
              ? getAvailableShades(selectedBaseColor)
              : colorPalette.flatMap(color => color.shades)
            ).map((shade, index) => {
              const isShadeSelected = isSelected(shade);
              
              return (
                <div key={index} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      onChange(shade);
                    }}
                    title={shade}
                    className={cn(
                      "h-12 w-full rounded-md transition-all relative",
                      isShadeSelected 
                        ? "outline outline-3 outline-black" 
                        : "border border-gray-200 hover:border-gray-300",
                      "hover:scale-105"
                    )}
                    style={{ backgroundColor: shade }}
                  />
                  
                  {/* Selected indicator */}
                  {isShadeSelected && (
                    <div className="absolute top-1 right-1">
                      <div className="w-3 h-3 bg-black rounded-full border border-white"></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-gray-500 italic">
            {language === 'en' 
              ? 'Please select a base color first' 
              : 'Bitte zuerst eine Grundfarbe wählen'}
          </div>
        )}
      </div>
      

    </div>
  );
}