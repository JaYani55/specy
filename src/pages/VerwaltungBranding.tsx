import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Image as ImageIcon, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUploader } from '@/components/pagebuilder/ImageUploader';
import { useBranding } from '@/hooks/useBranding';
import { usePermissions } from '@/hooks/usePermissions';
import { BRANDING_QUERY_KEY, updateBrandingSettings } from '@/services/brandingService';
import { useTheme } from '@/contexts/ThemeContext';

const DEFAULT_LOGO_URL = '/servicecms-transp.png';

const VerwaltungBranding = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const permissions = usePermissions();
  const { language } = useTheme();
  const { data: branding, isLoading } = useBranding();
  const [logoUrl, setLogoUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!permissions.userRoles.includes('super-admin')) {
      navigate('/admin');
    }
  }, [navigate, permissions.userRoles]);

  useEffect(() => {
    setLogoUrl(branding?.logoUrl ?? '');
  }, [branding?.logoUrl]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const nextBranding = await updateBrandingSettings({ logoUrl: logoUrl.trim() });
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
                      value={logoUrl}
                      onChange={setLogoUrl}
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
                      value={logoUrl}
                      onChange={(event) => setLogoUrl(event.target.value)}
                    />
                  </div>
                  <div className="flex gap-3">
                    <Button onClick={handleSave} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                      {language === 'en' ? 'Save Branding' : 'Branding speichern'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setLogoUrl('')} disabled={saving}>
                      {language === 'en' ? 'Use Default Logo' : 'Standardlogo verwenden'}
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label>{language === 'en' ? 'Preview' : 'Vorschau'}</Label>
                  <div className="rounded-2xl border bg-card p-6 space-y-4">
                    <div className="h-16 rounded-lg border bg-muted/30 flex items-center justify-center px-4">
                      <img
                        src={logoUrl || DEFAULT_LOGO_URL}
                        alt="Brand preview"
                        className="max-h-10 max-w-full object-contain"
                      />
                    </div>
                    <div className="rounded-xl border bg-muted/20 p-6 flex items-center justify-center">
                      <img
                        src={logoUrl || DEFAULT_LOGO_URL}
                        alt="Login preview"
                        className="max-h-16 max-w-full object-contain"
                      />
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