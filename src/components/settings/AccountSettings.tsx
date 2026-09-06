import React, { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { AlertCircle, Loader2, Trash2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUploader } from '@/components/pagebuilder/ImageUploader';
import { isUsernameTakenError, USERNAME_MAX_LENGTH, validateUsername } from '@/utils/usernameUtils';

interface ProfileRow {
  Username: string | null;
  pfp_url: string | null;
}

/**
 * "Account Settings" section of the /settings page: the signed-in user can
 * change their own public display name (`user_profile.Username`) and set a
 * profile picture (`user_profile.pfp_url`) via the media picker. Row Level
 * Security allows users to update their own profile row.
 */
export const AccountSettings: React.FC = () => {
  const { language } = useTheme();
  const { user } = useAuth();

  const [username, setUsername] = useState<string>('');
  const [pfpUrl, setPfpUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const [isRemovingPfp, setIsRemovingPfp] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;
      try {
        const { data, error } = await supabase
          .from('user_profile')
          .select('Username, pfp_url')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) throw error;
        if (!isMountedRef.current) return;

        const row = (data ?? {}) as Partial<ProfileRow>;
        setUsername(typeof row.Username === 'string' ? row.Username : '');
        setPfpUrl(typeof row.pfp_url === 'string' && row.pfp_url.trim() ? row.pfp_url : null);
      } catch (error) {
        console.error('[AccountSettings] Failed to load profile:', error);
        toast.error(language === 'en' ? 'Failed to load account settings.' : 'Kontoeinstellungen konnten nicht geladen werden.');
      } finally {
        if (isMountedRef.current) setIsLoading(false);
      }
    };

    void loadProfile();
  }, [user, language]);

  const startEditingUsername = () => {
    setUsernameDraft(username);
    setUsernameError(null);
    setIsEditingUsername(true);
  };

  const cancelEditingUsername = () => {
    setIsEditingUsername(false);
    setUsernameDraft(username);
    setUsernameError(null);
  };

  const handleUsernameChange = (value: string) => {
    setUsernameDraft(value);
    if (usernameError) setUsernameError(null);
  };

  const saveUsername = async () => {
    if (!user) return;
    const trimmed = usernameDraft.trim();

    if (trimmed === username) {
      setIsEditingUsername(false);
      return;
    }

    const ruleError = validateUsername(trimmed);
    if (ruleError) {
      setUsernameError(language === 'en' ? ruleError.en : ruleError.de);
      return;
    }

    setIsSavingUsername(true);
    try {
      const { error } = await supabase
        .from('user_profile')
        .update({ Username: trimmed })
        .eq('user_id', user.id);

      if (error) throw error;

      if (!isMountedRef.current) return;
      setUsername(trimmed);
      setIsEditingUsername(false);
      setUsernameError(null);
      toast.success(language === 'en' ? 'Username updated.' : 'Anzeigename aktualisiert.');
      // The display name is cached in several places (auth context, user
      // lists); a reload guarantees every view shows the new name.
      window.location.reload();
    } catch (error) {
      console.error('[AccountSettings] Failed to update username:', error);
      if (!isMountedRef.current) return;
      if (isUsernameTakenError(error)) {
        setUsernameError(language === 'en'
          ? 'This username is already taken. Please choose a different one.'
          : 'Dieser Anzeigename ist bereits vergeben. Bitte wählen Sie einen anderen.');
      } else {
        setUsernameError(language === 'en'
          ? 'Failed to update the username. Please try again.'
          : 'Anzeigename konnte nicht aktualisiert werden. Bitte versuchen Sie es erneut.');
      }
    } finally {
      if (isMountedRef.current) setIsSavingUsername(false);
    }
  };

  const handlePfpChange = async (url: string) => {
    if (!user || !url) return;
    setPfpUrl(url);
    try {
      const { error } = await supabase
        .from('user_profile')
        .update({ pfp_url: url })
        .eq('user_id', user.id);

      if (error) throw error;
      toast.success(language === 'en' ? 'Profile picture updated.' : 'Profilbild aktualisiert.');
    } catch (error) {
      console.error('[AccountSettings] Failed to update profile picture:', error);
      if (isMountedRef.current) setPfpUrl(null);
      toast.error(language === 'en' ? 'Failed to update the profile picture.' : 'Profilbild konnte nicht aktualisiert werden.');
    }
  };

  const removePfp = async () => {
    if (!user) return;
    setIsRemovingPfp(true);
    const previous = pfpUrl;
    setPfpUrl(null);
    try {
      const { error } = await supabase
        .from('user_profile')
        .update({ pfp_url: null })
        .eq('user_id', user.id);

      if (error) throw error;
      toast.success(language === 'en' ? 'Profile picture removed.' : 'Profilbild entfernt.');
    } catch (error) {
      console.error('[AccountSettings] Failed to remove profile picture:', error);
      if (isMountedRef.current) setPfpUrl(previous);
      toast.error(language === 'en' ? 'Failed to remove the profile picture.' : 'Profilbild konnte nicht entfernt werden.');
    } finally {
      if (isMountedRef.current) setIsRemovingPfp(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {language === 'en' ? 'Loading account settings…' : 'Kontoeinstellungen werden geladen…'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Username */}
      <div className="space-y-2">
        <Label htmlFor="account-username">{language === 'en' ? 'Username' : 'Anzeigename'}</Label>
        {isEditingUsername ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                id="account-username"
                value={usernameDraft}
                maxLength={USERNAME_MAX_LENGTH}
                onChange={(event) => handleUsernameChange(event.target.value)}
                disabled={isSavingUsername}
                className={usernameError ? 'border-red-500 focus:border-red-500' : ''}
                aria-invalid={!!usernameError}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void saveUsername();
                  } else if (event.key === 'Escape') {
                    cancelEditingUsername();
                  }
                }}
                autoFocus
              />
              <Button type="button" size="sm" onClick={() => void saveUsername()} disabled={isSavingUsername || !!usernameError}>
                {isSavingUsername
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : (language === 'en' ? 'Save' : 'Speichern')}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={cancelEditingUsername} disabled={isSavingUsername}>
                {language === 'en' ? 'Cancel' : 'Abbrechen'}
              </Button>
            </div>
            {usernameError && (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600" role="alert">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{usernameError}</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {language === 'en'
                ? '2–50 characters. Allowed: letters, numbers, spaces, hyphens, underscores. Must be unique.'
                : '2–50 Zeichen. Erlaubt: Buchstaben, Zahlen, Leerzeichen, Bindestriche, Unterstriche. Muss eindeutig sein.'}
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border bg-muted/30 px-3">
              <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm">{username || (language === 'en' ? 'No username set' : 'Kein Anzeigename gesetzt')}</span>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={startEditingUsername}>
              {language === 'en' ? 'Change' : 'Ändern'}
            </Button>
          </div>
        )}
      </div>

      {/* Profile picture */}
      <div className="space-y-2">
        <Label>{language === 'en' ? 'Profile picture' : 'Profilbild'}</Label>
        <div className="flex items-start gap-3">
          <div className="max-w-xs flex-1">
            <ImageUploader
              value={pfpUrl ?? ''}
              previewVariant="avatar"
              onChange={(url) => void handlePfpChange(url)}
            />
          </div>
          {pfpUrl && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-1 shrink-0 text-red-600 hover:text-red-700"
              onClick={() => void removePfp()}
              disabled={isRemovingPfp}
            >
              {isRemovingPfp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {language === 'en' ? 'Remove' : 'Entfernen'}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {language === 'en'
            ? 'Choose an image from the media library. It is shown next to your name.'
            : 'Bild aus der Medienauswahl wählen. Es wird neben deinem Namen angezeigt.'}
        </p>
      </div>
    </div>
  );
};
