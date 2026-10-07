import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { Info, X, Trash2 } from "lucide-react";
import { ANIMAL_ICONS } from "@/constants/animalIcons"; // Add this import

interface ProfileImageUploadProps {
  language: 'en' | 'de';
  onImageUploaded: (url: string) => void;
  userId: string;
  currentIcon?: string;
  onClose?: () => void;
}

export const ProfileImageUpload = ({ language, userId, currentIcon, onImageUploaded, onClose }: ProfileImageUploadProps) => {
  const [selectedIcon, setSelectedIcon] = useState(currentIcon || '');
  const [takenIcons, setTakenIcons] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  
  const permissions = usePermissions();
  const canChangeIcon = permissions.canChangeAnimalIcons;

  // Fetch already taken icons - FIX THE COLUMN NAME
  useEffect(() => {
    const fetchTakenIcons = async () => {
      try {
        const { data, error } = await supabase
          .from('user_profile')
          .select('selected_animal_icon')
          .neq('user_id', userId) // ✅ Change 'id' to 'user_id'
          .not('selected_animal_icon', 'is', null);
        
        if (error) {
          console.error('Error fetching taken icons:', error);
          return;
        }
        
        if (data) {
          const takenIconsList = data
            .map(profile => profile.selected_animal_icon)
            .filter(icon => icon !== null && icon !== undefined && icon !== '');
          setTakenIcons(takenIconsList);
        }
      } catch (error) {
        console.error('Error in fetchTakenIcons:', error);
      }
    };
    
    fetchTakenIcons();
  }, [userId]);

  // Add this helper function
  const announceToScreenReader = (message: string) => {
    const liveRegion = document.getElementById('live-announcements');
    if (liveRegion) {
      liveRegion.textContent = message;
      // Clear after announcement
      setTimeout(() => {
        liveRegion.textContent = '';
      }, 1000);
    }
  };

  const handleIconSelect = async (iconId: string) => {
    if (takenIcons.includes(iconId)) {
      toast.error(language === 'en' ? 'This icon is already assigned' : 'Dieses Icon ist bereits vergeben');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('user_profile')
        .update({ selected_animal_icon: iconId })
        .eq('user_id', userId);

      if (error) throw error;

      setSelectedIcon(iconId);
      
      if (onImageUploaded) {
        onImageUploaded(iconId);
      }
      
      // ✅ Visual toast AND screen reader announcement
      const successMessage = language === 'en' ? 'Profile icon updated' : 'Profil-Icon aktualisiert';
      toast.success(successMessage);
      announceToScreenReader(successMessage); // ✅ Screen reader will hear this
    
      // Close the editor after successful update
      if (onClose) {
        onClose();
      }
    } catch (error) {
      const errorMessage = language === 'en' ? 'Failed to update icon' : 'Fehler beim Aktualisieren';
      toast.error(errorMessage);
      announceToScreenReader(errorMessage); // ✅ Screen reader will hear errors too
    } finally {
      setLoading(false);
    }
  };

  // ✅ ADD BACK: Remove icon function
  const handleRemoveIcon = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('user_profile')
        .update({ selected_animal_icon: null })
        .eq('user_id', userId);

      if (error) throw error;

      setSelectedIcon('');
      
      if (onImageUploaded) {
        onImageUploaded(''); // Pass empty string to indicate removal
      }
      
      toast.success(language === 'en' ? 'Profile icon removed' : 'Profil-Icon entfernt');
      
      // Close the editor after successful removal
      if (onClose) {
        onClose();
      }
    } catch (error) {
      toast.error(language === 'en' ? 'Failed to remove icon' : 'Fehler beim Entfernen des Icons');
    } finally {
      setLoading(false);
    }
  };

  // If user cannot change icon, show minimal message
  if (!canChangeIcon) {
    return (
      <div className="mt-4 p-3 border border-gray-200 rounded-md bg-gray-50">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-gray-500" />
          <p className="text-sm text-gray-600">
            {language === 'en' 
              ? 'Contact staff management to change your icon'
              : 'Kontaktieren Sie das Mitarbeiter-Management für Icon-Änderungen'}
          </p>
        </div>
      </div>
    );
  }

  // Always show the icon selection grid directly
  return (
    <div className="mt-4 p-4 border border-gray-200 rounded-md bg-white shadow-sm">
      {/* Header with close button */}
      <div className="flex items-center justify-between mb-3">
        <h4 id="icon-editor-title" className="text-sm font-medium text-gray-700">
          {language === 'en' ? 'Select Profile Icon' : 'Profil-Icon auswählen'}
        </h4>
        <div className="flex items-center gap-2">
          {/* ✅ ADD BACK: Delete button in header */}
          {selectedIcon && (
            <button
              onClick={handleRemoveIcon}
              disabled={loading}
              className="p-1 hover:bg-red-100 rounded text-red-600 hover:text-red-700 transition-colors"
              aria-label={language === 'en' ? 'Remove current icon' : 'Aktuelles Icon entfernen'}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  onClose?.();
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-100 rounded"
              aria-label={language === 'en' ? 'Close' : 'Schließen'}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  onClose();
                }
              }}
            >
              <X className="h-4 w-4 text-gray-500" />
            </button>
          )}
        </div>
      </div>

      {/* Current selection info */}
      {selectedIcon && (
        <div className="text-center mb-3">
          <p className="text-sm text-gray-600">
            {language === 'en' ? 'Current:' : 'Aktuell:'} {ANIMAL_ICONS.find(icon => icon.id === selectedIcon)?.name[language]}
          </p>
        </div>
      )}

      {/* Icon selection grid - always visible */}
      <div className="space-y-4">
        <div className="grid grid-cols-8 gap-2 max-h-48 overflow-y-auto p-2 border border-gray-200 rounded bg-gray-50"
             role="grid"
             aria-label={language === 'en' ? 'Animal icon selection grid' : 'Tiericon-Auswahlraster'}>
          {ANIMAL_ICONS.map((icon) => {
            const isTaken = takenIcons.includes(icon.id);
            const isSelected = selectedIcon === icon.id;
            
            return (
              <button
                key={icon.id}
                onClick={() => !isTaken && handleIconSelect(icon.id)}
                disabled={isTaken || loading}
                role="gridcell"
                aria-label={`${icon.name[language]}${isSelected ? ` (${language === 'en' ? 'currently selected' : 'aktuell ausgewählt'})` : ''}${isTaken ? ` (${language === 'en' ? 'already taken' : 'bereits vergeben'})` : ''}`}
                aria-pressed={isSelected}
                aria-disabled={isTaken || loading}
                className={`p-1.5 rounded border transition-colors relative ${
                  isSelected 
                    ? 'border-blue-500 bg-blue-50' 
                    : isTaken 
                      ? 'border-gray-200 bg-gray-100 cursor-not-allowed opacity-50'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <img 
                  src={`/assets/animals/${icon.id}.png`} 
                  alt="" // ✅ Empty alt since button has aria-label
                  className="w-6 h-6 mx-auto"
                  role="presentation" // ✅ Decorative image
                />
                {isTaken && (
                  <div className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full"
                       aria-hidden="true" // ✅ Decorative indicator
                  ></div>
                )}
              </button>
            );
          })}
        </div>
        
        <p className="text-xs text-gray-500 text-center">
          {language === 'en' 
            ? 'Each icon can only be assigned once. Click the trash icon to remove your current selection.'
            : 'Jedes Icon kann nur einmal vergeben werden. Klicken Sie auf das Papierkorb-Symbol, um Ihre aktuelle Auswahl zu entfernen.'}
        </p>
      </div>
    </div>
  );
};