import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  Braces,
  Database,
  Eye,
  FileJson,
  KeyRound,
  Loader2,
  Search,
  Shield,
  Waypoints,
} from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { usePermissions } from '@/hooks/usePermissions';
import { AGENT_LOGGER_ENDPOINTS, API_CATALOG, API_TAGS, buildLoggingEndpointKey, type ApiEndpointDefinition } from '@/lib/apiCatalog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { getLoggingConfigSettings, updateLoggingConfigSettings } from '@/services/connectionsService';
import { toast } from 'sonner';

const methodClasses: Record<ApiEndpointDefinition['method'], string> = {
  GET: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  POST: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800',
  PUT: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
  DELETE: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
};

const authLabels: Record<ApiEndpointDefinition['auth'], { en: string; de: string; className: string }> = {
  public: {
    en: 'Public',
    de: 'Öffentlich',
    className: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  'bearer-optional': {
    en: 'Bearer Optional',
    de: 'Bearer optional',
    className: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  },
  'bearer-required': {
    en: 'Bearer Required',
    de: 'Bearer erforderlich',
    className: 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  },
  'worker-secret': {
    en: 'Worker Secret Context',
    de: 'Worker-Secret-Kontext',
    className: 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
  },
};

function CodeBlock({ content }: { content: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-950 p-4 text-xs text-slate-100 dark:border-slate-800">
      <code>{content}</code>
    </pre>
  );
}

function EndpointOperation({ endpoint, language, baseUrl }: { endpoint: ApiEndpointDefinition; language: 'en' | 'de'; baseUrl: string }) {
  const auth = authLabels[endpoint.auth];

  return (
    <AccordionItem value={endpoint.id} className="rounded-2xl border border-slate-200 bg-white px-5 dark:border-slate-800 dark:bg-slate-950/60">
      <AccordionTrigger className="py-5 hover:no-underline">
        <div className="flex w-full flex-col gap-3 text-left md:flex-row md:items-center md:justify-between md:gap-6">
          <div className="flex items-start gap-3">
            <Badge variant="outline" className={methodClasses[endpoint.method]}>
              {endpoint.method}
            </Badge>
            <div className="space-y-1">
              <div className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{endpoint.path}</div>
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{endpoint.summary}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{endpoint.description}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={auth.className}>{auth[language]}</Badge>
            <Badge variant="secondary">{endpoint.tag}</Badge>
            <Badge variant="outline">{endpoint.logging}</Badge>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-5">
        <div className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="border-slate-200 dark:border-slate-800 lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{language === 'de' ? 'Operation' : 'Operation'}</CardTitle>
                <CardDescription>{language === 'de' ? 'Technische Zusammenfassung der Route' : 'Technical route summary'}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">Base URL</div>
                    <div className="font-mono text-xs text-slate-900 dark:text-slate-100">{baseUrl}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">Mounted At</div>
                    <div className="font-mono text-xs text-slate-900 dark:text-slate-100">{endpoint.mountsAt}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">Handler</div>
                    <div className="font-mono text-xs text-slate-900 dark:text-slate-100">{endpoint.sourceFile}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">Logging</div>
                    <div className="text-xs text-slate-900 dark:text-slate-100">{endpoint.logging}</div>
                  </div>
                </div>
                {endpoint.tables && endpoint.tables.length > 0 ? (
                  <div>
                    <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Tables / Backing Stores</div>
                    <div className="flex flex-wrap gap-2">
                      {endpoint.tables.map((table) => (
                        <Badge key={table} variant="outline" className="font-mono text-xs">{table}</Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                {endpoint.sideEffects && endpoint.sideEffects.length > 0 ? (
                  <div>
                    <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Side Effects</div>
                    <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                      {endpoint.sideEffects.map((effect) => (
                        <li key={effect}>• {effect}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {endpoint.notes && endpoint.notes.length > 0 ? (
                  <div>
                    <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Notes</div>
                    <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                      {endpoint.notes.map((note) => (
                        <li key={note}>• {note}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border-slate-200 dark:border-slate-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{language === 'de' ? 'Aufruf' : 'Invocation'}</CardTitle>
                <CardDescription>{language === 'de' ? 'Schneller Überblick für Operators und Agenten' : 'Quick view for operators and agents'}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Method</div>
                  <div className="mt-1"><Badge variant="outline" className={methodClasses[endpoint.method]}>{endpoint.method}</Badge></div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Path</div>
                  <div className="mt-1 font-mono text-xs text-slate-900 dark:text-slate-100">{endpoint.path}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Auth Model</div>
                  <div className="mt-1"><Badge variant="outline" className={auth.className}>{auth[language]}</Badge></div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Observed By</div>
                  <div className="mt-1 text-xs text-slate-700 dark:text-slate-300">{endpoint.logging === 'agentLogger' ? 'agentLogger middleware' : endpoint.logging === 'internal' ? 'route-managed operational path' : 'not logged by middleware'}</div>
                </div>
              </CardContent>
            </Card>
          </div>

          {endpoint.parameters && endpoint.parameters.length > 0 ? (
            <Card className="border-slate-200 dark:border-slate-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{language === 'de' ? 'Parameter' : 'Parameters'}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3">
                  {endpoint.parameters.map((parameter) => (
                    <div key={`${endpoint.id}-${parameter.in}-${parameter.name}`} className="grid gap-2 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800 md:grid-cols-[110px_180px_1fr]">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{parameter.in}</div>
                      <div className="font-mono text-xs text-slate-900 dark:text-slate-100">{parameter.name} {parameter.required ? '*' : ''}</div>
                      <div className="text-xs text-slate-600 dark:text-slate-300">{parameter.type} · {parameter.description}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {endpoint.requestExample ? (
            <Card className="border-slate-200 dark:border-slate-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{language === 'de' ? 'Request Body Beispiel' : 'Request Body Example'}</CardTitle>
              </CardHeader>
              <CardContent>
                <CodeBlock content={endpoint.requestExample} />
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-slate-200 dark:border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{language === 'de' ? 'Responses' : 'Responses'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {endpoint.responseExamples.map((response) => (
                <div key={`${endpoint.id}-${response.status}`} className="space-y-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{response.status}</Badge>
                    <span className="text-sm text-slate-700 dark:text-slate-200">{response.description}</span>
                  </div>
                  {response.example ? <CodeBlock content={response.example} /> : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

const VerwaltungApi: React.FC = () => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { language } = useTheme();
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState('all');
  const [selectedLogKeys, setSelectedLogKeys] = useState<string[]>([]);
  const [loggingLoading, setLoggingLoading] = useState(true);
  const [loggingSaving, setLoggingSaving] = useState(false);

  const loggableEndpoints = useMemo(() => AGENT_LOGGER_ENDPOINTS, []);
  const allLoggableKeys = useMemo(
    () => loggableEndpoints.map((endpoint) => buildLoggingEndpointKey(endpoint)),
    [loggableEndpoints],
  );

  useEffect(() => {
    if (!permissions.canManageAccounts || !permissions.userRoles.includes('super-admin')) {
      navigate('/admin');
    }
  }, [navigate, permissions.canManageAccounts, permissions.userRoles]);

  useEffect(() => {
    let cancelled = false;

    const loadLoggingConfig = async () => {
      setLoggingLoading(true);
      try {
        const logging = await getLoggingConfigSettings();
        if (cancelled) return;

        const validKeys = new Set(allLoggableKeys);
        const nextKeys = logging.mode === 'all'
          ? allLoggableKeys
          : logging.enabledEndpointKeys.filter((entry) => validKeys.has(entry));
        setSelectedLogKeys(nextKeys);
      } catch (error) {
        if (!cancelled) {
          setSelectedLogKeys(allLoggableKeys);
          toast.error(error instanceof Error ? error.message : 'Failed to load logging settings');
        }
      } finally {
        if (!cancelled) {
          setLoggingLoading(false);
        }
      }
    };

    void loadLoggingConfig();

    return () => {
      cancelled = true;
    };
  }, [allLoggableKeys]);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://cms.example.com';

  const counts = useMemo(() => {
    const mutable = API_CATALOG.filter((endpoint) => endpoint.method !== 'GET').length;
    const authProtected = API_CATALOG.filter((endpoint) => endpoint.auth !== 'public').length;
    const logged = loggingLoading ? allLoggableKeys.length : selectedLogKeys.length;
    return {
      total: API_CATALOG.length,
      mutable,
      authProtected,
      logged,
    };
  }, [allLoggableKeys.length, loggingLoading, selectedLogKeys.length]);

  const selectedLogKeySet = useMemo(() => new Set(selectedLogKeys), [selectedLogKeys]);

  const toggleLogKey = (endpointKey: string, checked: boolean) => {
    setSelectedLogKeys((current) => {
      if (checked) {
        return current.includes(endpointKey) ? current : [...current, endpointKey];
      }

      return current.filter((entry) => entry !== endpointKey);
    });
  };

  const saveLoggingConfig = async () => {
    setLoggingSaving(true);
    try {
      const isAllSelected = selectedLogKeys.length === allLoggableKeys.length;
      const saved = await updateLoggingConfigSettings({
        mode: isAllSelected ? 'all' : 'custom',
        enabledEndpointKeys: selectedLogKeys,
      });

      setSelectedLogKeys(saved.mode === 'all' ? allLoggableKeys : saved.enabledEndpointKeys);
      toast.success(language === 'de' ? 'Logging-Einstellungen gespeichert' : 'Logging settings saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save logging settings');
    } finally {
      setLoggingSaving(false);
    }
  };

  const reloadLoggingConfig = async () => {
    setLoggingLoading(true);
    try {
      const logging = await getLoggingConfigSettings();
      const validKeys = new Set(allLoggableKeys);
      setSelectedLogKeys(
        logging.mode === 'all'
          ? allLoggableKeys
          : logging.enabledEndpointKeys.filter((entry) => validKeys.has(entry)),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reload logging settings');
    } finally {
      setLoggingLoading(false);
    }
  };

  const filteredEndpoints = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return API_CATALOG.filter((endpoint) => {
      const matchesTag = activeTag === 'all' || endpoint.tag === activeTag;
      if (!matchesTag) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        endpoint.path,
        endpoint.summary,
        endpoint.description,
        endpoint.sourceFile,
        endpoint.tag,
        endpoint.method,
        ...(endpoint.tables ?? []),
      ].join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [activeTag, query]);

  const grouped = useMemo(() => {
    return API_TAGS.reduce<Record<string, ApiEndpointDefinition[]>>((accumulator, tag) => {
      accumulator[tag] = filteredEndpoints.filter((endpoint) => endpoint.tag === tag);
      return accumulator;
    }, {});
  }, [filteredEndpoints]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-4">
            <Button variant="outline" className="w-fit" onClick={() => navigate('/admin')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {language === 'de' ? 'Zur Verwaltung' : 'Back to Administration'}
            </Button>
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 via-sky-600 to-slate-900 text-white shadow-lg">
                <Waypoints className="h-7 w-7" />
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  {language === 'de' ? 'API Administration' : 'API Administration'}
                </h1>
                <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">
                  {language === 'de'
                    ? 'Swagger-artige Betriebsansicht der Worker-API. Die Oberfläche dokumentiert Methoden, Authentifizierungsmodell, Logging-Verhalten, Speicherzugriffe und Beispiel-Payloads für die beobachtbare API-Schicht.'
                    : 'Swagger-style operational view of the worker API. This screen documents methods, auth model, logging behavior, storage touchpoints, and payload examples for the observable API layer.'}
                </p>
                <div className="font-mono text-xs text-slate-500 dark:text-slate-400">Base URL: {baseUrl}</div>
              </div>
            </div>
          </div>

          <Card className="min-w-[260px] border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-950/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{language === 'de' ? 'Observability Hinweise' : 'Observability Notes'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
              <div>• {language === 'de' ? 'Die meisten /api und /mcp Aufrufe laufen durch agentLogger.' : 'Most /api and /mcp calls pass through agentLogger.'}</div>
              <div>• {language === 'de' ? 'Die Log-Routen sind bewusst separat montiert, um rekursive Logerzeugung zu vermeiden.' : 'The log routes are mounted separately to avoid recursive log generation.'}</div>
              <div>• {language === 'de' ? 'Secrets-Endpunkte sind operator-orientiert und hängen von Worker-Konfiguration statt Browser-Auth ab.' : 'Secrets endpoints are operator-facing and depend on worker configuration rather than browser auth.'}</div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="border-slate-200 dark:border-slate-800">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="rounded-2xl bg-slate-100 p-3 dark:bg-slate-800"><Braces className="h-5 w-5" /></div>
              <div>
                <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{counts.total}</div>
                <div className="text-xs uppercase tracking-wide text-slate-500">{language === 'de' ? 'Dokumentierte Endpunkte' : 'Documented Endpoints'}</div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-slate-200 dark:border-slate-800">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="rounded-2xl bg-sky-100 p-3 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"><Activity className="h-5 w-5" /></div>
              <div>
                <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{counts.logged}</div>
                <div className="text-xs uppercase tracking-wide text-slate-500">{language === 'de' ? 'Beobachtete Operationen' : 'Observed Operations'}</div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-slate-200 dark:border-slate-800">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="rounded-2xl bg-amber-100 p-3 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"><Shield className="h-5 w-5" /></div>
              <div>
                <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{counts.authProtected}</div>
                <div className="text-xs uppercase tracking-wide text-slate-500">{language === 'de' ? 'Nicht rein öffentlich' : 'Not Purely Public'}</div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-slate-200 dark:border-slate-800">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="rounded-2xl bg-rose-100 p-3 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"><Database className="h-5 w-5" /></div>
              <div>
                <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{counts.mutable}</div>
                <div className="text-xs uppercase tracking-wide text-slate-500">{language === 'de' ? 'Mutierende Operationen' : 'Mutating Operations'}</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="pb-4">
            <CardTitle>{language === 'de' ? 'Katalog filtern' : 'Filter Catalog'}</CardTitle>
            <CardDescription>{language === 'de' ? 'Suche nach Pfad, Handler, Tag, Tabelle oder Methode.' : 'Search by path, handler, tag, table, or method.'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder={language === 'de' ? 'z. B. /api/forms, agent_logs, secrets ...' : 'e.g. /api/forms, agent_logs, secrets ...'} />
            </div>
            <Separator />
            <Tabs value={activeTag} onValueChange={setActiveTag}>
              <TabsList className="flex h-auto flex-wrap justify-start gap-2 bg-transparent p-0">
                <TabsTrigger value="all">{language === 'de' ? 'Alle' : 'All'}</TabsTrigger>
                {API_TAGS.map((tag) => (
                  <TabsTrigger key={tag} value={tag}>{tag}</TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value={activeTag} className="mt-6 space-y-6">
                {activeTag === 'all' ? (
                  API_TAGS.map((tag) => (
                    grouped[tag]?.length ? (
                      <section key={tag} className="space-y-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{tag}</h2>
                            <p className="text-sm text-slate-500 dark:text-slate-400">{grouped[tag].length} {language === 'de' ? 'Operationen' : 'operations'}</p>
                          </div>
                          <Badge variant="secondary">{grouped[tag].length}</Badge>
                        </div>
                        <Accordion type="multiple" className="space-y-3">
                          {grouped[tag].map((endpoint) => (
                            <EndpointOperation key={endpoint.id} endpoint={endpoint} language={language} baseUrl={baseUrl} />
                          ))}
                        </Accordion>
                      </section>
                    ) : null
                  ))
                ) : grouped[activeTag]?.length ? (
                  <Accordion type="multiple" className="space-y-3">
                    {grouped[activeTag].map((endpoint) => (
                      <EndpointOperation key={endpoint.id} endpoint={endpoint} language={language} baseUrl={baseUrl} />
                    ))}
                  </Accordion>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    {language === 'de' ? 'Keine Endpunkte entsprechen dem aktuellen Filter.' : 'No endpoints match the current filter.'}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="pb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle>{language === 'de' ? 'Verbosity Settings' : 'Verbosity Settings'}</CardTitle>
                <CardDescription>
                  {language === 'de'
                    ? 'Super-Admin-Allowlist fuer agentLogger. Die Liste wird aus dem API-Katalog gefiltert und zeigt nur Endpunkte, die tatsaechlich durch die Kommunikationslogs laufen koennen.'
                    : 'Super-admin allowlist for agentLogger. The list is filtered from the API catalog and only shows endpoints that can actually flow into the communication logs.'}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setSelectedLogKeys(allLoggableKeys)} disabled={loggingLoading || loggingSaving}>
                  {language === 'de' ? 'Alle aktivieren' : 'Enable all'}
                </Button>
                <Button variant="outline" onClick={() => setSelectedLogKeys([])} disabled={loggingLoading || loggingSaving}>
                  {language === 'de' ? 'Alle deaktivieren' : 'Disable all'}
                </Button>
                <Button variant="outline" onClick={reloadLoggingConfig} disabled={loggingLoading || loggingSaving}>
                  {loggingLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {language === 'de' ? 'Neu laden' : 'Reload'}
                </Button>
                <Button onClick={saveLoggingConfig} disabled={loggingLoading || loggingSaving}>
                  {loggingSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {language === 'de' ? 'Speichern' : 'Save'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <Badge variant="secondary">{selectedLogKeys.length} / {allLoggableKeys.length}</Badge>
              <span>
                {language === 'de'
                  ? 'Secrets- und Log-Endpunkte sind absichtlich ausgeschlossen. Aenderungen werden nach kurzer Middleware-Cache-Zeit wirksam.'
                  : 'Secrets and log-management endpoints are intentionally excluded. Changes become effective after the short middleware cache TTL.'}
              </span>
            </div>

            {loggingLoading ? (
              <div className="flex items-center gap-2 rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                {language === 'de' ? 'Lade Logging-Allowlist ...' : 'Loading logging allowlist ...'}
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {loggableEndpoints.map((endpoint) => {
                  const endpointKey = buildLoggingEndpointKey(endpoint);
                  return (
                    <label
                      key={endpoint.id}
                      htmlFor={`log-endpoint-${endpoint.id}`}
                      className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-slate-700"
                    >
                      <Checkbox
                        id={`log-endpoint-${endpoint.id}`}
                        checked={selectedLogKeySet.has(endpointKey)}
                        onCheckedChange={(checked) => toggleLogKey(endpointKey, checked === true)}
                        className="mt-1"
                      />
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={methodClasses[endpoint.method]}>
                            {endpoint.method}
                          </Badge>
                          <Badge variant="secondary">{endpoint.tag}</Badge>
                          <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{endpoint.path}</span>
                        </div>
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{endpoint.summary}</div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{endpoint.description}</p>
                        <Label htmlFor={`log-endpoint-${endpoint.id}`} className="sr-only">{endpoint.summary}</Label>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="border-slate-200 dark:border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Eye className="h-4 w-4" /> {language === 'de' ? 'Logging-Sicht' : 'Logging View'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <div>• {language === 'de' ? 'agentLogger sitzt vor /api/* und /mcp*.' : 'agentLogger sits in front of /api/* and /mcp*.'}</div>
              <div>• {language === 'de' ? 'Die Log-Endpunkte werden vor /api/schemas montiert, damit /api/schemas/logs nicht erneut geloggt wird.' : 'The log endpoints are mounted before /api/schemas so /api/schemas/logs does not recursively re-log itself.'}</div>
              <div>• {language === 'de' ? 'Super-Admins koennen ueber die Verbosity Settings einzelne agentLogger-Endpunkte gezielt ein- oder ausschalten.' : 'Super-admins can selectively enable or disable individual agentLogger endpoints through Verbosity Settings.'}</div>
            </CardContent>
          </Card>
          <Card className="border-slate-200 dark:border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4" /> {language === 'de' ? 'Auth-Sicht' : 'Auth View'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <div>• {language === 'de' ? 'Form- und Media-Routen interpretieren Authorization: Bearer ... selektiv.' : 'Form and media routes selectively interpret Authorization: Bearer ... .'}</div>
              <div>• {language === 'de' ? 'Secrets-Routen verlassen sich auf Worker-Bindings und CF_API_TOKEN statt Endnutzer-Headern.' : 'Secrets routes rely on worker bindings and CF_API_TOKEN instead of end-user headers.'}</div>
            </CardContent>
          </Card>
          <Card className="border-slate-200 dark:border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><FileJson className="h-4 w-4" /> {language === 'de' ? 'Aktueller Plugin-Status' : 'Current Plugin Status'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <div>• {language === 'de' ? 'api/plugin-routes.ts meldet derzeit keine installierten Plugin-API-Routen.' : 'api/plugin-routes.ts currently reports no installed plugin API routes.'}</div>
              <div>• {language === 'de' ? 'Bei Plugin-Installation muss dieser Katalog erweitert oder dynamisch aus der Registry gespeist werden.' : 'When plugins add APIs, this catalog should be extended or fed dynamically from the registry.'}</div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default VerwaltungApi;