import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { DefaultViewSetting } from '@/components/profile/DefaultViewSetting';
import { ArrowLeft, LayoutDashboard, PanelLeft, Globe } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ProfileSkeleton } from '@/components/profile/ProfileSkeleton';
import {
  getDefaultLandingOptions,
  getStoredSetting,
  resolveDefaultLandingView,
  storeSetting,
  type DefaultLandingOption,
} from '@/services/defaultLandingService';

const Settings = () => {
  const { language, layoutMode, setLayoutMode, changeLanguage } = useTheme();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [defaultView, setDefaultView] = React.useState<string>('events');
  const [defaultViewOptions, setDefaultViewOptions] = React.useState<DefaultLandingOption[]>([]);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [isUpdating, setIsUpdating] = React.useState<boolean>(false);

  React.useEffect(() => {
    const loadSettings = async () => {
      if (user) {
        try {
          const options = await getDefaultLandingOptions(user.roles);
          setDefaultViewOptions(options);

          const storedDefaultView = getStoredSetting(user.id, 'default_view', '');
          const resolvedDefaultView = await resolveDefaultLandingView(storedDefaultView, user.roles);

          setDefaultView(resolvedDefaultView);
        } catch (error) {
          console.error("Failed to load user settings:", error);
        } finally {
          setIsLoading(false);
        }
      }
    };

    loadSettings();
  }, [user]);

  const handleUpdateDefaultView = async (view: string): Promise<boolean> => {
    if (!user) return false;
    
    setIsUpdating(true);
    try {
      // Store in localStorage
      const success = storeSetting(user.id, 'default_view', view);
      
      if (!success) {
        return false;
      }
      
      setDefaultView(view);
      return true;
    } catch (error) {
      console.error("Failed to update default view:", error);
      return false;
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-1" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
          {language === "en" ? "Back" : "Zurück"}
        </Button>
        <h1 className="text-3xl font-bold">
          {language === "en" ? "Preferences" : "Einstellungen"}
        </h1>
      </div>

      {isLoading || isUpdating ? (
        <Card className="p-6">
          <ProfileSkeleton />
        </Card>
      ) : (
        <div className="space-y-6">
          <Card className="p-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <PanelLeft className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">
                  {language === "en" ? "Navigation Layout" : "Navigationslayout"}
                </h2>
              </div>
              <p className="text-sm text-muted-foreground">
                {language === "en" 
                  ? "Choose between a top navigation bar or a side navigation bar." 
                  : "Wählen Sie zwischen einer oberen Navigationsleiste oder einer seitlichen Navigation."}
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div 
                  className={`cursor-pointer rounded-lg border-2 p-4 hover:bg-accent transition-all ${layoutMode === 'navbar' ? 'border-primary bg-accent/50' : 'border-transparent bg-card shadow-sm'}`}
                  onClick={() => setLayoutMode('navbar')}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-full bg-primary/10">
                      <LayoutDashboard className="h-4 w-4 text-primary" />
                    </div>
                    <span className="font-medium">
                      {language === "en" ? "Top Navigation" : "Obere Navigation"}
                    </span>
                  </div>
                  <div className="h-20 bg-muted/20 rounded border border-dashed border-muted-foreground/20 relative overflow-hidden">
                     <div className="absolute top-0 left-0 right-0 h-4 bg-primary/20 border-b border-primary/10"></div>
                  </div>
                </div>

                <div 
                  className={`cursor-pointer rounded-lg border-2 p-4 hover:bg-accent transition-all ${layoutMode === 'sidebar' ? 'border-primary bg-accent/50' : 'border-transparent bg-card shadow-sm'}`}
                  onClick={() => setLayoutMode('sidebar')}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-full bg-primary/10">
                      <PanelLeft className="h-4 w-4 text-primary" />
                    </div>
                    <span className="font-medium">
                      {language === "en" ? "Sidebar Navigation" : "Seitliche Navigation"}
                    </span>
                  </div>
                  <div className="h-20 bg-muted/20 rounded border border-dashed border-muted-foreground/20 relative overflow-hidden">
                     <div className="absolute top-0 left-0 bottom-0 w-8 bg-primary/20 border-r border-primary/10"></div>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <DefaultViewSetting 
              defaultView={defaultView}
              language={language}
              options={defaultViewOptions}
              onUpdate={handleUpdateDefaultView}
            />
          </Card>

          {/* Language */}
          <Card className="p-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">
                  {language === "en" ? "Language" : "Sprache"}
                </h2>
              </div>
              <p className="text-sm text-muted-foreground">
                {language === "en"
                  ? "Choose the interface language."
                  : "Wähle die Sprache der Benutzeroberfläche."}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div
                  className={`cursor-pointer rounded-lg border-2 p-4 hover:bg-accent transition-all ${
                    language === 'de' ? 'border-primary bg-accent/50' : 'border-transparent bg-card shadow-sm'
                  }`}
                  onClick={() => changeLanguage('de')}
                >
                  <div className="flex items-center gap-3">
                    <img
                      src="https://raw.githubusercontent.com/lipis/flag-icons/main/flags/4x3/de.svg"
                      alt="DE"
                      className="h-5 w-7 object-cover rounded-sm"
                    />
                    <span className="font-medium">Deutsch</span>
                  </div>
                </div>
                <div
                  className={`cursor-pointer rounded-lg border-2 p-4 hover:bg-accent transition-all ${
                    language === 'en' ? 'border-primary bg-accent/50' : 'border-transparent bg-card shadow-sm'
                  }`}
                  onClick={() => changeLanguage('en')}
                >
                  <div className="flex items-center gap-3">
                    <img
                      src="https://raw.githubusercontent.com/lipis/flag-icons/main/flags/4x3/gb.svg"
                      alt="EN"
                      className="h-5 w-7 object-cover rounded-sm"
                    />
                    <span className="font-medium">English</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

export default Settings;