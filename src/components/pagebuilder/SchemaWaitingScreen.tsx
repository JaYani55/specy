import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, Copy, CheckCircle2, XCircle, ExternalLink, Globe, Sparkles, Play, FileText, Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { cancelSchemaRegistration, getSchemaRegistrationStatus } from '@/services/pageService';
import { getSchemaSpecBundle } from '@/services/specService';
import type { PageSchema } from '@/types/pagebuilder';
import type { SchemaSpecBundle } from '@/types/specs';
import { useTheme } from '@/contexts/ThemeContext';
import { toast } from 'sonner';
import { API_URL } from '@/lib/apiUrl';
import { getExpectedSlugStructure, normalizeSchemaIntegrationRequirements } from '@/utils/schemaRouting';

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
  const [selectedFramework, setSelectedFramework] = useState<'nextjs' | 'astro'>('nextjs');
  const [schemaSpecBundle, setSchemaSpecBundle] = useState<SchemaSpecBundle | null>(null);

  const specUrl = `${API_URL}/api/schemas/${schema.slug}/spec.txt`;
  const specJsonUrl = `${API_URL}/api/schemas/${schema.slug}/spec`;
  const specsUrl = `${API_URL}/api/specs`;
  const schemaBundleUrl = `${API_URL}/api/specs/schema/${schema.slug}`;
  const pagesUrl = `${API_URL}/api/schemas/${schema.slug}/pages`;
  const registerUrl = `${API_URL}/api/schemas/${schema.slug}/register`;
  const integrationRequirements = normalizeSchemaIntegrationRequirements(schema.integration_requirements);
  const expectedSlugStructure = getExpectedSlugStructure(schema);

  useEffect(() => {
    getSchemaSpecBundle(schema.slug)
      .then(setSchemaSpecBundle)
      .catch(() => setSchemaSpecBundle(null));
  }, [schema.slug]);

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

    let prompt = `You are building a ${isNext ? 'Next.js (App Router)' : 'Astro SSR on Cloudflare Workers'} frontend for the Specy schema "${schema.name}".

  Schema slug: ${schema.slug}
  Unified spec discovery URL: ${specsUrl}
  Schema tool bundle URL: ${schemaBundleUrl}
  Specification URL: ${specUrl}
  Machine-readable spec URL: ${specJsonUrl}
  Published pages API: ${pagesUrl}
  Registration URL: ${registerUrl}
  Registration code: ${schema.registration_code}

  Non-negotiable constraints:
  - Frontend target model: a schema may expose a collection slot, an optional detail page, or both.
  ${expectedSlugStructure === '/' ? '- This schema is collection-oriented and uses the host path /; it does not require a :slug route.' : `- Legacy/detail route shape: ${expectedSlugStructure}`}
  - Route ownership policy: ${integrationRequirements.route_ownership}
  - Page discovery mode: ${integrationRequirements.page_discovery_mode}
  - Canonical frontend URL: ${integrationRequirements.canonical_frontend_url || 'Not fixed by schema'}
  - Temporary domains allowed: ${integrationRequirements.allow_temporary_frontend_urls ? 'yes' : 'no'}

  1. Fetch the full schema specification first:
    GET ${specsUrl}
    GET ${schemaBundleUrl}
    GET ${specUrl}
    Also fetch the machine-readable spec if you need to script against it:
    GET ${specJsonUrl}

  2. Read published pages from the schema-scoped pages endpoint unless explicitly instructed otherwise:
    GET ${pagesUrl}

  3. Support ContentBlock arrays as defined in the spec.
    ContentBlock types:
    - text
    - heading
    - image
    - quote
    - list
    - video
    - form
    - audio
  `;

     if (isNext) {
      prompt += `
  4. Implement ISR in Next.js App Router.
      - Implement a collection host route and/or detail route only for the registered targets.
    - Expose POST /api/revalidate?path=<full-server-path>
    - Read Authorization: Bearer <secret> for authentication
      - Revalidate the full route path from the incoming path query parameter.
  `;
     } else {
      prompt += `
    4. Implement request-time SSR and revalidation in Astro.
      - Implement a collection host route and/or detail route only for the registered targets.
      - Use output: 'server' with @astrojs/cloudflare and do not use getStaticPaths().
      - Expose POST /api/revalidate?path=<full-server-path> from src/pages/api/revalidate.ts.
      - Read Authorization: Bearer <secret> for authentication and return 401 for invalid credentials.
      - Fetch published Specy pages at request time so new slugs work without a redeploy.
  `;
     }

     if (integrationRequirements.content_scope === 'single-page') {
      prompt += `
    4.5 SINGLE-PAGE CONTRACT
      - This schema is single-page content.
      - Render the existing host path ${integrationRequirements.page_target?.host_path || '/'}.
      - Do not create a [slug] route and do not call create_page for this schema.
      - Preserve the exact content keys, including Content, Code Block, author-name, and author-picture when present.
    `;
     } else {
      prompt += `
    4.5 PAGE-COLLECTION CONTRACT
      - This schema contains multiple page records.
      - Render the registered collection host path and detail route only when targets define them.
      - New published slugs must resolve without a frontend rebuild when the frontend requirement is no-deploy publishing.
    `;
     }

     prompt += `
  5. Register the deployed frontend once it is live:
    POST ${registerUrl}
    Content-Type: application/json

    {
      "code": "${schema.registration_code}",
      "frontend_url": "${integrationRequirements.canonical_frontend_url || 'https://your-site.com'}",
      "revalidation_endpoint": "/api/revalidate",
      "revalidation_secret": "REQUIRED_GENERATE_A_STRONG_RANDOM_SECRET",
      "targets": [
        ${expectedSlugStructure === '/' ? '{ "target_key": "home.content", "kind": "collection-slot", "host_path": "/", "placement_key": "home.content" }' : `{ "target_key": "default", "kind": "detail-page", "host_path": "${expectedSlugStructure}" }`}
      ]
    }

  6. The revalidation_secret is REQUIRED. Generate a strong random secret, send it in this registration request, and configure the exact same value in the frontend's revalidation endpoint. Registration must not be attempted without it. A placement_key is a semantic component contract, not a CSS selector or DOM query. Do not register #posts; fragments are client-side only and server invalidation must target /.

  7. Do not register the frontend until the final deployed domain is healthy.
    ${integrationRequirements.allow_temporary_frontend_urls
      ? '- Temporary preview domains are allowed by this schema, but production is still preferred.'
      : `- Temporary preview domains are not allowed. Register only ${integrationRequirements.canonical_frontend_url || 'the canonical production URL'}.`}

  8. Existing route policy:
    ${integrationRequirements.route_ownership === 'isolated'
      ? '- Keep the new frontend isolated to the configured route segment. Do not replace unrelated dynamic routes.'
      : integrationRequirements.route_ownership === 'shared-layout-only'
        ? '- Existing routes may only be touched for shared layout or styling concerns.'
        : '- Existing routes may be modified if necessary, but preserve the final public route shape.'}

  9. Health checks expect the deployed domain to respond successfully.
  `;

     return prompt;
    }, [
      expectedSlugStructure,
      integrationRequirements.allow_temporary_frontend_urls,
      integrationRequirements.canonical_frontend_url,
      integrationRequirements.page_discovery_mode,
      integrationRequirements.route_ownership,
      pagesUrl,
      registerUrl,
      schema.name,
      schema.registration_code,
      schema.slug,
      schemaBundleUrl,
      selectedFramework,
      specJsonUrl,
      specUrl,
      specsUrl,
      integrationRequirements.content_scope,
      integrationRequirements.page_target?.host_path,
    ]);

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
                ? 'Use the unified Specs discovery endpoint, the schema tool bundle, and the registration code below to build and connect the frontend for this schema. Once the frontend registers successfully, this screen updates automatically.'
                : 'Verwende den vereinheitlichten Specs-Discovery-Endpunkt, das Schema-Tool-Bundle und den Registrierungscode unten, um das Frontend für dieses Schema zu bauen und zu verbinden. Sobald sich das Frontend erfolgreich registriert, aktualisiert sich dieser Bildschirm automatisch.'}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white/60 dark:bg-black/20 rounded-xl p-5 border border-amber-200/80 dark:border-amber-700/40 space-y-3">
              <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {language === 'en' ? 'Unified Discovery' : 'Vereinheitlichte Discovery'}
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white/80 dark:bg-black/30 px-3 py-2 rounded font-mono text-xs break-all">{specsUrl}</code>
                  <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => handleCopy(specsUrl, 'specs-url')}>
                    {copiedValue === 'specs-url'
                      ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                      : <Copy className="h-4 w-4 text-amber-700 dark:text-amber-400" />}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white/80 dark:bg-black/30 px-3 py-2 rounded font-mono text-xs break-all">{schemaBundleUrl}</code>
                  <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => handleCopy(schemaBundleUrl, 'schema-bundle-url')}>
                    {copiedValue === 'schema-bundle-url'
                      ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                      : <Copy className="h-4 w-4 text-amber-700 dark:text-amber-400" />}
                  </Button>
                </div>
                {schemaSpecBundle?.main_spec && (
                  <p className="text-xs text-amber-800/70 dark:text-amber-300/70">
                    {language === 'en'
                      ? `Main spec: ${schemaSpecBundle.main_spec.name} (${schemaSpecBundle.main_spec.slug})`
                      : `Haupt-Spec: ${schemaSpecBundle.main_spec.name} (${schemaSpecBundle.main_spec.slug})`}
                  </p>
                )}
              </div>
            </div>

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
              <Info className="h-4 w-4" />
              {language === 'en' ? 'Schema Contract' : 'Schema-Vertrag'}
            </h3>
            <div className="grid gap-2 text-sm text-amber-900 dark:text-amber-200">
              <p><strong>{language === 'en' ? 'Route shape:' : 'Routenform:'}</strong> {expectedSlugStructure}</p>
              <p><strong>{language === 'en' ? 'Route ownership:' : 'Routen-Verantwortung:'}</strong> {integrationRequirements.route_ownership}</p>
              <p><strong>{language === 'en' ? 'Canonical domain:' : 'Kanonische Domain:'}</strong> {integrationRequirements.canonical_frontend_url || 'Not fixed'}</p>
              <p><strong>{language === 'en' ? 'Temporary domains:' : 'Temporäre Domains:'}</strong> {integrationRequirements.allow_temporary_frontend_urls ? 'Allowed' : 'Blocked'}</p>
              <p><strong>{language === 'en' ? 'Page discovery:' : 'Seitenermittlung:'}</strong> {integrationRequirements.page_discovery_mode}</p>
              {integrationRequirements.registration_notes && (
                <p><strong>{language === 'en' ? 'Registration notes:' : 'Registrierungsnotizen:'}</strong> {integrationRequirements.registration_notes}</p>
              )}
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
                  onClick={() => setSelectedFramework('astro')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                    selectedFramework === 'astro'
                      ? 'bg-white dark:bg-amber-800/60 text-amber-900 dark:text-amber-100 shadow-sm'
                      : 'text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200'
                  }`}
                >
                  Astro
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
