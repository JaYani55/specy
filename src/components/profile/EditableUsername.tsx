// EditableUsername.tsx

import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Check, X, AlertCircle, Info, UserRoundMinus } from 'lucide-react'; // <-- NEU: Info, UserRoundMinus
import { usePermissions } from '@/hooks/usePermissions';
import { isUsernameTakenError, validateUsername } from '@/utils/usernameUtils';

interface EditableUsernameProps {
  username: string;
  onUpdate: (newUsername: string) => Promise<boolean>;
  isUpdating?: boolean;
  language?: 'en' | 'de';
}

export const EditableUsername: React.FC<EditableUsernameProps> = ({
  username,
  onUpdate,
  isUpdating = false,
  language = 'en'
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(username);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { canEditUsername } = usePermissions();

  const getDefaultUsername = (lang: 'en' | 'de') => {
    return lang === 'de' ? 'Noch kein Anzeigename gegeben' : 'No Username given';
  };
  const defaultPlaceholderEn = getDefaultUsername('en');
  const defaultPlaceholderDe = getDefaultUsername('de');

  const isCurrentlyPlaceholder = username === defaultPlaceholderEn || username === defaultPlaceholderDe;

  const handleSave = async () => {
    setError(null);
    const trimmedEditValue = editValue.trim();

    if (trimmedEditValue === username || trimmedEditValue === '') {
      setIsEditing(false);
      setEditValue(username);
      return;
    }

    const ruleError = validateUsername(trimmedEditValue);
    if (ruleError) {
      setError(language === 'de' ? ruleError.de : ruleError.en);
      return;
    }

    setIsSaving(true);
    try {
      const success = await onUpdate(trimmedEditValue); // Pass trimmed value
      if (success) {
        setIsEditing(false);
        setError(null);
      } else {
        setError(language === 'de' ? 'Fehler beim Aktualisieren des Anzeigenamens. Bitte versuchen Sie es erneut.' : 'Failed to update username. Please try again.');
      }
    } catch (error: unknown) {
      console.error('Error updating username:', error);
      if (isUsernameTakenError(error)) {
        setError(language === 'de' ? 'Dieser Anzeigename ist bereits vergeben. Bitte wählen Sie einen anderen.' : 'This username is already taken. Please choose a different one.');
      } else {
        setError(language === 'de' ? 'Fehler beim Aktualisieren des Anzeigenamens. Bitte versuchen Sie es erneut.' : 'Failed to update username. Please try again.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue(username);
    setError(null);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value);
    if (error) {
      setError(null);
    }
  };

  // --- KORRIGIERTE LOGIK FÜR DIE ANZEIGE UND STYLING ---

  // Text für bearbeitbare Platzhalter
  const editablePlaceholderText = language === 'de'
    ? 'Anzeigename vergeben' // Kurz und prägnant
    : 'Assign display name';

  // Text für nicht-bearbeitbare Platzhalter
  const nonEditablePlaceholderText = language === 'de'
    ? 'Kein Anzeigename vergeben' // Kurz und prägnant
    : 'No display name assigned';

  // Der eigentlich anzuzeigende Haupttext
  const mainDisplayText = isCurrentlyPlaceholder
    ? (canEditUsername ? editablePlaceholderText : nonEditablePlaceholderText)
    : username;

  // Zusätzliche Beschreibungstexte für die Prominenz
  const descriptionText = language === 'de'
    ? (canEditUsername ? 'Du kannst dem User einen Anzeigenamen geben.' : 'Die Mentorenverwaltung kann diesen Anzeigenamen vergeben.')
    : (canEditUsername ? 'You can set a Username for this user.' : 'Mentor management can assign this display name.');


  // --- Render-Logik ---

  if (isEditing) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 max-w-2xl">
          <div className="flex-1 min-w-0">
            <Input
              value={editValue}
              onChange={handleInputChange}
              className={`text-2xl font-bold h-12 ${error ? 'border-red-500 focus:border-red-500' : ''}`}
              disabled={isSaving || isUpdating}
              placeholder={language === 'de' ? 'Anzeigename eingeben...' : 'Enter username...'}
              aria-label={language === 'de' ? 'Anzeigename bearbeiten' : 'Edit username'}
              aria-describedby={error ? 'username-error' : 'username-help'}
              aria-invalid={!!error}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSave();
                } else if (e.key === 'Escape') {
                  handleCancel();
                }
              }}
              autoFocus
            />
          </div>
          <div className="flex gap-2 flex-shrink-0" role="group" aria-label={language === 'de' ? 'Aktionen bearbeiten' : 'Edit actions'}>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving || isUpdating || !!error}
              className="h-12 px-4"
              aria-describedby={language === 'de' ? 'Änderungen speichern' : 'Save changes'}
            >
              {isSaving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" aria-hidden="true"></div>
                  <span className="sr-only">{language === 'de' ? 'Wird gespeichert...' : 'Saving...'}</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-1" aria-hidden="true" />
                  {language === 'de' ? 'Speichern' : 'Save'}
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancel}
              disabled={isSaving || isUpdating}
              className="h-12 px-4"
              aria-label={language === 'de' ? 'Bearbeitung abbrechen' : 'Cancel editing'}
            >
              <X className="h-4 w-4 mr-1" aria-hidden="true" />
              {language === 'de' ? 'Abbrechen' : 'Cancel'}
            </Button>
          </div>
        </div>
        {error && (
          <div id="username-error"
               className="flex items-start gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-md border border-red-200 max-w-2xl"
               role="alert"
               aria-live="polite">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        {!error && (
          <div id="username-help" className="text-sm text-gray-500 max-w-2xl">
            {language === 'de'
              ? 'Enter zum Speichern, Escape zum Abbrechen'
              : 'Press Enter to save, Escape to cancel'
            }
          </div>
        )}
      </div>
    );
  }

  // --- ANZEIGELOGIK, WENN NICHT IM BEARBEITUNGSMODUS ---
  return (
    <div className="flex items-center gap-3">
      {/* Icon für Platzhalter-Status */}
      {isCurrentlyPlaceholder && (
        <UserRoundMinus // Oder Info, je nach Präferenz
          className={`h-6 w-6 ${canEditUsername ? 'text-blue-500' : 'text-gray-400'}`}
        />
      )}

      {/* Haupt-Anzeigename */}
      <h1 className={`text-2xl font-semibold leading-tight ${isCurrentlyPlaceholder ? (canEditUsername ? 'text-blue-600' : 'text-gray-700') : 'text-gray-900'}`}
          role="heading"
          aria-level={1}>
        {mainDisplayText}
      </h1>

      {/* Button nur anzeigen, wenn bearbeitbar */}
      {canEditUsername && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setIsEditing(true)}
          disabled={isUpdating}
          className="h-9 w-9 p-0 hover:bg-gray-100"
          aria-label={language === 'de' ? 'Anzeigename bearbeiten' : 'Edit username'}
          title={language === 'de' ? 'Public Anzeigename festlegen' : 'Set public display name'}
        >
          <Pencil className="h-4 w-4 text-red-600" aria-hidden="true" /> {/* Pencil icon in red */}
        </Button>
      )}

      {/* Prominenter, aber nicht aufdringlicher Beschreibungstext */}
      {isCurrentlyPlaceholder && (
        <p className={`text-sm ml-2 ${canEditUsername ? 'text-blue-600' : 'text-gray-500'} font-medium`}>
          ({descriptionText})
        </p>
      )}
    </div>
  );
};