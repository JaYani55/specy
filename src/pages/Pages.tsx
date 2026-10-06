import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, FileText, Globe, Clock, CheckCircle2, AlertCircle, Eye, EyeOff,
  Loader2, Copy, ExternalLink, Sparkles, ArrowRight, ChevronDown, ChevronRight, Play, Trash2,
  Building2, Pencil,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { getSchemas, groupSchemasByTLD, checkDomainHealthDirect, startSchemaRegistration, unhookSchema, getAdminPageDomains, updateAdminPageDomain } from '@/services/pageService';
import type { PageSchema, TLDGroup, TLDRegistryEntry } from '@/types/pagebuilder';
import { useTheme } from '@/contexts/ThemeContext';
import { useFeatureFlags } from '@/contexts/FeatureFlagsContext';
import { useActiveWorkspace } from '@/contexts/ActiveWorkspaceContext';
import { usePermissions } from '@/hooks/usePermissions';
import { toast } from 'sonner';
import AgentLogs from '@/components/pagebuilder/AgentLogs';
import { API_URL } from '@/lib/apiUrl';
import { getVisibleTenantNameMap, getVisibleTenants } from '@/services/tenantService';
import { getSchemaConsolePath } from '@/utils/schemaPaths';
import { isPreviewConfigured } from '@/utils/schemaRouting';

const statusConfig: Record<string, { label: { en: string; de: string }; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ElementType }> = {
  pending: { label: { en: 'Pending', de: 'Ausstehend' }, variant: 'secondary', icon: Clock },
  waiting: { label: { en: 'Waiting', de: 'Wartet' }, variant: 'outline', icon: Loader2 },
  registered: { label: { en: 'Active', de: 'Aktiv' }, variant: 'default', icon: CheckCircle2 },
  archived: { label: { en: 'Archived', de: 'Archiviert' }, variant: 'destructive', icon: AlertCircle },
};

// ─── Onboarding Empty State ─────────────────────────────────────────────────

interface OnboardingScreenProps {
  language: string;
  schemas: PageSchema[];
  tenantNames: Record<string, string>;
  onCreateSchema: () => void;
  onNavigateSchema: (schema: PageSchema) => void;
  onRefresh: () => void;
}

