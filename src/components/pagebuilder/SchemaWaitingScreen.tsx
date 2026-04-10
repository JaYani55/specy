import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, Copy, CheckCircle2, XCircle, ExternalLink, Globe, Sparkles, Play, FileText, Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [registrationComplete, setRegistrationComplete] = useState(false);
  const [frontendUrl, setFrontendUrl] = useState<string | null>(null);
  const [selectedFramework, setSelectedFramework] = useState<'nextjs' | 'sveltekit'>('nextjs');

  const specUrl = `${API_URL}/api/schemas/${schema.slug}/spec.txt`;
  const registerUrl = `${API_URL}/api/schemas/${schema.slug}/register`;

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

    const handleCopy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedValue(key);
      setTimeout(() => setCopiedValue((current) => (current === key ? null : current)), 2000);
      toast.success(language === 'en' ? 'Copied!' : 'Kopiert!');
    } catch {
      toast.error(language === 'en' ? 'Failed to copy' : 'Kopieren fehlgeschlagen');
    }
    }, [language]);

    const agentPrompt = useMemo(() => {
     const isNext = selectedFramework === 'nextjs';

     let prompt = `You are building a ${isNext ? 'Next.js (App Router)' : 'SvelteKit'} frontend for the Specy schema "${schema.name}".

  Schema slug: ${schema.slug}
  Specification URL: ${specUrl}
  Registration URL: ${registerUrl}
  Registration code: ${schema.registration_code}

  1. Fetch the full schema specification first:
    GET ${specUrl}

  2. Build a frontend that reads published pages for this schema from Supabase table "pages".
    Required page fields:
    - id
    - slug
    - name
    - status
    - content
    - domain_url
    - updated_at

  3. Support ContentBlock arrays as defined in the spec.
    ContentBlock types:
    - text
    - heading
    - image
    - quote
    - list
    - video
  `;

     if (isNext) {
      prompt += `
  4. Implement ISR in Next.js App Router.
    - Use app/[slug]/page.tsx or the matching route for your slug_structure.
    - Expose POST /api/revalidate?path=<page_slug>
    - Read Authorization: Bearer <secret> for authentication
    - Revalidate the full route path derived from slug_structure.
  `;
     } else {
      prompt += `
  4. Implement revalidation / cache invalidation in SvelteKit.
    - Use src/routes/[slug]/+page.server.ts or the matching route for your slug_structure.
    - Expose POST /api/revalidate/<page_slug> or POST /api/revalidate?path=<page_slug>.
    - Read Authorization: Bearer <secret> for authentication.
    - Invalidate the full route path derived from slug_structure.
  `;
     }

     prompt += `
  5. Register the deployed frontend once it is live:
    POST ${registerUrl}
    Content-Type: application/json

    {
      "code": "${schema.registration_code}",
      "frontend_url": "https://your-site.com",
      "revalidation_endpoint": "/api/revalidate",
      "revalidation_secret": "your-secret",
      "slug_structure": "/:slug"
    }

  6. Use the slug_structure that matches the real route shape.
    Examples:
    - /:slug
    - /blog/:slug
    - /products/:slug

  7. Health checks expect the deployed domain to respond successfully.
  `;

     return prompt;
    }, [registerUrl, schema.name, schema.registration_code, schema.slug, selectedFramework, specUrl]);

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
      <div className="relative overflow-hidden rounded-2xl border-2 border-amber-400/60 bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 dark:from-amber-950/40 dark:via-orange-950/30 dark:to-yellow-950/20 dark:border-amber-600/40">
        <div className="absolute inset-0 opacity-[0.04] dark:opacity-[0.06]" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23f59e0b' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />

        <div className="relative p-8 space-y-8">
          <div className="flex items-center justify-center">
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-200/60 dark:bg-amber-800/40 border border-amber-300 dark:border-amber-700">
              <Loader2 className="h-4 w-4 animate-spin text-amber-700 dark:text-amber-400" />
              <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {language === 'en' ? 'Waiting for frontend registration' : 'Warten auf Frontend-Registrierung'}
              </span>
            </div>
          </div>

          <div className="text-center space-y-3 max-w-2xl mx-auto">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-200/50 dark:bg-amber-800/30 mb-2">
              <Sparkles className="h-8 w-8 text-amber-600 dark:text-amber-400" />
            </div>
            <h2 className="text-2xl font-bold text-amber-900 dark:text-amber-100">
              {language === 'en' ? `Register a Frontend for "${schema.name}"` : `Frontend für „${schema.name}" registrieren`}
            </h2>
            <p className="text-amber-800/80 dark:text-amber-200/70 leading-relaxed">
              {language === 'en'
                ? 'Use the specification URL and registration code below to build and connect the frontend for this schema. Once the frontend registers successfully, this screen updates automatically.'
                : 'Verwende die Spec-URL und den Registrierungscode unten, um das Frontend für dieses Schema zu bauen und zu verbinden. Sobald sich das Frontend erfolgreich registriert, aktualisiert sich dieser Bildschirm automatisch.'}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white/60 dark:bg-black/20 rounded-xl p-5 border border-amber-200/80 dark:border-amber-700/40 space-y-3">
              <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm flex items-center gap-2">
                <Play className="h-4 w-4" />
                {language === 'en' ? 'Registration Code' : 'Registrierungscode'}
              </h3>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-white/80 dark:bg-black/30 px-3 py-2 rounded font-mono text-base tracking-wider text-center text-amber-900 dark:text-amber-200 select-all">
                  {schema.registration_code}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  className="border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30 h-9 w-9"
                  onClick={() => handleCopy(schema.registration_code || '', 'registration-code')}
                >
                  {copiedValue === 'registration-code'
                    ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                    : <Copy className="h-4 w-4 text-amber-700 dark:text-amber-400" />}
                </Button>
              </div>
              <p className="text-xs text-amber-800/70 dark:text-amber-300/60">
                {language === 'en'
                  ? 'Your frontend must send this exact code when calling the registration endpoint.'
                  : 'Dein Frontend muss genau diesen Code beim Registrierungsendpunkt mitsenden.'}
              </p>
            </div>

            <div className="bg-white/60 dark:bg-black/20 rounded-xl p-5 border border-amber-200/80 dark:border-amber-700/40 space-y-3">
              <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {language === 'en' ? 'Schema Specification URL' : 'Schema-Spezifikations-URL'}
              </h3>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-white/80 dark:bg-black/30 px-3 py-2 rounded font-mono text-xs text-amber-900 dark:text-amber-200 select-all break-all">
                  {specUrl}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  className="border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30 h-9 w-9"
                  onClick={() => handleCopy(specUrl, 'spec-url')}
                >
                  {copiedValue === 'spec-url'
                    ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                    : <Copy className="h-4 w-4 text-amber-700 dark:text-amber-400" />}
                </Button>
              </div>
              <p className="text-xs text-amber-800/70 dark:text-amber-300/60">
                {language === 'en'
                  ? 'Share this URL with your AI agent or developer. It contains the full schema definition, instructions, and registration payload details.'
                  : 'Teile diese URL mit deinem KI-Agenten oder Entwickler. Sie enthält die vollständige Schema-Definition, Anweisungen und Details zum Registrierungspayload.'}
              </p>
            </div>
          </div>

          <div className="bg-white/60 dark:bg-black/20 rounded-xl p-5 border border-amber-200/80 dark:border-amber-700/40 space-y-3">
            <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm flex items-center gap-2">
              <Globe className="h-4 w-4" />
              {language === 'en' ? 'Registration Endpoint' : 'Registrierungs-Endpunkt'}
            </h3>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white/80 dark:bg-black/30 px-3 py-2 rounded font-mono text-xs text-amber-900 dark:text-amber-200 select-all break-all">
                {registerUrl}
              </code>
              <Button
                variant="outline"
                size="icon"
                className="border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30 h-9 w-9"
                onClick={() => handleCopy(registerUrl, 'register-url')}
              >
                {copiedValue === 'register-url'
                  ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                  : <Copy className="h-4 w-4 text-amber-700 dark:text-amber-400" />}
              </Button>
            </div>
            <p className="text-xs text-amber-800/70 dark:text-amber-300/60">
              {language === 'en'
                ? 'This is the endpoint your deployed frontend must call once to finish registration.'
                : 'Dies ist der Endpunkt, den dein deploytes Frontend einmal aufrufen muss, um die Registrierung abzuschließen.'}
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              {language === 'en' ? 'Example Agent Prompt' : 'Beispiel-Prompt für den Agenten'}
            </h3>

            <div className="flex items-center gap-2">
              <span className="text-xs text-amber-800/70 dark:text-amber-300/60 shrink-0">
                {language === 'en' ? 'Framework:' : 'Framework:'}
              </span>
              <div className="flex gap-1 p-1 rounded-lg bg-amber-100/60 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/50">
                <button
                  type="button"
                  onClick={() => setSelectedFramework('nextjs')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                    selectedFramework === 'nextjs'
                      ? 'bg-white dark:bg-amber-800/60 text-amber-900 dark:text-amber-100 shadow-sm'
                      : 'text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200'
                  }`}
                >
                  Next.JS
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedFramework('sveltekit')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                    selectedFramework === 'sveltekit'
                      ? 'bg-white dark:bg-amber-800/60 text-amber-900 dark:text-amber-100 shadow-sm'
                      : 'text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200'
                  }`}
                >
                  SvelteKit
                </button>
              </div>
            </div>

            <div className="relative">
              <pre className="bg-white/70 dark:bg-black/30 border border-amber-200 dark:border-amber-700/50 p-4 rounded-lg text-xs font-mono text-amber-900/90 dark:text-amber-200/80 whitespace-pre-wrap leading-relaxed overflow-auto max-h-72">
{agentPrompt}
              </pre>
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2 h-7 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-800/30"
                onClick={() => handleCopy(agentPrompt, 'agent-prompt')}
              >
                {copiedValue === 'agent-prompt'
                  ? <CheckCircle2 className="h-3 w-3 mr-1 text-green-600" />
                  : <Copy className="h-3 w-3 mr-1" />}
                {language === 'en' ? 'Copy' : 'Kopieren'}
              </Button>
            </div>
          </div>

          <Alert className="border-amber-300 bg-white/60 dark:bg-black/20 dark:border-amber-700/40">
            <Info className="h-4 w-4 text-amber-700 dark:text-amber-400" />
            <AlertTitle className="text-amber-900 dark:text-amber-200">
              {language === 'en' ? 'Registration flow' : 'Registrierungsablauf'}
            </AlertTitle>
            <AlertDescription className="text-amber-800/80 dark:text-amber-300/70 space-y-1">
              <p>{language === 'en' ? '1. Build and deploy the frontend using the specification URL.' : '1. Baue und deploye das Frontend mit der Spec-URL.'}</p>
              <p>{language === 'en' ? '2. POST the registration payload to the registration endpoint shown above.' : '2. Sende das Registrierungspayload per POST an den oben gezeigten Registrierungs-Endpunkt.'}</p>
              <p>{language === 'en' ? '3. This screen polls automatically and switches to success once the schema is registered.' : '3. Dieser Bildschirm pollt automatisch und wechselt zum Erfolgszustand, sobald das Schema registriert ist.'}</p>
            </AlertDescription>
          </Alert>
        </div>
      </div>

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
