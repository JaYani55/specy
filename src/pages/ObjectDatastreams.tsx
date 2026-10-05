import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Box, ExternalLink, Loader2, RefreshCw, Radio, ShieldCheck, ShieldOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AdminCard, AdminPageLayout } from '@/components/admin/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ObjectApiAccessControls } from '@/components/objects/ObjectApiAccessControls';
import { useActiveWorkspace } from '@/contexts/ActiveWorkspaceContext';
import { useTheme } from '@/contexts/ThemeContext';
import { API_URL } from '@/lib/apiUrl';
import { getObjectDatastreams, probePublicObjectDatastream, updateObjectApiAccess, type ObjectDatastreamProbe, type ObjectDatastreamRecord } from '@/services/objectService';

const ObjectDatastreams = () => {
  const { language } = useTheme();
  const { activeTenantId } = useActiveWorkspace();
  const [datastreams, setDatastreams] = useState<ObjectDatastreamRecord[]>([]);
  const [probes, setProbes] = useState<Record<string, ObjectDatastreamProbe | { kind: 'checking' }>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [accessTarget, setAccessTarget] = useState<ObjectDatastreamRecord | null>(null);
  const [accessDraft, setAccessDraft] = useState({ api_enabled: false, requires_auth: false });
  const [isSavingAccess, setIsSavingAccess] = useState(false);

  const loadDatastreams = useCallback(async (refresh = false) => {
    try {
      if (refresh) setIsRefreshing(true);
      else setIsLoading(true);
      const records = await getObjectDatastreams(activeTenantId);
      setDatastreams(records);
      setProbes(Object.fromEntries(records.map((record) => [record.id, { kind: 'checking' as const }])));
      setIsLoading(false);

      // Probe in small batches, without an Authorization header, so the result
      // reports the actual anonymous REST availability and not CMS/RLS access.
      for (let offset = 0; offset < records.length; offset += 6) {
        const batch = records.slice(offset, offset + 6);
        const results = await Promise.all(batch.map(async (record) => [
          record.id,
          await probePublicObjectDatastream(record.slug),
        ] as const));
        setProbes((current) => ({ ...current, ...Object.fromEntries(results) }));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Datastreams konnten nicht geladen werden.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [activeTenantId]);

  useEffect(() => {
    void loadDatastreams();
  }, [loadDatastreams]);

  const counts = useMemo(() => ({
    total: datastreams.length,
    public: datastreams.filter((stream) => stream.publicly_readable).length,
    generated: datastreams.filter((stream) => stream.source.kind === 'product').length,
  }), [datastreams]);

  const configStatus = (stream: ObjectDatastreamRecord) => {
    if (stream.status === 'archived') return language === 'en' ? 'Archived' : 'Archiviert';
    if (stream.source.kind === 'product' && stream.requested_api_enabled && stream.api_gate_reason) {
      return language === 'en' ? 'Waiting for Product publication' : 'Produktfreigabe erforderlich';
    }
    if (!stream.requested_api_enabled) return language === 'en' ? 'API disabled' : 'API deaktiviert';
    if (stream.requires_auth) return language === 'en' ? 'Authentication required' : 'Authentifizierung erforderlich';
    return language === 'en' ? 'Public API' : 'Öffentliche API';
  };

  const apiGateMessage = (reason: ObjectDatastreamRecord['api_gate_reason']): string => {
    const english: Record<NonNullable<ObjectDatastreamRecord['api_gate_reason']>, string> = {
      product_retired: 'The source Product is retired.',
      product_page_missing: 'The source Product has no linked Page.',
      product_page_unpublished: 'Publish the Product Page to enable its API stream.',
      product_schema_not_eligible: 'The Product Page must use a registered service-product schema.',
      product_schema_not_registered: 'Register the Product schema with a frontend to enable its API stream.',
    };
    const german: Record<NonNullable<ObjectDatastreamRecord['api_gate_reason']>, string> = {
      product_retired: 'Das Quellprodukt ist archiviert.',
      product_page_missing: 'Dem Quellprodukt ist keine Seite zugeordnet.',
      product_page_unpublished: 'Veröffentliche die Produktseite, um den API-Datenstrom freizuschalten.',
      product_schema_not_eligible: 'Die Produktseite muss ein registriertes Service-Product-Schema verwenden.',
      product_schema_not_registered: 'Registriere das Produktschema bei einem Frontend, um den API-Datenstrom freizuschalten.',
    };
    return reason ? (language === 'en' ? english[reason] : german[reason]) : '';
  };

  const openAccessSettings = (stream: ObjectDatastreamRecord) => {
    setAccessTarget(stream);
    setAccessDraft({ api_enabled: stream.requested_api_enabled, requires_auth: stream.requires_auth });
  };

  const saveAccessSettings = async () => {
    if (!accessTarget) return;
    try {
      setIsSavingAccess(true);
      await updateObjectApiAccess(accessTarget.id, accessDraft);
      toast.success(language === 'en' ? 'API access settings saved.' : 'API-Zugriffseinstellungen gespeichert.');
      setAccessTarget(null);
      await loadDatastreams(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'API-Zugriffseinstellungen konnten nicht gespeichert werden.');
    } finally {
      setIsSavingAccess(false);
    }
  };

  const probeLabel = (stream: ObjectDatastreamRecord) => {
    const result = probes[stream.id];
    if (!result || result.kind === 'checking') return language === 'en' ? 'Checking…' : 'Prüfung läuft …';
    if (result.kind === 'network-error') return language === 'en' ? 'Network/CORS error' : 'Netzwerk-/CORS-Fehler';
    if (stream.publicly_readable && result.kind === 'available') return 'HTTP 200';
    if (!stream.publicly_readable && result.kind === 'not-found') {
      return language === 'en' ? 'HTTP 404 (not public)' : 'HTTP 404 (nicht öffentlich)';
    }
    if (result.kind === 'not-found') return language === 'en' ? 'HTTP 404 — unexpected' : 'HTTP 404 — unerwartet';
    if (result.kind === 'available') return language === 'en' ? 'HTTP 200 — check access flags' : 'HTTP 200 — Zugriffsflags prüfen';
    return `HTTP ${result.httpStatus}`;
  };

  const probeIsUnexpected = (stream: ObjectDatastreamRecord) => {
    const result = probes[stream.id];
    if (!result || result.kind === 'checking' || result.kind === 'network-error') return false;
    return stream.publicly_readable ? result.kind !== 'available' : result.kind === 'available';
  };

  return (
    <AdminPageLayout
      title={language === 'en' ? 'Object Datastreams' : 'Object-Datastreams'}
      description={language === 'en'
        ? 'API availability for all visible Objects, including automatically generated Product streams.'
        : 'API-Verfügbarkeit aller sichtbaren Objects einschließlich automatisch erzeugter Produkt-Datastreams.'}
      icon={Activity}
      actions={(
        <Button variant="outline" onClick={() => void loadDatastreams(true)} disabled={isRefreshing || isLoading}>
          {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {language === 'en' ? 'Refresh status' : 'Status aktualisieren'}
        </Button>
      )}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <AdminCard title={language === 'en' ? 'Visible datastreams' : 'Sichtbare Datastreams'}>
          <p className="text-3xl font-semibold">{counts.total}</p>
        </AdminCard>
        <AdminCard title={language === 'en' ? 'Public API' : 'Öffentliche API'}>
          <p className="text-3xl font-semibold">{counts.public}</p>
        </AdminCard>
        <AdminCard title={language === 'en' ? 'Generated Product streams' : 'Generierte Produkt-Datastreams'}>
          <p className="text-3xl font-semibold">{counts.generated}</p>
        </AdminCard>
      </div>

      {isLoading ? (
        <AdminCard className="mt-6 flex min-h-[220px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </AdminCard>
      ) : datastreams.length === 0 ? (
        <AdminCard className="mt-6 border-dashed">
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
            <Box className="h-10 w-10 text-muted-foreground" />
            <h2 className="text-lg font-semibold">{language === 'en' ? 'No Object datastreams found' : 'Keine Object-Datastreams gefunden'}</h2>
            <p className="max-w-xl text-sm text-muted-foreground">
              {language === 'en'
                ? 'The list includes manually authored Objects and generated Product Objects visible in the selected workspace.'
                : 'Die Liste umfasst manuell gepflegte Objects und generierte Produkt-Objects im ausgewählten Workspace.'}
            </p>
          </div>
        </AdminCard>
      ) : (
        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          {datastreams.map((stream) => {
            const apiUrl = `${API_URL}${stream.endpoint_path}`;
            const probe = probes[stream.id];
            const unexpected = probeIsUnexpected(stream);
            const probeFailed = probe?.kind === 'network-error';
            return (
              <AdminCard key={stream.id} title={stream.name}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={stream.source.kind === 'product' ? 'default' : 'secondary'}>
                    {stream.source.kind === 'product'
                      ? (language === 'en' ? 'Generated Product Object' : 'Generiertes Product-Object')
                      : (language === 'en' ? 'Manual Object' : 'Manuelles Object')}
                  </Badge>
                  <Badge variant={stream.status === 'published' ? 'default' : 'destructive'}>{stream.status}</Badge>
                  <Badge variant={stream.api_enabled ? 'outline' : 'secondary'}>
                    {configStatus(stream)}
                  </Badge>
                  <Badge variant={unexpected || probeFailed ? 'destructive' : 'outline'} className="gap-1">
                    {unexpected || probeFailed ? <ShieldOff className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                    {probeLabel(stream)}
                  </Badge>
                </div>

                {stream.source.kind === 'product' && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {language === 'en' ? 'Product source:' : 'Produktquelle:'} {stream.source.name}
                  </p>
                )}
                {stream.description && <p className="mt-2 text-sm text-muted-foreground">{stream.description}</p>}

                <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-[max-content_1fr]">
                  <dt className="text-muted-foreground">Slug</dt>
                  <dd className="break-all font-mono">{stream.slug}</dd>
                  <dt className="text-muted-foreground">API</dt>
                  <dd className="break-all font-mono">{apiUrl}</dd>
                  <dt className="text-muted-foreground">{language === 'en' ? 'Updated' : 'Aktualisiert'}</dt>
                  <dd>{new Date(stream.updated_at).toLocaleString(language === 'en' ? 'en-GB' : 'de-DE')}</dd>
                </dl>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => openAccessSettings(stream)}>
                    {language === 'en' ? 'API access settings' : 'API-Zugriff einstellen'}
                  </Button>
                  {stream.publicly_readable && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={apiUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-2 h-4 w-4" />
                        {language === 'en' ? 'Open public API' : 'Öffentliche API öffnen'}
                      </a>
                    </Button>
                  )}
                  {stream.source.kind === 'object' && (
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/objects/${stream.id}`}>
                        <Radio className="mr-2 h-4 w-4" />
                        {language === 'en' ? 'Open Object editor' : 'Object-Editor öffnen'}
                      </Link>
                    </Button>
                  )}
                </div>
              </AdminCard>
            );
          })}
        </div>
      )}
      <Dialog open={accessTarget !== null} onOpenChange={(open) => { if (!open && !isSavingAccess) setAccessTarget(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{language === 'en' ? 'Object API access' : 'Object-API-Zugriff'}</DialogTitle>
            <DialogDescription>{accessTarget?.name} · {accessTarget?.slug}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <ObjectApiAccessControls
              apiEnabled={accessDraft.api_enabled}
              requiresAuth={accessDraft.requires_auth}
              onApiEnabledChange={(api_enabled) => setAccessDraft((current) => ({ ...current, api_enabled }))}
              onRequiresAuthChange={(requires_auth) => setAccessDraft((current) => ({ ...current, requires_auth }))}
              disabled={isSavingAccess}
              idPrefix="datastream-access"
            />
          </div>
          {accessTarget?.source.kind === 'product' && accessTarget.api_gate_reason && accessDraft.api_enabled && (
            <Alert>
              <Activity className="h-4 w-4" />
              <AlertTitle>{language === 'en' ? 'Product publication gate' : 'Produktfreigabe'}</AlertTitle>
              <AlertDescription>{apiGateMessage(accessTarget.api_gate_reason)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccessTarget(null)} disabled={isSavingAccess}>
              {language === 'en' ? 'Cancel' : 'Abbrechen'}
            </Button>
            <Button onClick={() => void saveAccessSettings()} disabled={isSavingAccess}>
              {isSavingAccess && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {language === 'en' ? 'Save settings' : 'Einstellungen speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPageLayout>
  );
};

export default ObjectDatastreams;
