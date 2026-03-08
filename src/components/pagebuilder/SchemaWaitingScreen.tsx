import React, { useEffect, useState, useCallback } from 'react';
import { Loader2, Copy, CheckCircle2, XCircle, ExternalLink, Globe } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { cancelSchemaRegistration, getSchemaRegistrationStatus } from '@/services/pageService';
import type { PageSchema } from '@/types/pagebuilder';
import { useTheme } from '@/contexts/ThemeContext';
import { toast } from 'sonner';
import { API_URL } from '@/lib/apiUrl';

interface SchemaWaitingScreenProps {
  schema: PageSchema;
  onStatusChange: () => void;
}

export const SchemaWaitingScreen: React.FC<SchemaWaitingScreenProps> = ({ schema, onStatusChange }) => {
  const { language } = useTheme();
  const [isCancelling, setIsCancelling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [registrationComplete, setRegistrationComplete] = useState(false);
  const [frontendUrl, setFrontendUrl] = useState<string | null>(null);

  const specUrl = `${API_URL}/api/schemas/${schema.slug}/spec.txt`;

  // Poll for registration status changes
  useEffect(() => {
    if (registrationComplete) return;

    const interval = setInterval(async () => {
      try {
        const result = await getSchemaRegistrationStatus(schema.id);
        if (result.registration_status === 'registered') {
          setRegistrationComplete(true);
          setFrontendUrl(result.frontend_url);
          clearInterval(interval);
        }
      } catch {
        // Silent fail on poll
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [schema.id, registrationComplete]);

  const handleCopyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(specUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(language === 'en' ? 'URL copied!' : 'URL kopiert!');
    } catch {
      toast.error(language === 'en' ? 'Failed to copy' : 'Kopieren fehlgeschlagen');
    }
  }, [specUrl, language]);

  const handleCancel = async () => {
    setIsCancelling(true);
    try {
      await cancelSchemaRegistration(schema.id);
      toast.success(language === 'en' ? 'Registration cancelled' : 'Registrierung abgebrochen');
      onStatusChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel');
    } finally {
      setIsCancelling(false);
    }
  };

  // Success state
  if (registrationComplete) {
    return (
      <Card className="border-green-500">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-6 w-6" />
            {language === 'en' ? 'Frontend Registered!' : 'Frontend registriert!'}
          </CardTitle>
          <CardDescription>
            {language === 'en'
              ? 'The frontend has successfully connected to this schema.'
              : 'Das Frontend wurde erfolgreich mit diesem Schema verbunden.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {frontendUrl && (
            <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 rounded-lg">
              <Globe className="h-4 w-4 text-green-600" />
              <span className="font-medium">{language === 'en' ? 'Domain:' : 'Domain:'}</span>
              <a
                href={frontendUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline flex items-center gap-1"
              >
                {frontendUrl}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          <Button onClick={onStatusChange} className="w-full">
            {language === 'en' ? 'Continue to Pages' : 'Weiter zu Seiten'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
            {language === 'en' ? 'Waiting for Frontend' : 'Warten auf Frontend'}
          </CardTitle>
          <CardDescription>
            {language === 'en'
              ? `Schema "${schema.name}" is waiting for a frontend to register.`
              : `Schema „${schema.name}" wartet darauf, dass sich ein Frontend registriert.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Registration Code */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm">
              {language === 'en' ? 'Registration Code' : 'Registrierungscode'}
            </h3>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-muted p-3 rounded-lg font-mono text-lg tracking-wider text-center select-all">
                {schema.registration_code}
              </code>
            </div>
          </div>

          <Separator />

          {/* Schema Spec URL */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm">
              {language === 'en' ? 'Schema Specification URL' : 'Schema-Spezifikations-URL'}
            </h3>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-muted p-3 rounded-lg text-sm font-mono truncate">
                {specUrl}
              </code>
              <Button variant="outline" size="icon" onClick={handleCopyUrl}>
                {copied ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {language === 'en'
                ? 'Share this URL with your LLM agent or developer to build the frontend template.'
                : 'Teile diese URL mit deinem LLM-Agenten oder Entwickler, um das Frontend-Template zu erstellen.'}
            </p>
          </div>

          <Separator />

          {/* Instructions */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">
              {language === 'en' ? 'How to complete registration' : 'So wird die Registrierung abgeschlossen'}
            </h3>
            <ol className="space-y-3 text-sm">
              <li className="flex gap-3">
                <Badge variant="outline" className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center p-0">1</Badge>
                <span>
                  {language === 'en'
                    ? 'Give the Schema URL to your LLM agent (or fetch it manually). It contains the full schema definition, content block types, and LLM instructions.'
                    : 'Gib die Schema-URL an deinen LLM-Agenten weiter (oder rufe sie manuell ab). Sie enthält die vollständige Schema-Definition, Content-Block-Typen und LLM-Anweisungen.'}
                </span>
              </li>
              <li className="flex gap-3">
                <Badge variant="outline" className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center p-0">2</Badge>
                <span>
                  {language === 'en'
                    ? 'Build the frontend template that consumes pages matching this schema from the Supabase `pages` table.'
                    : 'Erstelle das Frontend-Template, das Seiten gemäß diesem Schema aus der Supabase-Tabelle `pages` konsumiert.'}
                </span>
              </li>
              <li className="flex gap-3">
                <Badge variant="outline" className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center p-0">3</Badge>
                <div>
                  <span>
                    {language === 'en'
                      ? 'Register the frontend by POSTing to the registration endpoint:'
                      : 'Registriere das Frontend durch einen POST an den Registrierungsendpunkt:'}
                  </span>
                  <pre className="mt-2 bg-muted p-3 rounded text-xs font-mono overflow-auto">
{`POST ${API_URL}/api/schemas/${schema.slug}/register
Content-Type: application/json

{
  "code": "${schema.registration_code}",
  "frontend_url": "https://your-frontend.com",
  "revalidation_endpoint": "/api/revalidate",
  "revalidation_secret": "your-secret",
  "slug_structure": "/:slug"
}`}
                  </pre>
                </div>
              </li>
              <li className="flex gap-3">
                <Badge variant="outline" className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center p-0">4</Badge>
                <span>
                  {language === 'en'
                    ? 'This screen will automatically update once the registration is complete.'
                    : 'Dieser Bildschirm wird automatisch aktualisiert, sobald die Registrierung abgeschlossen ist.'}
                </span>
              </li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* Polling indicator */}
      <Alert>
        <Loader2 className="h-4 w-4 animate-spin" />
        <AlertDescription className="flex items-center justify-between">
          <span className="text-sm">
            {language === 'en'
              ? 'Checking for registration every 10 seconds...'
              : 'Prüfung auf Registrierung alle 10 Sekunden...'}
          </span>
        </AlertDescription>
      </Alert>

      {/* Cancel button */}
      <div className="flex justify-center">
        <Button
          variant="destructive"
          onClick={handleCancel}
          disabled={isCancelling}
        >
          {isCancelling ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <XCircle className="h-4 w-4 mr-2" />
          )}
          {language === 'en' ? 'Cancel Registration' : 'Registrierung abbrechen'}
        </Button>
      </div>
    </div>
  );
};
