import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Image as ImageIcon, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { ImageUploader } from '@/components/pagebuilder/ImageUploader';
import { useBranding } from '@/hooks/useBranding';
import { usePermissions } from '@/hooks/usePermissions';
import Logo from '@/components/shared/Logo';
import { BRANDING_QUERY_KEY, DEFAULT_BRANDING_SETTINGS, updateBrandingSettings } from '@/services/brandingService';
import { useTheme } from '@/contexts/ThemeContext';

const VerwaltungBranding = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const { language } = useTheme();
  const { data: branding, isLoading } = useBranding();
  const [logoMode, setLogoMode] = useState<'default' | 'custom'>(DEFAULT_BRANDING_SETTINGS.logoMode);
  const [customLogoUrl, setCustomLogoUrl] = useState(DEFAULT_BRANDING_SETTINGS.customLogoUrl);
  const [logoScale, setLogoScale] = useState(DEFAULT_BRANDING_SETTINGS.logoScale);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!permissions.userRoles.includes('super-admin')) {
      navigate('/admin');
    }
  }, [navigate, permissions.userRoles]);

  useEffect(() => {
    if (!branding) {
      return;
    }

    setLogoMode(branding.logoMode);
    setCustomLogoUrl(branding.customLogoUrl);
    setLogoScale(branding.logoScale);
  }, [branding]);

  const previewBranding = {
    logoMode,
    customLogoUrl,
    logoScale,
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const nextBranding = await updateBrandingSettings({
        logoMode,
        customLogoUrl: customLogoUrl.trim(),
        logoScale,
      });
      queryClient.setQueryData(BRANDING_QUERY_KEY, nextBranding);
      await queryClient.invalidateQueries({ queryKey: BRANDING_QUERY_KEY });
      toast.success(language === 'en' ? 'Branding updated.' : 'Branding aktualisiert.');
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : language === 'en'
            ? 'Failed to update branding.'
            : 'Branding konnte nicht gespeichert werden.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (!permissions.userRoles.includes('super-admin')) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <Button variant="ghost" className="gap-2" onClick={() => navigate('/admin')}>
          <ArrowLeft className="h-4 w-4" />
          {language === 'en' ? 'Back to Administration' : 'Zurueck zur Verwaltung'}
        </Button>

        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
            <ImageIcon className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Branding</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              {language === 'en'
                ? 'Configure the application logo for navigation and login screens.'
                : 'Logo fuer Navigation und Login zentral konfigurieren.'}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{language === 'en' ? 'Logo' : 'Logo'}</CardTitle>
            <CardDescription>
              {language === 'en'
                ? 'Upload or choose a logo from the media library. If empty, the default ServiceCMS logo remains in use.'
                : 'Logo aus der Mediathek waehlen oder hochladen. Ohne Eintrag bleibt das Standard-ServiceCMS-Logo aktiv.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {language === 'en' ? 'Loading branding...' : 'Branding wird geladen...'}
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>{language === 'en' ? 'Media Library' : 'Mediathek'}</Label>
                    <ImageUploader
                      value={customLogoUrl}
                      onChange={(url) => {
                        setCustomLogoUrl(url);
                        setLogoMode(url ? 'custom' : 'default');
                      }}
                      previewVariant="banner"
                      folder="branding"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="branding-logo-url">{language === 'en' ? 'Logo URL' : 'Logo-URL'}</Label>
                    <Input
                      id="branding-logo-url"
                      type="url"
                      placeholder="https://..."
                      value={customLogoUrl}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setCustomLogoUrl(nextValue);
                        setLogoMode(nextValue.trim() ? 'custom' : 'default');
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{language === 'en' ? 'Logo Source' : 'Logo-Quelle'}</Label>
                    <div className="flex gap-3">
                      <Button
                        type="button"
                        variant={logoMode === 'default' ? 'default' : 'outline'}
                        onClick={() => setLogoMode('default')}
                        disabled={saving}
                      >
                        {language === 'en' ? 'Use Repo Default' : 'Repo-Standard verwenden'}
                      </Button>
                      <Button
                        type="button"
                        variant={logoMode === 'custom' ? 'default' : 'outline'}
                        onClick={() => setLogoMode('custom')}
                        disabled={saving || !customLogoUrl.trim()}
                      >
                        {language === 'en' ? 'Use Custom Logo' : 'Eigenes Logo verwenden'}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {language === 'en'
                        ? 'The default logo always comes from the repo static files. Custom logos are stored separately and only used when this mode is enabled.'
                        : 'Das Standardlogo kommt immer aus den statischen Repo-Dateien. Eigene Logos werden separat gespeichert und nur im Custom-Modus verwendet.'}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <Button onClick={handleSave} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                      {language === 'en' ? 'Save Branding' : 'Branding speichern'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setLogoMode('default')} disabled={saving}>
                      {language === 'en' ? 'Use Default Logo' : 'Standardlogo verwenden'}
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label>{language === 'en' ? 'Preview' : 'Vorschau'}</Label>
                  <div className="rounded-2xl border bg-card p-6 space-y-4">
                    <div className="h-16 rounded-lg border bg-muted/30 flex items-center justify-center px-4">
                      <Logo variant="navbar" brandingOverride={previewBranding} className="max-w-full" />
                    </div>
                    <div className="rounded-xl border bg-muted/20 p-6 flex items-center justify-center">
                      <Logo variant="login" brandingOverride={previewBranding} className="max-w-full" />
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span>{language === 'en' ? 'Scale' : 'Skalierung'}</span>
                        <span className="text-muted-foreground">{logoScale}%</span>
                      </div>
                      <Slider
                        min={50}
                        max={180}
                        step={5}
                        value={[logoScale]}
                        onValueChange={(value) => {
                          const nextValue = value[0];
                          if (typeof nextValue === 'number') {
                            setLogoScale(nextValue);
                          }
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        {language === 'en'
                          ? 'Adjust how strongly the logo is scaled in shared UI placements.'
                          : 'Steuert, wie stark das Logo in den gemeinsamen UI-Bereichen skaliert wird.'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default VerwaltungBranding;