const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ language, schemas, tenantNames, onCreateSchema, onNavigateSchema, onRefresh }) => {
  const [copied, setCopied] = useState(false);
  const [startingRegId, setStartingRegId] = useState<string | null>(null);
  const [selectedFramework, setSelectedFramework] = useState<'nextjs' | 'astro'>('nextjs');
  const [showTechnical, setShowTechnical] = useState(false);
  const { isFeatureFlagEnabled } = useFeatureFlags();
  const isDevMode = isFeatureFlagEnabled('devMode');

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(language === 'en' ? 'Copied!' : 'Kopiert!');
    } catch {
      toast.error('Copy failed');
    }
  };

  const handleStartRegistration = async (schemaId: string) => {
    setStartingRegId(schemaId);
    try {
      await startSchemaRegistration(schemaId);
      toast.success(language === 'en' ? 'Registration started — code generated' : 'Registrierung gestartet — Code generiert');
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start registration');
    } finally {
      setStartingRegId(null);
    }
  };

  // Build dynamic prompt that includes registration codes for waiting schemas
  const waitingSchemas = schemas.filter(s => s.registration_status === 'waiting');

  const buildPrompt = (framework: 'nextjs' | 'astro') => {
    const isNext = framework === 'nextjs';

    // ── Section: discovery ──────────────────────────────────────────────────
    let prompt = `You are building a ${isNext ? 'Next.js (App Router)' : 'Astro SSR on Cloudflare Workers'} frontend for Specy.

════════════════════════════════════════════════════
  1. DISCOVERY
════════════════════════════════════════════════════

Start by fetching the schema index:
  GET ${API_URL}/api/schemas

Response shape:
  {
    service: "specy-api",
    mcp_endpoint: "${API_URL}/mcp",
    schemas: [
      {
        slug: string,           // stable API identifier (legacy schemas retain their old slug)
        schema_slug: string,     // tenant-local name, e.g. "blog"
        api_slug: string,        // use this value in /api/schemas/{api_slug}/... URLs
        tenant_slug: string | null,
        name: string,
        description: string,
        status: "pending" | "waiting" | "registered" | "archived",
        is_default: boolean,
        frontend_url: string | null,
        spec_url: "${API_URL}/api/schemas/{api_slug}/spec.txt",
        register_url: "${API_URL}/api/schemas/{api_slug}/register",
      }
    ]
  }

Pick the schema for this frontend. Then fetch its full spec:
  GET ${API_URL}/api/schemas/{api_slug}/spec.txt

The spec includes: field definitions (JSON), content block types,
LLM instructions, frontend info, and registration payload example.


════════════════════════════════════════════════════
  2. DATA MODEL  (schema-scoped Specy API)
════════════════════════════════════════════════════

Fetch pages through the schema-scoped Worker API:
  GET ${API_URL}/api/schemas/{api_slug}/pages

Do not query the Supabase pages table directly from the public frontend.
The endpoint returns only published pages after the schema is registered.

Page shape:
  {
    id: string (uuid),
    slug: string,           // URL path segment, e.g. "my-product"
    name: string,
    status: "draft" | "published" | "archived",
    content: Record<string, unknown>,  // JSONB — shape defined by schema
    domain_url: string | null,
    updated_at: string (ISO 8601),
  }

The "content" field carries ContentBlock arrays.
Each ContentBlock has { id, type } + type-specific fields:
  text    → { content: string }
  heading → { content: string, level: "heading1"…"heading6" }
  image   → { src: string, alt: string, caption?, width?, height? }
  quote   → { text: string, author?, source? }
  list    → { style: "ordered"|"unordered", items: string[] }
  video   → { src: string, provider: "youtube"|"vimeo"|"other", caption? }`;

    // ── Section: ISR ──────────────────────────────────────────────────────
    if (isNext) {
      prompt += `


════════════════════════════════════════════════════
  3. ISR SETUP  (Next.js App Router)
════════════════════════════════════════════════════

── File: app/[slug]/page.tsx ──
  export const revalidate = 60; // background ISR every 60 s

  export async function generateStaticParams() {
    const pages = await fetchPublishedPages(); // your Supabase helper
    return pages.map(p => ({ slug: p.slug }));
  }

  export default async function Page({ params }: { params: { slug: string } }) {
    const page = await fetchPageBySlug(params.slug);
    if (!page) notFound();
    return <PageRenderer page={page} />;
  }

── File: app/api/revalidate/route.ts ──
  // The CMS calls this endpoint via POST when content is saved.
  // It sends: POST /api/revalidate?path=<full-server-path>&slug=<page_slug>
  //           Authorization: Bearer <secret>

  import { revalidatePath } from 'next/cache';
  import { NextRequest, NextResponse } from 'next/server';

  export async function POST(req: NextRequest) {
    const authHeader = req.headers.get('authorization');
    const secret = authHeader?.replace(/^Bearer\\s+/i, '') ?? null;
    const path   = req.nextUrl.searchParams.get('path');   // full server path from CMS

    if (secret !== process.env.REVALIDATION_SECRET) {
      return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
    }
    if (!path) {
      return NextResponse.json({ error: 'Missing path' }, { status: 400 });
    }

    revalidatePath(path);
    return NextResponse.json({ revalidated: true, path });
  }`;
    } else {
      prompt += `


════════════════════════════════════════════════════
  3. SSR SETUP  (Astro + Cloudflare Workers)
════════════════════════════════════════════════════

  output: 'server'
  adapter: cloudflare({ imageService: 'passthrough' })

── File: src/pages/blog/index.astro ──
  export const prerender = false;
  const posts = await getBlogPosts(); // request-time Specy fetch
  // Render /blog and link each post to /blog/{post.slug}.

── File: src/pages/blog/[slug].astro ──
  export const prerender = false;
  // Fetch current published pages and find Astro.params.slug.
  // Do not add getStaticPaths(); new CMS slugs must work without a build.

── File: src/pages/api/revalidate.ts ──
  // Export an ALL handler, accept POST only, and compare exactly:
  // Authorization: Bearer <registered-secret>
  // Return 401 for wrong/missing credentials and 500 if not configured.

Use npx wrangler deploy, not wrangler pages deploy dist.
For a single-page schema, render the registered host path and do not create a [slug] route.`;
    }

    // ── Section: registration ─────────────────────────────────────────────
    prompt += `


════════════════════════════════════════════════════
  4. REGISTRATION  (one-time, after deploy)
════════════════════════════════════════════════════

Once deployed, call the CMS registration endpoint from your frontend
(e.g. from a startup script, a one-off CLI command, or CI/CD pipeline):

  POST ${API_URL}/api/schemas/{api_slug}/register
  Content-Type: application/json

  {
    "code": "<registration_code>",          // shown in CMS
    "frontend_url": "https://your-site.com",
    "revalidation_endpoint": "/api/revalidate",
    "revalidation_secret": "<REQUIRED_STRONG_RANDOM_SECRET>", // required; stored encrypted by the CMS
    "targets": [
      { "target_key": "home.posts", "kind": "collection-slot", "host_path": "/", "placement_key": "home.posts" },
      { "target_key": "posts.detail", "kind": "detail-page", "host_path": "/posts/:slug" }
    ]
  }

Success response (200):
  {
    "success": true,
    "message": "Schema registration completed successfully",
    "schema": { "slug": "...", "frontend_url": "...", "targets": [/* enabled targets */] }
  }

After registration the CMS will:
  • Set schema status → "registered"
  • Show the domain in the Pages dashboard with a health ping
  • Call POST {frontend_url}{revalidation_endpoint}?path={full_server_path}&slug={page_slug}
    with Authorization: Bearer {shared_secret}
    whenever content for this schema is published or updated`;

    // ── Section: frontend targets ─────────────────────────────────────────
    prompt += `


════════════════════════════════════════════════════
  4.5 SLUG STRUCTURE & PREVIEW URLS
════════════════════════════════════════════════════

Frontend targets describe where schema content is rendered. A collection-slot
uses a concrete host path and semantic placement_key. A detail-page target
uses a path pattern where ":slug" is replaced by the page slug.

Examples:
  "/:slug"              → https://your-site.com/my-page
  "/blog/:slug"         → https://your-site.com/blog/my-post
  "/products/:slug"     → https://your-site.com/products/my-product
  "/de/produkte/:slug"  → https://your-site.com/de/produkte/my-product

── How to choose a target ──
1. For content rendered inside an existing landing page, use for example:
  { "kind": "collection-slot", "host_path": "/", "placement_key": "home.posts" }
  The frontend may link to /#posts, but the fragment is client-side only.
2. For an optional detail route, inspect your ${isNext ? 'Next.js' : 'Astro'} file-system routing:
  - ${isNext ? 'app/[slug]/page.tsx' : 'src/pages/[slug].astro'} → use "/:slug"
  - ${isNext ? 'app/blog/[slug]/page.tsx' : 'src/pages/blog/[slug].astro'} → use "/blog/:slug"
3. Include the targets in your registration POST body (see step 4).
4. The CMS Page Builder shows an entry preview only when a detail-page target exists.

If the schema defines a fixed route segment like "/docs", keep the frontend isolated there and do not repurpose unrelated dynamic routes.

── Preview slug for draft pages ──
The CMS saves pages as "draft" by default. To preview before publishing:
${isNext ? `  • Add a ?draft=true query param and check it in your page component
  • Or expose a dedicated preview route: app/preview/[slug]/page.tsx
  • Optionally add a secret: app/api/preview/route.ts → sets a preview cookie` : `  • Read ?draft=true in the Astro server page
  • Or add a preview route: src/pages/preview/[slug].astro
  • Keep preview credentials server-side`}

── Revalidation path format ──
The CMS calls your revalidation endpoint with:
  POST {revalidation_endpoint}?path={full_server_path}&slug={page_slug}
  Authorization: Bearer {secret}

Here "path" is the full server path (e.g. "/blog/my-page" or "/" for a collection slot).
Fragments such as "#posts" are never sent to the CMS or used for invalidation.
The optional "slug" query parameter still carries the bare page slug for compatibility.`;

    // ── Section: health ───────────────────────────────────────────────────
    prompt += `


════════════════════════════════════════════════════
  5. HEALTH CHECK
════════════════════════════════════════════════════

The CMS monitors your domain via:
  GET ${API_URL}/api/schemas/{api_slug}/health

Response: { status: "online"|"offline", latency_ms: number, http_status: number }

Your frontend must respond with HTTP 200 to HEAD / for the health check.`;

    // ── Section: MCP ──────────────────────────────────────────────────────
    prompt += `


════════════════════════════════════════════════════
  6. MCP AGENT INTEGRATION  (optional)
════════════════════════════════════════════════════

Connect an AI agent to the MCP endpoint for tool-based interaction:
  ${API_URL}/mcp

Available MCP tools:
  list_schemas      — list all schemas with spec + register URLs
  get_schema_spec   — full spec for a schema by slug
  register_frontend — register a deployed frontend (same as step 4)
  check_health      — ping a frontend domain URL`;

    // ── Active registration codes ─────────────────────────────────────────
    if (waitingSchemas.length > 0) {
      prompt += '\n\n\n════════════════════════════════════════════════════';
      prompt += '\n  ACTIVE REGISTRATION CODES';
      prompt += '\n════════════════════════════════════════════════════';
      for (const s of waitingSchemas) {
        prompt += `\n\nSchema : ${s.name}  (${s.slug})`;
        prompt += `\n  Code  : ${s.registration_code}`;
        prompt += `\n  Spec  : ${API_URL}/api/schemas/${s.api_slug}/spec.txt`;
        prompt += `\n  POST  : ${API_URL}/api/schemas/${s.api_slug}/register`;
      }
    }

    return prompt;
  };

  const dynamicPrompt = buildPrompt(selectedFramework);

  return (
    <div className="container mx-auto py-8 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">
          {language === 'en' ? 'Pages' : 'Seiten'}
        </h1>
        <p className="text-muted-foreground">
          {language === 'en'
            ? 'Manage page schemas and content across your frontends'
            : 'Verwalte Seitenschemas und Inhalte für deine Frontends'}
        </p>
      </div>

      {/* Pending Onboarding Card */}
      <div className="relative overflow-hidden rounded-2xl border-2 border-amber-400/60 bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 dark:from-amber-950/40 dark:via-orange-950/30 dark:to-yellow-950/20 dark:border-amber-600/40">
        {/* Decorative pattern */}
        <div className="absolute inset-0 opacity-[0.04] dark:opacity-[0.06]" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23f59e0b' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />

        <div className="relative p-8 space-y-8">
          {/* Status indicator */}
          <div className="flex items-center justify-center">
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-200/60 dark:bg-amber-800/40 border border-amber-300 dark:border-amber-700">
              <Clock className="h-4 w-4 text-amber-700 dark:text-amber-400" />
              <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {language === 'en' ? 'No frontends connected yet' : 'Noch keine Frontends verbunden'}
              </span>
            </div>
          </div>

          {/* Main instruction */}
          <div className="text-center space-y-3 max-w-2xl mx-auto">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-200/50 dark:bg-amber-800/30 mb-2">
              <Sparkles className="h-8 w-8 text-amber-600 dark:text-amber-400" />
            </div>
            <h2 className="text-2xl font-bold text-amber-900 dark:text-amber-100">
              {language === 'en' ? 'Connect a Frontend to Get Started' : 'Verbinde ein Frontend, um loszulegen'}
            </h2>
            <p className="text-amber-800/80 dark:text-amber-200/70 leading-relaxed">
              {language === 'en'
                ? 'The CMS manages pages for your frontends. Each frontend runs on its own domain (TLD) and can serve multiple page schemas. Connect your first domain to start creating and publishing content.'
                : 'Das CMS verwaltet Seiten für deine Frontends. Jedes Frontend läuft auf einer eigenen Domain (TLD) und kann mehrere Seitenschemas bedienen. Verbinde deine erste Domain, um Inhalte zu erstellen und zu veröffentlichen.'}
            </p>
          </div>

          {/* Hint for technical users (only shown when developer mode is enabled) */}
          {isDevMode && (
          <p className="text-center text-xs text-amber-700/80 dark:text-amber-300/60">
            {language === 'en'
              ? 'Developer or working with an AI agent? Open the “Technical Documentation” below for API endpoints and a ready-to-use agent prompt.'
              : 'Entwickler oder mit einem KI-Agenten unterwegs? Öffne unten die „Technische Dokumentation“ für API-Endpunkte und einen einsatzbereiten Agenten-Prompt.'}
          </p>
          )}

          {/* Steps */}
          <div className="space-y-3">
            <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm">
              {language === 'en' ? 'How to Connect' : 'So verbindest du ein Frontend'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="bg-white/60 dark:bg-black/20 rounded-xl p-4 border border-amber-200/80 dark:border-amber-700/40 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="h-6 w-6 rounded-full p-0 flex items-center justify-center border-amber-400 text-amber-700 dark:text-amber-400 text-xs font-bold">1</Badge>
                <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm">
                  {language === 'en' ? 'Pick a Schema' : 'Schema wählen'}
                </h3>
              </div>
              <p className="text-xs text-amber-800/70 dark:text-amber-300/60">
                {language === 'en'
                  ? 'Use a default schema below or create a custom one with your own fields and sections.'
                  : 'Nutze ein Standard-Schema unten oder erstelle ein eigenes mit deinen Feldern und Abschnitten.'}
              </p>
            </div>
            <div className="bg-white/60 dark:bg-black/20 rounded-xl p-4 border border-amber-200/80 dark:border-amber-700/40 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="h-6 w-6 rounded-full p-0 flex items-center justify-center border-amber-400 text-amber-700 dark:text-amber-400 text-xs font-bold">2</Badge>
                <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm">
                  {language === 'en' ? 'Start Registration' : 'Registrierung starten'}
                </h3>
              </div>
              <p className="text-xs text-amber-800/70 dark:text-amber-300/60">
                {language === 'en'
                  ? 'Open the schema and click "Start Registration". You\'ll get a spec URL and a registration code.'
                  : 'Öffne das Schema und klicke auf „Registrierung starten". Du erhältst eine Spec-URL und einen Registrierungscode.'}
              </p>
            </div>
            <div className="bg-white/60 dark:bg-black/20 rounded-xl p-4 border border-amber-200/80 dark:border-amber-700/40 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="h-6 w-6 rounded-full p-0 flex items-center justify-center border-amber-400 text-amber-700 dark:text-amber-400 text-xs font-bold">3</Badge>
                <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm">
                  {language === 'en' ? 'Build & Deploy' : 'Bauen & Deployen'}
                </h3>
              </div>
              <p className="text-xs text-amber-800/70 dark:text-amber-300/60">
                {language === 'en'
                  ? 'Give the spec URL to an AI agent or developer. They build a Next.js or Astro SSR frontend and deploy it to a domain.'
                  : 'Gib die Spec-URL an einen KI-Agenten oder Entwickler. Dieser baut ein Next.js- oder Astro-SSR-Frontend und deployed es auf eine Domain.'}
              </p>
            </div>
            <div className="bg-white/60 dark:bg-black/20 rounded-xl p-4 border border-amber-200/80 dark:border-amber-700/40 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="h-6 w-6 rounded-full p-0 flex items-center justify-center border-amber-400 text-amber-700 dark:text-amber-400 text-xs font-bold">4</Badge>
                <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm">
                  {language === 'en' ? 'Register Domain' : 'Domain registrieren'}
                </h3>
              </div>
              <p className="text-xs text-amber-800/70 dark:text-amber-300/60">
                {language === 'en'
                  ? 'The frontend POSTs its domain URL + registration code to the API. The TLD appears here with a health ping.'
                  : 'Das Frontend sendet seine Domain-URL + Registrierungscode an die API. Die TLD erscheint hier mit Health-Ping.'}
              </p>
            </div>
            </div>
          </div>

          {/* Technical documentation — only visible with the "devMode" feature flag */}
          {isDevMode && (
            <>
          <Separator className="bg-amber-200/60 dark:bg-amber-700/30" />

          <Collapsible open={showTechnical} onOpenChange={setShowTechnical} className="space-y-6">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-200 transition-colors"
              >
                {showTechnical ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {language === 'en' ? 'Technical Documentation' : 'Technische Dokumentation'}
                <span className="text-xs font-normal text-amber-700/70 dark:text-amber-400/60">
                  {language === 'en' ? '— for developers & AI agents' : '— für Entwickler & KI-Agenten'}
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-8">

          {/* What is a TLD section */}
          <div className="bg-white/60 dark:bg-black/20 rounded-xl p-5 border border-amber-200/80 dark:border-amber-700/40 space-y-3">
            <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm flex items-center gap-2">
              <Globe className="h-4 w-4" />
              {language === 'en' ? 'How Domains (TLDs) Work' : 'Wie Domains (TLDs) funktionieren'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-amber-800/80 dark:text-amber-200/70 leading-relaxed">
              <div className="space-y-2">
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  {language === 'en' ? 'One domain = one frontend app' : 'Eine Domain = eine Frontend-App'}
                </p>
                <p>
                  {language === 'en'
                    ? 'Each TLD (e.g. example.com, blog.yoursite.de) represents one deployed frontend. The CMS sends content to it and monitors its health.'
                    : 'Jede TLD (z.B. example.com, blog.deinsite.de) repräsentiert ein deployed Frontend. Das CMS sendet Inhalte dorthin und überwacht die Erreichbarkeit.'}
                </p>
              </div>
              <div className="space-y-2">
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  {language === 'en' ? 'Multiple schemas per domain' : 'Mehrere Schemas pro Domain'}
                </p>
                <p>
                  {language === 'en'
                    ? 'A single domain can handle multiple schemas (e.g. product pages + blog posts). All schemas sharing a domain are grouped together and share one health ping.'
                    : 'Eine Domain kann mehrere Schemas bedienen (z.B. Produktseiten + Blogbeiträge). Alle Schemas einer Domain werden gruppiert und teilen sich einen Health-Ping.'}
                </p>
              </div>
            </div>
          </div>

          {/* API Endpoints */}
          <div className="space-y-3">
            <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm flex items-center gap-2">
              <Globe className="h-4 w-4" />
              {language === 'en' ? 'Your API Endpoints' : 'Deine API-Endpunkte'}
            </h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] h-5 border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-400 shrink-0">
                  REST
                </Badge>
                <code className="flex-1 bg-white/70 dark:bg-black/30 border border-amber-200 dark:border-amber-700/50 px-4 py-2 rounded-lg text-sm font-mono text-amber-900 dark:text-amber-200 select-all">
                  {API_URL}/api/schemas
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  className="border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30 h-8 w-8"
                  onClick={() => handleCopy(`${API_URL}/api/schemas`)}
                >
                  {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] h-5 border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-400 shrink-0">
                  MCP
                </Badge>
                <code className="flex-1 bg-white/70 dark:bg-black/30 border border-amber-200 dark:border-amber-700/50 px-4 py-2 rounded-lg text-sm font-mono text-amber-900 dark:text-amber-200 select-all">
                  {API_URL}/mcp
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  className="border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30 h-8 w-8"
                  onClick={() => handleCopy(`${API_URL}/mcp`)}
                >
                  {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />}
                </Button>
              </div>
              <p className="text-xs text-amber-800/60 dark:text-amber-300/50 mt-1">
                {language === 'en'
                  ? 'The REST endpoint returns all schemas as JSON. The MCP endpoint exposes tools for agent integration (list_schemas, get_schema_spec, register_frontend, check_health).'
                  : 'Der REST-Endpunkt liefert alle Schemas als JSON. Der MCP-Endpunkt stellt Tools für Agent-Integration bereit (list_schemas, get_schema_spec, register_frontend, check_health).'}
              </p>
            </div>
          </div>

          {/* Example Prompt */}
          <div className="space-y-3">
            <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              {language === 'en' ? 'Example Agent Prompt' : 'Beispiel-Prompt für den Agenten'}
            </h3>

            {/* Framework Toggle */}
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
              <pre className="bg-white/70 dark:bg-black/30 border border-amber-200 dark:border-amber-700/50 p-4 rounded-lg text-xs font-mono text-amber-900/90 dark:text-amber-200/80 whitespace-pre-wrap leading-relaxed overflow-auto max-h-64">
{dynamicPrompt}
              </pre>
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2 h-7 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-800/30"
                onClick={() => handleCopy(dynamicPrompt)}
              >
                <Copy className="h-3 w-3 mr-1" />
                {language === 'en' ? 'Copy' : 'Kopieren'}
              </Button>
            </div>
          </div>

            </CollapsibleContent>
          </Collapsible>
            </>
          )}

          {/* Available Schemas */}
          {schemas.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {language === 'en' ? 'Available Schemas' : 'Verfügbare Schemas'}
              </h3>
              <p className="text-xs text-amber-800/70 dark:text-amber-300/60">
                {language === 'en'
                  ? 'These schemas are ready to use. Click one to view its spec or start the registration process.'
                  : 'Diese Schemas sind einsatzbereit. Klicke auf eines, um die Spec anzuzeigen oder die Registrierung zu starten.'}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {schemas.map((schema) => {
                  const status = statusConfig[schema.registration_status] || statusConfig.pending;
                  const StatusIcon = status.icon;
                  const isPending = schema.registration_status === 'pending';
                  const isWaiting = schema.registration_status === 'waiting';
                  const isStarting = startingRegId === schema.id;
                  return (
                    <div
                      key={schema.id}
                      className="bg-white/70 dark:bg-black/30 rounded-xl p-4 border border-amber-200/80 dark:border-amber-700/40 hover:border-amber-400 dark:hover:border-amber-500 hover:shadow-md transition-all space-y-3"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2 min-w-0 cursor-pointer" onClick={() => onNavigateSchema(schema)}>
                          <FileText className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                          <span className="font-medium text-sm text-amber-900 dark:text-amber-100 truncate">{schema.name}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {schema.tenant_id && tenantNames[schema.tenant_id] && (
                            <Badge variant="outline" className="text-[10px] h-5 border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-400">
                              {tenantNames[schema.tenant_id]}
                            </Badge>
                          )}
                          {schema.is_default && (
                            <Badge variant="outline" className="text-[10px] h-5 border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-400">
                              {language === 'en' ? 'Default' : 'Standard'}
                            </Badge>
                          )}
                          <Badge
                            variant="outline"
                            className="text-[10px] h-5 border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-400"
                            title={language === 'en'
                              ? (isPreviewConfigured(schema) ? 'An explicit preview slug structure is set for this schema.' : 'No preview slug structure set for this schema.')
                              : (isPreviewConfigured(schema) ? 'Für dieses Schema ist eine explizite Vorschau-Slug-Struktur gesetzt.' : 'Für dieses Schema ist keine Vorschau-Slug-Struktur gesetzt.')}
                          >
                            {isPreviewConfigured(schema)
                              ? <Eye className="h-2.5 w-2.5 mr-1" />
                              : <EyeOff className="h-2.5 w-2.5 mr-1" />}
                            {isPreviewConfigured(schema)
                              ? (language === 'en' ? 'Preview set' : 'Vorschau gesetzt')
                              : (language === 'en' ? 'No preview' : 'Keine Vorschau')}
                          </Badge>
                          <Badge variant={status.variant} className="flex items-center gap-1 text-[10px]">
                            <StatusIcon className={`h-2.5 w-2.5 ${isWaiting ? 'animate-spin' : ''}`} />
                            {status.label[language]}
                          </Badge>
                        </div>
                      </div>
                      {schema.description && (
                        <p className="text-xs text-amber-800/60 dark:text-amber-300/50 line-clamp-2">{schema.description}</p>
                      )}

                      {/* Registration Code display for waiting schemas */}
                      {isWaiting && schema.registration_code && (
                        <div className="bg-amber-100/60 dark:bg-amber-900/20 rounded-lg p-3 border border-amber-300/50 dark:border-amber-700/30 space-y-1.5">
                          <p className="text-[10px] font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wider">
                            {language === 'en' ? 'Registration Code' : 'Registrierungscode'}
                          </p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 bg-white/80 dark:bg-black/30 px-3 py-1.5 rounded font-mono text-sm tracking-wider text-amber-900 dark:text-amber-200 select-all text-center">
                              {schema.registration_code}
                            </code>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-amber-700 dark:text-amber-400 hover:bg-amber-200/50"
                              onClick={(e) => { e.stopPropagation(); handleCopy(schema.registration_code!); }}
                            >
                              {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                            </Button>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <div className="flex items-center text-xs text-amber-600 dark:text-amber-400 font-medium cursor-pointer" onClick={() => onNavigateSchema(schema)}>
                          {language === 'en' ? 'View schema' : 'Schema ansehen'}
                          <ArrowRight className="h-3 w-3 ml-1" />
                        </div>
                        {isPending && (
                          <Button
                            size="sm"
                            className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                            disabled={isStarting}
                            onClick={(e) => { e.stopPropagation(); handleStartRegistration(schema.id); }}
                          >
                            {isStarting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
                            {language === 'en' ? 'Start Registration' : 'Registrierung starten'}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* CTA */}
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button
              variant="outline"
              size="lg"
              className="border-amber-400 dark:border-amber-600 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 min-w-[200px]"
              onClick={onCreateSchema}
            >
              <Plus className="h-5 w-5 mr-2" />
              {language === 'en' ? 'Create New Schema' : 'Neues Schema erstellen'}
            </Button>
          </div>
        </div>
      </div>

      {/* Agent Communication Logs */}
      <AgentLogs language={language} schemas={schemas} />
    </div>
  );
};

// ─── TLD Domain Card ────────────────────────────────────────────────────────

interface TLDSectionProps {
  group: TLDGroup;
  language: string;
  tenantNames: Record<string, string>;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  defaultOpen?: boolean;
  /** Super-admin TLD management: owner reassignment + arbitrary display name */
  isAdmin?: boolean;
  tenantOptions: Array<{ id: string; name: string }>;
  onUpdateDomain: (domainId: string, patch: { tenant_id?: string; display_name?: string | null }) => Promise<void>;
}

const TLDSection: React.FC<TLDSectionProps> = ({ group, language, tenantNames, onNavigate, onRefresh, defaultOpen = true, isAdmin = false, tenantOptions, onUpdateDomain }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isUnhooking, setIsUnhooking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  const handleUnhook = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(
      language === 'en'
        ? `Disconnect all schemas from "${group.domain}"? This resets their registration status to pending and removes the frontend URL, revalidation endpoint, and secret.`
        : `Alle Schemas von "${group.domain}" trennen? Dies setzt den Registrierungsstatus auf „Ausstehend" zurück und entfernt Frontend-URL, Revalidierungs-Endpunkt und Secret.`
    )) return;

    setIsUnhooking(true);
    try {
      await Promise.all(group.schemas.map(s => unhookSchema(s.api_slug)));
      onRefresh();
    } catch (err) {
      console.error('Unhook failed', err);
    } finally {
      setIsUnhooking(false);
    }
  };
  const schemaCount = group.schemas.length;
  const registeredCount = group.schemas.filter(s => s.registration_status === 'registered').length;

  const registry = group.domain_registry;
  const displayTitle = registry?.display_name
    || (group.domain ? group.domain.replace(/^https?:\/\//, '') : null);

  const handleOwnerChange = (tenantId: string) => {
    if (!registry || tenantId === registry.tenant_id) return;
    // No browser confirm — a proper dialog previews the migration scope and
    // keeps the error visible for retry (see move dialog below).
    setMoveError(null);
    setMoveTarget({
      id: tenantId,
      name: tenantOptions.find((t) => t.id === tenantId)?.name ?? tenantId,
    });
    setMoveOpen(true);
  };

  const handleConfirmMove = async () => {
    if (!registry || !moveTarget) return;
    setIsSaving(true);
    setMoveError(null);
    try {
      await onUpdateDomain(registry.id, { tenant_id: moveTarget.id });
      setMoveOpen(false);
    } catch (err) {
      // The dialog stays open so the operator can retry after moving the
      // blocking aggregates — the database error names them.
      setMoveError(
        err instanceof Error
          ? err.message
          : (language === 'en' ? 'The move failed.' : 'Die Verschiebung ist fehlgeschlagen.'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleRename = async () => {
    if (!registry) return;
    setIsSaving(true);
    try {
      // Empty input clears back to the default (the domain URL itself)
      await onUpdateDomain(registry.id, { display_name: renameValue.trim() || null });
      setRenameOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : (language === 'en' ? 'Failed to rename domain' : 'Domain konnte nicht umbenannt werden'));
    } finally {
      setIsSaving(false);
    }
  };

  const openRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(registry?.display_name ?? '');
    setRenameOpen(true);
  };

  const healthBadge = () => {
    if (!group.domain) return null;
    switch (group.health) {
      case 'online':
        return (
          <Badge variant="default" className="bg-green-600 hover:bg-green-700 flex items-center gap-1">
            <Globe className="h-3 w-3" /> ONLINE
            {group.latency_ms !== undefined && <span className="text-[10px] opacity-80">({group.latency_ms}ms)</span>}
          </Badge>
        );
      case 'offline':
        return (
          <Badge variant="destructive" className="flex items-center gap-1">
            <Globe className="h-3 w-3" /> OFFLINE
          </Badge>
        );
      case 'checking':
        return (
          <Badge variant="outline" className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> ...
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className={`${!group.domain ? 'border-dashed border-amber-300 dark:border-amber-700' : ''}`}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                {group.domain ? (
                  <div className="flex items-center gap-2">
                    <Globe className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-lg">{displayTitle}</CardTitle>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-amber-500" />
                    <CardTitle className="text-lg text-amber-700 dark:text-amber-400">
                      {language === 'en' ? 'Pending / Unassigned' : 'Ausstehend / Nicht zugeordnet'}
                    </CardTitle>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                {healthBadge()}
                <Badge variant="outline" className="text-xs">
                  {schemaCount} {schemaCount === 1 ? 'Schema' : 'Schemas'}
                  {registeredCount > 0 && ` · ${registeredCount} ${language === 'en' ? 'active' : 'aktiv'}`}
                </Badge>
                {group.domain && (
                  <a
                    href={group.domain}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                {registry && !registry.ownership_consistent && (
                  <Badge variant="destructive" className="text-[10px]">
                    {language === 'en' ? 'Mixed ownership' : 'Gemischte Zuordnung'}
                  </Badge>
                )}
                {isAdmin && registry && (
                  <div
                    className="flex items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Select
                      value={registry.tenant_id ?? ''}
                      onValueChange={handleOwnerChange}
                      disabled={isSaving}
                    >
                      <SelectTrigger className="h-7 w-[180px] text-xs">
                        <Building2 className="h-3 w-3 mr-1 shrink-0" />
                        <SelectValue
                          placeholder={language === 'en' ? 'Unassigned' : 'Nicht zugeordnet'}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {tenantOptions.map((tenant) => (
                          <SelectItem key={tenant.id} value={tenant.id} className="text-xs">
                            {tenant.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={isSaving}
                      onClick={openRename}
                      title={language === 'en' ? 'Rename domain (display name)' : 'Domain umbenennen (Anzeigename)'}
                    >
                      <Pencil className="h-3 w-3 mr-1" />
                      {language === 'en' ? 'Rename' : 'Umbenennen'}
                    </Button>
                  </div>
                )}
                {group.domain && registeredCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    disabled={isUnhooking}
                    onClick={handleUnhook}
                  >
                    {isUnhooking
                      ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      : <Trash2 className="h-3 w-3 mr-1" />}
                    {language === 'en' ? 'Unhook' : 'Trennen'}
                  </Button>
                )}
              </div>
            </div>
            {group.domain && (
              <CardDescription className="ml-11 text-xs">
                {group.domain}
              </CardDescription>
            )}
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {group.schemas.map((schema) => {
                const status = statusConfig[schema.registration_status] || statusConfig.pending;
                const StatusIcon = status.icon;

                return (
                  <Card
                    key={schema.id}
                    className="cursor-pointer hover:shadow-md transition-shadow border-muted"
                    onClick={() => onNavigate(getSchemaConsolePath(schema))}
                  >
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium text-sm truncate">{schema.name}</span>
                        </div>
                        <Badge variant={status.variant} className="flex items-center gap-1 text-[10px] shrink-0">
                          <StatusIcon className={`h-2.5 w-2.5 ${schema.registration_status === 'waiting' ? 'animate-spin' : ''}`} />
                          {status.label[language]}
                        </Badge>
                      </div>
                      {schema.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{schema.description}</p>
                      )}
                      <div className="flex items-center gap-2">
                        {schema.tenant_id && tenantNames[schema.tenant_id] && (
                          <Badge variant="outline" className="text-[10px] h-5">
                            {tenantNames[schema.tenant_id]}
                          </Badge>
                        )}
                        {schema.is_default && (
                          <Badge variant="outline" className="text-[10px] h-5">
                            {language === 'en' ? 'Default' : 'Standard'}
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className="text-[10px] h-5"
                          title={language === 'en'
                            ? (isPreviewConfigured(schema) ? 'An explicit preview slug structure is set for this schema.' : 'No preview slug structure set for this schema.')
                            : (isPreviewConfigured(schema) ? 'Für dieses Schema ist eine explizite Vorschau-Slug-Struktur gesetzt.' : 'Für dieses Schema ist keine Vorschau-Slug-Struktur gesetzt.')}
                        >
                          {isPreviewConfigured(schema)
                            ? <Eye className="h-2.5 w-2.5 mr-1" />
                            : <EyeOff className="h-2.5 w-2.5 mr-1" />}
                          {isPreviewConfigured(schema)
                            ? (language === 'en' ? 'Preview set' : 'Vorschau gesetzt')
                            : (language === 'en' ? 'No preview' : 'Keine Vorschau')}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>

      {isAdmin && registry && (
        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogContent onClick={(e) => e.stopPropagation()}>
            <DialogHeader>
              <DialogTitle>
                {language === 'en' ? 'Rename domain' : 'Domain umbenennen'}
              </DialogTitle>
              <DialogDescription>
                {language === 'en'
                  ? `Set an arbitrary display name for "${registry.domain_url}". The domain URL itself stays unchanged and remains the default assigned name — an empty name falls back to it.`
                  : `Lege einen beliebigen Anzeigenamen für "${registry.domain_url}" fest. Die Domain-URL selbst bleibt unverändert und ist der standardmäßig zugewiesene Name — ein leerer Name fällt darauf zurück.`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="page-domain-display-name">
                {language === 'en' ? 'Display name' : 'Anzeigename'}
              </Label>
              <Input
                id="page-domain-display-name"
                value={renameValue}
                maxLength={120}
                placeholder={registry.domain_url.replace(/^https?:\/\//, '')}
                onChange={(e) => setRenameValue(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" disabled={isSaving} onClick={() => setRenameOpen(false)}>
                {language === 'en' ? 'Cancel' : 'Abbrechen'}
              </Button>
              <Button size="sm" disabled={isSaving} onClick={handleRename}>
                {isSaving
                  ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  : null}
                {language === 'en' ? 'Save' : 'Speichern'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {isAdmin && registry && moveTarget && (
        <Dialog
          open={moveOpen}
          onOpenChange={(open) => {
            if (!isSaving) {
              setMoveOpen(open);
              if (!open) setMoveError(null);
            }
          }}
        >
          <DialogContent onClick={(e) => e.stopPropagation()}>
            <DialogHeader>
              <DialogTitle>
                {language === 'en' ? 'Move domain' : 'Domain verschieben'}
              </DialogTitle>
              <DialogDescription>
                {language === 'en'
                  ? `Move "${registry.domain_url}" to workspace "${moveTarget.name}"? Everything registered on the domain is migrated atomically to the target workspace — the move cannot succeed partially.`
                  : `"${registry.domain_url}" in den Arbeitsbereich "${moveTarget.name}" verschieben? Alles auf der Domain Registrierte wird atomar in den Ziel-Arbeitsbereich verschoben — eine teilweise Verschiebung gibt es nicht.`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {language === 'en' ? 'Migration scope' : 'Verschiebeumfang'}
              </p>
              <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                <li>
                  {registry.schema_count}{' '}
                  {language === 'en'
                    ? (registry.schema_count === 1 ? 'schema' : 'schemas')
                    : (registry.schema_count === 1 ? 'Schema' : 'Schemas')}
                </li>
                <li>
                  {registry.page_count ?? 0}{' '}
                  {language === 'en'
                    ? ((registry.page_count ?? 0) === 1 ? 'page' : 'pages')
                    : ((registry.page_count ?? 0) === 1 ? 'Seite' : 'Seiten')}
                </li>
                <li>
                  {registry.event_count ?? 0}{' '}
                  {language === 'en'
                    ? ((registry.event_count ?? 0) === 1 ? 'event' : 'events')
                    : ((registry.event_count ?? 0) === 1 ? 'Veranstaltung' : 'Veranstaltungen')}
                </li>
                <li>
                  {registry.product_count ?? 0}{' '}
                  {language === 'en'
                    ? ((registry.product_count ?? 0) === 1 ? 'product' : 'products')
                    : ((registry.product_count ?? 0) === 1 ? 'Produkt' : 'Produkte')}
                </li>
                <li>
                  {registry.company_count ?? 0}{' '}
                  {language === 'en'
                    ? ((registry.company_count ?? 0) === 1 ? 'company' : 'companies')
                    : ((registry.company_count ?? 0) === 1 ? 'Firma' : 'Firmen')}
                  {' — '}
                  {language === 'en' ? 'assigned to the moved events' : 'den verschobenen Veranstaltungen zugeordnet'}
                </li>
              </ul>
            </div>
            {(registry.blocking_company_names?.length ?? 0) > 0 && (
              <p className="text-xs text-destructive">
                {language === 'en'
                  ? `These companies are also used by events outside this domain and block the move: ${registry.blocking_company_names!.join(', ')}. Move those events (or their domain) to the target workspace first.`
                  : `Diese Firmen werden auch von Veranstaltungen außerhalb dieser Domain genutzt und blockieren die Verschiebung: ${registry.blocking_company_names!.join(', ')}. Verschiebe diese Veranstaltungen (oder ihre Domain) zuerst in den Ziel-Arbeitsbereich.`}
              </p>
            )}
            {moveError && (
              <p className="text-xs text-destructive whitespace-pre-wrap">{moveError}</p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                disabled={isSaving}
                onClick={() => {
                  setMoveOpen(false);
                  setMoveError(null);
                }}
              >
                {language === 'en' ? 'Cancel' : 'Abbrechen'}
              </Button>
              <Button size="sm" disabled={isSaving} onClick={handleConfirmMove}>
                {isSaving
                  ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  : null}
                {language === 'en' ? 'Move to workspace' : 'In Arbeitsbereich verschieben'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Collapsible>
  );
};

// ─── Main Pages Component ───────────────────────────────────────────────────

const Pages: React.FC = () => {
  const navigate = useNavigate();
  const { language } = useTheme();
  const { activeTenantId } = useActiveWorkspace();
  const { canViewAdminData } = usePermissions();
  const [schemas, setSchemas] = useState<PageSchema[]>([]);
  const [tldGroups, setTldGroups] = useState<TLDGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tenantNames, setTenantNames] = useState<Record<string, string>>({});
  const [tenantOptions, setTenantOptions] = useState<Array<{ id: string; name: string }>>([]);

  const fetchAndGroup = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await getSchemas(activeTenantId);
      setSchemas(data);

      // Tenant name resolution is best-effort — don't let it block schema rendering
      try {
        setTenantNames(await getVisibleTenantNameMap(data.map((schema) => schema.tenant_id)));
      } catch (tenantErr) {
        console.warn('[Pages] Tenant name resolution failed, continuing without tenant labels:', tenantErr);
        setTenantNames({});
      }

      // Super-admin TLD management data (ownership + display names): best-effort
      let registryByDomain = new Map<string, TLDRegistryEntry>();
      if (canViewAdminData) {
        try {
          const [domains, tenants] = await Promise.all([getAdminPageDomains(), getVisibleTenants()]);
          registryByDomain = new Map(domains.map((domain) => [domain.domain_url, domain]));
          setTenantOptions(tenants.map((tenant) => ({
            id: tenant.id,
            name: tenant.organization_name ?? tenant.name,
          })));
        } catch (adminErr) {
          console.warn('[Pages] Super-admin domain registry unavailable:', adminErr);
          registryByDomain = new Map();
        }
      }

      const groups = groupSchemasByTLD(data, registryByDomain);

      // Health check per unique domain
      for (const group of groups) {
        if (group.domain) {
          group.health = 'checking';
        }
      }
      setTldGroups([...groups]);

      // Fire health checks in parallel
      for (const group of groups) {
        if (group.domain) {
          checkDomainHealthDirect(group.domain).then(result => {
            setTldGroups(prev => prev.map(g =>
              g.domain === group.domain
                ? { ...g, health: result.status, latency_ms: result.latency_ms }
                : g
            ));
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schemas');
    } finally {
      setIsLoading(false);
    }
  }, [activeTenantId, canViewAdminData]);

  // Super-admin TLD management: move ownership to another tenant and/or set
  // an arbitrary display name. Errors propagate to the caller (the move dialog
  // shows them inline for retry; the rename path falls back to a toast).
  const handleUpdateDomain = useCallback(async (
    domainId: string,
    patch: { tenant_id?: string; display_name?: string | null },
  ) => {
    await updateAdminPageDomain(domainId, patch);
    toast.success(language === 'en' ? 'Domain updated.' : 'Domain aktualisiert.');
    await fetchAndGroup();
  }, [fetchAndGroup, language]);

  useEffect(() => {
    fetchAndGroup();
  }, [fetchAndGroup]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  // ── Empty state: no registered TLD → show onboarding (default schemas always exist)
  const hasRegisteredTLD = tldGroups.some(g => g.domain !== null);
  if (!hasRegisteredTLD) {
    return (
      <OnboardingScreen
        language={language}
        schemas={schemas}
        tenantNames={tenantNames}
        onCreateSchema={() => navigate('/pages/schema/new')}
        onNavigateSchema={(schema) => navigate(getSchemaConsolePath(schema))}
        onRefresh={fetchAndGroup}
      />
    );
  }

  // ── Populated state: TLD-grouped view
  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            {language === 'en' ? 'Pages' : 'Seiten'}
          </h1>
          <p className="text-muted-foreground mt-1">
            {language === 'en'
              ? `${tldGroups.filter(g => g.domain).length} domain${tldGroups.filter(g => g.domain).length !== 1 ? 's' : ''} · ${schemas.length} schema${schemas.length !== 1 ? 's' : ''}`
              : `${tldGroups.filter(g => g.domain).length} Domain${tldGroups.filter(g => g.domain).length !== 1 ? 's' : ''} · ${schemas.length} Schema${schemas.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Button onClick={() => navigate('/pages/schema/new')}>
          <Plus className="h-4 w-4 mr-2" />
          {language === 'en' ? 'New Schema' : 'Neues Schema'}
        </Button>
      </div>

      {/* TLD Groups */}
      <div className="space-y-4">
        {tldGroups.map((group, idx) => (
          <TLDSection
            key={group.domain || '__unassigned__'}
            group={group}
            language={language}
            tenantNames={tenantNames}
            onNavigate={navigate}
            onRefresh={fetchAndGroup}
            isAdmin={canViewAdminData}
            tenantOptions={tenantOptions}
            onUpdateDomain={handleUpdateDomain}
            defaultOpen={idx === 0 || tldGroups.length <= 3}
          />
        ))}
      </div>

      {/* Agent Communication Logs */}
      <AgentLogs language={language} schemas={schemas} />
    </div>
  );
};

export default Pages;
