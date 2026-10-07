import React, { useState, useEffect } from 'react';
import { AlertCircle, ExternalLink } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useTheme } from '@/contexts/ThemeContext';
import { usePermissions } from '@/hooks/usePermissions'; // Add this import

function MentorSeaTableForm() {
  const { language } = useTheme();
  const permissions = usePermissions(); // Add this hook
  const [showWarning, setShowWarning] = useState(true);
  const formURL = 'https://cloud.seatable.io/dtable/forms/custom/newmentor';
  const [iframeHeight, setIframeHeight] = useState('800px');
  const canManageMentors = permissions.canManageMentors;
  
  // Responsive iframe height
  useEffect(() => {
    const handleResize = () => {
      setIframeHeight(window.innerWidth <= 1024 ? '600px' : '800px');
    };
    
    // Set initial height
    handleResize();
    
    // Add event listener
    window.addEventListener('resize', handleResize);
    
    // Cleanup
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // Add permission check
  if (!canManageMentors) {
    return (
      <div className="text-center p-6">
        <p className="text-muted-foreground">
          {language === 'en' 
            ? 'You do not have permission to add staff' 
            : 'Sie haben keine Berechtigung, Mitarbeitende hinzuzufügen'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full">
      {showWarning && (
        <Alert className="mb-4 border-amber-500 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>
            {language === 'en' ? 'Browser Cookie Notice' : 'Hinweis zu Browser-Cookies'}
          </AlertTitle>
          <AlertDescription className="mt-2">
            {language === 'en' 
              ? 'This form is hosted on SeaTable and requires third-party cookies to be enabled. If the form doesn\'t load correctly, please try opening it directly or adjust your browser settings to allow third-party cookies.'
              : 'Dieses Formular wird auf SeaTable gehostet und erfordert, dass Drittanbieter-Cookies aktiviert sind. Wenn das Formular nicht korrekt geladen wird, versuchen Sie bitte, es direkt zu öffnen oder passen Sie Ihre Browsereinstellungen an, um Drittanbieter-Cookies zuzulassen.'}
            <div className="mt-3 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowWarning(false)}
              >
                {language === 'en' ? 'Dismiss' : 'Ausblenden'}
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => window.open(formURL, '_blank')}
                className="flex items-center gap-1 text-xs sm:text-sm"
              >
                <ExternalLink className="h-4 w-4 flex-shrink-0" />
                <span className="whitespace-normal text-center">
                  {language === 'en' ? 'Open directly' : 'Direkt öffnen'}
                </span>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <iframe
        src={formURL}
        title="SeaTable Form"
        style={{
          width: '100%',
          height: iframeHeight,
          border: 'none',
        }}
      />
    </div>
  );
}

export default MentorSeaTableForm;
